"""Structural enhancement passes applied to pdf2docx output.

pdf2docx reproduces the look of a page but not Word's semantics: headings arrive as
big bold runs instead of Heading styles, list markers as frozen glyphs instead of
w:numPr, page furniture as body text instead of header/footer parts. Each pass here
upgrades one of those, working on the packed .docx bytes (plus the source PDF when a
pass needs per-page geometry). Passes are added one at a time by the quality loop,
each gated on the corpus scoreboard before it lands.

enhance() must stay safe on arbitrary documents: a pass that cannot prove its
transformation applies leaves the document unchanged, and a pass that raises is
skipped (logged as a metric line) rather than failing the conversion.
"""
import copy
import io
import json
import re
from collections import Counter

from docx import Document
from docx.text.paragraph import Paragraph
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

# A run is heading-sized when it clears the body size by 15% AND is either bold or
# dramatically larger. The bold requirement below 1.5x keeps emphasis-sized inline
# runs (a 14pt lead sentence in 11pt body) out of the outline.
HEAD_MIN_RATIO = 1.15
HEAD_BIG_RATIO = 1.5
HEAD_MAX_WORDS = 14
HEAD_MAX_LEVELS = 3
# Bail if the pass would style most of the document: that shape is a poster or
# cover page, not an outline, and spurious Heading styles are worse than none.
HEAD_MAX_SHARE = 0.6
HEAD_MAX_ABS = 40

# Section headings on CVs, reports and letters are often set only a fraction
# larger than the body (10.5pt over 9.5pt here) and carry their rank in BOLD
# CAPITALS instead of size, so the ratio test above misses every one of them.
# A caps heading is recognised structurally, never by wording: the paragraph
# holds nothing but bold, capitalised, body-sized-or-larger text, it is short,
# and it does not end like a sentence or a label.
CAPS_MAX_CHARS = 90
CAPS_MIN_LETTERS = 3
CAPS_MIN_RATIO = 0.95
CAPS_SENTENCE_END = (".", ":", ";", ",", "!", "?")

_STYLE_XML = (
    '<w:style %s w:type="paragraph" w:styleId="Heading%d">'
    '<w:name w:val="heading %d"/><w:qFormat/>'
    '<w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="%d"/></w:pPr>'
    "</w:style>"
)


def _run_size_pt(r):
    rpr = r.find(qn("w:rPr"))
    if rpr is None:
        return None
    sz = rpr.find(qn("w:sz"))
    if sz is None:
        return None
    try:
        return float(sz.get(qn("w:val"))) / 2.0
    except (TypeError, ValueError):
        return None


def _run_bold(r):
    rpr = r.find(qn("w:rPr"))
    if rpr is None:
        return False
    b = rpr.find(qn("w:b"))
    return b is not None and (b.get(qn("w:val")) or "1").lower() not in ("0", "false", "none")


def _run_text(r):
    return "".join(t.text or "" for t in r.findall(qn("w:t")))


def _body_size_pt(paras):
    weight = {}
    for p in paras:
        for r in p.findall(qn("w:r")):
            t = _run_text(r).strip()
            sz = _run_size_pt(r)
            if t and sz:
                weight[sz] = weight.get(sz, 0) + len(t)
    if not weight:
        return None
    return max(weight.items(), key=lambda kv: kv[1])[0]


def _qualifies(sz, bold, body):
    if sz is None or sz < body * HEAD_MIN_RATIO:
        return False
    return bold or sz >= body * HEAD_BIG_RATIO


def _leading_heading_chunks(p, body):
    """(heading_chunks, rest_chunks, heading_size) over direct w:r / w:hyperlink
    children; whitespace-only runs ride along with whichever side they touch."""
    chunks = [c for c in p if c.tag in (qn("w:r"), qn("w:hyperlink"))]
    head, sizes = [], []
    for i, c in enumerate(chunks):
        if c.tag != qn("w:r") or _has_nontext_content(c):
            break  # hyperlinks, drawings, field chars: never part of a heading split
        t = _run_text(c)
        if not t.strip():
            head.append(c)
            continue
        sz = _run_size_pt(c)
        if _qualifies(sz, _run_bold(c), body):
            head.append(c)
            sizes.append(sz)
        else:
            break
    if not sizes:
        return [], chunks, None
    rest = [c for c in chunks if c not in head]
    return head, rest, max(sizes)


def _caps_heading_size(p, body):
    """Font size of a standalone bold ALL-CAPS section heading, else None."""
    chunks = [c for c in p if c.tag in (qn("w:r"), qn("w:hyperlink"))]
    if not chunks:
        return None
    sizes, text = [], []
    for c in chunks:
        # hyperlinks, drawings, field chars, and any line break inside the
        # paragraph mean this is not one standalone heading line
        if c.tag != qn("w:r") or _has_nontext_content(c):
            return None
        if c.find(qn("w:br")) is not None or c.find(qn("w:cr")) is not None:
            return None
        t = _run_text(c)
        text.append(t)
        if not t.strip():
            continue
        if not _run_bold(c):
            return None
        sz = _run_size_pt(c)
        if sz is None or sz < body * CAPS_MIN_RATIO:
            return None
        sizes.append(sz)
    if not sizes:
        return None
    s = "".join(text).strip()
    if not s or len(s) > CAPS_MAX_CHARS or len(s.split()) > HEAD_MAX_WORDS:
        return None
    if s.endswith(CAPS_SENTENCE_END):
        return None
    letters = [ch for ch in s if ch.isalpha()]
    if len(letters) < CAPS_MIN_LETTERS or not all(ch.isupper() for ch in letters):
        return None
    return max(sizes)


def _set_heading_style(p, level):
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        ppr = parse_xml("<w:pPr %s/>" % nsdecls("w"))
        p.insert(0, ppr)
    old = ppr.find(qn("w:pStyle"))
    if old is not None:
        ppr.remove(old)
    ppr.insert(0, parse_xml('<w:pStyle %s w:val="Heading%d"/>' % (nsdecls("w"), level)))


def _ensure_heading_styles(doc, levels):
    styles = doc.styles.element
    have = {s.get(qn("w:styleId")) for s in styles.findall(qn("w:style"))}
    for lvl in sorted(levels):
        if f"Heading{lvl}" not in have:
            styles.append(parse_xml(_STYLE_XML % (nsdecls("w"), lvl, lvl, lvl - 1)))


def heading_styles(data, pdf_doc=None):
    """Give heading-sized text real Heading styles, splitting headings that
    pdf2docx fused into the paragraph that follows them."""
    doc = Document(io.BytesIO(data))
    body_paras = [p._p for p in doc.paragraphs]
    body = _body_size_pt(body_paras)
    if not body:
        return data

    found = []  # (paragraph_element_to_style, heading_size)
    for p in body_paras:
        head, rest, hsize = _leading_heading_chunks(p, body)
        if not head:
            caps_size = _caps_heading_size(p, body)
            if caps_size is not None:
                found.append((p, caps_size))
            continue
        head_words = len(" ".join(_run_text(c) for c in head).split())
        if head_words == 0 or head_words > HEAD_MAX_WORDS:
            continue
        if not rest:
            found.append((p, hsize))
            continue
        rest_text = " ".join(_run_text(c) for c in rest if c.tag == qn("w:r"))
        if not rest_text.strip():
            found.append((p, hsize))
            continue
        # fused heading: pull the heading runs out into their own paragraph
        new_p = copy.deepcopy(p)
        for c in list(new_p):
            if c.tag in (qn("w:r"), qn("w:hyperlink")):
                new_p.remove(c)
        insert_at = len(new_p)  # after pPr, before nothing
        for c in head:
            p.remove(c)
            new_p.insert(insert_at, c)
            insert_at += 1
        p.addprevious(new_p)
        found.append((new_p, hsize))

    if not found:
        return data
    nonempty = sum(1 for p in body_paras if "".join(
        _run_text(r) for r in p.findall(qn("w:r"))).strip())
    # the share bail targets poster/cover shapes; tiny documents (a few
    # headings over little prose) are legitimate outlines, not posters
    if len(found) > HEAD_MAX_ABS or (nonempty >= 8 and len(found) / nonempty > HEAD_MAX_SHARE):
        return data

    distinct = sorted({round(sz * 2) / 2 for _, sz in found}, reverse=True)
    level_of = {sz: min(i + 1, HEAD_MAX_LEVELS) for i, sz in enumerate(distinct)}
    levels = set()
    for p, sz in found:
        lvl = level_of[round(sz * 2) / 2]
        _set_heading_style(p, lvl)
        levels.add(lvl)
    _ensure_heading_styles(doc, levels)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- list numbering ---------------------------------------------------------
# pdf2docx keeps list markers as literal text ("• ", "1. ") so Word sees plain
# paragraphs: no renumbering on edit, no continuation, no outline. This pass
# strips the frozen marker and attaches real w:numPr numbering.
#
# Safety model (each rule earned by a reproduced corruption in review):
# - Detection and stripping share ONE character stream: the text-like elements
#   of DIRECT w:r children. para.text is never used — it includes w:hyperlink
#   text the stripper cannot reach, which misaligns the two streams.
# - Only elements the stripper itself fully consumed are removed; a run is
#   removed only when the stripper emptied it AND nothing but rPr remains.
#   Runs carrying drawings, nested hyperlinks, field chars etc. are never
#   touched, and the python-docx run.text setter (which clears such children)
#   is never used.
# - Ordered stretches convert only when their printed numbers already read
#   1..n, every ordered level renders decimal "%N.", and one stretch gets one
#   shared ilvl — so Word can never show different numbers than the PDF did.
# - Bullet levels reuse the printed marker glyph as the level's lvlText.

BULLET_CHARS = "•●◦○▪·∙‣"
_BULLET_RE = re.compile(r"^\s*([" + BULLET_CHARS + r"\-–*])\s+")
_ORD_RE = re.compile(r"^\s*(\d{1,3})[.)]\s+")
LIST_LEVEL_GAP_PT = 12.0
LIST_MAX_LEVELS = 3
_BULLET_LVLTEXT = ("•", "◦", "▪")
_ORD_LVLS = (("decimal", "%1."), ("decimal", "%2."), ("decimal", "%3."))


def _indent_pt(para):
    ppr = para._p.find(qn("w:pPr"))
    if ppr is None:
        return 0.0
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        return 0.0
    try:
        return float(ind.get(qn("w:left")) or ind.get(qn("w:start"))) / 20.0
    except (TypeError, ValueError):
        return 0.0


_TEXTLIKE = (qn("w:t"), qn("w:tab"), qn("w:br"), qn("w:cr"), qn("w:noBreakHyphen"))


def _char_of(el):
    if el.tag == qn("w:t"):
        return el.text or ""
    if el.tag == qn("w:tab"):
        return "\t"
    if el.tag in (qn("w:br"), qn("w:cr")):
        return "\n"
    return "-"  # noBreakHyphen


def _has_nontext_content(r):
    return any(c.tag != qn("w:rPr") and c.tag not in _TEXTLIKE for c in r)


def _first_content_is_run(p):
    skip = {qn("w:pPr"), qn("w:proofErr"), qn("w:bookmarkStart"), qn("w:bookmarkEnd"),
            qn("w:commentRangeStart"), qn("w:commentRangeEnd")}
    for c in p:
        if c.tag in skip:
            continue
        return c.tag == qn("w:r")
    return False


def _stream_text(p):
    """The exact character stream _consume_prefix can edit: text-like elements
    of DIRECT w:r children only (hyperlink/sdt content deliberately excluded)."""
    out = []
    for r in p.findall(qn("w:r")):
        for el in r:
            if el.tag in _TEXTLIKE:
                out.append(_char_of(el))
    return "".join(out)


def _consume_prefix(p, n):
    """Delete the first n stream characters. Touches only text-like elements,
    removes only elements it fully consumed, and removes a run only when it
    emptied it itself and nothing but rPr remains."""
    for r in list(p.findall(qn("w:r"))):
        if n <= 0:
            break
        touched = False
        for el in list(r):
            if n <= 0:
                break
            if el.tag == qn("w:t"):
                t = el.text or ""
                take = min(len(t), n)
                if not take:
                    continue
                n -= take
                touched = True
                rest = t[take:]
                if rest:
                    el.text = rest
                    el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                else:
                    r.remove(el)
            elif el.tag in _TEXTLIKE:
                n -= 1
                touched = True
                r.remove(el)
        if touched and not any(c.tag != qn("w:rPr") for c in r):
            p.remove(r)


def _numbering_root(doc):
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    try:
        return doc.part.part_related_by(RT.NUMBERING).element
    except KeyError:
        return None


def _add_num(numbering, kind, bullet_chars=None, lvl_rpr=""):
    abs_ids = [int(a.get(qn("w:abstractNumId")) or 0)
               for a in numbering.findall(qn("w:abstractNum"))]
    num_ids = [int(n.get(qn("w:numId")) or 0) for n in numbering.findall(qn("w:num"))]
    aid, nid = max(abs_ids, default=0) + 1, max(num_ids, default=0) + 1
    lvls = []
    for ilvl in range(LIST_MAX_LEVELS):
        if kind == "bul":
            fmt = "bullet"
            txt = (bullet_chars or {}).get(ilvl) or _BULLET_LVLTEXT[ilvl]
        else:
            fmt, txt = _ORD_LVLS[ilvl]
        lvls.append(f'<w:lvl w:ilvl="{ilvl}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/>'
                    f'<w:lvlText w:val="{txt}"/><w:lvlJc w:val="left"/>{lvl_rpr}</w:lvl>')
    abs_el = parse_xml(f'<w:abstractNum {nsdecls("w")} w:abstractNumId="{aid}">'
                       f'<w:multiLevelType w:val="hybridMultilevel"/>{"".join(lvls)}</w:abstractNum>')
    num_el = parse_xml(f'<w:num {nsdecls("w")} w:numId="{nid}">'
                       f'<w:abstractNumId w:val="{aid}"/></w:num>')
    # CT_Numbering sequence: numPicBullet*, abstractNum*, num*, numIdMacAtCleanup?
    cleanup = numbering.find(qn("w:numIdMacAtCleanup"))
    nums = numbering.findall(qn("w:num"))
    abs_anchor = nums[0] if nums else cleanup
    if abs_anchor is not None:
        abs_anchor.addprevious(abs_el)
    else:
        numbering.append(abs_el)
    if cleanup is not None:
        cleanup.addprevious(num_el)
    else:
        numbering.append(num_el)
    return nid


def _set_numpr(para, ilvl, numid):
    # python-docx's CT_PPr accessors place numPr per the schema sequence
    ppr = para._p.get_or_add_pPr()
    numpr = ppr.get_or_add_numPr()
    numpr.get_or_add_ilvl().set(qn("w:val"), str(ilvl))
    numpr.get_or_add_numId().set(qn("w:val"), str(numid))


def _block_levels(indents):
    order = sorted({round(i, 1) for i in indents})
    levels, lvl, prev = {}, 0, None
    for ind in order:
        if prev is not None and ind - prev > LIST_LEVEL_GAP_PT:
            lvl += 1
        levels[ind] = min(lvl, LIST_MAX_LEVELS - 1)
        prev = ind
    return levels


# --- bullet glyphs rasterised as images -------------------------------------
# A vector bullet (a filled dot drawn with a path, not typed as a character)
# has no text for pdf2docx to carry over, so it arrives as a tiny inline PNG at
# the head of the line: a picture where Word expects numbering. This pass finds
# those marks by structure only and re-emits them as real w:numPr list items.
#
# A mark must be a run whose ONLY content is one picture, whose media part is
# a few hundred bytes and whose drawn box is a near-square of at most a dozen
# points. Real artwork fails every one of those; a lone tiny icon still fails
# the "at least two marks in the document" rule below, so a single decorative
# glyph is never promoted to a one-item list.
BULLET_IMG_MAX_BYTES = 400
BULLET_IMG_MAX_EMU = 152400        # 12pt
BULLET_IMG_MIN_EMU = 6350          # 0.5pt
BULLET_IMG_MIN_ASPECT = 0.4
BULLET_IMG_MAX_ASPECT = 2.5
BULLET_IMG_MIN_ITEMS = 2
BULLET_IMG_MIN_TEXT = 2

_PARA_SKIP = (qn("w:pPr"), qn("w:proofErr"), qn("w:bookmarkStart"),
              qn("w:bookmarkEnd"), qn("w:commentRangeStart"),
              qn("w:commentRangeEnd"))


def _para_all_text(p):
    return "".join(t.text or "" for t in p.iter(qn("w:t")))


def _has_numpr(p):
    ppr = p.find(qn("w:pPr"))
    return ppr is not None and ppr.find(qn("w:numPr")) is not None


def _blip_size_bytes(doc, blip):
    rid = blip.get(qn("r:embed"))
    if not rid:
        return None
    try:
        part = doc.part.related_parts[rid]
    except KeyError:
        return None
    try:
        return len(part.blob)
    except Exception:  # noqa: BLE001 - an unreadable part is simply not a mark
        return None


def _is_bullet_mark_run(doc, r):
    """True only for a run that carries one tiny near-square picture, nothing else."""
    kids = [c for c in r if c.tag != qn("w:rPr")]
    if len(kids) != 1 or kids[0].tag != qn("w:drawing"):
        return False
    drawing = kids[0]
    blips = list(drawing.iter(qn("a:blip")))
    if len(blips) != 1:
        return False
    extents = list(drawing.iter(qn("wp:extent")))
    if len(extents) != 1:
        return False
    try:
        cx = int(extents[0].get("cx"))
        cy = int(extents[0].get("cy"))
    except (TypeError, ValueError):
        return False
    if not (BULLET_IMG_MIN_EMU <= cx <= BULLET_IMG_MAX_EMU):
        return False
    if not (BULLET_IMG_MIN_EMU <= cy <= BULLET_IMG_MAX_EMU):
        return False
    if not BULLET_IMG_MIN_ASPECT <= cx / cy <= BULLET_IMG_MAX_ASPECT:
        return False
    size = _blip_size_bytes(doc, blips[0])
    return size is not None and size <= BULLET_IMG_MAX_BYTES


def _leading_mark_run(doc, p):
    for c in p:
        if c.tag in _PARA_SKIP:
            continue
        if c.tag != qn("w:r"):
            return None
        return c if _is_bullet_mark_run(doc, c) else None
    return None


def _celled_mark_target(p):
    """For a mark alone in its own narrow cell, the text cell it belongs to.

    Only a cell holding that single paragraph and nothing else qualifies, and
    only the next cell of the same row can receive the numbering.
    """
    tc = p.getparent()
    if tc is None or tc.tag != qn("w:tc"):
        return None
    if len(tc.findall(qn("w:tbl"))) or len(tc.findall(qn("w:p"))) != 1:
        return None
    row = tc.getparent()
    if row is None or row.tag != qn("w:tr"):
        return None
    cells = row.findall(qn("w:tc"))
    try:
        nxt = cells[cells.index(tc) + 1]
    except (ValueError, IndexError):
        return None
    for cand in nxt.findall(qn("w:p")):
        if _has_numpr(cand):
            return None
        if len(_para_all_text(cand).strip()) >= BULLET_IMG_MIN_TEXT:
            return cand
        return None
    return None


def _marker_rpr(found):
    """Draw the bullet at the size of the text it marks.

    Left unsized, Word renders the glyph at the document default, which on a
    9.5pt CV is visibly larger than the line and inflates every list line's
    height until the page overflows.
    """
    sizes = Counter()
    for _run, target, _owner in found:
        for r in target.findall(qn("w:r")):
            if not any((t.text or "").strip() for t in r.findall(qn("w:t"))):
                continue
            rpr = r.find(qn("w:rPr"))
            sz = rpr.find(qn("w:sz")) if rpr is not None else None
            val = sz.get(qn("w:val")) if sz is not None else None
            try:
                half = int(round(float(val)))
            except (TypeError, ValueError):
                continue
            if 8 <= half <= 200:
                sizes[half] += 1
    if not sizes:
        return ""
    return '<w:rPr><w:sz w:val="%d"/></w:rPr>' % sizes.most_common(1)[0][0]


def bullet_image_lists(data, pdf_doc=None):
    """Vector bullet marks rasterised into inline PNGs -> real list paragraphs."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    found = []  # (mark_run, paragraph_to_number, paragraph_owning_the_run)
    for p in body.iter(qn("w:p")):
        if _has_numpr(p):
            continue
        run = _leading_mark_run(doc, p)
        if run is None:
            continue
        if len(_para_all_text(p).strip()) >= BULLET_IMG_MIN_TEXT:
            found.append((run, p, p))            # mark heads its own text line
            continue
        if _para_all_text(p).strip():
            continue                             # a stray character, not a bullet
        target = _celled_mark_target(p)
        if target is not None:
            found.append((run, target, p))       # mark parked in its own cell
    if len(found) < BULLET_IMG_MIN_ITEMS:
        return data

    numbering = _numbering_root(doc)
    if numbering is None:
        return data
    nid = _add_num(numbering, "bul", lvl_rpr=_marker_rpr(found))
    for run, target, owner in found:
        owner.remove(run)
        _set_numpr(Paragraph(target, doc), 0, nid)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def list_numbering(data, pdf_doc=None):
    """Turn frozen marker glyphs into real Word list numbering."""
    doc = Document(io.BytesIO(data))
    items = []  # (paragraph_index, para, kind, match, indent_pt)
    for i, para in enumerate(doc.paragraphs):
        if not _first_content_is_run(para._p):
            continue  # marker inside a hyperlink/sdt: not ours to edit
        text = _stream_text(para._p)
        m = _ORD_RE.match(text) or _BULLET_RE.match(text)
        if m is None or not text[m.end():].strip():
            continue  # no marker, or marker-only paragraph
        kind = "ord" if m.re is _ORD_RE else "bul"
        items.append((i, para, kind, m, _indent_pt(para)))
    if not items:
        return data

    # dash/asterisk "bullets" are ambiguous with prose; keep one only when an
    # adjacent paragraph is also a dash/asterisk bullet
    ambiguous = "-–*"
    by_idx = {it[0]: it for it in items}
    items = [it for it in items
             if not (it[2] == "bul" and it[3].group(1) in ambiguous)
             or any(n in by_idx and by_idx[n][2] == "bul"
                    and by_idx[n][3].group(1) in ambiguous
                    for n in (it[0] - 1, it[0] + 1))]
    if not items:
        return data

    blocks, cur = [], [items[0]]
    for it in items[1:]:
        if it[0] == cur[-1][0] + 1:
            cur.append(it)
        else:
            blocks.append(cur)
            cur = [it]
    blocks.append(cur)

    numbering = _numbering_root(doc)
    if numbering is None:
        return data

    convert = []  # (item, numid, ilvl)
    for block in blocks:
        levels = _block_levels([it[4] for it in block])
        bullet_nid = None
        bullets = [it for it in block if it[2] == "bul"]
        if bullets:
            # keep the printed glyph per level so the look doesn't change
            per_level = {}
            for it in bullets:
                per_level.setdefault(levels[round(it[4], 1)], []).append(it[3].group(1))
            glyphs = {lvl: Counter(chars).most_common(1)[0][0]
                      for lvl, chars in per_level.items()}
        i = 0
        while i < len(block):
            if block[i][2] == "ord":
                j = i
                while j < len(block) and block[j][2] == "ord":
                    j += 1
                seq = block[i:j]
                printed = [int(e[3].group(1)) for e in seq]
                # split at each printed "1": adjacent restarting lists (natural,
                # or made adjacent by furniture removal) convert per segment;
                # every segment must itself read 1..k or the stretch declines
                starts = [k for k, v in enumerate(printed) if v == 1]
                ok = bool(starts) and starts[0] == 0
                segments = []
                if ok:
                    bounds = starts + [len(seq)]
                    for a, b in zip(bounds, bounds[1:]):
                        if printed[a:b] != list(range(1, b - a + 1)):
                            ok = False
                            break
                        segments.append(seq[a:b])
                if ok:
                    for seg in segments:
                        # one segment = one level: per-item indent jitter must
                        # never split a printed 1..k sequence across counters
                        ilvl = Counter(levels[round(e[4], 1)]
                                       for e in seg).most_common(1)[0][0]
                        nid = _add_num(numbering, "ord")
                        convert.extend((e, nid, ilvl) for e in seg)
                i = j
            else:
                if bullet_nid is None:
                    bullet_nid = _add_num(numbering, "bul", glyphs)
                it = block[i]
                convert.append((it, bullet_nid, levels[round(it[4], 1)]))
                i += 1

    if not convert:
        return data
    for (idx, para, kind, m, ind), nid, ilvl in convert:
        _consume_prefix(para._p, m.end())
        _set_numpr(para, ilvl, nid)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- header / footer parts --------------------------------------------------
# pdf2docx writes page furniture (running headers, footers) into the body once
# per page, because a .docx has no page boundaries to hang it on. This pass uses
# the source PDF's geometry to move that furniture into real header/footer
# parts.
#
# Safety model (each rule earned by a reproduced corruption in review):
# - A text is furniture only when it sits in the top/bottom band on EVERY page
#   and matches EXACTLY page-count body paragraphs. Anything else declines:
#   cover pages, per-chapter headers, occurrences pdf2docx merged into a body
#   paragraph or a table would otherwise cause deleted content or half-removal.
# - A text qualifying in both bands declines (the header sweep would steal the
#   footer's occurrences).
# - Matched paragraphs must be plain text (pPr + text runs only): bookmarks,
#   fields, notes, links, drawings, numbering and section breaks never move
#   into a part or get deleted with one.
# - Documents already carrying header/footer machinery (a section owning a
#   header/footerReference, titlePg, evenAndOddHeaders) decline entirely —
#   which also makes the pass idempotent.

HF_BAND_FRAC = 0.12
HF_MIN_PAGES = 2


def _norm_furniture(s):
    return re.sub(r"\s+", " ", s or "").strip()


def _band_lines(pdf_doc):
    head, foot = {}, {}
    for page in pdf_doc:
        r = page.rect
        top = r.y0 + r.height * HF_BAND_FRAC
        bot = r.y1 - r.height * HF_BAND_FRAC
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                x0, y0, x1, y1 = line["bbox"]
                text = _norm_furniture("".join(s.get("text", "") for s in line.get("spans", [])))
                if not text:
                    continue
                if y1 <= top:
                    target = head
                elif y0 >= bot:
                    target = foot
                else:
                    continue
                e = target.setdefault(text, {"pages": set(), "y": y0})
                e["pages"].add(page.number)
                e["y"] = min(e["y"], y0)
    return head, foot


def _plain_furniture_para(p):
    """True when the paragraph is plain text: safe to delete and to clone into
    a header/footer part. Anything beyond pPr + text runs (bookmarks, fields,
    notes, links, drawings, numbering, section breaks) declines."""
    for c in p:
        if c.tag == qn("w:pPr"):
            if c.find(qn("w:sectPr")) is not None or c.find(qn("w:numPr")) is not None:
                return False
        elif c.tag == qn("w:r"):
            for rc in c:
                if rc.tag != qn("w:rPr") and rc.tag not in _TEXTLIKE:
                    return False
        else:
            return False
    return True


def _cell_texts(doc):
    out = set()
    for tc in doc.element.body.iter(qn("w:tc")):
        for p in tc.iter(qn("w:p")):
            text = _norm_furniture("".join(t.text or "" for t in p.iter(qn("w:t"))))
            if text:
                out.add(text)
    return out


def _hf_blocked(doc, kind):
    ref = qn(f"w:{kind}Reference")
    for sp in doc.element.body.iter(qn("w:sectPr")):
        if sp.find(ref) is not None or sp.find(qn("w:titlePg")) is not None:
            return True
    try:
        if doc.settings.element.find(qn("w:evenAndOddHeaders")) is not None:
            return True
    except Exception:
        pass
    return False


def header_footer_parts(data, pdf_doc=None):
    """Move repeated page furniture into real Word header/footer parts."""
    if pdf_doc is None or pdf_doc.page_count < HF_MIN_PAGES:
        return data
    pages = pdf_doc.page_count
    head, foot = _band_lines(pdf_doc)
    hdr_all = {t: i for t, i in head.items() if len(i["pages"]) == pages}
    ftr_all = {t: i for t, i in foot.items() if len(i["pages"]) == pages}
    overlap = set(hdr_all) & set(ftr_all)
    wanted = {
        "header": sorted((i["y"], t) for t, i in hdr_all.items() if t not in overlap),
        "footer": sorted((i["y"], t) for t, i in ftr_all.items() if t not in overlap),
    }
    if not wanted["header"] and not wanted["footer"]:
        return data

    doc = Document(io.BytesIO(data))
    cells = _cell_texts(doc)
    moved = {"header": [], "footer": []}
    for kind in ("header", "footer"):
        if not wanted[kind] or _hf_blocked(doc, kind):
            continue
        for y, text in wanted[kind]:
            matches = [p for p in doc.paragraphs if _norm_furniture(p.text) == text]
            if len(matches) != pages or text in cells:
                continue
            if not all(_plain_furniture_para(p._p) for p in matches):
                continue
            exemplar = copy.deepcopy(matches[0]._p)
            for p in matches:
                p._p.getparent().remove(p._p)
            moved[kind].append(exemplar)

    if not moved["header"] and not moved["footer"]:
        return data
    section = doc.sections[0]
    for kind, part in (("header", section.header), ("footer", section.footer)):
        if not moved[kind]:
            continue
        part.is_linked_to_previous = False  # fresh part: exactly one empty paragraph
        default_p = part.paragraphs[0]._p
        for exemplar in moved[kind]:
            default_p.addprevious(exemplar)
        if not "".join(t.text or "" for t in default_p.iter(qn("w:t"))).strip():
            default_p.getparent().remove(default_p)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- paragraph reflow --------------------------------------------------------
# pdf2docx fragments logical paragraphs wherever its block detection breaks:
# styled-run line boundaries, column jumps, page breaks. It also carries the
# PDF's end-of-line hyphenation into the text ("equip‐ment"). This pass merges
# fragments back and removes hyphenation — but ONLY where the source PDF
# testifies: two docx paragraphs merge only when their combined token stream is
# contiguous inside one PDF-derived logical paragraph, and a hyphen is removed
# only when the fused word appears at a PDF line break. Merging moves content,
# never deletes it; ambiguity is always a no-op.

HYPHENS = "-‐­"
_TERMINALS = ".!?:;。．！？"  # incl. fullwidth/CJK — pdf2docx splits blocks on these


def _tok(s):
    # unicode-aware: Cyrillic/Arabic/CJK text must be visible to the oracle,
    # or paragraphs carrying it would look empty and get merged over
    return re.findall(r"[^\W_]+", (s or "").lower())


def _first_line_indent(cur_x0, prev_x0, block_x0, size):
    """Does this line start a first-line-indented paragraph inside its block?

    An indent is a step to the RIGHT of the line ABOVE, not merely of the
    block's left edge. Measuring against the block edge alone lies whenever the
    block also holds a line further left than the body — the flush-left label of
    a CV entry whose date sits flush right, which is the very shape pdf2docx
    turns into a table (date_column_untable). Every wrapped body line below such
    a label then measured as an indent, and its paragraph was cut at every
    single line break, leaving a ragged left edge in Word.

    The block-edge term is kept as a conjunct. When block_x0 really is the
    block minimum it is implied by the second term, which is what makes this a
    strict NARROWING of the old block-edge-only rule: it can merge lines that
    rule split and can never split lines it merged. Keeping it written out also
    holds that property for a caller that passes a non-minimal left edge.
    """
    return (cur_x0 > block_x0 + 0.5 * size
            and cur_x0 > prev_x0 + 0.5 * size)


def _pdf_logical_paras(pdf_doc):
    """Reading-order logical paragraphs + words fused across hyphenated line
    breaks. Lines inside a MuPDF block are segmented, not blindly joined: a
    line continues its paragraph only when the previous line is nearly full
    width, does not end a sentence into a capital, and the new line is not
    first-line indented. Segments then join across blocks/columns/pages under
    the same linguistic rules plus tight geometry. Every rule here exists
    because blind joining collapsed book layouts, poems, signature blocks and
    heading-only pages in adversarial review."""
    segs = []  # (page_no, bbox, text, font_size, page_y0, page_h, last_line_full)
    fuse_candidates = []  # (fused_word, hyphen_char)
    interior = set()  # hyphenated forms seen mid-line: NOT hyphenation artifacts

    def note_fuse(a_text, b_text):
        a_text = a_text.rstrip()
        w1 = re.findall(r"[A-Za-z]+", a_text[-24:])
        w2 = re.findall(r"[A-Za-z]+", b_text[:24])
        if not w1 or not w2:
            return
        # a hyphen inside the continuation word, or a chain of them behind the
        # boundary, marks a typographic compound broken at its own hyphen
        # (state-of-the-art) — never a hyphenation artifact (iter-9 guard)
        right_word = re.match(r"\S+", b_text.lstrip())
        left_word = re.search(r"\S+$", a_text)
        if right_word and any(h in right_word.group(0) for h in HYPHENS):
            return
        if left_word and sum(left_word.group(0).count(h) for h in "‐­") >= 2:
            return
        fuse_candidates.append(((w1[-1] + w2[0]).lower(), a_text[-1]))

    def continues(prev_text, prev_full, cur_text, cur_indented):
        a_last = prev_text.rstrip()[-1:]
        b_first = cur_text.lstrip()[:1]
        if not a_last or not b_first or not prev_full or cur_indented:
            return False
        if a_last in _TERMINALS:
            return False
        return b_first.islower() or (a_last in HYPHENS and b_first.isalpha())

    for page in pdf_doc:
        for b in page.get_text("dict").get("blocks", []):
            if b.get("type") != 0:
                continue
            lines = []  # (text, bbox, size)
            for ln in b.get("lines", []):
                t = "".join(s.get("text", "") for s in ln.get("spans", [])).strip()
                if t:
                    size = max((s.get("size", 10.0) for s in ln.get("spans", [])), default=10.0)
                    lines.append((t, ln["bbox"], size))
            if not lines:
                continue
            for (a, _, _), (nxt, _, _) in zip(lines, lines[1:]):
                if a[-1:] in tuple(HYPHENS) and nxt[:1].islower():
                    note_fuse(a, nxt)
            for t, _, _ in lines:
                for m in re.finditer(r"([A-Za-z]+)[" + HYPHENS + r"]([A-Za-z]+)", t):
                    interior.add((m.group(1) + m.group(2)).lower())
            bx0 = min(l[1][0] for l in lines)
            bx1 = max(l[1][2] for l in lines)
            bw = max(bx1 - bx0, 1.0)
            cur_lines, cur_size = [lines[0]], lines[0][2]
            for prev_l, cur_l in zip(lines, lines[1:]):
                # a continuation implies the previous line broke at the column
                # edge: it must fill its block AND the block must be a real
                # text column, not a stack of short standalone lines
                pw = prev_l[1][2] - prev_l[1][0]
                prev_full = pw >= 0.70 * bw and pw >= 90.0
                indented = _first_line_indent(cur_l[1][0], prev_l[1][0], bx0,
                                              cur_l[2])
                if continues(prev_l[0], prev_full, cur_l[0], indented):
                    cur_lines.append(cur_l)
                else:
                    segs.append(_seg_of(page, cur_lines, bw, bx0))
                    cur_lines = [cur_l]
            segs.append(_seg_of(page, cur_lines, bw, bx0))

    # No joining ACROSS blocks: two adversarial reviews proved the geometry
    # gate cannot tell a paragraph break from a line break there (lowercase
    # unterminated paragraphs weld; page-boundary text glues to furniture).
    # A logical paragraph is exactly an intra-block segment, and only segments
    # from real text columns (>=140pt wide) may authorise a merge.
    paras = [seg[2] for seg in segs]
    eligible = [seg[8] for seg in segs]

    # Only typographic hyphens (U+2010 / soft hyphen) mark automatic line
    # breaks; an ASCII "-" at a line end is indistinguishable from a compound
    # broken on its own hyphen ("re-\nform" vs "reform") and never fuses. A
    # form the document also hyphenates mid-line is spelling, never an
    # artifact — meaning must not flip.
    fused = {w for w, h in fuse_candidates if h in "‐­" and w not in interior}

    logical = []
    for p in paras:
        toks = _tok(p)
        # apply the fuses the paragraph itself testified to
        out, k = [], 0
        while k < len(toks):
            if k + 1 < len(toks) and toks[k] + toks[k + 1] in fused:
                out.append(toks[k] + toks[k + 1])
                k += 2
            else:
                out.append(toks[k])
                k += 1
        logical.append(" ".join(out))
    return logical, fused, eligible


def _seg_of(page, lines, block_width, block_x0):
    x0 = min(l[1][0] for l in lines)
    y0 = min(l[1][1] for l in lines)
    x1 = max(l[1][2] for l in lines)
    y1 = max(l[1][3] for l in lines)
    lw = lines[-1][1][2] - lines[-1][1][0]
    last_full = lw >= 0.60 * block_width and lw >= 90.0
    starts_indented = lines[0][1][0] > block_x0 + 0.5 * lines[0][2]
    merge_ok = block_width >= 140.0
    return (page.number, (x0, y0, x1, y1), " ".join(l[0] for l in lines),
            lines[-1][2], page.rect.y0, page.rect.height, last_full, starts_indented,
            merge_ok)


def _reflow_mergeable(p):
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        return True
    return (ppr.find(qn("w:pStyle")) is None and ppr.find(qn("w:numPr")) is None
            and ppr.find(qn("w:sectPr")) is None)


_SPACER_PPR_OK = None  # built lazily: qn() needs the docx namespace map loaded


def _is_blank_spacer(p):
    """A spacer may be swept with a merge ONLY when it carries nothing at all:
    no visible text in any script, no drawings, breaks, bookmarks or fields —
    and no pPr machinery beyond cosmetic spacing (a pStyle, pageBreakBefore or
    framePr changes layout and must survive)."""
    global _SPACER_PPR_OK
    if _SPACER_PPR_OK is None:
        _SPACER_PPR_OK = {qn("w:rPr"), qn("w:spacing"), qn("w:jc"), qn("w:ind")}
    for c in p:
        if c.tag == qn("w:pPr"):
            if any(g.tag not in _SPACER_PPR_OK for g in c):
                return False
            continue
        if c.tag != qn("w:r"):
            return False
        for rc in c:
            if rc.tag == qn("w:rPr"):
                continue
            # ascii-whitespace strip only: an NBSP is content, not blankness
            if rc.tag != qn("w:t") or (rc.text or "").strip(" \t\r\n"):
                return False
    return True


def _strip_trailing_hyphen(p):
    ts = [t for t in p.iter(qn("w:t")) if t.text and t.text.rstrip()]
    if ts:
        txt = ts[-1].text.rstrip()
        if txt[-1:] in tuple(HYPHENS):
            ts[-1].text = txt[:-1]


def _dehyph_within(doc, fused):
    # no optional space: the interior guard sees no spaced forms, so the fuser
    # must not rewrite them either
    pat = re.compile(r"([A-Za-z]{2,})[" + HYPHENS + r"]([A-Za-z]{2,})")
    changed = False
    for para in doc.paragraphs:
        if not _reflow_mergeable(para._p):
            continue  # headings, list items, section paragraphs keep their spelling
        runs = para._p.findall(qn("w:r"))
        for r in runs:
            for t in r.findall(qn("w:t")):
                if t.text and any(h in t.text for h in HYPHENS):
                    new = pat.sub(
                        lambda m: m.group(1) + m.group(2)
                        if (m.group(1) + m.group(2)).lower() in fused else m.group(0),
                        t.text)
                    if new != t.text:
                        t.text = new
                        changed = True
        # hyphen at a run boundary: "…equip‐" + "ment…"
        for ra, rb in zip(runs, runs[1:]):
            ta = [t for t in ra.findall(qn("w:t")) if t.text and t.text.rstrip()]
            tb = [t for t in rb.findall(qn("w:t")) if t.text and t.text.strip()]
            if not ta or not tb:
                continue
            atxt, btxt = ta[-1].text.rstrip(), tb[0].text.lstrip()
            if atxt[-1:] in tuple(HYPHENS):
                w1 = re.findall(r"[A-Za-z]+", atxt[-24:])
                w2 = re.findall(r"[A-Za-z]+", btxt[:24])
                if w1 and w2 and (w1[-1] + w2[0]).lower() in fused:
                    ta[-1].text = atxt[:-1]
                    tb[0].text = tb[0].text.lstrip()
                    changed = True
    return changed


def paragraph_reflow(data, pdf_doc=None):
    """Merge paragraph fragments back together, guided by the source PDF."""
    if pdf_doc is None:
        return data
    logical, fused, eligible = _pdf_logical_paras(pdf_doc)
    if not logical:
        return data
    wrapped = [" " + lp + " " for lp in logical]
    full = set(logical)

    doc = Document(io.BytesIO(data))
    changed = False
    cursor = 0  # logical paragraphs are consumed in document order:
    i = 0       # a fragment pair may never match an earlier region's text
    while True:
        paras = doc.paragraphs
        if i >= len(paras):
            break
        A = paras[i]
        la = _tok(A.text)
        if not la:
            i += 1
            continue
        # next content paragraph; only paragraphs carrying NOTHING (no text in
        # any script, no drawings/breaks/bookmarks) count as sweepable spacers
        spacers, B, j = [], None, i + 1
        while j < len(paras):
            if _is_blank_spacer(paras[j]._p):
                spacers.append(paras[j])
                j += 1
                continue
            B = paras[j]
            break
        if B is None:
            break
        sa = " ".join(la)
        if sa in full:
            for k in range(cursor, len(logical)):
                if logical[k] == sa:
                    cursor = k + 1
                    break
            i = j
            continue
        chain = [A._p] + [s._p for s in spacers] + [B._p]
        if (not all(chain[k].getnext() is chain[k + 1] for k in range(len(chain) - 1))
                or not (_reflow_mergeable(A._p) and _reflow_mergeable(B._p))):
            i = j
            continue
        lb = _tok(B.text)
        if not lb:
            i = j
            continue
        variants = [" " + " ".join(la + lb) + " "]
        a_end = A.text.rstrip()[-1:]
        dehyph = a_end in HYPHENS and (la[-1] + lb[0]) in fused
        if dehyph:
            variants.insert(0, " " + " ".join(la[:-1] + [la[-1] + lb[0]] + lb[1:]) + " ")
        hit = next((v for v in variants
                    if any(v in wrapped[k] for k in range(cursor, len(logical))
                           if eligible[k])), None)
        if hit is None:
            i = j
            continue
        if dehyph and hit is variants[0]:
            _strip_trailing_hyphen(A._p)
        else:
            stream_a = _stream_text(A._p)
            # a word-attached hyphen at the seam joins directly: the compound
            # keeps its printed form (state-of-the-art, well-known) instead of
            # gaining a space after the hyphen (iter-9)
            hyphen_join = bool(re.search(r"[A-Za-z][-‐­]$", stream_a)) and B.text[:1].isalpha()
            if (not hyphen_join and not stream_a.endswith((" ", "\t", "\n"))
                    and not B.text[:1].isspace()):
                joiner = parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve"> </w:t></w:r>')
                last_run = A._p.findall(qn("w:r"))
                if last_run:
                    rpr = last_run[-1].find(qn("w:rPr"))
                    if rpr is not None:
                        rpr = copy.deepcopy(rpr)
                        for deco in ("w:u", "w:strike", "w:dstrike", "w:shd",
                                     "w:highlight", "w:em", "w:bdr", "w:vertAlign"):
                            el = rpr.find(qn(deco))
                            if el is not None:
                                rpr.remove(el)
                        joiner.insert(0, rpr)
                A._p.append(joiner)
        for c in list(B._p):
            if c.tag != qn("w:pPr"):
                A._p.append(c)
        B._p.getparent().remove(B._p)
        for s in spacers:
            s._p.getparent().remove(s._p)
        changed = True
        # stay on A: it may continue absorbing the next fragment

    changed = _dehyph_within(doc, fused) or changed
    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- span-boundary space repair ----------------------------------------------
# pdf2docx drops the inter-word space where a styled or hyperlink span meets
# plain text ("with thedeployment checklist"). A space is restored at a run
# boundary only under double evidence from the PDF's own word stream: the
# fused form is NOT a word the PDF contains, AND the two halves DO appear
# adjacent as separate words. Insertion-only; ambiguity is a no-op.

_EDGE_PUNCT = re.compile(r"^[^\w]+|[^\w]+$")
# ASCII letters/digits only: the seam string tested MUST be the seam string
# edited. Punctuation at a seam ("on"+"-call", "O'"+"Brien", "ISO"+"-9001")
# always declines — stripping it first made the guard test a different string
# than the document contains. CJK seams decline too (no inter-word spaces).
_TAIL_WORD = re.compile(r"[A-Za-z0-9]+$")
_HEAD_WORD = re.compile(r"^[A-Za-z0-9]+")


def _pdf_word_evidence(pdf_doc):
    words, bigrams = set(), set()
    for page in pdf_doc:
        seq = [w for w in (_EDGE_PUNCT.sub("", t[4]).lower()
                           for t in page.get_text("words", sort=True)) if w]
        words.update(seq)
        bigrams.update(zip(seq, seq[1:]))
    return words, bigrams


def _seam_stream(p):
    """Text-like elements of a paragraph in document order, without descending
    into drawings/text boxes/fallback content — their text is not body text."""
    skip = {qn("w:drawing"), qn("w:object"), qn("w:pict")}
    out = []

    def walk(el):
        for c in el:
            if c.tag in skip:
                continue
            if c.tag in _TEXTLIKE:
                out.append(c)
            else:
                walk(c)

    walk(p)
    return out


def span_space_repair(data, pdf_doc=None):
    """Restore inter-word spaces pdf2docx loses at span boundaries."""
    if pdf_doc is None:
        return data
    words, bigrams = _pdf_word_evidence(pdf_doc)
    if not bigrams:
        return data
    doc = Document(io.BytesIO(data))
    changed = False
    for para in doc.paragraphs:
        stream = _seam_stream(para._p)
        for a, b in zip(stream, stream[1:]):
            if a.tag != qn("w:t") or b.tag != qn("w:t"):
                continue
            ta, tb = a.text or "", b.text or ""
            if not ta or not tb:
                continue
            if not (ta[-1].isalnum() and tb[0].isalnum()):
                continue  # only letter-against-letter seams can be lost spaces
            m1, m2 = _TAIL_WORD.search(ta), _HEAD_WORD.search(tb)
            if not m1 or not m2:
                continue
            f1, f2 = m1.group().lower(), m2.group().lower()
            # the WHOLE seam token must be the tested fragment: an interior
            # hyphen or non-ASCII letter ("X-Ray"+"scanner", "Zürich"+"bank")
            # would make the veto probe a substring of a token the PDF holds
            # solid, and corrupt it
            full_tail = re.search(r"\S+$", ta).group()
            full_head = re.search(r"^\S+", tb).group()
            if (_EDGE_PUNCT.sub("", full_tail).lower() != f1
                    or _EDGE_PUNCT.sub("", full_head).lower() != f2):
                continue
            if (f1 + f2) not in words and (f1, f2) in bigrams:
                a.text = ta + " "
                a.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                changed = True
    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- date-column untabling ----------------------------------------------------
# A CV line like "Employer — City" with the dates flush right is one flowed line
# of text with a right tab, but pdf2docx sees two horizontally separated blocks
# and emits a 2-column table for it. The section rule above the line becomes the
# table's top border, which is what makes pdf2docx open a table region at all.
# The result is three defects at once: a table that is not in the source, a stub
# cell that duplicates nothing but eats the reading order, and the continuation
# of a wrapped cell paragraph landing OUTSIDE the table as an orphan paragraph.
#
# Safety model - the pass only fires on a table that cannot be a real grid:
# - No gridlines anywhere. The ONLY border allowed in the whole table is a top
#   border on the first row (that is the section rule pdf2docx absorbed); any
#   start/end/bottom border, or a top border on a later row, means the source
#   had ruling and the table stays. A ruled table is also the only kind
#   pdfplumber-class detectors count, so this rule keeps every countable table.
# - At most two cells per row. Every real table in the corpus (bordered,
#   borderless, ragged, merged) has three or more columns; a two-column strip is
#   the date-column shape.
# - Every multi-cell row must be exactly [left content | right-aligned short
#   cell]. A right-aligned trailing cell is the flush-right tab; a left-aligned
#   one would be a genuine second text column, and the table is left alone.
# - At least one row must have that shape, so a plain single-column layout table
#   (a different defect) is not touched here, and AT MOST DATE_ROW_MAX of them:
#   a flush-right tail repeated down many rows is a column (a ledger, a table of
#   contents), not a one-off tabbed line. Every dissolve on the real-world corpus
#   has exactly one such row.
# - The label side of such a row must contain a real word. A row whose left side
#   is only figures is an amount grid, never "Employer — City".
# - No w:tblStyle. This pass can only see borders written as explicit
#   tcBorders/tblBorders elements, which is all pdf2docx ever emits; a table
#   gridded by a style name would have its gridlines drawn by the style and
#   would look borderless here.
# Text is never rewritten: runs are MOVED, so token recall is bit-exact.
#
# What comes OUT is a single paragraph per flowed line. pdf2docx pads a cell to
# the row height with trailing empty paragraphs, so the label cell's last
# paragraph is often blank; the date has to land on the label, not on that pad,
# or the pass re-creates the very split it exists to remove (and leaves the pad
# behind as a body blank line that is not in the source). _content_paras drops
# TRAILING pads only — an empty paragraph between two lines of cell text is a
# gap the source asked for and survives.
DATE_CELL_MAX_CHARS = 60
DATE_ROW_MAX = 3          # more flush-right tails than this and it is a column
_WORDY = re.compile(r"[^\W\d_]{3,}")   # a run of >=3 letters, any script
_PPR_ORDER = ("pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr",
              "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
              "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct",
              "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd",
              "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
              "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap",
              "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange")
_PPR_IDX = {qn("w:%s" % t): i for i, t in enumerate(_PPR_ORDER)}


def _ppr_insert(ppr, el):
    """Add el to a w:pPr and leave the whole pPr in CT_PPr schema order.

    Simply inserting at the right offset is not enough here: pdf2docx already
    emits its own properties out of sequence (autoSpaceDN before autoSpaceDE,
    widowControl after both), so an insert placed relative to that scrambled
    order stays invalid and schema-strict readers drop the property. Sorting is
    stable, and any tag not in the sequence keeps its relative place at the end.
    """
    ppr.append(el)
    order = sorted(ppr, key=lambda c: _PPR_IDX.get(c.tag, len(_PPR_IDX)))
    for child in order:
        ppr.append(child)


def _real_borders(el):
    """Border sides actually drawn by a w:tcBorders / w:tblBorders child of el."""
    pr = el.find(qn("w:tcPr"))
    if pr is None:
        pr = el.find(qn("w:tblPr"))
    if pr is None:
        return set()
    sides = set()
    for holder in (pr.find(qn("w:tcBorders")), pr.find(qn("w:tblBorders"))):
        if holder is None:
            continue
        for b in holder:
            if (b.get(qn("w:val")) or "none") not in ("none", "nil"):
                sides.add(b.tag.split("}")[1])
    return sides


def _el_text(el):
    return "".join(t.text or "" for t in el.iter(qn("w:t")))


def _norm_border(src):
    """A copy of a w:*Borders side with attribute values Word will actually take.

    pdf2docx writes the raw float it derived from the page ("5.599999999999909")
    into w:sz, which is an xsd:unsignedLong, and a CSS-style "#1A1A1A" into
    w:color, which is a bare hex triplet. Inside a w:tcBorders that is somebody
    else's bug, but this pass re-emits the side as a w:pBdr of its own, so it
    owns making it valid. Values that make no sense at all are dropped rather
    than guessed - a border with no size still draws at Word's default.
    """
    el = copy.deepcopy(src)
    sz = el.get(qn("w:sz"))
    if sz is not None:
        try:
            el.set(qn("w:sz"), str(max(0, min(255, int(round(float(sz)))))))
        except (TypeError, ValueError):
            del el.attrib[qn("w:sz")]
    color = el.get(qn("w:color"))
    if color is not None:
        color = color.strip().lstrip("#")
        if re.fullmatch(r"[0-9A-Fa-f]{6}", color) or color.lower() == "auto":
            el.set(qn("w:color"), color)
        else:
            del el.attrib[qn("w:color")]
    space = el.get(qn("w:space"))
    if space is not None:
        try:
            el.set(qn("w:space"), str(max(0, min(31, int(round(float(space)))))))
        except (TypeError, ValueError):
            del el.attrib[qn("w:space")]
    return el


def _tc_blank(tc):
    """A cell with nothing to lose: no text, no drawing, no embedded object."""
    if _el_text(tc).strip():
        return False
    for tag in ("w:drawing", "w:pict", "w:object", "w:tbl"):
        if tc.find(".//" + qn(tag)) is not None:
            return False
    return True


def _p_padding(p):
    """A paragraph that renders nothing at all: pure cell padding.

    pdf2docx pads a cell out to the row height with trailing empty paragraphs.
    Inside a table those are invisible spacing; flowed into the body by this
    pass they would become blank lines that are not in the source. They also
    decide where the flush-right date lands: it goes on the label cell's first
    CONTENT paragraph (see _first_content), so a pad at either end would detach
    the date from its own label onto a line of its own. Conservative on purpose: anything renderable (a break, a tab, a
    picture, an embedded object) makes the paragraph content, not padding.

    The list also covers markup that renders nothing but is still load-bearing —
    a section definition, a bookmark anchor, a hyperlink shell. None of those can
    legally appear in a table cell, so this is insurance rather than a live case,
    but dropping one would be silent and unrecoverable, and keeping a paragraph
    costs only a blank line.
    """
    if _el_text(p).strip():
        return False
    for tag in ("w:drawing", "w:pict", "w:object", "w:br", "w:tab", "w:tbl",
                "w:sectPr", "w:bookmarkStart", "w:hyperlink"):
        if p.find(".//" + qn(tag)) is not None:
            return False
    return True


def _content_paras(tc):
    """A cell's paragraphs with its trailing padding removed.

    Only TRAILING pads are dropped. A blank paragraph BETWEEN two lines of cell
    text is a deliberate gap in the content and is kept, so this can never close
    up text the source separated. Never returns an empty list for a cell that
    holds anything: the guard keeps the original list if stripping would empty it.
    """
    paras = tc.findall(qn("w:p"))
    kept = list(paras)
    while kept and _p_padding(kept[-1]):
        kept.pop()
    return kept or paras


def _first_content(paras):
    """Index of the first paragraph that is not vertical padding (else 0).

    _content_paras strips only TRAILING pads, because a blank line between two
    lines of cell text is content. A LEADING pad is not content either, and the
    date must not land on one, so it is skipped here rather than deleted.
    """
    for i, p in enumerate(paras):
        if not _p_padding(p):
            return i
    return 0


def _p_jc(p):
    jc = p.find(qn("w:pPr") + "/" + qn("w:jc"))
    return jc.get(qn("w:val")) if jc is not None else None


def _tw(el, tag, attr="w"):
    """Twips read off a w:tcW / w:tblInd inside the element's tcPr or tblPr."""
    node = el.find(qn("w:tcPr") + "/" + qn("w:" + tag))
    if node is None:
        node = el.find(qn("w:tblPr") + "/" + qn("w:" + tag))
    try:
        return int(round(float(node.get(qn("w:" + attr)))))
    except (AttributeError, TypeError, ValueError):
        return 0


def _section_widths(body):
    """(index in body, usable text width in twips) for every sectPr, in order."""
    out = []
    for i, child in enumerate(body):
        for sect in child.iter(qn("w:sectPr")) if child.tag == qn("w:p") else ():
            out.append((i, _sect_width(sect)))
    tail = body.find(qn("w:sectPr"))
    if tail is not None:
        out.append((len(body), _sect_width(tail)))
    return [(i, w) for i, w in out if w > 0]


def _sect_width(sect):
    def num(tag, attr):
        node = sect.find(qn("w:" + tag))
        try:
            return int(round(float(node.get(qn("w:" + attr)))))
        except (AttributeError, TypeError, ValueError):
            return 0
    return num("pgSz", "w") - num("pgMar", "left") - num("pgMar", "right")


def _untable_plan(tbl):
    """[(kind, left_cell, right_cell), ...] per row, or None if tbl is a real table.

    kind is "drop" (nothing in the row), "flow" (one cell, emit as paragraphs),
    "tab" (label + flush-right date -> one tabbed paragraph) or "marker" (a
    glyph-only cell in front of a text cell -> one paragraph, glyph first).
    """
    if _real_borders(tbl):
        return None
    if tbl.find(qn("w:tblPr") + "/" + qn("w:tblStyle")) is not None:
        return None
    rows = tbl.findall(qn("w:tr"))
    if not rows:
        return None
    plan, dates = [], 0
    for ri, tr in enumerate(rows):
        cells = tr.findall(qn("w:tc"))
        if len(cells) > 2:
            return None
        for tc in cells:
            allowed = {"top"} if ri == 0 else set()
            if _real_borders(tc) - allowed:
                return None
            if tc.find(".//" + qn("w:tbl")) is not None:
                return None
            if not tc.findall(qn("w:p")):
                return None
        live = [tc for tc in cells if not _tc_blank(tc)]
        if not live:
            plan.append(("drop", None, None))
            continue
        if len(live) == 1:
            plan.append(("flow", live[0], None))
            continue
        left, right = live
        lps, rps = left.findall(qn("w:p")), right.findall(qn("w:p"))
        if right is not cells[-1] or len(rps) != 1:
            return None
        if _p_jc(rps[0]) == "right":
            # label ... flush-right date
            if (_p_jc(lps[-1]) == "right"
                    or len(_el_text(right).strip()) > DATE_CELL_MAX_CHARS
                    or not _WORDY.search(_el_text(left))):
                return None
            plan.append(("tab", left, right))
            dates += 1
            if dates > DATE_ROW_MAX:
                return None
        elif not _el_text(left).strip() and len(lps) == 1:
            # textless leading cell: the line's bullet glyph, not a column
            plan.append(("marker", left, right))
        else:
            return None
    return plan if dates else None


def _row_width(tr):
    return sum(_tw(tc, "tcW") for tc in tr.findall(qn("w:tc")))


def date_column_untable(data, pdf_doc=None):
    """Flow pdf2docx's flush-right date "tables" back into tabbed paragraphs."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    sects = _section_widths(body)
    changed = False

    # section widths are resolved against the ORIGINAL body order, before the
    # rewrite starts shifting indices around
    candidates = [(c, next((w for i, w in sects if i > idx), 0) or 0)
                  for idx, c in enumerate(body) if c.tag == qn("w:tbl")]

    for tbl, limit in candidates:
        plan = _untable_plan(tbl)
        if plan is None:
            continue
        rows = tbl.findall(qn("w:tr"))
        stop = max((_row_width(tr) for tr in rows), default=0) + _tw(tbl, "tblInd")
        if stop <= 0:
            # no usable w:tcW anywhere (auto-width table). Fall back to the text
            # margin: without a stop the w:tab below would fall to Word's default
            # half-inch grid and the date would sit mid-line instead of flush right
            stop = limit
        if limit:
            stop = min(stop, limit)
        rule = None
        first_pr = rows[0].find(qn("w:tc") + "/" + qn("w:tcPr") + "/" + qn("w:tcBorders"))
        if first_pr is not None:
            top = first_pr.find(qn("w:top"))
            if top is not None and (top.get(qn("w:val")) or "none") not in ("none", "nil"):
                rule = top

        out = []
        for kind, left, right in plan:
            if kind == "drop":
                continue
            if kind == "marker":
                # the glyph cell is furniture in front of the text: move its
                # content to the head of the text paragraph, drop the cell
                target = right.findall(qn("w:p"))[0]
                at = 1 if target.find(qn("w:pPr")) is not None else 0
                for child in reversed([c for c in left.findall(qn("w:p"))[0]
                                       if c.tag != qn("w:pPr")]):
                    child.getparent().remove(child)
                    target.insert(at, child)
                out.append(target)
                continue
            # trailing padding is dropped, so the date lands on the label rather
            # than on a blank line below it, and the cell's row-height spacing
            # does not survive into the body as stray empty paragraphs
            paras = _content_paras(left)
            out.extend(paras)
            if kind == "flow":
                continue
            # The date goes on the label cell's FIRST content line, not its last.
            # _untable_plan only plans a "tab" row when the right cell holds ONE
            # paragraph, i.e. pdf2docx wrote no vertical padding around it, so the
            # date sits at the top of the row and is on the same baseline as the
            # label's first line. Attaching it to the last paragraph reads the
            # same on a one-line label and is wrong on every longer one: on a CV
            # entry whose cell holds a title line and a subtitle line it welded
            # "2020 - 2023" onto the subtitle, fusing three source lines into two.
            target, src = paras[_first_content(paras)], right.findall(qn("w:p"))[0]
            ppr = target.get_or_add_pPr()
            jc = ppr.find(qn("w:jc"))
            if jc is not None:
                ppr.remove(jc)
            if stop > 0:
                tabs = parse_xml('<w:tabs %s><w:tab w:val="right" w:pos="%d"/></w:tabs>'
                                 % (nsdecls("w"), stop))
                old = ppr.find(qn("w:tabs"))
                if old is not None:
                    ppr.remove(old)
                _ppr_insert(ppr, tabs)
            # the gap the two cells used to provide has to survive as a real
            # character: a bare w:tab is invisible to every extractor that reads
            # only w:t, which would silently weld "...Adma" onto "Mar 2025"
            seam = _el_text(target)[-1:] + _el_text(src)[:1]
            gap = "" if (seam.strip() != seam or not seam) else \
                '<w:t xml:space="preserve"> </w:t>'
            target.append(parse_xml("<w:r %s>%s<w:tab/></w:r>" % (nsdecls("w"), gap)))
            for child in list(src):
                if child.tag != qn("w:pPr"):
                    src.remove(child)
                    target.append(child)

        if not out:
            continue
        if rule is not None:
            ppr = out[0].get_or_add_pPr()
            if ppr.find(qn("w:pBdr")) is None:
                pbdr = parse_xml("<w:pBdr %s/>" % nsdecls("w"))
                pbdr.append(_norm_border(rule))
                _ppr_insert(ppr, pbdr)
        for p in out:
            p.getparent().remove(p)
            tbl.addprevious(p)
        body.remove(tbl)
        changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- wrap_break_heal (v2): remove pdf2docx's per-wrapped-line hard breaks ----
# pdf2docx writes a w:br for every wrapped source line it does not space-join,
# so the converted paragraph never re-wraps when edited. v1 healed on line
# fullness alone and was reverted: adversarial review proved the blocks that
# carry such breaks are usually shaped by the author's own deliberate lines
# (verse, addresses, signatures, code, logs, TOCs), so fullness-vs-own-block
# holds by construction. v2 heals only under COMBINED evidence:
#   per block: unique paragraph<->block match; >=3 lines; contains a real
#     sentence terminal; >=40% of continuation lines start lowercase (wrapped
#     prose reads that way, deliberate lines rarely do); no monospace font
#     (code/logs); no digit-tailed lines (TOCs); no CJK/RTL content.
#   per boundary: previous line TRUE width >=70% of block and >=90pt; the next
#     line's first word would NOT have fit in the remaining space (the wrap
#     was forced, not chosen); no tab at the seam; no hyphen at the seam —
#     there is NO fusion branch: hyphen line-ends always keep their break
#     (meaning-flips like re-sign -> resign are reachable otherwise).
# A br that heals becomes a single space (or nothing when whitespace already
# borders it). Ambiguity anywhere = keep the break.

_WRAP_FULL_SHARE = 0.70
_WRAP_FULL_MIN_PT = 90.0
_WRAP_BLOCK_MIN_PT = 140.0
_SOFT_HYPHENS = "\u2010\u00ad"
_SKIP_SUBTREES = (qn("w:drawing"), qn("w:object"), qn("w:pict"), qn("w:hyperlink"),
                  "{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent")
_MONO_RE = re.compile(r"mono|courier|consolas|menlo|andale|code", re.I)
_TERMINAL_RE = re.compile(r"[.!?\u2026](\s|$)")


def _wb_blocks(pdf_doc):
    blocks = []
    for page in pdf_doc:
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            lines, fonts = [], set()
            for ln in b.get("lines", []):
                t = "".join(s["text"] for s in ln["spans"])
                if t.strip():
                    lines.append({"text": t, "x0": ln["bbox"][0], "x1": ln["bbox"][2]})
                    fonts.update(s.get("font", "") for s in ln["spans"])
            if lines:
                blocks.append({"lines": lines, "fonts": fonts,
                               "x0": min(l["x0"] for l in lines),
                               "x1": max(l["x1"] for l in lines)})
    return blocks


def _wb_cjk_or_rtl(text):
    for ch in text:
        o = ord(ch)
        if (0x3000 <= o <= 0x30FF or 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF
                or 0xFF00 <= o <= 0xFFEF or 0xAC00 <= o <= 0xD7AF
                or 0x0590 <= o <= 0x08FF or 0xFB1D <= o <= 0xFEFC):
            return True
    return False


def _wb_block_prose(block):
    """Block-level evidence that this is wrapped flowing prose. Every decline
    here is a named class from adversarial review."""
    lines = block["lines"]
    if len(lines) < 3:
        return False  # addresses, signatures, two-line fragments
    if (block["x1"] - block["x0"]) < _WRAP_BLOCK_MIN_PT:
        return False
    joined = "\n".join(l["text"] for l in lines)
    if _wb_cjk_or_rtl(joined):
        return False
    if any(_MONO_RE.search(f) for f in block["fonts"]):
        return False  # code / log listings
    if sum(1 for l in lines if re.search(r"\d\s*$", l["text"])) >= 2:
        return False  # tables of contents / numbered columns
    if not _TERMINAL_RE.search(joined):
        return False  # no sentence ever ends: not prose
    cont = lines[1:]
    lower = sum(1 for l in cont if l["text"].lstrip()[:1].islower())
    if lower < max(1, round(0.4 * len(cont))):
        return False  # deliberate lines are capitalised units; wraps are not
    return True


def _wb_items(p):
    """Text-like elements of the paragraph in stream order — skipping
    drawing/object/pict/hyperlink/AlternateContent subtrees so nothing inside
    them is ever counted or edited."""
    items = []

    def walk(el):
        for c in el:
            if c.tag in _SKIP_SUBTREES or c.tag == qn("w:pPr"):
                continue
            if c.tag in _TEXTLIKE:
                items.append(c)
            else:
                walk(c)

    walk(p)
    return items


def _wb_segments(items):
    """Split the item stream at wrap w:br elements. None when the paragraph
    carries any break the pass must not touch (page/column breaks, w:cr)."""
    segments, brs, cur = [], [], []
    for el in items:
        if el.tag == qn("w:br"):
            if el.get(qn("w:type")) not in (None, "textWrapping"):
                return None, None
            brs.append(el)
            segments.append(cur)
            cur = []
        elif el.tag == qn("w:cr"):
            return None, None
        else:
            cur.append(el)
    segments.append(cur)
    return segments, brs


def _wb_text(seg):
    return "".join(_char_of(el) for el in seg)


def _wb_align(segments, block):
    """Greedily map segments to consecutive block lines by exact token
    equality; the paragraph must consume the whole block. Returns last-line
    indices per segment or None."""
    ends, li = [], 0
    lines = block["lines"]
    for seg in segments:
        want = _wb_text(seg).split()
        if not want:
            return None
        got, start = [], li
        while li < len(lines) and len(got) < len(want):
            got.extend(lines[li]["text"].split())
            li += 1
        if got != want or li == start:
            return None
        ends.append(li - 1)
    if li != len(lines):
        return None
    return ends


def _wb_drop_empty(el):
    run = el.getparent()
    run.remove(el)
    if not [k for k in run if k.tag != qn("w:rPr")] and not _has_nontext_content(run):
        run.getparent().remove(run)


def _wb_remove_br(br, replace_with_space):
    run = br.getparent()
    if replace_with_space:
        sp = parse_xml('<w:t xml:space="preserve" %s> </w:t>' % nsdecls("w"))
        run.replace(br, sp)
        return
    run.remove(br)
    if not [k for k in run if k.tag != qn("w:rPr")] and not _has_nontext_content(run):
        run.getparent().remove(run)


def _wb_forced(prev, nxt, block):
    """The wrap was FORCED: the next line's first word could not have fit in
    the space left on the previous line (estimated with the previous line's
    own average character width). A break with room to spare was chosen by
    the author and is kept."""
    word = nxt["text"].split()[0] if nxt["text"].split() else ""
    if not word:
        return False
    prev_w = prev["x1"] - prev["x0"]
    if not prev["text"]:
        return False
    avg = prev_w / max(1, len(prev["text"]))
    remaining = block["x1"] - prev["x1"]
    return remaining < (len(word) + 1) * avg


def wrap_break_heal(data, pdf_doc=None):
    if pdf_doc is None:
        return data
    blocks = _wb_blocks(pdf_doc)
    if not blocks:
        return data
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    changed = False

    for p in body.findall(qn("w:p")):
        items = _wb_items(p)
        if not any(el.tag == qn("w:br") for el in items):
            continue
        segments, brs = _wb_segments(items)
        if not brs:
            continue
        matches = []
        for block in blocks:
            ends = _wb_align(segments, block)
            if ends is not None:
                matches.append((block, ends))
                if len(matches) > 1:
                    break
        if len(matches) != 1:
            continue  # ambiguous or absent evidence (unique-match binding)
        block, ends = matches[0]
        if not _wb_block_prose(block):
            continue

        seg_texts = [_wb_text(s) for s in segments]
        for i, br in enumerate(brs):
            prev = block["lines"][ends[i]]
            if ends[i] + 1 >= len(block["lines"]):
                continue
            nxt = block["lines"][ends[i] + 1]
            prev_w = prev["x1"] - prev["x0"]
            if prev_w < _WRAP_FULL_MIN_PT or prev_w < _WRAP_FULL_SHARE * (block["x1"] - block["x0"]):
                continue
            if not _wb_forced(prev, nxt, block):
                continue
            left = seg_texts[i].rstrip()
            right = seg_texts[i + 1].lstrip()
            if not left or not right:
                continue
            if (seg_texts[i].rstrip(" ").endswith("\t")
                    or seg_texts[i + 1].lstrip(" ").startswith("\t")):
                continue
            if left[-1] in _SOFT_HYPHENS or left[-1] == "-":
                continue  # no fusion branch, ever
            needs_space = (not seg_texts[i][-1:].isspace()
                           and not seg_texts[i + 1][:1].isspace())
            _wb_remove_br(br, replace_with_space=needs_space)
            changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


_HYPERLINK_STYLE_XML = (
    '<w:style %s w:type="character" w:styleId="Hyperlink">'
    '<w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/>'
    '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
)


def _link_key(h):
    return (h.get(qn("r:id")), h.get(qn("w:anchor")))


_RPR_ORDER = ("rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
              "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
              "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
              "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
              "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath")
_RPR_IDX = {qn("w:%s" % t): i for i, t in enumerate(_RPR_ORDER)}


def _rpr_insert(rpr, el):
    my = _RPR_IDX.get(el.tag, len(_RPR_IDX))
    for child in rpr:
        if _RPR_IDX.get(child.tag, len(_RPR_IDX)) > my:
            child.addprevious(el)
            return
    rpr.append(el)


def _merge_wrapper_rpr(wrapper_rpr, inner_run):
    """Give an inner run the wrapper run's direct formatting. pdf2docx puts the
    visible underline/color on the wrapper and only rStyle on the inner run, so
    on the (never observed) tag conflict the WRAPPER's value wins — it is what
    Word was rendering. Inner-only properties are inserted at their CT_RPr
    schema position."""
    if wrapper_rpr is None:
        return
    merged = copy.deepcopy(wrapper_rpr)
    old = inner_run.find(qn("w:rPr"))
    if old is not None:
        for child in old:
            if merged.find(child.tag) is None:
                _rpr_insert(merged, copy.deepcopy(child))
        inner_run.remove(old)
    inner_run.insert(0, merged)


def hyperlink_unnest(data, pdf_doc=None):
    """Lift w:hyperlink elements that pdf2docx nests INSIDE w:r up to their
    schema-valid position as siblings of the run. Word tolerates the invalid
    nesting, but schema-strict consumers (LibreOffice, QuickLook, and other
    non-Word apps) drop the whole subtree, deleting the link text on screen.

    Only moves nodes within their own container in document order — the
    character stream is unchanged. Also merges directly-adjacent fragments of
    the same link and defines the referenced Hyperlink character style, which
    pdf2docx names but never defines."""
    doc = Document(io.BytesIO(data))
    changed = False

    work = [h for h in doc.element.body.xpath(".//w:hyperlink")
            if h.getparent().tag == qn("w:r")]
    while work:
        link = work.pop(0)
        run = link.getparent()
        if run is None or run.tag != qn("w:r"):
            continue
        changed = True
        container = run.getparent()
        wrapper_rpr = run.find(qn("w:rPr"))

        kids = list(run)
        at = kids.index(link)
        tail = [k for k in kids[at + 1:]]

        run.remove(link)
        container.insert(list(container).index(run) + 1, link)
        for inner in link.findall(qn("w:r")):
            _merge_wrapper_rpr(wrapper_rpr, inner)
        if tail:
            tail_run = parse_xml("<w:r %s/>" % nsdecls("w"))
            if wrapper_rpr is not None:
                tail_run.append(copy.deepcopy(wrapper_rpr))
            for k in tail:
                run.remove(k)
                tail_run.append(k)
            container.insert(list(container).index(link) + 1, tail_run)
            work[:0] = [h for h in tail_run.iter(qn("w:hyperlink"))
                        if h.getparent().tag == qn("w:r")]
        if not [k for k in run if k.tag != qn("w:rPr")]:
            container.remove(run)
        if container.tag == qn("w:r"):
            work.append(link)

    if changed:
        for link in doc.element.body.xpath(".//w:hyperlink"):
            prev = link.getprevious()
            while (prev is not None and prev.tag == qn("w:hyperlink")
                   and _link_key(prev) == _link_key(link) and _link_key(link) != (None, None)):
                for k in list(link):
                    prev.append(k)
                parent = link.getparent()
                parent.remove(link)
                link = prev
                prev = link.getprevious()

    has_links = bool(doc.element.body.xpath(".//w:hyperlink"))
    if has_links:
        styles_el = doc.styles.element
        defined = any(s.get(qn("w:styleId")) == "Hyperlink"
                      for s in styles_el.findall(qn("w:style")))
        if not defined:
            styles_el.append(parse_xml(_HYPERLINK_STYLE_XML % nsdecls("w")))
            changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- autolink (D9)
# A URL that reached the page as plain text (no PDF link annotation) survives
# pdf2docx as plain text too: readers see the address but cannot click it, and
# Word never renders it as a link. Only shapes that cannot be ordinary prose are
# promoted: an explicit scheme, a www. host, an e-mail address, or a registered
# host + "/" + path on a known TLD. A bare "Inc." or "e.g." can never match.
_XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
_AL_TLD = ("com|net|org|io|dev|edu|gov|co|uk|me|ai|app|info|biz|fr|de|",
           "es|it|nl|se|ch|au|ca|jp|in|eu|us|tv|cc|xyz|online|site|tech")
_AL_TLD = "".join(_AL_TLD)
_AL_STOP = r"[^\s<>\"'\u00a0()\[\]{}]"
_AUTOLINK_RE = re.compile(
    r"https?://" + _AL_STOP + r"{4,}"
    r"|www\.[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+(?:/" + _AL_STOP + r"*)?"
    r"|[A-Za-z0-9][A-Za-z0-9._%+-]*@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}"
    r"|(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+(?:" + _AL_TLD + r")/" + _AL_STOP + r"*",
    re.I)
# Sentence punctuation that a URL may not end on; stripped before wrapping so the
# full stop after a link stays outside the hyperlink.
_AL_TRAIL = ".,;:!?\u2019'\")]}>"
# Per-paragraph and per-document ceilings: a pathological page cannot turn the
# pass into a quadratic rewrite of the whole body.
_AL_MAX_PER_PARA = 40
_AL_MAX_TOTAL = 400


def _al_target(text):
    low = text.lower()
    if low.startswith(("http://", "https://")):
        return text
    if "@" in text and "/" not in text:
        return "mailto:" + text
    return "https://" + text


def _al_segments(p):
    """Maximal runs of consecutive direct-child w:r carrying exactly one w:t and
    nothing else. Any other child (an existing w:hyperlink, a drawing run, a
    break) ends the segment, so already-linked text is never re-scanned and a
    match can never straddle non-text content."""
    segs, cur = [], []
    for el in p:
        if el.tag == qn("w:pPr"):
            continue
        ok = False
        if el.tag == qn("w:r"):
            kids = [k for k in el if k.tag != qn("w:rPr")]
            if len(kids) == 1 and kids[0].tag == qn("w:t"):
                cur.append((el, kids[0]))
                ok = True
        if not ok and cur:
            segs.append(cur)
            cur = []
    if cur:
        segs.append(cur)
    return segs


def _al_locate(items, pos, end=False):
    acc = 0
    for i, (_r, t) in enumerate(items):
        n = len(t.text or "")
        if (pos < acc + n) or (end and pos <= acc + n and n > 0):
            return i, pos - acc
        acc += n
    return len(items) - 1, len(items[-1][1].text or "")


def _al_split(run, t, off):
    """Split run in place at character offset off; the tail becomes a new run
    inserted right after it, carrying a copy of the same rPr."""
    txt = t.text or ""
    new = copy.deepcopy(run)
    nt = new.find(qn("w:t"))
    t.text = txt[:off]
    nt.text = txt[off:]
    t.set(_XML_SPACE, "preserve")
    nt.set(_XML_SPACE, "preserve")
    run.addnext(new)
    return new, nt


def _al_style(run):
    rpr = run.find(qn("w:rPr"))
    if rpr is None:
        rpr = parse_xml("<w:rPr %s/>" % nsdecls("w"))
        run.insert(0, rpr)
    old = rpr.find(qn("w:rStyle"))
    if old is not None:
        rpr.remove(old)
    _rpr_insert(rpr, parse_xml('<w:rStyle %s w:val="Hyperlink"/>' % nsdecls("w")))


def _al_wrap(items, s, e, rid):
    """Wrap the [s, e) character range of a segment in a w:hyperlink placed as a
    SIBLING of the runs it covers (never inside a w:r - that nesting is invalid
    OOXML and schema-strict readers drop the subtree)."""
    i, off = _al_locate(items, s)
    if off > 0:
        nr, nt = _al_split(items[i][0], items[i][1], off)
        items.insert(i + 1, (nr, nt))
        i += 1
    j, off2 = _al_locate(items, e, end=True)
    if j < i:
        return False
    if off2 < len(items[j][1].text or ""):
        nr, nt = _al_split(items[j][0], items[j][1], off2)
        items.insert(j + 1, (nr, nt))
    covered = [r for r, _t in items[i:j + 1]]
    if not covered:
        return False
    link = parse_xml('<w:hyperlink %s r:id="%s"/>' % (nsdecls("w", "r"), rid))
    covered[0].addprevious(link)
    for r in covered:
        r.getparent().remove(r)
        link.append(r)
        _al_style(r)
    return True


def hyperlink_autolink(data, pdf_doc=None):
    """D9: promote URL- and e-mail-looking text that arrived as plain runs into
    real w:hyperlink elements with an external relationship in
    document.xml.rels. PDF link annotations already reach pdf2docx as links;
    what this recovers is the address a PDF printed without an annotation
    behind it, which is the common case for a CV contact line.

    Runs last in the pipeline so no earlier pass has to reason about the new
    elements, and so the text it matches is the final reflowed text. Character
    content is never added, removed or reordered - runs are only split at match
    boundaries and re-parented under a sibling w:hyperlink."""
    doc = Document(io.BytesIO(data))
    added = 0

    for p in doc.element.body.iter(qn("w:p")):
        for _ in range(_AL_MAX_PER_PARA):
            if added >= _AL_MAX_TOTAL:
                break
            hit = None
            for seg in _al_segments(p):
                text = "".join(t.text or "" for _r, t in seg)
                for m in _AUTOLINK_RE.finditer(text):
                    raw = m.group(0).rstrip(_AL_TRAIL)
                    if len(raw) < 5 or not _AUTOLINK_RE.fullmatch(raw):
                        continue
                    hit = (seg, m.start(), m.start() + len(raw), raw)
                    break
                if hit:
                    break
            if hit is None:
                break
            seg, s, e, raw = hit
            rid = doc.part.relate_to(_al_target(raw), RT.HYPERLINK, is_external=True)
            if not _al_wrap(list(seg), s, e, rid):
                break
            added += 1

    if not added:
        return data

    styles_el = doc.styles.element
    if not any(st.get(qn("w:styleId")) == "Hyperlink"
               for st in styles_el.findall(qn("w:style"))):
        styles_el.append(parse_xml(_HYPERLINK_STYLE_XML % nsdecls("w")))

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- font_names: carry the PDF's font families onto the runs (D7) -----------
# pdf2docx writes <w:rFonts w:ascii="" w:hAnsi="" w:eastAsia=""/> on every run:
# it resolves the span's font through its own installed-font table and, when the
# PostScript name is not an installed family, stores the empty string. Word then
# falls back to the theme font, so the converted document loses the source
# typeface everywhere. This pass reads the font of each PDF span, maps the
# PostScript name to a Word family name (subset tag and weight/style suffix
# stripped - the weight already lives in w:b/w:i), and writes it onto the runs
# whose rFonts is still empty. It never overwrites a font a run already names,
# and it only assigns a family it can tie to the run's own text: exact span-text
# match first, then a per-token vote over the spans, and the document's single
# family as the last resort (a document with two or more families leaves an
# unmatched run alone rather than guess).

_FONT_SUBSET_RE = re.compile(r"^[A-Z]{6}\+")
_FONT_SPLIT_RE = re.compile(r"[-_\s]+")
_FONT_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_FONT_TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
# style/weight words that name a face inside a family, never the family itself
_FONT_STYLE_WORDS = {
    "regular", "normal", "book", "roman", "plain", "upright",
    "bold", "semibold", "demibold", "demi", "medium", "light", "extralight",
    "ultralight", "thin", "black", "heavy", "extrabold", "ultrabold", "hairline",
    "italic", "oblique", "bolditalic", "boldoblique", "semibolditalic",
    "italicmt", "boldmt", "bolditalicmt", "psmt", "mt", "ps", "std", "pro",
    "condensed", "cd", "narrow", "extended", "expanded", "cond",
}
# PostScript families with a settled Word equivalent
_FONT_ALIASES = {
    "arial": "Arial", "arialmt": "Arial", "arialunicodems": "Arial Unicode MS",
    "arialnarrow": "Arial Narrow",
    "times": "Times New Roman", "timesnewroman": "Times New Roman",
    "timesnewromanps": "Times New Roman", "timesnewromanpsmt": "Times New Roman",
    "courier": "Courier New", "couriernew": "Courier New",
    "couriernewps": "Courier New", "helvetica": "Helvetica",
    "helveticaneue": "Helvetica Neue", "symbol": "Symbol", "symbolmt": "Symbol",
    "zapfdingbats": "Wingdings", "calibri": "Calibri", "cambria": "Cambria",
}
_FONT_ALIAS_RES = (
    (re.compile(r"^lmroman\d*$"), "Latin Modern Roman"),
    (re.compile(r"^lmsans\d*$"), "Latin Modern Sans"),
    (re.compile(r"^lmmono\d*$"), "Latin Modern Mono"),
    (re.compile(r"^cmr\d*$"), "Latin Modern Roman"),
)
_FONT_MAX_LEN = 31          # Word's own limit on a font name
_FONT_VOTE_SHARE = 0.6      # a token vote must be this decisive to be used


def _font_family(ps_name):
    """Word family name for a PDF font, or None when the name carries none."""
    if not ps_name:
        return None
    name = _FONT_SUBSET_RE.sub("", str(ps_name).strip())
    name = name.split(",")[0].strip()
    if not name or name.startswith("."):
        return None          # system-internal (.SFNS-Regular_wdth_opsz1)
    parts = [p for p in _FONT_SPLIT_RE.split(name) if p]
    if not parts:
        return None
    base = parts[0]
    for extra in parts[1:]:
        if extra.lower() in _FONT_STYLE_WORDS:
            continue
        base += extra       # "Foo-Sans" -> FooSans, a real family distinction
    key = base.lower()
    if key in _FONT_ALIASES:
        return _FONT_ALIASES[key]
    for rx, fam in _FONT_ALIAS_RES:
        if rx.match(key):
            return fam
    words = [w for w in _FONT_CAMEL_RE.split(base) if w]
    # only TRAILING style words are a face, and the first word is always the
    # family ("BookAntiqua" keeps its Book, "JacobsChronosLight" drops Light)
    while len(words) > 1 and words[-1].lower() in _FONT_STYLE_WORDS:
        words.pop()
    fam = " ".join(words).strip()
    if len(fam) < 2 or len(fam) > _FONT_MAX_LEN:
        return None
    if not any(c.isalpha() for c in fam):
        return None
    if fam.lower().startswith("unnamed"):
        return None
    return fam


def _font_evidence(pdf_doc):
    """(text -> family, token -> Counter(family), lone family) from the PDF."""
    by_text, by_token, weight = {}, {}, Counter()
    for page in pdf_doc:
        try:
            blocks = page.get_text("dict")["blocks"]
        except Exception:  # noqa: BLE001 - a broken page must not kill the pass
            continue
        for block in blocks:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = (span.get("text") or "").strip()
                    fam = _font_family(span.get("font"))
                    if not text or not fam:
                        continue
                    weight[fam] += len(text)
                    by_text.setdefault(text, set()).add(fam)
                    for tok in _FONT_TOKEN_RE.findall(text.lower()):
                        by_token.setdefault(tok, Counter())[fam] += 1
    exact = {t: next(iter(f)) for t, f in by_text.items() if len(f) == 1}
    lone = next(iter(weight)) if len(weight) == 1 else None
    return exact, by_token, lone


def _font_for_text(text, exact, by_token, lone):
    key = text.strip()
    if key in exact:
        return exact[key]
    votes = Counter()
    for tok in _FONT_TOKEN_RE.findall(key.lower()):
        votes.update(by_token.get(tok, ()))
    if votes:
        fam, n = votes.most_common(1)[0]
        if n >= _FONT_VOTE_SHARE * sum(votes.values()):
            return fam
    return lone


def _font_run_text(run):
    return "".join(t.text or "" for t in run.findall(qn("w:t")))


def _font_needs_name(rpr):
    """True when the run names no font at all (missing or all-empty rFonts)."""
    if rpr is None:
        return True
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        return True
    return not any((rf.get(qn("w:" + a)) or "").strip()
                   for a in ("ascii", "hAnsi", "asciiTheme", "hAnsiTheme", "cs"))


def font_names(data, pdf_doc=None):
    """Name each run's font family, taken from the PDF span it came from."""
    if pdf_doc is None:
        return data
    exact, by_token, lone = _font_evidence(pdf_doc)
    if not exact and not by_token:
        return data
    doc = Document(io.BytesIO(data))
    changed = False
    for run in doc.element.body.iter(qn("w:r")):
        text = _font_run_text(run)
        if not text.strip():
            continue
        rpr = run.find(qn("w:rPr"))
        if not _font_needs_name(rpr):
            continue
        fam = _font_for_text(text, exact, by_token, lone)
        if not fam:
            continue
        if rpr is None:
            rpr = parse_xml("<w:rPr %s/>" % nsdecls("w"))
            run.insert(0, rpr)
        rf = rpr.find(qn("w:rFonts"))
        if rf is None:
            rf = parse_xml("<w:rFonts %s/>" % nsdecls("w"))
            _rpr_insert(rpr, rf)
        rf.set(qn("w:ascii"), fam)
        rf.set(qn("w:hAnsi"), fam)
        rf.set(qn("w:cs"), fam)
        changed = True
    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- section_rules ----------------------------------------------------------
# pdf2docx keeps a page's hairline section rules only when a table happens to
# absorb one as a cell border; a rule that sits under a plain heading line is
# dropped, so a converted CV loses every divider under SUMMARY, PROJECTS,
# TECHNICAL SKILLS. This pass re-emits such a rule as what Word would have
# authored in the first place: a bottom border on the paragraph above it.
# Evidence is geometric and per-rule: a filled or stroked drawing that is a
# hairline (<= 2.5pt tall), spans a large share of the page, and sits within a
# few points under exactly one text line. A rule is skipped when the block
# after the anchor is a table whose first row already carries a top border
# (that is the same rule, already absorbed - drawing it twice is worse than
# the status quo), when the anchor line is long enough to be prose, or when
# the page is full of hairlines (a form grid or a ruled table, not section
# furniture).
_RULE_MAX_H_PT = 2.5
_RULE_MIN_WIDTH_SHARE = 0.35
_RULE_MAX_GAP_PT = 12.0
_RULE_MAX_ANCHOR_WORDS = 12
_RULE_MAX_PER_PAGE = 12
_RULE_MIN_HEADER_PAGES = 3
_RULE_BDR_XML = ('<w:pBdr %s><w:bottom w:val="single" w:sz="6" w:space="1" '
                 'w:color="auto"/></w:pBdr>')
# CT_PPrBase child sequence; pBdr has to be inserted at its own slot.
_PPR_ORDER = ("pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr",
              "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd",
              "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap",
              "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN",
              "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
              "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc",
              "textDirection", "textAlignment", "textboxTightWrap",
              "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange")
_PPR_INDEX = {qn("w:" + n): i for i, n in enumerate(_PPR_ORDER)}


def _rule_norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def _rule_lines(page):
    out = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            text = "".join(sp.get("text", "") for sp in line.get("spans", []))
            if text.strip():
                out.append((line["bbox"], text))
    return out


def _page_rules(page):
    """Anchor texts of the hairline rules on one page, in reading order."""
    width = page.rect.width
    rects = []
    for drawing in page.get_drawings():
        r = drawing["rect"]
        if r.height > _RULE_MAX_H_PT or r.width < _RULE_MIN_WIDTH_SHARE * width:
            continue
        if any(item[0] not in ("re", "l") for item in drawing.get("items", ())):
            continue
        rects.append(r)
    if not rects or len(rects) > _RULE_MAX_PER_PAGE:
        return []
    lines = _rule_lines(page)
    out = []
    for r in sorted(rects, key=lambda x: x.y0):
        above = [(bb, t) for bb, t in lines
                 if bb[3] <= r.y0 + 1.5 and r.y0 - bb[3] <= _RULE_MAX_GAP_PT
                 and bb[0] < r.x1 and bb[2] > r.x0]
        if not above:
            continue
        bb, text = max(above, key=lambda e: e[0][3])
        # two lines ending at the same height means the rule underlines a
        # column pair, not one heading: the anchor is ambiguous, leave it
        if sum(1 for b, _ in above if abs(b[3] - bb[3]) < 1.0) != 1:
            continue
        if len(text.split()) > _RULE_MAX_ANCHOR_WORDS:
            continue
        out.append(_rule_norm(text))
    return out


def _pdf_rule_anchors(pdf_doc):
    """Rule anchor texts across the document, in reading order.

    A line that anchors a rule on _RULE_MIN_HEADER_PAGES or more DIFFERENT
    pages is a running page header with a hairline under it, not section
    furniture: it has no single paragraph in the docx to underline, and its
    text tends to reappear as ordinary prose. Every occurrence of such an
    anchor is dropped before the match walk.
    """
    per_page = [_page_rules(page) for page in pdf_doc]
    pages_seen = {}
    for texts in per_page:
        for t in set(texts):
            pages_seen[t] = pages_seen.get(t, 0) + 1
    running = {t for t, n in pages_seen.items() if n >= _RULE_MIN_HEADER_PAGES}
    return [t for texts in per_page for t in texts if t not in running]


def _tbl_has_top_border(tbl):
    for name in ("tblBorders", "tcBorders"):
        for el in tbl.iter(qn("w:" + name)):
            top = el.find(qn("w:top"))
            if top is not None and (top.get(qn("w:val")) or "nil") not in ("nil", "none"):
                return True
    return False


def _add_bottom_border(p):
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        ppr = parse_xml("<w:pPr %s/>" % nsdecls("w"))
        p.insert(0, ppr)
    if ppr.find(qn("w:pBdr")) is not None:
        return False
    bdr = parse_xml(_RULE_BDR_XML % nsdecls("w"))
    limit = _PPR_INDEX[qn("w:pBdr")]
    for child in ppr:
        if _PPR_INDEX.get(child.tag, len(_PPR_ORDER)) > limit:
            child.addprevious(bdr)
            return True
    ppr.append(bdr)
    return True


def section_rules(data, pdf_doc=None):
    """Re-emit a hairline PDF rule under a heading as that heading's bottom border."""
    if pdf_doc is None:
        return data
    anchors = _pdf_rule_anchors(pdf_doc)
    if not anchors:
        return data
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    blocks = list(body)
    paras = [(i, el, _rule_norm("".join(t.text or "" for t in el.iter(qn("w:t")))))
             for i, el in enumerate(blocks) if el.tag == qn("w:p")]
    changed = False
    cursor = 0
    for anchor in anchors:
        if not anchor:
            continue
        hit = None
        for k in range(cursor, len(paras)):
            # exact match only: a prefix match lets a short anchor swallow a
            # body sentence that merely starts with the same words, and draws
            # a rule through the middle of prose
            if paras[k][2] == anchor:
                hit = k
                break
        if hit is None:
            continue
        cursor = hit + 1
        i, el, _ = paras[hit]
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        if nxt is not None and nxt.tag == qn("w:tbl") and _tbl_has_top_border(nxt):
            continue  # the same rule already survived as that table's top border
        changed |= _add_bottom_border(el)
    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- empty_para_prune -------------------------------------------------------
# pdf2docx pads the body with empty paragraphs: one before the first block to
# reproduce the top margin, one on either side of a section break, one where a
# dropped drawing used to sit. A Word reader sees stray blank lines. This pass
# keeps at most ONE empty paragraph between two blocks of content and drops
# the leading and trailing ones outright. Only a paragraph carrying nothing at
# all qualifies: a drawing, a break, a border, a field or a bookmark span all
# make it load-bearing. A paragraph whose only payload is a w:sectPr is never
# deleted (that is the page/section break itself) but it does count as the one
# blank a run is allowed, so the padding around it goes.
_EMPTY_PPR_OK = None


def _para_blankness(p):
    """'content', 'empty' (droppable) or 'sect' (blank but load-bearing)."""
    global _EMPTY_PPR_OK
    if _EMPTY_PPR_OK is None:
        _EMPTY_PPR_OK = {qn("w:rPr"), qn("w:spacing"), qn("w:jc"), qn("w:ind"),
                         qn("w:autoSpaceDE"), qn("w:autoSpaceDN"),
                         qn("w:widowControl"), qn("w:textAlignment"),
                         qn("w:contextualSpacing"), qn("w:snapToGrid"),
                         qn("w:bidi"), qn("w:adjustRightInd"),
                         qn("w:kinsoku"), qn("w:overflowPunct"),
                         qn("w:wordWrap"), qn("w:suppressAutoHyphens")}
    sect = False
    for c in p:
        if c.tag == qn("w:pPr"):
            for g in c:
                if g.tag == qn("w:sectPr"):
                    sect = True
                elif g.tag not in _EMPTY_PPR_OK:
                    return "content"
            continue
        if c.tag in (qn("w:bookmarkStart"), qn("w:bookmarkEnd")):
            continue
        if c.tag != qn("w:r"):
            return "content"
        for rc in c:
            if rc.tag == qn("w:rPr"):
                continue
            # ascii-whitespace strip only: an NBSP is content, not blankness
            if rc.tag != qn("w:t") or (rc.text or "").strip(" \t\r\n"):
                return "content"
    return "sect" if sect else "empty"


def empty_para_prune(data, pdf_doc=None):
    """Drop stray empty paragraphs: none leading or trailing, at most one between."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    blocks = [el for el in body if el.tag in (qn("w:p"), qn("w:tbl"))]
    kinds = ["content" if el.tag == qn("w:tbl") else _para_blankness(el)
             for el in blocks]
    doomed, i = [], 0
    while i < len(blocks):
        if kinds[i] == "content":
            i += 1
            continue
        j = i
        while j < len(blocks) and kinds[j] != "content":
            j += 1
        run = list(zip(blocks[i:j], kinds[i:j]))
        edge = i == 0 or j == len(blocks)
        if any(k == "sect" for _, k in run):
            keep = None          # the section break already is the blank line
        elif edge:
            keep = None          # leading/trailing padding is never wanted
        else:
            keep = run[0][0]
        doomed.extend(el for el, k in run if k == "empty" and el is not keep)
        i = j
    if not doomed:
        return data
    for el in doomed:
        body.remove(el)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# Order is load-bearing and enhance() is single-shot: hyperlink_unnest runs
# first so every later pass sees schema-valid hyperlink positions, and
# span_space_repair must see the document BEFORE reflow's dehyphenation (a
# healed word looks like a lost-space seam to a second run). The pipeline
# calls enhance() exactly once per conversion; never chain it. font_names runs
# LAST so it names the final run set: reflow and list_numbering merge and split
# runs, and naming before them would leave the survivors unnamed.
# wrap_break_heal (v2) is NOT enabled — backlog #8 is BLOCKED after two dead
# ends: even combined geometric+content evidence leaks on real shapes (lyric
# sheets, contract clauses, block-vote dilution, estimator lies — see
# out/adv_iter10). Its reopening blueprint (guard-cost table) is in backlog.md.
# date_column_untable runs AFTER header_footer_parts on purpose: that pass keys
# off which text is still inside a table cell, so dissolving a layout table in
# front of it would change which lines it lifts into the page furniture.
# bullet_image_lists runs AFTER heading_styles and BEFORE list_numbering: it
# only promotes runs that are still plain paragraphs, not headings, and it
# must land its w:numPr before list_numbering assigns numbering IDs.
# --- fused source lines / phantom centred indents ----------------------------
# pdf2docx emits one w:p per text BLOCK it decided the page has, so source lines
# it groups together arrive welded into a single paragraph: a CV entry's title,
# its flush-right date and the degree line underneath end up as one paragraph
# carrying three different font sizes, and the two centred contact lines of a
# header end up as one. The centred ones also carry the x-offset pdf2docx
# measured for them as a real w:ind, 108pt of left AND right indent on the CV's
# contact line, which is not an indent at all but the page's own centring
# restated as a margin, and it makes Word re-wrap a line that fits.
#
# fused_line_split cuts on PDF evidence only, never on wording:
#   * the paragraph's text must match ONE contiguous window of >=2 source lines,
#     and that window must be UNIQUE in the whole PDF: an ambiguous match cuts
#     nothing, so a repeated boilerplate line can never drag a cut onto a
#     paragraph it does not belong to;
#   * the cut has to fall exactly on a boundary between two child elements of
#     the paragraph, so runs are never sliced and no run property is guessed;
#   * a tab at the seam vetoes the cut: a tab is how both pdf2docx and
#     date_column_untable encode "these two source lines are one visual line,
#     label left and date right", and cutting there would put the date on a
#     line of its own;
#   * and the break must be DELIBERATE rather than a wrap, meaning the two lines
#     come from different PDF blocks, or the dominant font size changes across
#     the break. Wrapped prose is one size inside one block, so it matches
#     neither test and is left alone.
FS_MIN_WINDOW = 2
FS_SIZE_EPS = 0.5          # pt, smaller than any real typographic step
FS_SPLIT_MAX = 200         # runaway guard: a document this shape is not a page
FS_CENTRE_EPS = 3.0        # pt of drift allowed between two centred lines
FS_X0_EPS = 2.0            # pt below which two lines share a left edge
FS_OFFSET_PT = 36.0        # pt right of the column edge that is not a body line
_FS_SPLITTABLE = (qn("w:r"), qn("w:hyperlink"), qn("w:bookmarkStart"),
                  qn("w:bookmarkEnd"), qn("w:proofErr"), qn("w:smartTag"))
_FS_OPAQUE = ("w:drawing", "w:pict", "w:object", "w:txbxContent")
_FS_WS_RE = re.compile(r"\s+")


def _fs_norm(s):
    """Whitespace-normalised text, so a docx run stream and a PDF line compare."""
    return _FS_WS_RE.sub(" ", s.replace("\xa0", " ").replace("\u202f", " ")
                         .replace("\u2007", " ")).strip()


def _fs_lines(pdf_doc):
    """Every source line in page order: text, owning block, dominant font size.

    The dominant span (the longest one) gives the size, not the largest span: a
    trailing footnote marker or a superscript must not make a line read as a
    size change.
    """
    out = []
    for pi, page in enumerate(pdf_doc):
        page_lines = []
        for bi, block in enumerate(page.get_text("dict")["blocks"]):
            if block.get("type") != 0:
                continue
            for ln in block.get("lines", []):
                spans = [sp for sp in ln["spans"] if sp["text"].strip()]
                text = _fs_norm("".join(sp["text"] for sp in spans))
                if not text:
                    continue
                dom = max(spans, key=lambda sp: len(sp["text"]))
                page_lines.append({"text": text, "block": (pi, bi),
                                   "x0": ln["bbox"][0], "x1": ln["bbox"][2],
                                   "size": round(float(dom.get("size") or 0.0), 2)})
        # the column's right edge, taken from the page's own widest line: a
        # single-line block's own x1 IS where its text ended, so it can never
        # show that the line ran out of room
        right = max((l["x1"] for l in page_lines), default=0.0)
        left = min((l["x0"] for l in page_lines), default=0.0)
        for line in page_lines:
            line["page_right"] = right
            line["page_left"] = left
        out.extend(page_lines)
    return out


def _fs_children(p):
    """[(element, text)] for the paragraph's content children, or None to bail.

    Bails on anything this pass must not move or reason about: a picture or a
    text box (its anchor position is not the run stream), a hard break (already
    a line boundary, wrap_break_heal owns those), a list paragraph, or any child
    tag outside the known-safe set.
    """
    if p.find(qn("w:pPr") + "/" + qn("w:numPr")) is not None:
        return None
    if p.find(".//" + qn("w:br")) is not None:
        return None
    for tag in _FS_OPAQUE:
        if p.find(".//" + qn(tag)) is not None:
            return None
    items = []
    for child in p:
        if child.tag == qn("w:pPr"):
            continue
        if child.tag not in _FS_SPLITTABLE:
            return None
        items.append((child, _el_text(child)))
    return items


def _fs_tabbed(el):
    return el.find(".//" + qn("w:tab")) is not None


def _fs_window(text, lines):
    """The one contiguous >=FS_MIN_WINDOW-line window whose join is `text`."""
    hit = None
    for i, first in enumerate(lines):
        if not text.startswith(first["text"]):
            continue
        acc = first["text"]
        for j in range(i + 1, len(lines)):
            acc = acc + " " + lines[j]["text"]
            if len(acc) > len(text) or not text.startswith(acc):
                break
            if acc == text and j - i + 1 >= FS_MIN_WINDOW:
                if hit is not None:
                    return None          # ambiguous: cut nothing
                hit = (i, j)
                break
    return hit


def _fs_forced(a, b):
    """The break was FORCED: b's first word could not have fit on the rest of a.

    Same estimate wrap_break_heal uses in the other direction (a's own average
    character width), against the column's right edge rather than the block's:
    when a page's font sizes vary, fitz hands back one BLOCK per visual line,
    and such a block's right edge is just where its own text stopped.
    """
    word = (b["text"].split() or [""])[0]
    if not word or not a["text"]:
        return False
    avg = (a["x1"] - a["x0"]) / max(1, len(a["text"]))
    return (a["page_right"] - a["x1"]) < (len(word) + 1) * avg


def _fs_centred_pair(a, b):
    """Two lines centred on the same axis: each is a line the author placed.

    A wrapped continuation returns to its block's left edge, so a line that
    starts somewhere else yet shares the previous line's centre was set that
    way (a title, a contact line), not run onto by the margin.
    """
    return (abs((a["x0"] + a["x1"]) / 2 - (b["x0"] + b["x1"]) / 2) <= FS_CENTRE_EPS
            and abs(a["x0"] - b["x0"]) > FS_X0_EPS)


def _fs_offset_line(a):
    """`a` starts far right of the column, so nothing wrapped onto it.

    A flush-right date is the case that matters: it ends hard against the right
    margin, which makes the room-to-spare test above read every break after it
    as forced, when in truth no body line could ever have continued there.
    """
    return (a["x0"] - a["page_left"]) > FS_OFFSET_PT


def _fs_deliberate(a, b):
    """True when the break between two source lines is a real line, not a wrap.

    TYPOGRAPHY first: one block at one size is flowing text and is never cut.
    Then GEOMETRY, because neither half of the first test is sufficient alone —
    an inline size change (a 14pt lead sentence inside 11pt body) lands on a
    line break sooner or later, and fitz blocks split on exactly that. So the
    second line must also look like a line of its own: centred with the first
    on a shared axis, or starting with room to spare on the line above.
    """
    if a["block"] == b["block"] and abs(a["size"] - b["size"]) < FS_SIZE_EPS:
        return False
    return (_fs_centred_pair(a, b) or _fs_offset_line(a)
            or not _fs_forced(a, b))


def _fs_cuts(items, lines, i, j):
    """Child indices to cut at, for the matched source-line window lines[i:j+1]."""
    offsets, acc = {}, ""
    for k, (_, text) in enumerate(items):
        acc += text
        offsets.setdefault(len(_fs_norm(acc)), k + 1)
    cuts, pos = [], 0
    for m in range(i, j):
        pos += len(lines[m]["text"])
        k = offsets.get(pos)
        pos += 1                          # the space the join put between them
        if not _fs_deliberate(lines[m], lines[m + 1]):
            continue
        if k is None or k <= 0 or k >= len(items):
            continue                      # the line break falls inside a run
        if _fs_tabbed(items[k - 1][0]) or _fs_tabbed(items[k][0]):
            continue                      # a label/date column, not two lines
        if not _fs_norm("".join(t for _, t in items[:k])):
            continue
        if not _fs_norm("".join(t for _, t in items[k:])):
            continue
        cuts.append(k)
    return cuts


def _fs_split(p, items, cuts):
    """Move each group of children after a cut into a paragraph of its own."""
    groups = [[items[x][0] for x in range(a, b)]
              for a, b in zip(cuts, cuts[1:] + [len(items)])]
    for group in reversed(groups):
        new = copy.deepcopy(p)
        for child in list(new):
            if child.tag != qn("w:pPr"):
                new.remove(child)
        for child in group:
            child.getparent().remove(child)
            new.append(child)
        p.addnext(new)


def fused_line_split(data, pdf_doc=None):
    """Split paragraphs pdf2docx welded out of separate source lines."""
    if pdf_doc is None:
        return data
    lines = _fs_lines(pdf_doc)
    if len(lines) < FS_MIN_WINDOW:
        return data
    doc = Document(io.BytesIO(data))
    splits = 0
    for p in doc.element.body.findall(qn("w:p")):
        items = _fs_children(p)
        if not items or len(items) < 2:
            continue
        text = _fs_norm("".join(t for _, t in items))
        if not text:
            continue
        window = _fs_window(text, lines)
        if window is None:
            continue
        cuts = _fs_cuts(items, lines, *window)
        if not cuts:
            continue
        splits += len(cuts)
        if splits > FS_SPLIT_MAX:
            return data
        _fs_split(p, items, cuts)
    if not splits:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# On a centred paragraph a left and a right indent of the same size cannot move
# the text: the centre of the box is the centre of the page either way. So it is
# never authored, it is pdf2docx restating where the line happened to start and
# end. Keeping it only shrinks the box until Word re-wraps a line that fitted.
# Asymmetric or small indents are left alone, those can be real.
CENTRED_IND_MIN_TW = 720   # twips (0.5"), below this the box is not squeezed
CENTRED_IND_SKEW = 0.2     # left/right may differ by this share of the larger
_IND_SIDES = ("left", "start", "right", "end")


def _ind_tw(ind, *names):
    for name in names:
        raw = ind.get(qn("w:" + name))
        if raw is None:
            continue
        try:
            return int(round(float(raw)))
        except (TypeError, ValueError):
            return None
    return None


def centred_indent_drop(data, pdf_doc=None):
    """Drop the measured x-offset pdf2docx leaves as an indent on centred lines."""
    doc = Document(io.BytesIO(data))
    changed = False
    for p in doc.element.body.iter(qn("w:p")):
        if _p_jc(p) != "center":
            continue
        ind = p.find(qn("w:pPr") + "/" + qn("w:ind"))
        if ind is None:
            continue
        left = _ind_tw(ind, "left", "start")
        right = _ind_tw(ind, "right", "end")
        if left is None or right is None:
            continue
        if min(left, right) < CENTRED_IND_MIN_TW:
            continue
        if abs(left - right) > CENTRED_IND_SKEW * max(left, right):
            continue
        for side in _IND_SIDES:
            if ind.get(qn("w:" + side)) is not None:
                del ind.attrib[qn("w:" + side)]
        if not ind.attrib:
            ind.getparent().remove(ind)
        changed = True
    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# fused_line_split runs after date_column_untable so it sees the tabs that pass
# writes (a tab at a seam vetoes a cut), and before heading_styles so a title
# line freed from its subtitle can still be recognised as a heading.
# section_rules and empty_para_prune run last of all: the border needs the
# final paragraph text (reflow may still be merging it) and the prune has to
# see the empties every earlier pass left behind, font_names included (it
# only ever touches runs with text, so the empties it leaves alone are exactly
# what the prune is for).

PASSES = (hyperlink_unnest, span_space_repair, header_footer_parts, date_column_untable,
          fused_line_split, centred_indent_drop, heading_styles, bullet_image_lists,
          list_numbering, paragraph_reflow, hyperlink_autolink, font_names,
          section_rules, empty_para_prune)


def enhance(docx_bytes, pdf_doc=None):
    """All accepted passes, in order. A failing pass is skipped, never fatal."""
    data = docx_bytes
    for pass_fn in PASSES:
        try:
            data = pass_fn(data, pdf_doc)
        except Exception as e:  # noqa: BLE001 - conversion must survive a bad pass
            print(json.dumps({"m": "enhance_pass_failed", "pass": pass_fn.__name__,
                              "err": f"{type(e).__name__}: {e}"[:300]}))
    return data
