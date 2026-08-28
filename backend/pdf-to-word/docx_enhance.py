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
import zipfile
from collections import Counter

from lxml import etree

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


# --- whole-line space realign -------------------------------------------------
# span_space_repair works seam by seam and needs the two halves of the seam to be
# whole PDF words. When pdf2docx shatters a line into per-glyph runs
# ("TE"|"CHNICAL"|"S"|"K"|"I"|"L"|"LS") the seam halves are fragments, the bigram
# probe cannot match, and a lost space survives ("TECHNICALSKILLS"). This pass
# works on the paragraph's whole text stream instead: it fires only when the
# paragraph, with all whitespace removed, is character-for-character identical to
# exactly one PDF line that carries MORE whitespace, and then re-inserts that
# line's spaces at the aligned offsets. Insertion-only, exact-match-only.

# A PDF line whose own tokens are mostly single characters is letter-spaced
# display text ("H e l l o"), which pdf2docx correctly joins; re-splitting it
# would be the corruption, so such a line is never used as evidence.
_LS_OK_SOLO = frozenset("aAiIoO&+-/:0123456789")
_WS_RE = re.compile(r"\s+")


def _lsr_usable_line(line):
    for tok in line.split():
        if len(tok) > 1:
            continue
        if tok in _LS_OK_SOLO or not tok.isalnum():
            continue
        return False
    return True


def _lsr_pdf_lines(pdf_doc):
    """despaced text -> the single PDF line producing it (None when ambiguous)."""
    index = {}
    for page in pdf_doc:
        for raw in page.get_text("text").split("\n"):
            line = raw.strip()
            if not line or not _WS_RE.search(line):
                continue  # a line with no space cannot donate one
            key = _WS_RE.sub("", line)
            if len(key) < 4:
                continue
            if key in index and index[key] != line:
                index[key] = None  # two different spacings, no safe choice
            else:
                index.setdefault(key, line)
    return index


_WS_RE = re.compile(r"\s+")


def _lsr_insert_offsets(para_text, line_text):
    """Offsets in para_text where line_text has whitespace and para_text does not."""
    offsets, i = [], 0
    n = len(para_text)
    for ch in line_text:
        if ch.isspace():
            # a real gap in the PDF line: insert unless the docx already has one
            if 0 < i < n and not para_text[i - 1].isspace() and not para_text[i].isspace():
                offsets.append(i)
            continue
        while i < n and para_text[i].isspace():
            i += 1
        if i >= n or para_text[i] != ch:
            return None  # alignment broke; refuse
        i += 1
    while i < n and para_text[i].isspace():
        i += 1
    return offsets if i == n else None


def line_space_realign(data, pdf_doc=None):
    """Restore spaces lost inside a run-shattered line, by whole-line alignment."""
    if pdf_doc is None:
        return data
    index = _lsr_pdf_lines(pdf_doc)
    if not index:
        return data
    doc = Document(io.BytesIO(data))
    changed = False
    for para in doc.paragraphs:
        stream = [el for el in _seam_stream(para._p) if el.tag == qn("w:t")]
        if not stream:
            continue
        if len(_seam_stream(para._p)) != len(stream):
            continue  # tabs/breaks in the paragraph: offsets are not comparable
        text = "".join(el.text or "" for el in stream)
        key = _WS_RE.sub("", text)
        if len(key) < 4:
            continue
        line = index.get(key)
        if not line or line == text or not _lsr_usable_line(line):
            continue
        offsets = _lsr_insert_offsets(text, line)
        if not offsets:
            continue
        # apply right-to-left so earlier offsets stay valid
        bounds, acc = [], 0
        for el in stream:
            start = acc
            acc += len(el.text or "")
            bounds.append((start, acc, el))
        for off in reversed(offsets):
            for start, end, el in bounds:
                if start < off <= end:
                    t = el.text or ""
                    el.text = t[: off - start] + " " + t[off - start:]
                    el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                    break
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


# A flush-right date cell does not always arrive as w:jc="right". pdf2docx sizes
# the cell to the text block it found and then reproduces the horizontal position
# it measured, so on some layouts it writes the SAME visual shape as an ordinary
# left-aligned paragraph carrying a large w:ind — the indent IS the gap that
# pushes the date to the cell's right edge. The CV that opened this defect wrote
# `<w:jc w:val="left"/><w:ind w:left="722"/>` in a 3866-twip cell, so
# _untable_plan counted zero dates and refused the whole table; the ADDITIONAL
# EXPERIENCE line then survived as a 2-column table with the section rule frozen
# into a tcBorders top.
#
# _pushed_right is the one place that decides "this cell's single line sits at
# the right of its cell", and it accepts either spelling:
#   - w:jc right (what pdf2docx writes most of the time), or
#   - a left/start-aligned line whose effective left indent is a large share of
#     the cell's own width. The share is what makes it structural rather than a
#     guess: a genuine left-aligned second text column is indented by a cell
#     margin or a paragraph indent, both of which are small against the column
#     they sit in, while a date pushed to the right edge has to give up most of
#     the cell to whitespace. Both a share floor and an absolute floor must be
#     cleared, so a narrow cell cannot qualify on a quarter-inch of margin.
# Every other guard in _untable_plan (single paragraph, <= DATE_CELL_MAX_CHARS,
# trailing cell, wordy label, <= DATE_ROW_MAX rows, no real borders, no tblStyle)
# applies to this spelling exactly as it does to w:jc="right".
# The indent spelling also has to be ONE line. A w:jc="right" cell says outright
# that its content is right-aligned however many lines it holds; a big w:ind says
# only where the FIRST line starts, and a multi-line cell that happens to start
# there is a second column, not a date. A letterhead in the real-world corpus is
# exactly that: a right-hand block of phone/fax/web lines, short enough to clear
# DATE_CELL_MAX_CHARS, that this pass would otherwise inline behind the postal
# address. So the indent branch additionally requires a paragraph with no w:br.
IND_RIGHT_SHARE = 0.15    # of the cell width, at minimum
IND_RIGHT_MIN_TW = 360    # and never less than a quarter inch


def _p_ind_left(p):
    """Effective left offset of the paragraph's first line, in twips."""
    ind = p.find(qn("w:pPr") + "/" + qn("w:ind"))
    if ind is None:
        return 0
    left = _ind_tw(ind, "left", "start") or 0
    first = _ind_tw(ind, "firstLine") or 0
    hanging = _ind_tw(ind, "hanging") or 0
    return left + first - hanging


def _pushed_right(p, cell_w):
    """True when p's line sits at the right of a cell cell_w twips wide."""
    jc = _p_jc(p)
    if jc == "right":
        return True
    if jc not in (None, "left", "start", "both"):
        return False
    if cell_w <= 0:
        return False
    if p.find(".//" + qn("w:br")) is not None:
        return False
    return _p_ind_left(p) >= max(IND_RIGHT_MIN_TW, IND_RIGHT_SHARE * cell_w)


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
        if _pushed_right(rps[0], _tw(right, "tcW")):
            # label ... flush-right date (w:jc right, or pushed there by w:ind)
            if (_pushed_right(lps[-1], _tw(left, "tcW"))
                    or len(_el_text(right).strip()) > DATE_CELL_MAX_CHARS
                    or not _WORDY.search(_el_text(left))):
                return None
            # One cell can hold SEVERAL dates stacked behind soft breaks, one
            # per label line in the cell beside it (pdf2docx merges a whole run
            # of CV entries into a single 1x2 row that way). Each date then
            # belongs to its own label; moving the cell wholesale stacks them
            # all on the first label and leaves the rest of the entries dateless.
            # Pair them only when the count matches exactly on both sides, and
            # every label is a real line of words; anything else is a shape this
            # pass cannot read, so it leaves the table alone rather than stack.
            nseg = _br_stack_count(rps[0])
            if nseg is None:
                return None
            if nseg:
                labels = [p for p in _content_paras(left) if not _p_padding(p)]
                if len(labels) != nseg + 1:
                    return None
                if not all(_WORDY.search(_el_text(p)) for p in labels):
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


def _soft_br(el):
    return (el.tag == qn("w:br")
            and (el.get(qn("w:type")) or "textWrapping") == "textWrapping")


def _br_stack_count(p):
    """Number of top-level soft breaks in a paragraph, or None if it is not flat.

    "Flat" means every break sits directly inside a direct w:r child of the
    paragraph, which is where pdf2docx puts them. A break nested any deeper (in
    a hyperlink, a text box, a smartTag) is not something this pass knows how to
    slice, so it reports None and the caller refuses the table rather than
    guessing at the structure.
    """
    flat = sum(1 for r in p.findall(qn("w:r")) for br in r.findall(qn("w:br"))
               if _soft_br(br))
    total = sum(1 for br in p.iter(qn("w:br")) if _soft_br(br))
    return flat if flat == total else None


def _br_segments(p):
    """The paragraph's renderable children grouped into soft-break segments.

    Returns [[el, ...], ...] with the break runs removed. A run that holds text
    on both sides of a break is rebuilt as one run per side, each keeping a copy
    of the original rPr; a run with no break is passed through untouched, so a
    break-free paragraph returns exactly its own child list and this is a no-op
    for every row that was already handled correctly.
    """
    segs, cur = [], []
    for child in list(p):
        if child.tag == qn("w:pPr"):
            continue
        if child.tag != qn("w:r") or not any(_soft_br(s) for s in child):
            cur.append(child)
            continue
        rpr = child.find(qn("w:rPr"))
        piece = []
        for sub in list(child):
            if sub.tag == qn("w:rPr"):
                continue
            if _soft_br(sub):
                if piece:
                    cur.append(_rebuild_run(rpr, piece))
                segs.append(cur)
                cur, piece = [], []
                continue
            piece.append(sub)
        if piece:
            cur.append(_rebuild_run(rpr, piece))
    segs.append(cur)
    return segs


def _rebuild_run(rpr, children):
    run = parse_xml("<w:r %s/>" % nsdecls("w"))
    if rpr is not None:
        run.append(copy.deepcopy(rpr))
    for child in children:
        run.append(copy.deepcopy(child))
    return run


def _seg_text(children):
    return "".join(t.text or ""
                   for child in children for t in child.iter(qn("w:t")))


def _tab_attach(target, children, stop):
    """Move one flush-right segment onto a label paragraph behind a right tab."""
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
    seam = _el_text(target)[-1:] + _seg_text(children)[:1]
    gap = "" if (seam.strip() != seam or not seam) else \
        '<w:t xml:space="preserve"> </w:t>'
    target.append(parse_xml("<w:r %s>%s<w:tab/></w:r>" % (nsdecls("w"), gap)))
    for child in children:
        parent = child.getparent()
        if parent is not None:
            parent.remove(child)
        target.append(child)


# --- date_column_untable indent repair (F2) ---------------------------------
# A right tab stop is measured from the section's left text margin, but the
# paragraph's TEXT AREA ends at (section width - right indent). pdf2docx gives
# every cell paragraph the cell's own right indent, so after the cells are
# flowed back into the body the stop this pass writes at the text margin can
# sit OUTSIDE the text area: the tab is unreachable, Word gives up on it, and
# the date wraps onto its own line (or lands mid-line) while the entries that
# happened to come from a full-width cell stay flush right. The column goes
# ragged. The cell's right indent is furniture — the cell is gone — so it is
# dropped for the whole cell group whose date it strands.
# The left edge is the same story in miniature: pdf2docx measures each cell's
# left edge independently, so identical entries land on 10 twips and 22 twips
# (0.6pt apart). Only differences below _IND_SNAP_TWIPS are treated as one
# edge measured twice; anything larger is a real indent and is left alone.

_IND_SNAP_TWIPS = 30  # 1.5pt
_IND_HAIR_TWIPS = 20  # 1pt: below this an indent is cell residue, not an indent


def _ind_val(p, *attrs):
    ppr = p.find(qn("w:pPr"))
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    if ind is None:
        return None
    for attr in attrs:
        raw = ind.get(qn("w:" + attr))
        if raw is not None:
            try:
                return int(round(float(raw)))
            except (TypeError, ValueError):
                return None
    return None


def _ind_set(p, value, *attrs):
    ppr = p.find(qn("w:pPr"))
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    if ind is None:
        return
    for attr in attrs:
        if ind.get(qn("w:" + attr)) is not None:
            ind.set(qn("w:" + attr), str(value))


def _dominant_left(body):
    """Modal left indent of the body's OWN paragraphs (never a cell's).

    None when the body has no indented paragraph of its own or when two values
    tie, so an ambiguous document is left exactly as it was.
    """
    counts = {}
    for p in body.iterchildren(qn("w:p")):
        if not _el_text(p).strip():
            continue
        left = _ind_val(p, "left", "start")
        if left is None:
            continue
        counts[left] = counts.get(left, 0) + 1
    if not counts:
        return None
    top = max(counts.values())
    winners = [k for k, v in counts.items() if v == top]
    return winners[0] if len(winners) == 1 else None


# --- G1: the date column's own right edge, measured in the PDF --------------
# Both tab-writing passes used to align a flush-right date at the SECTION's
# right text margin, on the assumption that flush-right means flush with the
# page. Two things are wrong with that.
#
#   * It is often the wrong column. On a CV whose dates stop 78pt short of the
#     margin, every date was pushed out to the paper edge and no longer lined
#     up with anything in the source.
#   * It is frequently UNREACHABLE. pdf2docx leaves a hair-width left indent
#     (10 twips) on the paragraphs it flows out of a cell, so a stop written at
#     the full text width sits past the end of that paragraph's own line box.
#     Real Word drops such a tab outright and the column goes ragged; QuickLook
#     renders custom stops loosely and hid this for a whole season.
#
# Measuring the edge in the source PDF fixes the first, and _clamp_stop_to_line
# below fixes the second for every stop this file writes, measured or not.
#
# A line only counts when its text occurs at ONE right edge in the whole PDF
# and every line of the column shares that edge. Anything ambiguous returns
# None and the caller keeps its width-derived stop, so this can never move a
# tab it did not actually measure.

_TAB_EDGE_TOL_PT = 2.0     # right-aligned lines share an edge this closely
_TAB_MIN_STOP = 720        # half an inch: no measured stop lands left of this
_WS_RUN_RE = re.compile(r"[\s\u00a0\u2007\u202f]+")


def _norm_line(text):
    return _WS_RUN_RE.sub(" ", text or "").strip()


def _pdf_right_edges(pdf_doc):
    """{line text: [(right edge pt, page width pt), ...]} for the whole PDF."""
    index = {}
    if pdf_doc is None:
        return index
    try:
        pages = list(pdf_doc)
    except Exception:  # noqa: BLE001 - a measurement is never worth a failure
        return index
    for page in pages:
        try:
            width = float(page.rect.width)
            blocks = page.get_text("dict").get("blocks", [])
        except Exception:  # noqa: BLE001
            continue
        if width <= 0:
            continue
        for b in blocks:
            if b.get("type") != 0:
                continue
            for ln in b.get("lines", []):
                text = _norm_line("".join(s.get("text", "")
                                          for s in ln.get("spans", [])))
                if not text:
                    continue
                index.setdefault(text, []).append((float(ln["bbox"][2]), width))
    return index


def _measured_stop(index, texts, page_w, left_margin, limit):
    """The right edge shared by every one of `texts`, in twips from the left
    text margin, or None when the column does not measure unambiguously.

    Edges are compared as a FRACTION of the page width, so the index survives
    any rescaling between the PDF page and the docx pgSz.
    """
    if not index or not texts or page_w <= 0 or limit <= 0:
        return None
    tol = _TAB_EDGE_TOL_PT * 20.0 / page_w
    edges = []
    for text in texts:
        hits = index.get(text)
        if not hits:
            return None
        fracs = [x / w for x, w in hits]
        if max(fracs) - min(fracs) > tol:
            return None      # the same text sits at two different edges
        edges.append(max(fracs))
    if max(edges) - min(edges) > tol:
        return None          # the column is not one column
    stop = int(round(max(edges) * page_w)) - left_margin
    if stop < _TAB_MIN_STOP or stop > limit:
        return None
    return stop


def _section_geoms(body):
    """(index in body, (usable width, page width, left margin)) per section."""
    out = []
    for i, child in enumerate(body):
        for sect in child.iter(qn("w:sectPr")) if child.tag == qn("w:p") else ():
            out.append((i, sect))
    tail = body.find(qn("w:sectPr"))
    if tail is not None:
        out.append((len(body), tail))
    geoms = []
    for i, sect in out:
        node = sect.find(qn("w:pgSz"))
        try:
            page_w = int(round(float(node.get(qn("w:w")))))
        except (AttributeError, TypeError, ValueError):
            page_w = 0
        geoms.append((i, (_sect_width(sect), page_w,
                          _sect_margin(sect, "left"))))
    return geoms


def _geom_at(geoms, idx, inclusive=False):
    """Geometry of the section governing body child `idx`.

    A sectPr rides on the LAST paragraph of its own section, so a PARAGRAPH is
    governed by the first sectPr recorded at or after it (inclusive), while a
    table, which can never carry one, is governed by the first one after it.
    """
    return next((g for i, g in geoms if (i >= idx if inclusive else i > idx)),
                (0, 0, 0))


def _plan_date_texts(plan):
    """Every flush-right line this plan is about to put behind a tab."""
    texts = []
    for kind, _left, right in plan:
        if kind != "tab":
            continue
        cells = right.findall(qn("w:p"))
        if not cells:
            continue
        for seg in _br_segments(cells[0]):
            text = _norm_line(_seg_text(seg))
            if text:
                texts.append(text)
    return texts


def _clamp_stop_to_line(p, limit):
    """Pull a stop sitting past the end of THIS paragraph's line box back
    inside it, so real Word can still reach the tab."""
    tabs, stops = _direct_stops(p)
    if tabs is None or limit <= 0:
        return
    room = (limit
            - max(_ind_val(p, "left", "start") or 0, 0)
            - max(_ind_val(p, "right", "end") or 0, 0))
    if room <= 0:
        return
    for stop in stops:
        pos = _stop_pos(stop)
        if pos is not None and pos > room:
            stop.set(qn("w:pos"), str(room))


def _untable_indent_repair(groups, stop, limit, dom_left):
    """Drop a cell right indent that strands this pass's own right tab, and
    snap a hair-width left indent onto the body's own left edge."""
    for paras, tabbed in groups:
        if tabbed and stop > 0 and limit > 0:
            for p in paras:
                right = _ind_val(p, "right", "end")
                if right and stop > limit - right:
                    for q in paras:
                        _ind_set(q, 0, "right", "end")
                    break
        if tabbed:
            for p in paras:
                # A hair-width left indent is the cell's own left edge, not an
                # author's indent: it survives the untabling as a sub-point
                # offset that shifts every stop on the line right by the same
                # amount, so the date column no longer meets the edge measured
                # for it, and a stop written at the full text width lands
                # outside the line box entirely. Drop it before clamping.
                left = _ind_val(p, "left", "start")
                if left is not None and 0 < left <= _IND_HAIR_TWIPS:
                    _ind_set(p, 0, "left", "start")
                _clamp_stop_to_line(p, limit)
        if dom_left is None:
            continue
        for p in paras:
            left = _ind_val(p, "left", "start")
            if left is None or left == dom_left:
                continue
            if abs(left - dom_left) <= _IND_SNAP_TWIPS:
                _ind_set(p, dom_left, "left", "start")


def date_column_untable(data, pdf_doc=None):
    """Flow pdf2docx's flush-right date "tables" back into tabbed paragraphs."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    sects = _section_widths(body)
    geoms = _section_geoms(body)
    edges = _pdf_right_edges(pdf_doc)
    dom_left = _dominant_left(body)
    changed = False

    # section widths are resolved against the ORIGINAL body order, before the
    # rewrite starts shifting indices around
    candidates = [(c, next((w for i, w in sects if i > idx), 0) or 0,
                   _geom_at(geoms, idx))
                  for idx, c in enumerate(body) if c.tag == qn("w:tbl")]

    for tbl, limit, geom in candidates:
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
        # the cell widths are pdf2docx's guess at the column; the PDF knows
        # where the dates actually end. Prefer the measurement when the whole
        # column resolves to one edge.
        measured = _measured_stop(edges, _plan_date_texts(plan),
                                  geom[1], geom[2], limit)
        if measured:
            stop = measured
        rule = None
        first_pr = rows[0].find(qn("w:tc") + "/" + qn("w:tcPr") + "/" + qn("w:tcBorders"))
        if first_pr is not None:
            top = first_pr.find(qn("w:top"))
            if top is not None and (top.get(qn("w:val")) or "none") not in ("none", "nil"):
                rule = top

        out = []
        groups = []
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
                groups.append(([target], False))
                continue
            # trailing padding is dropped, so the date lands on the label rather
            # than on a blank line below it, and the cell's row-height spacing
            # does not survive into the body as stray empty paragraphs
            paras = _content_paras(left)
            out.extend(paras)
            if kind == "flow":
                groups.append((paras, False))
                continue
            groups.append((paras, True))
            # The date goes on the label cell's FIRST content line, not its last.
            # _untable_plan only plans a "tab" row when the right cell holds ONE
            # paragraph, i.e. pdf2docx wrote no vertical padding around it, so the
            # date sits at the top of the row and is on the same baseline as the
            # label's first line. Attaching it to the last paragraph reads the
            # same on a one-line label and is wrong on every longer one: on a CV
            # entry whose cell holds a title line and a subtitle line it welded
            # "2020 - 2023" onto the subtitle, fusing three source lines into two.
            src = right.findall(qn("w:p"))[0]
            segs = _br_segments(src)
            if len(segs) == 1:
                _tab_attach(paras[_first_content(paras)], segs[0], stop)
                continue
            # stacked dates: _untable_plan has already proved there is exactly
            # one label line per segment, so they pair off in order
            labels = [p for p in paras if not _p_padding(p)]
            for target, children in zip(labels, segs):
                if children:
                    _tab_attach(target, children, stop)

        if not out:
            continue
        _untable_indent_repair(groups, stop, limit, dom_left)
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
                    lines.append({"text": t, "x0": ln["bbox"][0], "x1": ln["bbox"][2],
                                  "y0": ln["bbox"][1], "y1": ln["bbox"][3]})
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


# --------------------------------------------------------------------------
# br_row_split: one paragraph per visual row for label rows
#
# pdf2docx welds consecutive lines of the same PDF block into ONE paragraph
# joined by <w:br/>. When those lines are independent "Label: value" rows of a
# definition block (a CV skills list, a spec sheet, a key/value panel) the weld
# is wrong twice over: the rows lose the sibling row spacing, and editing one
# row reflows the other. This pass splits at those w:br only, and only on
# structural proof:
#
#   * the paragraph's br-separated segments map, token for token, onto the
#     consecutive lines of exactly ONE PDF block, one segment per line, and
#     consume that block entirely (unique-match binding, borrowed from
#     wrap_break_heal);
#   * every line ends well short of the block's right edge, so the next line's
#     first word WOULD have fit -- the break was authored, not a wrap;
#   * the rows sit at normal leading (no big gap, no overlap);
#   * EVERY segment is a short "Label: " row, and
#   * an adjacent body paragraph outside this one is already a standalone row
#     of the same shape and style -- the sibling whose spacing is inherited.
#
# All five must hold, so flowing prose, poetry, addresses and signature blocks
# (no label rows, no sibling) are untouched, and a genuine soft break inside one
# logical paragraph never qualifies.
_RS_LABEL_RE = re.compile(r"^[ \t]{0,3}([^\s:][^:]{0,39}):(\s|$)")
_RS_MAX_LABEL_WORDS = 5
_RS_MAX_PITCH_RATIO = 2.0   # row pitch / line height; above this it is a gap
_RS_SLACK_WORDS = 1.0       # the next word must fit with this much margin


def _rs_label_ok(text):
    """A short 'Label: value' row head -- deliberate, never a prose wrap."""
    m = _RS_LABEL_RE.match(text)
    if not m:
        return False
    label = m.group(1).strip()
    if not label or len(label.split()) > _RS_MAX_LABEL_WORDS:
        return False
    first = label[0]
    if not (first.isalnum() or first in "#&/"):
        return False
    if first.islower() and not any(c.isupper() for c in label):
        return False  # a lowercase opener is a sentence fragment, not a label
    if "." in label:
        return False
    return bool(text[m.end():].strip())


def _rs_para_text(p):
    return "".join(_char_of(el) for el in _wb_items(p))


def _rs_row_sibling(body, p):
    """Nearest adjacent body paragraph that is already a standalone label row of
    the same style. Following first: its w:before is the gap BETWEEN two rows of
    this group, which is the spacing the split rows must inherit."""
    kids = [k for k in body if k.tag == qn("w:p")]
    try:
        i = kids.index(p)
    except ValueError:
        return None
    style = _rs_style_id(p)
    for j in (i + 1, i - 1):
        if j < 0 or j >= len(kids):
            continue
        q = kids[j]
        items = _wb_items(q)
        if any(el.tag in (qn("w:br"), qn("w:cr")) for el in items):
            continue
        if _rs_style_id(q) != style:
            continue
        if _rs_label_ok("".join(_char_of(el) for el in items)):
            return q
    return None


def _rs_style_id(p):
    pPr = p.find(qn("w:pPr"))
    if pPr is None:
        return None
    st = pPr.find(qn("w:pStyle"))
    return None if st is None else st.get(qn("w:val"))


def _rs_before(sibling):
    pPr = sibling.find(qn("w:pPr"))
    if pPr is None:
        return None
    sp = pPr.find(qn("w:spacing"))
    if sp is None:
        return None
    return sp.get(qn("w:before"))


def _rs_rows_ok(block, ends):
    """One segment per line, normal leading, and every break authored."""
    lines = block["lines"]
    if len(lines) < 2 or ends != list(range(len(lines))):
        return False
    for i in range(len(lines) - 1):
        prev, nxt = lines[i], lines[i + 1]
        h = max(prev["y1"] - prev["y0"], nxt["y1"] - nxt["y0"])
        pitch = nxt["y0"] - prev["y0"]
        if h <= 0 or pitch <= 0 or pitch > _RS_MAX_PITCH_RATIO * h:
            return False
        # the first word of the next line had room on this one: authored break
        word = nxt["text"].split()[0] if nxt["text"].split() else ""
        if not word or not prev["text"]:
            return False
        avg = (prev["x1"] - prev["x0"]) / max(1, len(prev["text"]))
        if (block["x1"] - prev["x1"]) < (len(word) + _RS_SLACK_WORDS) * avg:
            return False  # forced wrap, not a row boundary
    return True


def _rs_split_run(run):
    """Split one run at its top-level w:br into a list of runs (br dropped).
    Returns None if the run holds anything the split must not reorder."""
    rPr = run.find(qn("w:rPr"))
    groups, cur = [], []
    for c in run:
        if c.tag == qn("w:rPr"):
            continue
        if c.tag == qn("w:br"):
            groups.append(cur)
            cur = []
        else:
            cur.append(c)
    groups.append(cur)
    out = []
    for g in groups:
        new = parse_xml("<w:r %s/>" % nsdecls("w"))
        if rPr is not None:
            new.append(copy.deepcopy(rPr))
        for c in g:
            new.append(copy.deepcopy(c))
        out.append(new if g else None)
    return out


def _rs_chunks(p):
    """p's content split at top-level w:br inside top-level runs. None when a
    br sits anywhere else (inside a hyperlink, a smartTag, a nested field)."""
    chunks = [[]]
    for c in list(p):
        if c.tag == qn("w:pPr"):
            continue
        if c.tag == qn("w:r") and any(k.tag == qn("w:br") for k in c):
            parts = _rs_split_run(c)
            if parts is None:
                return None
            for j, part in enumerate(parts):
                if j:
                    chunks.append([])
                if part is not None:
                    chunks[-1].append(part)
        else:
            if any(d.tag == qn("w:br") for d in c.iter()):
                return None  # a br we cannot split cleanly
            chunks[-1].append(copy.deepcopy(c))
    return chunks


def br_row_split(data, pdf_doc=None):
    if pdf_doc is None:
        return data
    blocks = _wb_blocks(pdf_doc)
    if not blocks:
        return data
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    changed = False

    for p in list(body.findall(qn("w:p"))):
        items = _wb_items(p)
        if not any(el.tag == qn("w:br") for el in items):
            continue
        segments, brs = _wb_segments(items)
        if not brs:
            continue
        seg_texts = [_wb_text(s) for s in segments]
        if len(seg_texts) < 2 or not all(t.strip() for t in seg_texts):
            continue
        if not all(_rs_label_ok(t) for t in seg_texts):
            continue
        matches = []
        for block in blocks:
            ends = _wb_align(segments, block)
            if ends is not None:
                matches.append((block, ends))
                if len(matches) > 1:
                    break
        if len(matches) != 1:
            continue  # ambiguous or absent geometric evidence
        block, ends = matches[0]
        if not _rs_rows_ok(block, ends):
            continue
        sibling = _rs_row_sibling(body, p)
        if sibling is None:
            continue
        chunks = _rs_chunks(p)
        if chunks is None or len(chunks) != len(segments):
            continue
        if not all(chunks[i] for i in range(len(chunks))):
            continue

        pPr = p.find(qn("w:pPr"))
        before = _rs_before(sibling)
        for c in list(p):
            if c.tag != qn("w:pPr"):
                p.remove(c)
        for c in chunks[0]:
            p.append(c)
        anchor = p
        for chunk in chunks[1:]:
            np = parse_xml("<w:p %s/>" % nsdecls("w"))
            if pPr is not None:
                new_pPr = copy.deepcopy(pPr)
                if before is not None:
                    sp = new_pPr.find(qn("w:spacing"))
                    if sp is None:
                        sp = parse_xml("<w:spacing %s/>" % nsdecls("w"))
                        new_pPr.append(sp)
                    sp.set(qn("w:before"), before)
                np.append(new_pPr)
            for c in chunk:
                np.append(c)
            anchor.addnext(np)
            anchor = np
        changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------
# label_row_split: the general case of br_row_split, done at SOURCE-LINE
# granularity instead of at w:br granularity.
#
# br_row_split can only cut where pdf2docx happened to leave a <w:br/>, and it
# needs one segment per source line. Real definition blocks defeat both: a CV's
# TECHNICAL SKILLS panel comes back as ONE paragraph in which some row
# boundaries carry a br and others carry nothing at all (the rows are merely
# adjacent in the run stream and looked separate only because the page wrapped
# there), so six rows arrive as five br-joined segments, one of which holds two
# rows fused. SOFT SKILLS & LANGUAGES arrives as two rows fused with no break
# element anywhere. Either way the rows cannot be edited or reordered on their
# own and collapse into each other on the first edit.
#
# This pass reconstructs the rows from the page instead of from the markup: it
# binds the whole paragraph to one contiguous run of lines inside exactly ONE
# PDF block, and emits one paragraph per line. It fires only on structural
# proof, all of which must hold:
#
#   * the paragraph's text, whitespace-normalised, equals the join of >=2
#     consecutive lines of one block, and that window is UNIQUE in the document
#     (the unique-match binding wrap_break_heal uses);
#   * EVERY line in the window is a short "Label: value" row head
#     (_rs_label_ok, shared with br_row_split) -- this is what separates a
#     definition block from wrapped prose, and it is why the "the next word
#     would have fit" wrap test is not used here: a row whose value happens to
#     fill the column to the right edge is still a row when the line under it
#     opens a new label;
#   * the rows share a left edge and sit at normal leading, so a two-column
#     panel or a gapped list is not mistaken for one block of rows;
#   * every cut lands exactly on a child boundary of the run stream -- no run
#     is ever divided, so no formatting is re-derived -- and every w:br the
#     paragraph does carry lands on one of those same cuts, so no authored
#     break is silently swallowed;
#   * the paragraph carries no tab (a label/date column is a row of its own
#     kind and belongs to tabbed_subline_split), no list numbering, and no
#     element outside the known-splittable set.
#
# Continuation rows inherit the sibling spacing when an adjacent standalone row
# of the same style exists to copy it from, and otherwise take w:before="0",
# which is what they had inside the paragraph they are being cut out of.
_LRS_X0_EPS = 2.0            # pt, two rows share a left edge
_LRS_MAX_PITCH_RATIO = 2.0   # row pitch / line height; above this it is a gap
_LRS_MAX_SPLITS = 60         # runaway guard


def _lrs_flatten(p):
    """[[element, text, br_after]] for p's content, or None to bail.

    Runs holding a top-level wrap w:br are divided at it into separate runs
    with the break recorded as a boundary flag, so the caller sees one flat
    child stream whatever pdf2docx did with the breaks.
    """
    if p.find(qn("w:pPr") + "/" + qn("w:numPr")) is not None:
        return None
    if p.find(".//" + qn("w:tab")) is not None:
        return None
    if p.find(".//" + qn("w:cr")) is not None:
        return None
    for tag in _FS_OPAQUE:
        if p.find(".//" + qn(tag)) is not None:
            return None
    out = []
    for c in list(p):
        if c.tag == qn("w:pPr"):
            continue
        if c.tag not in _FS_SPLITTABLE:
            return None
        brs = [k for k in c if k.tag == qn("w:br")] if c.tag == qn("w:r") else []
        if brs:
            if any(b.get(qn("w:type")) not in (None, "textWrapping") for b in brs):
                return None
            if any(d.tag == qn("w:br") for d in c.iter()) and len(
                    [d for d in c.iter(qn("w:br"))]) != len(brs):
                return None          # a br nested below the run's top level
            parts = _rs_split_run(c)
            if parts is None:
                return None
            for j, part in enumerate(parts):
                if j:
                    if not out or out[-1][2]:
                        return None  # a break with no row before it
                    out[-1][2] = True
                if part is not None:
                    out.append([part, _el_text(part), False])
            continue
        if any(d.tag == qn("w:br") for d in c.iter()):
            return None
        out.append([copy.deepcopy(c), _el_text(c), False])
    if out and out[-1][2]:
        return None                  # trailing break: an empty row
    return out


def _lrs_text(items):
    parts = []
    for _, text, br_after in items:
        parts.append(text)
        if br_after:
            parts.append(" ")
    return _fs_norm("".join(parts))


def _lrs_window(text, blocks):
    """The one (block, i, j) whose lines i..j join to exactly `text`."""
    hit = None
    for block in blocks:
        norms = [_fs_norm(l["text"]) for l in block["lines"]]
        for i in range(len(norms)):
            if not norms[i] or not text.startswith(norms[i]):
                continue
            acc = norms[i]
            for j in range(i + 1, len(norms)):
                acc = acc + " " + norms[j]
                if len(acc) > len(text) or not text.startswith(acc):
                    break
                if acc == text:
                    if hit is not None:
                        return None      # ambiguous: cut nothing
                    hit = (block, i, j)
                    break
    return hit


def _lrs_rows_ok(lines):
    """Every line is a label row, on a shared left edge, at normal leading."""
    if len(lines) < 2:
        return False
    if not all(_rs_label_ok(l["text"]) for l in lines):
        return False
    x0 = lines[0]["x0"]
    if any(abs(l["x0"] - x0) > _LRS_X0_EPS for l in lines):
        return False
    for prev, nxt in zip(lines, lines[1:]):
        h = max(prev["y1"] - prev["y0"], nxt["y1"] - nxt["y0"])
        pitch = nxt["y0"] - prev["y0"]
        if h <= 0 or pitch <= 0 or pitch > _LRS_MAX_PITCH_RATIO * h:
            return False
    return True


def _lrs_cuts(items, norms):
    """Child indices to cut at, one per row boundary, or None to bail.

    Bails unless EVERY boundary lands on a child boundary and every w:br the
    paragraph carries is one of those boundaries -- a partial split would fuse
    the rows the cut could not reach.
    """
    offsets, acc = {}, ""
    for k, (_, text, br_after) in enumerate(items):
        acc += text
        if br_after:
            acc += " "
        offsets.setdefault(len(_fs_norm(acc)), k + 1)
    cuts, pos = [], 0
    for m in range(len(norms) - 1):
        pos += len(norms[m])
        k = offsets.get(pos)
        pos += 1                       # the space the join put between them
        if k is None or k <= 0 or k >= len(items):
            return None                # the boundary falls inside a run
        cuts.append(k)
    if sorted(set(cuts)) != cuts:
        return None
    breaks = {k + 1 for k, it in enumerate(items) if it[2]}
    if not breaks <= set(cuts):
        return None                    # an authored break we would swallow
    return cuts


def label_row_split(data, pdf_doc=None):
    if pdf_doc is None:
        return data
    blocks = _wb_blocks(pdf_doc)
    if not blocks:
        return data
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    splits = 0

    for p in list(body.findall(qn("w:p"))):
        items = _lrs_flatten(p)
        if not items or len(items) < 2:
            continue
        text = _lrs_text(items)
        if not text:
            continue
        window = _lrs_window(text, blocks)
        if window is None:
            continue
        block, i, j = window
        lines = block["lines"][i:j + 1]
        if not _lrs_rows_ok(lines):
            continue
        cuts = _lrs_cuts(items, [_fs_norm(l["text"]) for l in lines])
        if not cuts:
            continue
        splits += len(cuts)
        if splits > _LRS_MAX_SPLITS:
            return data

        pPr = p.find(qn("w:pPr"))
        sibling = _rs_row_sibling(body, p)
        before = _rs_before(sibling) if sibling is not None else "0"
        groups = [[items[x][0] for x in range(a, b)]
                  for a, b in zip([0] + cuts, cuts + [len(items)])]
        for c in list(p):
            if c.tag != qn("w:pPr"):
                p.remove(c)
        for c in groups[0]:
            p.append(c)
        anchor = p
        for group in groups[1:]:
            np = parse_xml("<w:p %s/>" % nsdecls("w"))
            if pPr is not None:
                new_pPr = copy.deepcopy(pPr)
                if before is not None:
                    sp = new_pPr.find(qn("w:spacing"))
                    if sp is None:
                        sp = parse_xml("<w:spacing %s/>" % nsdecls("w"))
                        _ppr_insert(new_pPr, sp)
                    sp.set(qn("w:before"), before)
                np.append(new_pPr)
            for c in group:
                np.append(c)
            anchor.addnext(np)
            anchor = np

    if not splits:
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


# --- list hanging indent ----------------------------------------------------
# pdf2docx numbers a bullet line by attaching w:numPr, but it never gives the
# list a hanging indent: the abstractNum level carries no w:ind at all and the
# paragraph keeps whatever left indent the layout guesser produced for its own
# first line (4 twips here, 96 twips there).  Word then draws the marker on the
# left margin and wraps continuation lines back underneath the marker instead of
# under the text, and any stray w:right the guesser left behind wraps that one
# item half an inch early.
#
# The source PDF states the correct geometry outright: the bullet mark is drawn
# at one x, its text starts at another, and the wrapped lines line up with the
# text.  That difference IS the hanging indent.  This pass measures it and
# writes it once, on the numbering level and identically on every paragraph of
# the list, so the whole list shares one geometry.
#
# Safety model:
# - Only paragraphs that already carry w:numPr are touched, so prose - which has
#   no numbering - is structurally out of reach.
# - Only bullet-format numbering whose level 0 has no w:ind of its own is
#   touched: a list that already states its own indent is left alone.
# - Geometry comes from the PDF or the pass is a no-op.  It needs at least two
#   agreeing marks, a hanging between 2pt and 72pt, and a docx whose page width
#   matches the PDF page at 20 twips/pt (no scaling model to invert otherwise).
# - The right indent is only ever LOWERED, never raised: the value written is
#   the measured right boundary clamped to the smallest right indent the list
#   already had, so the pass can remove a spurious early wrap but can never
#   introduce one.
LIST_IND_MARK_MAX_PT = 12.0        # a bullet mark is at most a dozen points
LIST_IND_MARK_MIN_PT = 0.4
LIST_IND_MARK_ASPECT = (0.4, 2.5)
LIST_IND_MIN_MARKS = 2             # one mark is a decoration, not a list
LIST_IND_MIN_HANG_PT = 2.0
LIST_IND_MAX_HANG_PT = 72.0
LIST_IND_MAX_LEFT_TW = 2880        # 2in: past that it is not a list indent
LIST_IND_QUANT_PT = 0.25           # geometry vote bucket
LIST_IND_SCALE_TOL = 0.01          # allowed pgSz-vs-page-width mismatch
_TWIPS_PER_PT = 20.0
_LI_MARK_CHARS = set(BULLET_CHARS)  # deliberately excludes "-", "*": prose uses them


def _li_bucket(v):
    return round(v / LIST_IND_QUANT_PT) * LIST_IND_QUANT_PT


def _li_lines(page):
    """Every text line on the page as {x0,x1,y0,y1,chars}, chars = (x0,x1,ch)."""
    out = []
    try:
        raw = page.get_text("rawdict")
    except Exception:  # noqa: BLE001 - an unreadable page yields no geometry
        return out
    for b in raw.get("blocks", ()):
        if b.get("type"):
            continue
        for ln in b.get("lines", ()):
            chars = []
            for sp in ln.get("spans", ()):
                for ch in sp.get("chars", ()):
                    bb = ch.get("bbox")
                    if bb:
                        chars.append((bb[0], bb[2], ch.get("c", "")))
            if not chars:
                continue
            x0, y0, x1, y1 = ln.get("bbox", (0, 0, 0, 0))
            out.append({"x0": x0, "x1": x1, "y0": y0, "y1": y1, "chars": chars})
    return out


def _li_vector_marks(page):
    """Small near-square filled drawings: vector bullets pdf2docx rasterises."""
    marks = []
    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001
        return marks
    for dr in drawings:
        r = dr.get("rect")
        if r is None:
            continue
        w, h = float(r.width), float(r.height)
        if not (LIST_IND_MARK_MIN_PT <= w <= LIST_IND_MARK_MAX_PT):
            continue
        if not (LIST_IND_MARK_MIN_PT <= h <= LIST_IND_MARK_MAX_PT):
            continue
        if not LIST_IND_MARK_ASPECT[0] <= w / h <= LIST_IND_MARK_ASPECT[1]:
            continue
        marks.append((float(r.x0), float(r.x1), float(r.y0), float(r.y1)))
    return marks


def _li_text_after(line, start=0):
    """x0 of the first non-blank, non-marker character at or after `start`."""
    for cx0, _cx1, ch in line["chars"][start:]:
        if ch.strip() and ch not in _LI_MARK_CHARS:
            return cx0
    return None


def _li_pairs(pdf_doc):
    """(mark_x0, text_x0, text_x1) for every bullet the PDF draws."""
    pairs = []
    for page in pdf_doc:
        lines = _li_lines(page)
        marks = _li_vector_marks(page)                     # vector bullets
        for ln in lines:                                   # typed bullet glyphs
            if ln["chars"][0][2] not in _LI_MARK_CHARS:
                continue
            tx = _li_text_after(ln, 1)
            if tx is not None:
                pairs.append((ln["chars"][0][0], tx, ln["x1"]))
            else:
                # the marker was laid out as its own text object: it is a mark
                # standing beside its text, exactly like a drawn one
                marks.append((ln["chars"][0][0], ln["chars"][0][1],
                              ln["y0"], ln["y1"]))
        for mx0, mx1, my0, my1 in marks:
            mid = (my0 + my1) / 2.0
            best = None
            for ln in lines:
                if not (ln["y0"] - 2.0 <= mid <= ln["y1"] + 2.0):
                    continue
                if ln["x0"] < mx1:
                    continue
                if best is None or ln["x0"] < best["x0"]:
                    best = ln
            if best is not None:
                tx = _li_text_after(best)
                if tx is not None:
                    pairs.append((mx0, tx, best["x1"]))
    return pairs


def _li_geometry(pdf_doc):
    """The document's modal bullet geometry, in points, or None."""
    pairs = _li_pairs(pdf_doc)
    if len(pairs) < LIST_IND_MIN_MARKS:
        return None
    votes = Counter((_li_bucket(mx), _li_bucket(tx)) for mx, tx, _ in pairs)
    (mark_x, text_x), n = votes.most_common(1)[0]
    if n < LIST_IND_MIN_MARKS:
        return None
    hang = text_x - mark_x
    if not LIST_IND_MIN_HANG_PT <= hang <= LIST_IND_MAX_HANG_PT:
        return None
    right_x = max(x1 for mx, tx, x1 in pairs
                  if (_li_bucket(mx), _li_bucket(tx)) == (mark_x, text_x))
    return mark_x, text_x, right_x


def _li_page_frame(doc, pdf_doc):
    """(left, right, width) of the first section in twips, if the docx page and
    the PDF page agree at 20 twips/pt.  None when they do not: without a known
    scale a PDF x cannot be turned into a docx indent."""
    sect = doc.element.body.find(qn("w:sectPr"))
    if sect is None:
        return None
    sz, mar = sect.find(qn("w:pgSz")), sect.find(qn("w:pgMar"))
    if sz is None or mar is None:
        return None
    try:
        width = int(sz.get(qn("w:w")))
        left = int(mar.get(qn("w:left")))
        right = int(mar.get(qn("w:right")))
    except (TypeError, ValueError):
        return None
    if width <= 0 or left < 0 or right < 0:
        return None
    try:
        pdf_w = float(pdf_doc[0].rect.width)
    except Exception:  # noqa: BLE001
        return None
    if pdf_w <= 0:
        return None
    if abs(width / (pdf_w * _TWIPS_PER_PT) - 1.0) > LIST_IND_SCALE_TOL:
        return None
    return left, right, width


def _li_num_map(numbering):
    """numId -> abstractNum element."""
    by_abs = {a.get(qn("w:abstractNumId")): a
              for a in numbering.findall(qn("w:abstractNum"))}
    out = {}
    for n in numbering.findall(qn("w:num")):
        ref = n.find(qn("w:abstractNumId"))
        if ref is None:
            continue
        a = by_abs.get(ref.get(qn("w:val")))
        if a is not None:
            out[n.get(qn("w:numId"))] = a
    return out


def _li_lvl(abs_el, ilvl):
    for lvl in abs_el.findall(qn("w:lvl")):
        if lvl.get(qn("w:ilvl")) == str(ilvl):
            return lvl
    return None


def _li_open_bullet(abs_el):
    """True for bullet numbering whose level 0 states no indent of its own."""
    lvl = _li_lvl(abs_el, 0)
    if lvl is None:
        return False
    fmt = lvl.find(qn("w:numFmt"))
    if fmt is None or fmt.get(qn("w:val")) != "bullet":
        return False
    ppr = lvl.find(qn("w:pPr"))
    return ppr is None or ppr.find(qn("w:ind")) is None


def _li_numpr(p):
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        return None
    npr = ppr.find(qn("w:numPr"))
    if npr is None:
        return None
    nid = npr.find(qn("w:numId"))
    if nid is None:
        return None
    ilvl = npr.find(qn("w:ilvl"))
    try:
        lvl = int(ilvl.get(qn("w:val"))) if ilvl is not None else 0
    except (TypeError, ValueError):
        lvl = 0
    return nid.get(qn("w:val")), max(0, lvl)


def _li_right_of(p):
    ppr = p.find(qn("w:pPr"))
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    if ind is None:
        return 0
    try:
        return int(ind.get(qn("w:right")) or 0)
    except (TypeError, ValueError):
        return 0


def _li_set_ind(ppr, left, hanging, right):
    """Write the one indent this list uses, replacing whatever was there."""
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        ind = parse_xml("<w:ind %s/>" % nsdecls("w"))
        # CT_PPr sequence: w:ind sits before w:jc / w:rPr / w:sectPr
        anchor = None
        for tag in ("w:jc", "w:textAlignment", "w:rPr", "w:sectPr"):
            anchor = ppr.find(qn(tag))
            if anchor is not None:
                break
        if anchor is not None:
            anchor.addprevious(ind)
        else:
            ppr.append(ind)
    for attr in ("w:firstLine", "w:firstLineChars", "w:hanging", "w:hangingChars",
                 "w:leftChars", "w:rightChars", "w:start", "w:end"):
        if ind.get(qn(attr)) is not None:
            del ind.attrib[qn(attr)]
    ind.set(qn("w:left"), str(left))
    ind.set(qn("w:hanging"), str(hanging))
    ind.set(qn("w:right"), str(right))


# --- list_wrap_merge (E2) ---------------------------------------------------
# pdf2docx cuts a bullet whose text wraps into TWO docx paragraphs: the list
# paragraph, and a plain paragraph carrying the continuation ("and routing,
# REST API integration, ...") with no numPr and a hand-set left indent that
# only LOOKS like the bullet's text column. Nothing reflows when the reader
# edits it, which is the editability hard-fail the visual panel called.
#
# The merge is authorised by STRUCTURE, not by prose heuristics. The orphan is
# swallowed only when the PDF itself testifies that the two docx paragraphs are
# consecutive LINES OF ONE BLOCK:
#   * the previous sibling is a real list paragraph (has numPr);
#   * the orphan is plain body text: no numPr, no pStyle (never a heading), no
#     sectPr/framePr, no drawing/pict/object (never a rasterised bullet glyph);
#   * the list paragraph's text does not end a sentence (a terminal, or a
#     hyphen whose seam is ambiguous, declines) and the orphan starts with a
#     lower-case letter — an upper-case start after a period is exactly the
#     "new sentence, own paragraph" shape and must survive;
#   * some PDF text block holds a line L whose tokens are the TAIL of the list
#     paragraph, and lines L+1.. whose tokens are EXACTLY the orphan's tokens.
#     Because L+1 is interior to its block, an orphan that starts a new PDF
#     block can never match, which is the "new block" veto stated structurally;
#   * line L+1 does not itself start with a bullet glyph (a real second item
#     pdf2docx merely failed to number is left alone for list_numbering).
# Ambiguity anywhere is a no-op.

_LWM_BULLET_GLYPHS = "•◦▪▫‣∙·●○◘§*-–—+"
_LWM_MIN_ANCHOR_TOKENS = 3   # a 1-2 word tail matches far too many lines
_LWM_MIN_ORPHAN_TOKENS = 2
_LWM_BLOCKERS = (qn("w:drawing"), qn("w:pict"), qn("w:object"),
                 "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
                 "AlternateContent")


def _lwm_pdf_blocks(pdf_doc):
    """Per-block line texts, blocks of a single line dropped (they can hold no
    interior continuation)."""
    blocks = []
    for page in pdf_doc:
        for b in page.get_text("dict").get("blocks", []):
            if b.get("type") != 0:
                continue
            lines = []
            for ln in b.get("lines", []):
                t = "".join(s.get("text", "") for s in ln.get("spans", [])).strip()
                if t:
                    lines.append(t)
            if len(lines) >= 2:
                blocks.append(lines)
    return blocks


def _lwm_continues(blocks, anchor_toks, orphan_toks):
    """True when one PDF block holds a line ending the anchor immediately
    followed by the line(s) that spell the orphan exactly."""
    for lines in blocks:
        toks = [_tok(l) for l in lines]
        for i in range(len(lines) - 1):
            head = toks[i]
            if len(head) < _LWM_MIN_ANCHOR_TOKENS or len(head) > len(anchor_toks):
                continue
            if anchor_toks[-len(head):] != head:
                continue
            if lines[i + 1][:1] in _LWM_BULLET_GLYPHS:
                continue  # a bullet of its own, not a wrapped continuation
            acc, j = [], i + 1
            while j < len(lines) and len(acc) < len(orphan_toks):
                acc.extend(toks[j])
                j += 1
            if acc == orphan_toks:
                return True
    return False


def _lwm_plain_orphan(p):
    for tag in _LWM_BLOCKERS:
        if p.find(".//" + tag) is not None:
            return False
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        return True
    for tag in ("w:numPr", "w:pStyle", "w:sectPr", "w:framePr"):
        if ppr.find(qn(tag)) is not None:
            return False
    return True


def _lwm_is_list(p):
    ppr = p.find(qn("w:pPr"))
    return ppr is not None and ppr.find(qn("w:numPr")) is not None


def _lwm_absorb(anchor, orphan):
    seam = _el_text(anchor)[-1:] + _el_text(orphan)[:1]
    if seam and seam.strip() == seam:
        anchor.append(parse_xml('<w:r %s><w:t xml:space="preserve"> </w:t></w:r>'
                                % nsdecls("w")))
    for child in list(orphan):
        if child.tag == qn("w:pPr"):
            continue
        orphan.remove(child)
        anchor.append(child)
    orphan.getparent().remove(orphan)


def list_wrap_merge(data, pdf_doc=None):
    """E2: fold a bullet's wrapped continuation back into the list paragraph."""
    if pdf_doc is None:
        return data
    blocks = _lwm_pdf_blocks(pdf_doc)
    if not blocks:
        return data

    doc = Document(io.BytesIO(data))
    changed = False
    for orphan in list(doc.element.body.iter(qn("w:p"))):
        parent = orphan.getparent()
        if parent is None:
            continue
        anchor = orphan.getprevious()
        while anchor is not None and anchor.tag != qn("w:p"):
            anchor = anchor.getprevious()
        if anchor is None or anchor.getnext() is not orphan:
            continue  # not DIRECTLY adjacent: something sits between them
        if not _lwm_is_list(anchor) or _lwm_is_list(orphan):
            continue
        if not _lwm_plain_orphan(orphan):
            continue
        atext, otext = _el_text(anchor).rstrip(), _el_text(orphan).strip()
        if not atext or not otext:
            continue
        if atext[-1] in _TERMINALS or atext[-1] in HYPHENS:
            continue  # a finished sentence, or an unresolvable hyphen seam
        if not otext[:1].islower():
            continue
        atoks, otoks = _tok(atext), _tok(otext)
        if len(otoks) < _LWM_MIN_ORPHAN_TOKENS or len(atoks) < _LWM_MIN_ANCHOR_TOKENS:
            continue
        if not _lwm_continues(blocks, atoks, otoks):
            continue
        _lwm_absorb(anchor, orphan)
        changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def list_hanging_indent(data, pdf_doc=None):
    """E1: give bullet lists the hanging indent the PDF draws, uniformly."""
    if pdf_doc is None:
        return data
    doc = Document(io.BytesIO(data))
    numbering = _numbering_root(doc)
    if numbering is None:
        return data
    num_map = _li_num_map(numbering)
    open_ids = {nid for nid, abs_el in num_map.items() if _li_open_bullet(abs_el)}
    if not open_ids:
        return data

    paras = []
    for p in doc.element.body.iter(qn("w:p")):
        got = _li_numpr(p)
        if got is not None and got[0] in open_ids:
            paras.append((p, got[0], got[1]))
    if len(paras) < LIST_IND_MIN_MARKS:
        return data

    frame = _li_page_frame(doc, pdf_doc)
    if frame is None:
        return data
    pg_left, pg_right, pg_width = frame
    geom = _li_geometry(pdf_doc)
    if geom is None:
        return data
    mark_x, text_x, right_x = geom

    left_tw = int(round(text_x * _TWIPS_PER_PT)) - pg_left
    hang_tw = int(round((text_x - mark_x) * _TWIPS_PER_PT))
    if hang_tw <= 0:
        return data
    left_tw = max(left_tw, hang_tw)          # never draw the marker off the margin
    if not 0 < left_tw <= LIST_IND_MAX_LEFT_TW:
        return data
    measured_right = pg_width - pg_right - int(round(right_x * _TWIPS_PER_PT))
    # lower-only: the pass may delete a spurious early wrap, never add one
    right_tw = max(0, min(measured_right, min(_li_right_of(p) for p, _, _ in paras)))

    touched = set()
    for p, nid, ilvl in paras:
        step = min(ilvl, LIST_MAX_LEVELS - 1)
        _li_set_ind(p.find(qn("w:pPr")), left_tw * (step + 1), hang_tw, right_tw)
        touched.add(nid)
    for nid in touched:
        abs_el = num_map[nid]
        for ilvl in range(LIST_MAX_LEVELS):
            lvl = _li_lvl(abs_el, ilvl)
            if lvl is None:
                continue
            ppr = lvl.find(qn("w:pPr"))
            if ppr is None:
                ppr = parse_xml("<w:pPr %s/>" % nsdecls("w"))
                rpr = lvl.find(qn("w:rPr"))
                if rpr is not None:
                    rpr.addprevious(ppr)
                else:
                    lvl.append(ppr)
            _li_set_ind(ppr, left_tw * (ilvl + 1), hang_tw, 0)


    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


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
_RULE_MIN_ANCHOR_KEY = 3   # alphanumerics an anchor needs to identify a line
_RULE_BDR_XML = ('<w:pBdr %s><w:bottom w:val="single" w:sz="%d" w:space="1" '
                 'w:color="%s"/></w:pBdr>')
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


def _rule_key(s):
    """Whitespace- and punctuation-free identity of a line.

    The anchor match has to survive the converter's own spacing damage: a
    heading pdf2docx emits as "TECHNICALSKILLS" is the PDF's "TECHNICAL
    SKILLS", and span_space_repair may put the space back on some runs and
    not others. Comparing alphanumerics only makes the match independent of
    that, and it is still a whole-line equality, so it cannot slide onto a
    different heading.
    """
    return re.sub(r"[^0-9a-z]+", "", (s or "").lower())


def _rule_rects(page):
    """Deduplicated hairline rules on one page: (rect, colour, stroke width).

    A generator routinely strokes the same rule twice (a fill pass and a
    stroke pass, or one stroke per content stream), and PyMuPDF reports each
    one. Counting the raw strokes made a plain CV with seven section rules
    look like a fourteen-line form grid, which tripped the _RULE_MAX_PER_PAGE
    guard and turned this pass (and the E5 dedupe, which shares the guard)
    off on exactly the documents it exists for. Two strokes with the same
    geometry to a tenth of a point are one rule.
    """
    width = page.rect.width
    seen = {}
    for drawing in page.get_drawings():
        r = drawing["rect"]
        if r.height > _RULE_MAX_H_PT or r.width < _RULE_MIN_WIDTH_SHARE * width:
            continue
        if any(item[0] not in ("re", "l") for item in drawing.get("items", ())):
            continue
        key = (round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1))
        if key in seen:
            continue
        seen[key] = (r, drawing.get("color") or drawing.get("fill"),
                     drawing.get("width"))
    return [seen[k] for k in sorted(seen, key=lambda k: (k[1], k[0]))]


def _rule_style(color, width):
    """(w:sz eighths-of-a-point, w:color) for a PDF stroke.

    Taken from the stroke itself so every re-emitted rule on a page matches
    the one pdf2docx happened to absorb as a table border (which carries the
    source colour already) - seven rules at one weight and one colour, not a
    mix of black paragraph borders and grey table borders.
    """
    sz = 6
    if width:
        try:
            sz = max(2, min(12, int(round(float(width) * 8))))
        except (TypeError, ValueError):
            sz = 6
    hexc = "auto"
    if color is not None:
        try:
            chan = [max(0, min(255, int(round(float(c) * 255)))) for c in color[:3]]
        except (TypeError, ValueError):
            chan = []
        if len(chan) == 3:
            hexc = "%02X%02X%02X" % tuple(chan)
    return sz, hexc


def _rule_lines(page):
    out = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            text = "".join(sp.get("text", "") for sp in line.get("spans", []))
            if text.strip():
                out.append((line["bbox"], text))
    return out


def _page_rules(page):
    """Anchors of the hairline rules on one page: (text, sz, colour)."""
    rules = _rule_rects(page)
    if not rules or len(rules) > _RULE_MAX_PER_PAGE:
        return []
    lines = _rule_lines(page)
    out = []
    for r, color, stroke in rules:
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
        sz, hexc = _rule_style(color, stroke)
        out.append((_rule_norm(text), sz, hexc))
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
    for rules in per_page:
        for t in {r[0] for r in rules}:
            pages_seen[t] = pages_seen.get(t, 0) + 1
    running = {t for t, n in pages_seen.items() if n >= _RULE_MIN_HEADER_PAGES}
    return [r for rules in per_page for r in rules if r[0] not in running]


def _tbl_has_top_border(tbl):
    for name in ("tblBorders", "tcBorders"):
        for el in tbl.iter(qn("w:" + name)):
            top = el.find(qn("w:top"))
            if top is not None and (top.get(qn("w:val")) or "nil") not in ("nil", "none"):
                return True
    return False


def _add_bottom_border(p, sz=6, color="auto"):
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        ppr = parse_xml("<w:pPr %s/>" % nsdecls("w"))
        p.insert(0, ppr)
    if ppr.find(qn("w:pBdr")) is not None:
        return False
    bdr = parse_xml(_RULE_BDR_XML % (nsdecls("w"), sz, color))
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
    paras = [(i, el, _rule_key("".join(t.text or "" for t in el.iter(qn("w:t")))))
             for i, el in enumerate(blocks) if el.tag == qn("w:p")]
    changed = False
    cursor = 0
    for anchor, sz, color in anchors:
        key = _rule_key(anchor)
        if len(key) < _RULE_MIN_ANCHOR_KEY:
            continue
        hit = None
        for k in range(cursor, len(paras)):
            # whole-line equality only: a prefix match lets a short anchor
            # swallow a body sentence that merely starts with the same words,
            # and draws a rule through the middle of prose
            if paras[k][2] == key:
                hit = k
                break
        if hit is None:
            continue
        cursor = hit + 1
        i, el, _ = paras[hit]
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        if nxt is not None and nxt.tag == qn("w:tbl") and _tbl_has_top_border(nxt):
            continue  # the same rule already survived as that table's top border
        changed |= _add_bottom_border(el, sz, color)
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


# A CV education/experience entry is two authored lines plus a right-hand date
# column: a BOLD institution line carrying a flush-right date, and a lighter
# sub-line under it (the degree, "Primary and Secondary Education"). pdf2docx
# sometimes welds the two lines into one paragraph, so the degree runs on after
# the institution and the date lands at the end of the pair. fused_line_split
# cannot repair those: its window match joins consecutive PDF lines, and the
# flush-right date sits BETWEEN the two lines in reading order, so the join
# never equals the paragraph text; it also declines any paragraph carrying a
# tab, because a label/date column is normally exactly what must not be cut.
#
# This pass owns that one shape, and only when the page proves it:
#   * the paragraph holds exactly one tab, with text on both sides of it;
#   * before the tab the run stream flips ONCE from bold to non-bold;
#   * the bold text is one whole PDF line, the non-bold text is another whole
#     PDF line, each occurring exactly once on its page;
#   * the two lines share a left edge and the sub-line sits one line below;
#   * the tail after the tab is a third line on the institution's OWN baseline,
#     to its right - that is the date column, and it stays with the institution;
#   * nothing else is printed between those two baselines.
# Wrapped prose fails every geometric test (no date column, no shared-x0 pair
# with a third line on the first baseline), so it is never touched.
TSS_X0_EPS = 2.0           # pt, two lines share a left edge
TSS_MIN_DROP = 2.0         # pt, the sub-line is strictly below, not the same row
TSS_ROW_EPS = 3.0          # pt of baseline drift allowed inside one row
TSS_MAX_LEAD = 2.5         # sub-line must be within this many line heights
TSS_TAIL_MAX = 40          # chars: a right-hand column, never a sentence
TSS_SPLIT_MAX = 50         # runaway guard


def _tss_lines(pdf_doc):
    """[page][line] with the geometry this pass reasons about."""
    pages = []
    for page in pdf_doc:
        rows = []
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for ln in block.get("lines", []):
                text = _fs_norm("".join(sp["text"] for sp in ln["spans"]))
                if not text:
                    continue
                x0, y0, x1, y1 = ln["bbox"]
                rows.append({"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
        pages.append(rows)
    return pages


def _tss_only(rows, text):
    """The one line on the page reading exactly `text`, else None."""
    hits = [r for r in rows if r["text"] == text]
    return hits[0] if len(hits) == 1 else None


def _tss_boundary(items, stop):
    """The single bold -> non-bold flip inside items[:stop], else None."""
    marks = [(i, _run_bold(el)) for i, (el, text) in enumerate(items[:stop])
             if text.strip()]
    if len(marks) < 2 or not marks[0][1]:
        return None
    flips = [n for n in range(1, len(marks)) if marks[n][1] != marks[n - 1][1]]
    if len(flips) != 1 or marks[-1][1]:
        return None
    return marks[flips[0]][0]


def _tss_tabs(items):
    """The index of the paragraph's only tab-bearing child, else None."""
    at = [i for i, (el, _) in enumerate(items) if _fs_tabbed(el)]
    return at[0] if len(at) == 1 else None


def _tss_geometry(rows, head, sub, tail):
    """True when the page shows head/sub as two stacked lines + a date column."""
    a, b, t = (_tss_only(rows, head), _tss_only(rows, sub), _tss_only(rows, tail))
    if a is None or b is None or t is None:
        return False
    if abs(a["x0"] - b["x0"]) > TSS_X0_EPS:
        return False
    drop = b["y0"] - a["y0"]
    height = max(a["y1"] - a["y0"], 1.0)
    if drop < TSS_MIN_DROP or drop > TSS_MAX_LEAD * height:
        return False
    if abs(t["y0"] - a["y0"]) > TSS_ROW_EPS or t["x0"] <= a["x1"]:
        return False
    for other in rows:
        if other is a or other is b or other is t:
            continue
        if a["y0"] + TSS_MIN_DROP < other["y0"] < b["y0"] - TSS_MIN_DROP:
            return False
    return True


def _tss_split(p, items, k, stop):
    """Move items[k:stop] into a Normal paragraph of its own, right after p."""
    new = copy.deepcopy(p)
    for child in list(new):
        if child.tag != qn("w:pPr"):
            new.remove(child)
    ppr = new.find(qn("w:pPr"))
    if ppr is not None:
        for tabs in ppr.findall(qn("w:tabs")):
            ppr.remove(tabs)
    for el, _ in items[k:stop]:
        el.getparent().remove(el)
        new.append(el)
    p.addnext(new)


def tabbed_subline_split(data, pdf_doc=None):
    """Unweld a bold institution line from the lighter sub-line beneath it."""
    if pdf_doc is None:
        return data
    pages = _tss_lines(pdf_doc)
    if not any(pages):
        return data
    doc = Document(io.BytesIO(data))
    pending, splits = [], 0
    for p in doc.element.body.findall(qn("w:p")):
        items = _fs_children(p)
        if not items or len(items) < 3:
            continue
        stop = _tss_tabs(items)
        if stop is None or stop < 2:
            continue
        tail = _fs_norm("".join(t for _, t in items[stop:]))
        if not tail or len(tail) > TSS_TAIL_MAX:
            continue
        k = _tss_boundary(items, stop)
        if k is None:
            continue
        head = _fs_norm("".join(t for _, t in items[:k]))
        sub = _fs_norm("".join(t for _, t in items[k:stop]))
        if not head or not sub:
            continue
        if not any(_tss_geometry(rows, head, sub, tail) for rows in pages):
            continue
        splits += 1
        if splits > TSS_SPLIT_MAX:
            return data
        pending.append((p, items, k, stop))
    if not pending:
        return data
    for p, items, k, stop in pending:
        _tss_split(p, items, k, stop)
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


# --- section_rule_dedupe (E5): one PDF hairline, one border -----------------
# Two passes can each re-emit the SAME source hairline and neither can see the
# other do it. date_column_untable dissolves a pdf2docx date table and carries
# the table's top border onto the first freed paragraph as a top w:pBdr;
# section_rules, running later, matches the heading text above it to that same
# rule in the PDF and gives the heading a bottom w:pBdr. Its own "the rule
# already survived" guard only knows about tables, and by then the table is
# gone. Word then draws two hairlines a couple of points apart under three of
# the CV's seven section headings.
#
# This pass is the referee, and it decides on the PDF's geometry rather than on
# which pass ran first: for two ADJACENT paragraphs where the upper one carries
# a bottom border and the lower one a top border, it locates both paragraphs'
# source lines on one page and counts the hairlines that lie between them. If
# the source drew exactly ONE rule in that gap, the two borders are that one
# rule and the lower paragraph's top border is dropped - the rule belongs to
# the heading it underlines. Two or more rules in the gap is a document that
# really is doubly ruled and is left alone; zero rules means neither border is
# PDF-backed and this pass has no evidence to act on, so it also leaves it.
#
# Safety model (each rule earned by a case this could otherwise corrupt):
#   - strictly adjacent blocks: a table or any other paragraph in between and
#     the two borders are not a pair.
#   - the upper paragraph's text must match exactly ONE source line in the
#     whole document; a repeated line ("Notes", a form label) cannot say which
#     gap to measure.
#   - the lower paragraph must be the very next source line under it on the
#     same page (the date column shares that baseline, so the whole baseline
#     group is offered), and must start with that line's text - date_column_
#     untable appends the date, so a prefix match is the honest test.
#   - a page carrying more hairlines than _RULE_MAX_PER_PAGE is a form grid or
#     a ruled table, not section furniture: no dedupe anywhere on it.
# Nothing is ever added, only a duplicate side removed, so a document without
# the pair is untouched byte for byte.

_SRD_BASELINE_EPS = 3.0   # pt of drift inside one baseline group
_SRD_MIN_ANCHOR = 8       # chars a source line needs before a prefix match counts


def _srd_page_rule_ys(page):
    """y0 of every hairline on the page, or None when the page is a grid."""
    rules = _rule_rects(page)
    if len(rules) > _RULE_MAX_PER_PAGE:
        return None
    return sorted(r.y0 for r, _, _ in rules)


def _srd_pages(pdf_doc):
    """Per page: sorted (bbox, normalised text) lines and hairline y0s."""
    out = []
    for page in pdf_doc:
        lines = sorted(((bb, _rule_norm(t)) for bb, t in _rule_lines(page)),
                       key=lambda e: (e[0][1], e[0][0]))
        out.append((lines, _srd_page_rule_ys(page)))
    return out


def _srd_locate(pages, text):
    """(page index, line index) when exactly one source line equals text."""
    hit = None
    for pi, (lines, _) in enumerate(pages):
        for li, (_, norm) in enumerate(lines):
            if norm == text:
                if hit is not None:
                    return None
                hit = (pi, li)
    return hit


def _srd_next_group(lines, li):
    """The gap under line li: (its own bottom y, the next baseline y, texts)."""
    top = lines[li][0][3]
    below = [e for e in lines[li + 1:] if e[0][1] >= lines[li][0][1] + 1.0]
    if not below:
        return None
    y = below[0][0][1]
    group = [norm for bb, norm in below if bb[1] <= y + _SRD_BASELINE_EPS]
    return top, y, group


def _srd_side(p, side):
    """The paragraph's w:pBdr child for that side, when it actually draws."""
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        return None
    pbdr = ppr.find(qn("w:pBdr"))
    if pbdr is None:
        return None
    el = pbdr.find(qn("w:" + side))
    if el is None or (el.get(qn("w:val")) or "nil") in ("nil", "none"):
        return None
    return el


def _srd_drop(el):
    """Remove one border side, and the wrappers it leaves empty."""
    pbdr = el.getparent()
    pbdr.remove(el)
    if len(pbdr):
        return
    ppr = pbdr.getparent()
    ppr.remove(pbdr)
    if not len(ppr) and not ppr.attrib:
        ppr.getparent().remove(ppr)


def _srd_text(p):
    return _rule_norm("".join(t.text or "" for t in p.iter(qn("w:t"))))


def section_rule_dedupe(data, pdf_doc=None):
    """Drop a paragraph's top border when the heading above it already draws that rule."""
    if pdf_doc is None:
        return data
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    blocks = [el for el in body if el.tag in (qn("w:p"), qn("w:tbl"))]
    pairs = []
    for a, b in zip(blocks, blocks[1:]):
        if a.tag != qn("w:p") or b.tag != qn("w:p"):
            continue
        if _srd_side(a, "bottom") is None:
            continue
        top = _srd_side(b, "top")
        if top is not None:
            pairs.append((a, b, top))
    if not pairs:
        return data
    pages = _srd_pages(pdf_doc)
    changed = False
    for a, b, top in pairs:
        text_a, text_b = _srd_text(a), _srd_text(b)
        if not text_a or not text_b:
            continue
        at = _srd_locate(pages, text_a)
        if at is None:
            continue
        pi, li = at
        lines, rule_ys = pages[pi]
        if rule_ys is None:            # grid page: no section furniture here
            continue
        nxt = _srd_next_group(lines, li)
        if nxt is None:
            continue
        gap_top, gap_bottom, group = nxt
        if not any(len(norm) >= _SRD_MIN_ANCHOR and text_b.startswith(norm)
                   for norm in group):
            continue
        if sum(1 for y in rule_ys if gap_top <= y <= gap_bottom) != 1:
            continue
        _srd_drop(top)
        changed = True
    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- wrap_tab_unfold: a soft wrap encoded as a tab is not a tab -------------
# Raw pdf2docx output for this CV carries ten paragraphs shaped
# <w:t>...monitoring, </w:t><w:r><w:tab/></w:r><w:t>and automated risk...</w:t>.
# There is no tab in the source. pdf2docx folded the wrapped continuation line
# into the paragraph that started it and, because the continuation line's x0
# sits a little right of the paragraph indent (a bullet's text column is
# outdented from its marker), encoded that leading offset as a TAB CHARACTER
# instead of a soft wrap. The paragraph then declares only the bullet's own
# stop, so the tab falls through to Word's default half-inch grid and paints a
# blank hole in the middle of a sentence ("such as        guns and knives").
#
# No other pass reaches it: paragraph_reflow and list_wrap_merge merge SEPARATE
# paragraphs, wrap_break_heal only heals w:br, and tab_stop_normalize bails on
# these (they are list items, and it only rewrites a single-tab date line).
#
# The discriminator is structural, not stylistic: in a REAL tabbed layout the
# text on both sides of the tab sits on the SAME line of the PDF (a label and
# its flush-right date). Here the text after the tab begins a NEW line, one row
# below, of a paragraph the page had to wrap. So a bare tab run is unfolded to a
# single space only when every one of these holds:
#
#   * the run holds a w:tab and nothing else (date_column_untable writes its
#     tabs as " \t" inside a text run, so its own output is out of scope), and
#     it has text on both sides;
#   * the words either side of it match the END of one PDF line and the START
#     of another EXACTLY ONCE in the document (unique-match binding, as in
#     wrap_break_heal) - ambiguous or absent evidence keeps the tab;
#   * that second line sits directly below the first (nothing between them,
#     normal leading) and starts further right - the offset that became the tab;
#   * the first line is a full measure AND the second line's first word could
#     not have fitted in the room left on it, so the wrap was forced by the
#     page, not chosen by the author;
#   * no hyphen at the seam (re-\tsign must not become "re- sign"; those keep
#     the tab rather than risk a meaning flip).
#
# The tab becomes one space, or nothing when a space already borders the seam,
# so the sentence reads with exactly one space wherever the hole used to be.

_WT_CTX_WORDS = 4          # words of context taken either side of the tab
_WT_MIN_CTX_WORDS = 5      # ...and at least this many in total, so the
                           # evidence n-gram is specific enough to bind
_WT_PITCH_RATIO = 2.0      # (row pitch / line height) above this is a gap
_WT_WORD_SLACK = 1.0       # extra character in the "would it have fitted" sum
_WT_HYPHENS = "-‐‑­"
_WT_SEG_RE = re.compile(r"[\n\t]")


def _wt_pages(pdf_doc):
    """Per page: every non-empty text line with its bbox, plus that page's own
    left-most and right-most text edges (the measure a full line is judged
    against)."""
    pages = []
    for page in pdf_doc:
        lines = []
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for ln in b.get("lines", []):
                text = "".join(s["text"] for s in ln["spans"])
                if not text.strip():
                    continue
                x0, y0, x1, y1 = ln["bbox"]
                lines.append({"text": text, "words": text.split(),
                              "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                              "mid": (y0 + y1) / 2.0})
        if lines:
            pages.append({"lines": lines,
                          "left": min(l["x0"] for l in lines),
                          "right": max(l["x1"] for l in lines)})
    return pages


def _wt_bare_tab(el):
    """The w:tab is the whole run: no text, no drawing, nothing but rPr."""
    run = el.getparent()
    if run is None or run.tag != qn("w:r"):
        return False
    kids = [c for c in run if c.tag != qn("w:rPr")]
    return len(kids) == 1 and kids[0] is el


def _wt_context(items, i):
    """(head, tail, words before, words after) for the tab at items[i]; the
    word context is taken from its own visual segment only, so another tab or
    a w:br ends it."""
    head = "".join(_char_of(el) for el in items[:i])
    tail = "".join(_char_of(el) for el in items[i + 1:])
    hw = _WT_SEG_RE.split(head)[-1].split()[-_WT_CTX_WORDS:]
    tw = _WT_SEG_RE.split(tail)[0].split()[:_WT_CTX_WORDS]
    return head, tail, hw, tw


def _wt_between(lines, a, b):
    """Some other line's vertical centre lies strictly between a's and b's."""
    lo, hi = a["mid"], b["mid"]
    for c in lines:
        if c is a or c is b:
            continue
        if lo + 0.01 < c["mid"] < hi - 0.01:
            return True
    return False


def _wt_forced(a, b, page):
    """b's first word could not have fitted in the room left on a, measured
    with a's own average character width."""
    if not b["words"] or not a["text"]:
        return False
    avg = (a["x1"] - a["x0"]) / max(1, len(a["text"]))
    remaining = page["right"] - a["x1"]
    return remaining < (len(b["words"][0]) + _WT_WORD_SLACK) * avg


def _wt_pair_ok(a, b, page):
    """b is the wrapped continuation of a: directly below it, offset right,
    behind a full measure that had no room for b's first word."""
    if b["mid"] <= a["mid"] or b["x0"] <= a["x0"]:
        return False
    height = max(a["y1"] - a["y0"], 1e-6)
    if (b["mid"] - a["mid"]) > _WT_PITCH_RATIO * height:
        return False
    if _wt_between(page["lines"], a, b):
        return False
    width = a["x1"] - a["x0"]
    if width < _WRAP_FULL_MIN_PT:
        return False
    if width < _WRAP_FULL_SHARE * (page["right"] - page["left"]):
        return False
    return _wt_forced(a, b, page)


def _wt_evidence(pages, hw, tw):
    """True when exactly one line pair in the document ends with hw, starts
    with tw, and reads as a forced wrap."""
    hits = 0
    for page in pages:
        ends = [l for l in page["lines"] if l["words"][-len(hw):] == hw]
        starts = [l for l in page["lines"] if l["words"][:len(tw)] == tw]
        for a in ends:
            for b in starts:
                if a is b:
                    continue
                if _wt_pair_ok(a, b, page):
                    hits += 1
                    if hits > 1:
                        return False
    return hits == 1


def _wt_collapse_trailing(items, i, tail_leads_space):
    """Leave exactly one space (or none) where the tab's neighbour ended."""
    if i == 0:
        return
    prev = items[i - 1]
    if prev.tag != qn("w:t"):
        return
    txt = prev.text or ""
    if not txt or not txt[-1:].isspace():
        return
    new = txt.rstrip() if tail_leads_space else txt.rstrip() + " "
    if new == txt:
        return
    prev.text = new
    if new[-1:].isspace():
        prev.set(_XML_SPACE, "preserve")


def wrap_tab_unfold(data, pdf_doc=None):
    """Replace a bare tab run that only encodes a forced line wrap with the
    single space the sentence actually reads with."""
    if pdf_doc is None:
        return data
    pages = _wt_pages(pdf_doc)
    if not pages:
        return data
    doc = Document(io.BytesIO(data))
    changed = False

    for p in doc.element.body.iter(qn("w:p")):
        items = _wb_items(p)
        for i, el in enumerate(items):
            if el.tag != qn("w:tab") or not _wt_bare_tab(el):
                continue
            head, tail, hw, tw = _wt_context(items, i)
            if not hw or not tw or len(hw) + len(tw) < _WT_MIN_CTX_WORDS:
                continue
            if hw[-1][-1:] in _WT_HYPHENS:
                continue  # never fuse across a hyphen
            if not _wt_evidence(pages, hw, tw):
                continue
            tail_leads_space = tail[:1].isspace()
            needs_space = not head[-1:].isspace() and not tail_leads_space
            # _wb_remove_br drops the element and the run it emptied; a w:tab
            # and a w:br are the same shape of run child to it.
            _wb_remove_br(el, replace_with_space=needs_space)
            _wt_collapse_trailing(items, i, tail_leads_space)
            changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- tab_stop_normalize (E3): one date column, no phantom stops -------------
# Three defects the visual panel found on the CV, all about tab furniture:
#
#  (a) the date lines do not agree with each other. Most of them came out of
#      date_column_untable, which writes a RIGHT stop at the label row's own
#      width, so they land flush right. The ETSTC line never was a table -
#      pdf2docx wrote it as a plain paragraph with a LEFT stop at the x where
#      it measured the date starting (462.3pt). A left stop only puts the date
#      where the ORIGINAL font's metrics put it; in any substituted font the
#      tail is a different width and the date floats short of the margin while
#      its neighbours sit on it. A right stop at the text-column edge is the
#      shape that means "flush right" independently of font metrics, so every
#      right-zone stop is rewritten to exactly that, wherever it came from -
#      but only where the section states a real text margin to align to. On a
#      pgMar-0 document (pdf2docx emits those) the "text column" is the paper
#      edge, and moving a footer's already-right page number out there would
#      push it into the printer's unprintable border, so those are left alone.
#
#  (b) fused_line_split copies a paragraph's pPr onto the half it cuts off, so
#      the degree line below ETSTC inherits a tab stop it never uses. An unused
#      direct stop is invisible until someone edits the line, then their tab
#      jumps to a position nothing on the page explains. A stop on a list item
#      is NOT unused - that is the gap between the number and the text, which
#      list_hanging_indent owns - so numbered paragraphs are out of scope. The
#      numbering test reads the paragraph's own pPr, which is what pdf2docx and
#      list_numbering both write; a paragraph inheriting numPr from its STYLE
#      would look unnumbered here.
#
#  (c) trailing whitespace baked into the last run (the contact line's dangling
#      space, "2020 - 2023 "). It is invisible in Word, but it survives copy,
#      it lands in every text extraction, and it defeats an exact-match search.
#      Whitespace BEFORE a tab is deliberately left alone: date_column_untable
#      writes exactly one such space so that an extractor reading only w:t does
#      not weld "...Adma" onto "Mar 2025".
#
# The pass runs last so it normalises what every other pass emitted, and each
# rule is structural: prose carries neither tab characters nor direct stops.

TAB_RIGHT_ZONE = 0.75     # fraction of the text column past which a stop is a
                          # right-margin stop rather than a real column stop
TAB_TAIL_MAX_CHARS = DATE_CELL_MAX_CHARS
_TAB_STOP_SKIP = ("clear", "bar")


def _tab_stream(p):
    """('tab', '') / ('text', s) for p's runs, in document order.

    Reads w:r elements, so a run wrapped in a w:hyperlink is included and a
    w:tab sitting in w:pPr/w:tabs (the STOP, same tag name) is not.
    """
    items = []
    for r in p.iter(qn("w:r")):
        for child in r:
            if child.tag == qn("w:tab"):
                items.append(("tab", ""))
            elif child.tag == qn("w:t"):
                items.append(("text", child.text or ""))
    return items


def _section_text_columns(body):
    """(index in body, text width in twips) for sections that HAVE a text margin.

    _section_widths reports pgSz - pgMar for every section, which is the text
    column only when the margins are real. pdf2docx writes pgMar left/right = 0
    on some documents (it positions everything by absolute indent instead), and
    there the same subtraction returns the full paper width - the physical page
    edge, not a margin anything is aligned to. A right stop placed there prints
    inside the unprintable border, so those sections are simply not offered as
    an alignment target and every rule that needs one is skipped.
    """
    out = []
    for i, child in enumerate(body):
        for sect in child.iter(qn("w:sectPr")) if child.tag == qn("w:p") else ():
            out.append((i, sect))
    tail = body.find(qn("w:sectPr"))
    if tail is not None:
        out.append((len(body), tail))
    cols = []
    for i, sect in out:
        if _sect_margin(sect, "left") <= 0 or _sect_margin(sect, "right") <= 0:
            continue
        w = _sect_width(sect)
        if w > 0:
            cols.append((i, w))
    return cols


def _sect_margin(sect, side):
    node = sect.find(qn("w:pgMar"))
    try:
        return int(round(float(node.get(qn("w:" + side)))))
    except (AttributeError, TypeError, ValueError):
        return 0


def _direct_stops(p):
    """(w:tabs element, [stop elements]) from p's OWN pPr, never from its style."""
    ppr = p.find(qn("w:pPr"))
    tabs = ppr.find(qn("w:tabs")) if ppr is not None else None
    if tabs is None:
        return None, []
    return tabs, [c for c in tabs if c.tag == qn("w:tab")]


def _stop_pos(stop):
    try:
        return int(round(float(stop.get(qn("w:pos")))))
    except (TypeError, ValueError):
        return None


def _rstrip_paragraph(p):
    """Drop whitespace hanging off the END of the paragraph's text.

    Walks back from the last run, so a dangling space split across two runs
    goes in one pass, and stops at the first run whose tail is real text. A run
    left with nothing but an empty w:t and no other content is removed, and an
    emptied w:hyperlink shell goes with it.
    """
    runs = list(p.iter(qn("w:r")))   # in document order, hyperlink children too
    if not runs:
        return False
    # the last renderable thing must be text: a trailing tab, break, picture or
    # field is content, and the whitespace in front of it is positioning
    last = runs[-1]
    kids = [c for c in last if c.tag in (qn("w:t"), qn("w:tab"), qn("w:br"),
                                         qn("w:drawing"), qn("w:pict"),
                                         qn("w:object"), qn("w:noBreakHyphen"))]
    if not kids or kids[-1].tag != qn("w:t"):
        return False
    if not "".join(t.text or "" for t in p.iter(qn("w:t"))).strip():
        return False    # a whitespace-only paragraph is empty_para_prune's call
    changed = False
    for r in reversed(runs):
        kids = [c for c in r if c.tag in (qn("w:t"), qn("w:tab"), qn("w:br"),
                                          qn("w:drawing"), qn("w:pict"),
                                          qn("w:object"), qn("w:noBreakHyphen"))]
        if not kids or kids[-1].tag != qn("w:t"):
            break
        t = kids[-1]
        stripped = (t.text or "").rstrip()
        if stripped != (t.text or ""):
            t.text = stripped
            changed = True
        if stripped:
            break
        if len(kids) > 1:
            break       # keep the empty w:t; the run still holds real content
        parent = r.getparent()
        parent.remove(r)
        if (parent.tag == qn("w:hyperlink")
                and parent.find(qn("w:r")) is None):
            parent.getparent().remove(parent)
        changed = True
    return changed


# ---------------------------------------------------------------- section breaks
# pdf2docx starts a new w:sectPr per PDF page, and it parks that sectPr on an
# extra paragraph of its own. That paragraph is empty but it is still a
# paragraph, so Word prints a blank line the source never had - here between the
# LANGUAGES heading and its one line of content. OOXML lets the break ride on
# the LAST paragraph of the section instead, so the break can be attached to the
# paragraph already above it and the carrier deleted with no change to which
# content falls in which section.
#
# The same per-page reconstruction also guesses margins page by page, and when
# it finds no evidence on a continuation page it falls back to Word's 1in
# default: page 1 here is right=810 bottom=478 twips, page 2 right=1440
# bottom=1440, so the text column narrows by half an inch halfway down a CV
# whose two PDF pages are exactly the same size. Where the PDF pages really do
# share one geometry, a continuation section takes the first section's margin on
# any side where the first section's is the SMALLER of the two. Only-smaller is
# what keeps this safe on arbitrary documents: the text area of a continuation
# section can grow but never shrink, so no page can be made to overflow and
# nothing already laid out is pushed off the bottom.
SB_SIDES = ("top", "right", "bottom", "left")


def _sb_sections(body):
    """[(carrier paragraph or None for the body-level one, sectPr)], in order."""
    out = []
    for child in body:
        if child.tag != qn("w:p"):
            continue
        ppr = child.find(qn("w:pPr"))
        if ppr is None:
            continue
        sect = ppr.find(qn("w:sectPr"))
        if sect is not None:
            out.append((child, sect))
    tail = body.find(qn("w:sectPr"))
    if tail is not None:
        out.append((None, tail))
    return out


def _sb_int(node, attr):
    try:
        return int(round(float(node.get(qn("w:" + attr)))))
    except (AttributeError, TypeError, ValueError):
        return None


def _sb_pgsz(sect):
    node = sect.find(qn("w:pgSz"))
    if node is None:
        return None
    w, h = _sb_int(node, "w"), _sb_int(node, "h")
    if not w or not h:
        return None
    return (w, h, node.get(qn("w:orient")) or "")


def _sb_margins(sect):
    """{side: twips} or None when the sectPr has no usable w:pgMar."""
    node = sect.find(qn("w:pgMar"))
    if node is None:
        return None
    vals = {}
    for side in SB_SIDES:
        v = _sb_int(node, side)
        if v is None or v < 0:
            return None
        vals[side] = v
    return vals


def _sb_uniform_pages(pdf_doc):
    """True when every PDF page is the same size, to the point."""
    try:
        sizes = {(round(pg.rect.width), round(pg.rect.height)) for pg in pdf_doc}
    except Exception:  # noqa: BLE001 - no geometry evidence is just "do nothing"
        return False
    return len(sizes) == 1


def _sb_prev_paragraph(body, p):
    """The w:p immediately before p, or None if that slot is not a paragraph.

    A sectPr may only live on w:p/w:pPr or on w:body, so a table (or the start
    of the body) directly above the carrier leaves nowhere legal to move it.
    """
    prev = p.getprevious()
    if prev is None or prev.tag != qn("w:p"):
        return None
    return prev


def _sb_flatten(p):
    """Make an empty section-carrier paragraph take no vertical space."""
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        return False
    for sp in ppr.findall(qn("w:spacing")):
        ppr.remove(sp)
    _ppr_insert(ppr, parse_xml(
        '<w:spacing %s w:before="0" w:after="0" w:line="1" w:lineRule="exact"/>'
        % nsdecls("w")))
    rpr = ppr.find(qn("w:rPr"))
    if rpr is None:
        rpr = parse_xml("<w:rPr %s/>" % nsdecls("w"))
        _ppr_insert(ppr, rpr)
    for tag in ("w:sz", "w:szCs"):
        for el in rpr.findall(qn(tag)):
            rpr.remove(el)
    rpr.insert(0, parse_xml('<w:szCs %s w:val="2"/>' % nsdecls("w")))
    rpr.insert(0, parse_xml('<w:sz %s w:val="2"/>' % nsdecls("w")))
    return True


def section_break_tidy(data, pdf_doc=None):
    """Hide pdf2docx's blank section-break paragraphs and stop the page margins
    changing between two PDF pages that are the same size."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    changed = False

    # (a) an empty carrier paragraph: re-attach its break to the paragraph above.
    for p, sect in _sb_sections(body):
        if p is None or _para_blankness(p) != "sect":
            continue
        prev = _sb_prev_paragraph(body, p)
        prev_ppr = prev.find(qn("w:pPr")) if prev is not None else None
        if prev is not None and (prev_ppr is None
                                 or prev_ppr.find(qn("w:sectPr")) is None):
            if prev_ppr is None:
                prev_ppr = parse_xml("<w:pPr %s/>" % nsdecls("w"))
                prev.insert(0, prev_ppr)
            sect.getparent().remove(sect)
            _ppr_insert(prev_ppr, sect)
            body.remove(p)
            changed = True
        elif not p.findall(qn("w:r")):
            changed = _sb_flatten(p) or changed

    # (b) one page geometry in the PDF -> one set of margins in the docx.
    sects = [s for _, s in _sb_sections(body)]
    if len(sects) > 1 and pdf_doc is not None and _sb_uniform_pages(pdf_doc):
        first_size, first_mar = _sb_pgsz(sects[0]), _sb_margins(sects[0])
        if first_size and first_mar and all(v > 0 for v in first_mar.values()):
            for sect in sects[1:]:
                mar = _sb_margins(sect)
                if mar is None or _sb_pgsz(sect) != first_size:
                    continue
                node = sect.find(qn("w:pgMar"))
                for side in SB_SIDES:
                    if first_mar[side] < mar[side]:
                        node.set(qn("w:" + side), str(first_mar[side]))
                        changed = True

    if not changed:
        return data
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()

def tab_stop_normalize(data, pdf_doc=None):
    """Right-align every date tab at the text margin; drop unused stops and
    trailing run whitespace."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    sects = _section_text_columns(body)
    geoms = _section_geoms(body)
    edges = _pdf_right_edges(pdf_doc)
    changed = False

    for idx, p in enumerate(body):
        if p.tag != qn("w:p"):
            continue
        if _rstrip_paragraph(p):
            changed = True
        tabs, stops = _direct_stops(p)
        if tabs is None or _has_numpr(p):
            continue
        stream = _tab_stream(p)
        tab_chars = [i for i, (kind, _) in enumerate(stream) if kind == "tab"]

        if not tab_chars:
            # (b) a stop nothing uses: fused_line_split's inherited leftover
            tabs.getparent().remove(tabs)
            changed = True
            continue

        # (a) one label, one flush-right tail, one stop deep in the right zone
        if len(tab_chars) != 1 or len(stops) != 1:
            continue
        if (stops[0].get(qn("w:val")) or "left") in _TAB_STOP_SKIP:
            continue
        pos = _stop_pos(stops[0])
        # a sectPr rides on the LAST paragraph of its own section, so the
        # section governing idx is the first one recorded at or after it
        width = next((w for i, w in sects if i >= idx), 0)
        if pos is None or width <= 0 or pos < TAB_RIGHT_ZONE * width:
            continue
        head = "".join(s for k, s in stream[:tab_chars[0]] if k == "text")
        tail = "".join(s for k, s in stream[tab_chars[0] + 1:] if k == "text")
        if not head.strip() or not tail.strip():
            continue
        if len(tail.strip()) > TAB_TAIL_MAX_CHARS:
            continue
        # A hair-width left indent is pdf2docx's measurement of a cell edge,
        # not an author's indent. It costs the line box that much width, so a
        # stop written at the text margin ends up outside it and real Word
        # drops the tab (QuickLook places custom stops loosely and hid this).
        # Dropping it is also what makes the measured stop land exactly on the
        # column the dates were measured at.
        left = _ind_val(p, "left", "start")
        if left is not None and 0 < left <= _IND_HAIR_TWIPS:
            _ind_set(p, 0, "left", "start")
            changed = True
        # Where the tail REALLY ends in the source, when the PDF can say so.
        # Falling back to the text margin assumes every flush-right tail is
        # flush with the paper, which is false whenever the author right-aligned
        # to a column of their own; and the margin has to be reduced by this
        # paragraph's own indents or the stop lands outside its line box and
        # real Word drops the tab (see _clamp_stop_to_line).
        geom = _geom_at(geoms, idx, inclusive=True)
        target = _measured_stop(edges, [_norm_line(tail)],
                                geom[1], geom[2], width)
        if target is None:
            target = (width
                      - max(_ind_val(p, "left", "start") or 0, 0)
                      - max(_ind_val(p, "right", "end") or 0, 0))
        if target <= 0:
            continue
        if stops[0].get(qn("w:val")) == "right" and pos == target:
            continue
        stops[0].set(qn("w:val"), "right")
        stops[0].set(qn("w:pos"), str(target))
        changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ST_TextScale is an integer percent (1..600 in the transitional schema).  pdf2docx
# derives character scaling from the ratio of the PDF's drawn glyph width to the
# substituted font's natural width, so it emits full float precision
# (<w:w w:val="97.74999618530273"/>): strict validators reject it, and a value that
# is not a whole percent cannot be reproduced by anyone retyping the text in Word.
CHAR_SCALE_MIN = 1
CHAR_SCALE_MAX = 600
CHAR_SCALE_DEFAULT = 100


def _xml_roots(doc):
    """Every XML part's root element: body, headers/footers, styles, numbering."""
    roots, seen = [], set()
    for part in doc.part.package.iter_parts():
        el = getattr(part, "element", None)
        if el is None or id(el) in seen:
            continue
        seen.add(id(el))
        roots.append(el)
    return roots


def _scale_percent(raw):
    """int percent for an ST_TextScale value, or None when it is not a number.

    Word 2010+ also writes the measurement form ("98%"); both parse to the same
    percent, and both are re-emitted in the integer form the schema requires.
    """
    if raw is None:
        return None
    txt = raw.strip()
    if txt.endswith("%"):
        txt = txt[:-1].strip()
    try:
        pct = float(txt)
    except ValueError:
        return None
    pct = int(round(pct))
    return max(CHAR_SCALE_MIN, min(CHAR_SCALE_MAX, pct))


def char_scale_normalize(data, pdf_doc=None):
    """Round every w:w character scale to a whole percent; drop it at 100%."""
    doc = Document(io.BytesIO(data))
    changed = False

    for root in _xml_roots(doc):
        for el in list(root.iter(qn("w:w"))):
            rpr = el.getparent()
            # w:w is character scaling only inside a run-properties element;
            # anything else wearing that tag is left alone.
            if rpr is None or rpr.tag != qn("w:rPr"):
                continue
            raw = el.get(qn("w:val"))
            pct = _scale_percent(raw)
            if pct is None:
                continue
            if pct == CHAR_SCALE_DEFAULT:
                # 100% is the default; the element only adds invalid noise.
                rpr.remove(el)
                changed = True
                continue
            if raw != str(pct):
                el.set(qn("w:val"), str(pct))
                changed = True

    if not changed:
        return data
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --- phantom two-column page regions -----------------------------------------
# pdf2docx decides a page's column count by looking for a vertical strip of
# white space that runs down the text. A CV whose entries put the school on the
# left and the date flush right hands it exactly that strip, so it reads the
# page as a real two-column region and emits it as one: a `continuous` section
# break carrying <w:cols w:num="2"> for the left text, then a `nextColumn`
# section for the dates. Two things break at once inside that band. The left
# column is narrower than the page, so the source lines pdf2docx folded into one
# block ("... Achrafieh, Lebanon" and "BA in Computer Science") stay welded with
# no separator at all, which is why fused_line_split cannot cut them: there is
# no child boundary to cut on. And the date is exiled into column two, several
# paragraphs of vertical white space away from the line it belongs to.
#
# phantom_column_flatten dissolves such a band and rebuilds it from the PDF's
# own lines. It refutes the column reading with geometry, never with wording:
# on a genuine two-column page NO line may cross the gutter, so a page whose
# body lines straddle pdf2docx's own column boundary has one text column and
# the band is an artefact. The rebuild is evidence-only:
#   * every run of the band must match exactly ONE source line, at exactly one
#     offset in it, or nothing is touched: an ambiguous run means the band
#     cannot be re-ordered safely;
#   * output paragraphs are the PDF's lines, in the PDF's own (y, x) order, so
#     the date returns to the line it was set on and the welded lines separate;
#   * two segments share one output paragraph only when they overlap vertically
#     AND the second starts to the right of the first, i.e. they were one visual
#     line; they are joined by a tab and a RIGHT stop written at the x the PDF
#     ends the second segment on, so the date stays flush right;
#   * runs, run properties and paragraph properties are moved, never rewritten.
# The band's section breaks disappear with the paragraphs that carried them, so
# no w:cols above one survives; a nextPage break directly in front of a band
# whose text is on the same PDF page is demoted to `continuous`, because a page
# break there is provably wrong.
PCB_TWIPS_PER_PT = 20.0
PCB_SCALE_TOL = 0.01       # pgSz vs PDF page width
PCB_MIN_CROSS = 2          # body lines straddling the gutter that refute columns
PCB_MAX_BAND_PARAS = 24    # a band longer than this is a document, not an entry
PCB_ROW_OVERLAP = 0.5      # share of line height two segments must share
PCB_MIN_TAB_TW = 240       # a right stop closer in than this is not a column


def _pcb_cols(sect):
    """(column count, first column width in twips) declared by a sectPr."""
    node = sect.find(qn("w:cols")) if sect is not None else None
    if node is None:
        return 1, None
    try:
        num = int(node.get(qn("w:num")) or 1)
    except (TypeError, ValueError):
        num = 1
    first = None
    for col in node.findall(qn("w:col")):
        try:
            first = int(col.get(qn("w:w")))
        except (TypeError, ValueError):
            first = None
        break
    return max(1, num), first


def _pcb_type(sect):
    node = sect.find(qn("w:type")) if sect is not None else None
    val = node.get(qn("w:val")) if node is not None else None
    return val or "nextPage"


def _pcb_sections(body):
    """[(carrier w:p or None, sectPr or None, [blocks])] in document order."""
    out, acc = [], []
    for child in body:
        if child.tag == qn("w:sectPr"):
            continue
        acc.append(child)
        if child.tag != qn("w:p"):
            continue
        ppr = child.find(qn("w:pPr"))
        sect = ppr.find(qn("w:sectPr")) if ppr is not None else None
        if sect is not None:
            out.append((child, sect, acc))
            acc = []
    out.append((None, body.find(qn("w:sectPr")), acc))
    return out


def _pcb_bands(sections):
    """Maximal runs of >=2 consecutive sections sharing one multi-column spec."""
    bands, i = [], 0
    while i < len(sections):
        num, width = _pcb_cols(sections[i][1])
        if num < 2 or not width:
            i += 1
            continue
        j = i + 1
        while j < len(sections) and _pcb_cols(sections[j][1]) == (num, width):
            j += 1
        if j - i >= 2:
            bands.append((i, j, width))
        i = j
    return bands


def _pcb_page_lines(page):
    out = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type"):
            continue
        for ln in block.get("lines", ()):
            text = _fs_norm("".join(sp["text"] for sp in ln["spans"]))
            if not text:
                continue
            x0, y0, x1, y1 = ln["bbox"]
            out.append({"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
    return out


def _pcb_pages(pdf_doc):
    try:
        return [(_pcb_page_lines(page), float(page.rect.width)) for page in pdf_doc]
    except Exception:  # noqa: BLE001 - unreadable geometry is just "do nothing"
        return []


def _pcb_boundary(sect, col1_tw, page_width_pt):
    """Gutter x in PDF points, or None when the docx and PDF pages disagree."""
    node = sect.find(qn("w:pgSz"))
    try:
        page_tw = int(node.get(qn("w:w")))
    except (AttributeError, TypeError, ValueError):
        return None
    if page_tw <= 0 or page_width_pt <= 0:
        return None
    if abs(page_tw / (page_width_pt * PCB_TWIPS_PER_PT) - 1.0) > PCB_SCALE_TOL:
        return None
    left = _sect_margin(sect, "left")
    if left <= 0:
        return None
    return (left + col1_tw) / PCB_TWIPS_PER_PT


def _pcb_crossings(lines, boundary):
    """Body lines that straddle the gutter: each one refutes the column split."""
    return sum(1 for l in lines
               if l["x0"] < boundary - 1.0 and l["x1"] > boundary + 1.0)


def _pcb_locate(key, lines):
    """The one line containing `key` exactly once, as (index, offset), or None."""
    hit = None
    for i, line in enumerate(lines):
        n = line["text"].count(key)
        if not n:
            continue
        if n > 1 or hit is not None:
            return None
        hit = (i, line["text"].index(key))
    return hit


def _pcb_segments(paras, lines):
    """{line index: [elements in reading order]} for the whole band, or None."""
    placed, pending, seen = {}, [], {}
    for p in paras:
        items = _fs_children(p)
        if items is None:
            return None
        last = None
        for el, text in items:
            key = _fs_norm(text)
            if not key:
                pending.append((el, last))
                continue
            hit = _pcb_locate(key, lines)
            if hit is None:
                return None
            idx, off = hit
            placed.setdefault(idx, []).append((off, len(seen), el))
            seen[el] = idx
            last = el
    for el, anchor in pending:
        idx = seen.get(anchor)
        if idx is None:
            return None
        placed[idx].append((10 ** 9, len(seen), el))
        seen[el] = idx
    if not placed:
        return None
    return {idx: [el for _, _, el in sorted(seg, key=lambda t: t[:2])]
            for idx, seg in placed.items()}


def _pcb_rows(placed, lines):
    """Group the used source lines into visual rows: [[line index, ...], ...]."""
    used = sorted(placed, key=lambda i: (round(lines[i]["y0"], 1), lines[i]["x0"]))
    rows = []
    for idx in used:
        line = lines[idx]
        if rows:
            prev = lines[rows[-1][-1]]
            share = min(prev["y1"], line["y1"]) - max(prev["y0"], line["y0"])
            height = min(prev["y1"] - prev["y0"], line["y1"] - line["y0"])
            if (height > 0 and share >= PCB_ROW_OVERLAP * height
                    and line["x0"] >= prev["x1"]):
                rows[-1].append(idx)
                continue
        rows.append([idx])
    return rows


def _pcb_set_right_stop(ppr, pos_tw):
    """One right stop where the PDF ends the line, and no right indent to clip it."""
    for tabs in ppr.findall(qn("w:tabs")):
        ppr.remove(tabs)
    _ppr_insert(ppr, parse_xml(
        '<w:tabs %s><w:tab w:val="right" w:pos="%d"/></w:tabs>'
        % (nsdecls("w"), pos_tw)))
    ind = ppr.find(qn("w:ind"))
    if ind is not None:
        for attr in ("right", "end", "rightChars", "endChars"):
            if ind.get(qn("w:" + attr)) is not None:
                del ind.attrib[qn("w:" + attr)]


def _pcb_build(row, placed, lines, owner, left_tw, text_tw):
    """One output paragraph for one visual row of the band."""
    new = copy.deepcopy(owner[placed[row[0]][0]])
    for child in list(new):
        if child.tag != qn("w:pPr"):
            new.remove(child)
    ppr = new.find(qn("w:pPr"))
    if ppr is not None:
        for sect in ppr.findall(qn("w:sectPr")):
            ppr.remove(sect)
    for n, idx in enumerate(row):
        if n:
            # pdf2docx's own label/date convention is a space and then the tab;
            # the space is what keeps the two segments separate words for any
            # reader that ignores tabs, so it is written unless one is there
            tail = _el_text(new)
            new.append(parse_xml(
                "<w:r %s>%s<w:tab/></w:r>"
                % (nsdecls("w"),
                   "" if not tail or tail[-1].isspace()
                   else '<w:t xml:space="preserve"> </w:t>')))
        for el in placed[idx]:
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
            new.append(el)
    if len(row) > 1 and ppr is not None:
        pos = int(round(lines[row[-1]]["x1"] * PCB_TWIPS_PER_PT)) - left_tw
        if PCB_MIN_TAB_TW <= pos <= text_tw:
            _pcb_set_right_stop(ppr, pos)
    return new


def _pcb_demote_break(first, lines):
    """A nextPage break in front of a band on the SAME PDF page is wrong: make
    it continuous, so the band no longer starts a page of its own."""
    prev = first.getprevious()
    if prev is None or prev.tag != qn("w:p"):
        return
    sect = prev.find(qn("w:pPr") + "/" + qn("w:sectPr"))
    if sect is None or _pcb_type(sect) in ("continuous", "nextColumn"):
        return
    # the carrier is often pdf2docx's own empty paragraph, so the text that has
    # to be shown to sit on the band's page is the nearest one above it
    key, back = "", prev
    while back is not None and back.tag == qn("w:p") and not key:
        key = _fs_norm(_el_text(back))
        back = back.getprevious()
    if not key or _pcb_locate(key, lines) is None:
        return
    for node in sect.findall(qn("w:type")):
        sect.remove(node)
    sect.insert(0, parse_xml('<w:type %s w:val="continuous"/>' % nsdecls("w")))


def phantom_column_flatten(data, pdf_doc=None):
    """Dissolve a pdf2docx column band on a single-text-column page and rebuild
    its paragraphs from the PDF's own source lines."""
    if pdf_doc is None:
        return data
    pages = _pcb_pages(pdf_doc)
    if not pages:
        return data
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    sections = _pcb_sections(body)
    changed = False
    for start, stop, col1_tw in _pcb_bands(sections):
        band = sections[start:stop]
        paras = [c for _, _, blocks in band for c in blocks]
        if not paras or len(paras) > PCB_MAX_BAND_PARAS:
            continue
        if any(p.tag != qn("w:p") for p in paras):
            continue
        sect = band[0][1]
        text_tw = _sect_width(sect)
        left_tw = _sect_margin(sect, "left")
        if text_tw <= 0:
            continue
        found = None
        for lines, width in pages:
            boundary = _pcb_boundary(sect, col1_tw, width)
            if boundary is None or _pcb_crossings(lines, boundary) < PCB_MIN_CROSS:
                continue
            placed = _pcb_segments(paras, lines)
            if placed is not None:
                found = (lines, placed)
                break
        if found is None:
            continue
        lines, placed = found
        owner = {}
        for p in paras:
            for el in p:
                if el.tag != qn("w:pPr"):
                    owner[el] = p
        built = [_pcb_build(row, placed, lines, owner, left_tw, text_tw)
                 for row in _pcb_rows(placed, lines)]
        anchor = paras[0]
        for new in built:
            anchor.addprevious(new)
        _pcb_demote_break(built[0], lines)
        for p in paras:
            body.remove(p)
        for carrier, sect_el, _blocks in band:
            if carrier is not None or sect_el is None:
                continue
            for node in sect_el.findall(qn("w:cols")):
                sect_el.replace(node, parse_xml("<w:cols %s/>" % nsdecls("w")))
            for node in sect_el.findall(qn("w:type")):
                if (node.get(qn("w:val")) or "") == "nextColumn":
                    sect_el.remove(node)
        changed = True
    if not changed:
        return data
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# fused_line_split runs after date_column_untable so it sees the tabs that pass
# writes (a tab at a seam vetoes a cut), and before heading_styles so a title
# line freed from its subtitle can still be recognised as a heading.
# section_rules and empty_para_prune run last of all: the border needs the
# final paragraph text (reflow may still be merging it) and the prune has to
# see the empties every earlier pass left behind, font_names included (it
# only ever touches runs with text, so the empties it leaves alone are exactly
# what the prune is for).

# ------------------------------------------------------------------ stray marks
# pdf2docx leaves three structural marks on a page the PDF itself does not have.
#
# (a) A continuous w:sectPr parked in a body paragraph's w:pPr whose page size,
#     margins, columns and grid are identical to the section that follows it.
#     It changes no layout at all, and shows up in Word as a "Section Break
#     (Continuous)" marker (a box glyph in other renderers). A section break
#     that carries no property change is removable by definition, so the test is
#     a serialised comparison of the two sections' properties, not a heuristic.
#
# (b) A trailing w:br (and the trailing space in front of it) on a heading run.
#     pdf2docx emits it where the source page simply ends the title line, so the
#     docx gets an empty line the PDF does not have. Only ever applied to a
#     Heading-styled paragraph, and only to breaks at the very end of it, so a
#     deliberate mid-heading line break and every prose paragraph are untouched.
#
# (c) A w:ind w:right measured off the text block's bounding box rather than off
#     a real right-hand constraint. When a docx paragraph matches exactly ONE
#     line in the PDF, that line never wrapped, so the source says nothing about
#     where its right boundary is; the invented indent narrows the paragraph for
#     whoever edits it next and can wrap the very line it was measured from.
#     Requires a unique whole-line match and clear space to the right of it, so a
#     genuine narrow column (something else printed alongside) keeps its indent.
#     Widening a paragraph can only unwrap text, never push it off the page --
#     but only while the text hangs off the LEFT margin. On a right-aligned or
#     centred paragraph the right indent is not a wrap boundary at all, it is
#     what positions the text; clearing it slides the line to the right margin.
#     So the effective alignment (direct w:jc, else the w:jc inherited down the
#     paragraph style's w:basedOn chain) has to say left/start/justify before
#     the indent can be treated as measurement noise.

_SM_HEADING_RE = re.compile(r"^Heading[1-9]$")
_SM_POSITIONAL_JC = frozenset(("right", "end", "center", "centre"))
SM_RIGHT_GAP_PT = 2.0        # ink this close to the right edge still counts as adjacent
SM_BAND_PAD_PT = 1.0         # vertical slack when testing "on the same line"


def _sm_sig(sect):
    """Section properties minus w:type, canonically ordered, for comparison."""
    out = []
    for child in sect:
        if child.tag == qn("w:type"):
            continue
        out.append((child.tag, tuple(sorted(child.attrib.items())),
                    tuple((g.tag, tuple(sorted(g.attrib.items()))) for g in child)))
    return tuple(sorted(out))


def _sm_type(sect):
    node = sect.find(qn("w:type"))
    return (node.get(qn("w:val")) or "") if node is not None else ""


def _sm_drop_inert_sections(body):
    """(a) remove every continuous break that changes nothing about the page."""
    sects = [s for _, s in _sb_sections(body)]
    changed = False
    for i, sect in enumerate(sects[:-1]):
        if _sm_type(sect) != "continuous":
            continue
        if _sm_sig(sect) != _sm_sig(sects[i + 1]):
            continue
        parent = sect.getparent()
        if parent is None or parent.tag != qn("w:pPr"):
            continue          # the body-level sectPr is the document's own
        parent.remove(sect)
        changed = True
    return changed


def _sm_runs_with_text(p):
    return [r for r in p.findall(qn("w:r"))
            if any((t.text or "") for t in r.findall(qn("w:t")))]


def _sm_strip_heading_tail(p):
    """(b) drop trailing breaks and trailing spaces from a heading paragraph."""
    ppr = p.find(qn("w:pPr"))
    if ppr is None:
        return False
    style = ppr.find(qn("w:pStyle"))
    if style is None or not _SM_HEADING_RE.match(style.get(qn("w:val")) or ""):
        return False
    changed = False
    while True:
        runs = p.findall(qn("w:r"))
        if not runs:
            break
        last = runs[-1]
        kids = [k for k in last if k.tag != qn("w:rPr")]
        if kids and all(k.tag == qn("w:br") for k in kids):
            if not _sm_runs_with_text(p):
                break                     # never empty the heading out
            p.remove(last)
            changed = True
            continue
        while kids and kids[-1].tag == qn("w:br"):
            last.remove(kids[-1])
            kids.pop()
            changed = True
        break
    # Only strip when the heading really ends in one of its own runs.  If the
    # last thing in it is a w:hyperlink, both the link's trailing space and the
    # space in front of it are deliberate, so leave the paragraph alone.
    content = [k for k in p if k.tag in (qn("w:r"), qn("w:hyperlink"))]
    if content and content[-1].tag == qn("w:hyperlink"):
        return changed
    texts = [t for r in p.findall(qn("w:r"))
             for t in r.findall(qn("w:t")) if (t.text or "")]
    if texts:
        last_t = texts[-1]
        stripped = (last_t.text or "").rstrip()
        if stripped and stripped != last_t.text:
            last_t.text = stripped
            changed = True
    return changed


def _sm_page_ink(page):
    """(text lines, every drawn box) on one page, in PDF points."""
    lines, boxes = [], []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type"):
            boxes.append(tuple(float(v) for v in block["bbox"]))
            continue
        for ln in block.get("lines", ()):
            body = _fs_norm("".join(sp["text"] for sp in ln["spans"]))
            if not body:
                continue
            bbox = tuple(float(v) for v in ln["bbox"])
            lines.append({"text": body, "bbox": bbox})
            boxes.append(bbox)
    return lines, boxes


def _sm_pages(pdf_doc):
    try:
        return [_sm_page_ink(page) for page in pdf_doc]
    except Exception:  # noqa: BLE001 - unreadable geometry is just "do nothing"
        return []


def _sm_unwrapped(pages, text):
    """True when `text` is exactly one PDF line with nothing printed right of it."""
    hit = None
    for lines, boxes in pages:
        for line in lines:
            if line["text"] != text:
                continue
            if hit is not None:
                return False              # ambiguous: two lines say the same thing
            hit = (line["bbox"], boxes)
    if hit is None:
        return False
    (x0, y0, x1, y1), boxes = hit
    for bx0, by0, bx1, by1 in boxes:
        if bx0 < x1 + SM_RIGHT_GAP_PT:
            continue
        if by1 > y0 + SM_BAND_PAD_PT and by0 < y1 - SM_BAND_PAD_PT:
            return False                  # a real column: something sits alongside
    return True


def _sm_style_jc(doc):
    """styleId -> the w:jc it ends up with, resolved through w:basedOn."""
    try:
        root = doc.styles.element
    except Exception:  # noqa: BLE001 - no styles part is just "inherit nothing"
        return {}
    own, based = {}, {}
    for style in root.findall(qn("w:style")):
        sid = style.get(qn("w:styleId"))
        if not sid:
            continue
        ppr = style.find(qn("w:pPr"))
        jc = None if ppr is None else ppr.find(qn("w:jc"))
        val = None if jc is None else jc.get(qn("w:val"))
        if val:
            own[sid] = val
        parent = style.find(qn("w:basedOn"))
        if parent is not None and parent.get(qn("w:val")):
            based[sid] = parent.get(qn("w:val"))
    out = {}
    for sid in set(own) | set(based):
        seen, cur, val = set(), sid, ""
        while cur and cur not in seen:
            seen.add(cur)
            if cur in own:
                val = own[cur]
                break
            cur = based.get(cur)
        out[sid] = val
    return out


def _sm_effective_jc(ppr, style_jc):
    """The alignment the paragraph actually renders with ("" when unset)."""
    jc = ppr.find(qn("w:jc"))
    if jc is not None and jc.get(qn("w:val")):
        return jc.get(qn("w:val"))
    style = ppr.find(qn("w:pStyle"))
    if style is None:
        return ""
    return style_jc.get(style.get(qn("w:val")) or "", "")


def _sm_drop_phantom_right(body, pages, style_jc):
    """(c) clear right indents no line in the PDF ever wrapped against."""
    changed = False
    for p in body:
        if p.tag != qn("w:p"):
            continue
        ppr = p.find(qn("w:pPr"))
        if ppr is None:
            continue
        if _sm_effective_jc(ppr, style_jc) in _SM_POSITIONAL_JC:
            continue      # the indent places the text; it is not a wrap boundary
        ind = ppr.find(qn("w:ind"))
        if ind is None:
            continue
        try:
            right = int(round(float(ind.get(qn("w:right")))))
        except (TypeError, ValueError):
            continue
        if right <= 0:
            continue
        text = _fs_norm("".join(t.text or "" for t in p.iter(qn("w:t"))))
        if not text or not _sm_unwrapped(pages, text):
            continue
        ind.set(qn("w:right"), "0")
        changed = True
    return changed


def stray_mark_cleanup(data, pdf_doc=None):
    """Remove the section break, heading line break and right indent pdf2docx
    invents from the PDF's geometry rather than from the page's own structure."""
    doc = Document(io.BytesIO(data))
    body = doc.element.body
    changed = _sm_drop_inert_sections(body)
    for p in body.iter(qn("w:p")):
        changed = _sm_strip_heading_tail(p) or changed
    if pdf_doc is not None:
        pages = _sm_pages(pdf_doc)
        if pages:
            changed = _sm_drop_phantom_right(body, pages, _sm_style_jc(doc)) or changed
    if not changed:
        return data
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# --------------------------------------------------------------- illegible shading
# pdf2docx builds a cell's background by sampling the page under the text.  On a
# heading band it sometimes samples the glyphs instead of the band, and writes the
# TEXT colour out as w:shd/@w:fill -- black text on a black bar, four of five
# section headings invisible.  The text colour is the half that survived; the fill
# is the misread half, so drop the fill and keep the text.
CS_MIN_CONTRAST = 2.0          # WCAG ratio under which the text cannot be read at all
_CS_FLAT_SHD = ("clear", "solid")


def _cs_rgb(value):
    """'RRGGBB' -> (r, g, b) in 0..1, or None when it is not a real colour."""
    if not value:
        return None
    v = value.strip().lstrip("#")
    if len(v) != 6:
        return None                      # 'auto' and anything malformed
    try:
        return tuple(int(v[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return None


def _cs_luminance(rgb):
    def chan(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _cs_contrast(a, b):
    la, lb = _cs_luminance(a), _cs_luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _cs_fill(pr):
    """(w:shd element, fill rgb) for a flat solid fill, else (None, None)."""
    if pr is None:
        return None, None
    shd = pr.find(qn("w:shd"))
    if shd is None:
        return None, None
    if (shd.get(qn("w:val")) or "clear") not in _CS_FLAT_SHD:
        return None, None                # a hatch pattern is not one flat colour
    rgb = _cs_rgb(shd.get(qn("w:fill")))
    return (shd, rgb) if rgb else (None, None)


def _cs_runs(el):
    """The text-bearing runs this shading actually sits behind."""
    paras = el.findall(qn("w:p")) if el.tag == qn("w:tc") else (el,)
    out = []
    for para in paras:
        for r in para.iter(qn("w:r")):
            if any((t.text or "") for t in r.findall(qn("w:t"))):
                out.append(r)
    return out


def _cs_illegible(el, fill):
    """True only when EVERY run under the fill has an explicit, unreadable colour."""
    runs = _cs_runs(el)
    if not runs:
        return False                     # an empty shaded cell is a drawn band
    for r in runs:
        rpr = r.find(qn("w:rPr"))
        col = None if rpr is None else rpr.find(qn("w:color"))
        rgb = None if col is None else _cs_rgb(col.get(qn("w:val")))
        if rgb is None:
            return False                 # inherited colour: never guess
        if _cs_contrast(rgb, fill) >= CS_MIN_CONTRAST:
            return False                 # legible: the fill is deliberate
    return True


def illegible_shading_drop(data, pdf_doc=None):
    """Drop a cell/paragraph shading fill that its own text cannot be read against."""
    doc = Document(io.BytesIO(data))
    changed = False
    for el in doc.element.body.iter(qn("w:tc"), qn("w:p")):
        pr = el.find(qn("w:tcPr")) if el.tag == qn("w:tc") else el.find(qn("w:pPr"))
        shd, fill = _cs_fill(pr)
        if shd is None or not _cs_illegible(el, fill):
            continue
        pr.remove(shd)
        changed = True
    if not changed:
        return data
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# --- font_metric_twin -------------------------------------------------------
# A document authored in LibreOffice names its faces Carlito, Caladea or
# Liberation Sans/Serif/Mono, and the PDF carries those names through. They are
# the free clones of Microsoft's Calibri, Cambria, Arial, Times New Roman and
# Courier New: same glyph widths, same line metrics, different name. font_names
# copies the PDF's family onto the run, so the converted .docx asks Word for a
# font a Windows recruiter does not have; Word substitutes an arbitrary
# installed face (usually a serif) and the whole page reflows.
#
# The fix is a rename, not a guess: each pair below is metric-compatible by
# design, so naming the Microsoft twin changes nothing about how the document
# lays out on a machine that HAS the clone, and fixes it everywhere else. The
# rename covers every font-naming attribute in the package - run and style
# rFonts, the theme's typeface attributes, and the fontTable declarations - so
# no part of the document is left pointing at the clone. Theme references
# (asciiTheme and friends) name no family and are untouched.
_FMT_TWINS = {
    "carlito": "Calibri",
    "caladea": "Cambria",
    "liberationsans": "Arial",
    "liberationserif": "Times New Roman",
    "liberationmono": "Courier New",
}
_FMT_RFONT_ATTRS = ("ascii", "hAnsi", "cs", "eastAsia")
_FMT_PARTS_RE = re.compile(
    r"^word/(document|styles|stylesWithEffects|numbering|footnotes|endnotes|"
    r"settings|fontTable|header\d*|footer\d*|theme/theme\d*)\.xml$")
_FMT_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_FMT_MARKERS = (b"carlito", b"caladea", b"liberation")


def _fmt_key(name):
    """Whitespace- and punctuation-free identity of a font family name."""
    return re.sub(r"[^0-9a-z]+", "", (name or "").lower())


def _fmt_twin(name):
    """The Microsoft twin of a metric-compatible free face, else None."""
    twin = _FMT_TWINS.get(_fmt_key(name))
    return twin if twin and twin != (name or "").strip() else None


def _fmt_rewrite_tree(root):
    """Rename clone faces in one parsed part. True when anything changed."""
    changed = False
    for el in root.iter(qn("w:rFonts")):
        for attr in _FMT_RFONT_ATTRS:
            twin = _fmt_twin(el.get(qn("w:" + attr)))
            if twin:
                el.set(qn("w:" + attr), twin)
                changed = True
    for el in root.iter("{%s}latin" % _FMT_A_NS, "{%s}ea" % _FMT_A_NS,
                        "{%s}cs" % _FMT_A_NS, "{%s}font" % _FMT_A_NS):
        twin = _fmt_twin(el.get("typeface"))
        if twin:
            el.set("typeface", twin)
            changed = True
    # fontTable: rename the declaration, then drop it if the twin is declared
    # twice (Word reads the first and a duplicate name is invalid).
    seen = set()
    for el in list(root.iter(qn("w:font"))):
        name = el.get(qn("w:name"))
        twin = _fmt_twin(name)
        if twin:
            el.set(qn("w:name"), twin)
            name, changed = twin, True
        key = _fmt_key(name)
        if not key:
            continue
        if key in seen:
            el.getparent().remove(el)
            changed = True
        else:
            seen.add(key)
    return changed


def font_metric_twin(data, pdf_doc=None):
    """Point every clone font name at its metric-compatible Microsoft twin."""
    src = zipfile.ZipFile(io.BytesIO(data))
    parts = {}
    for info in src.infolist():
        if not _FMT_PARTS_RE.match(info.filename):
            continue
        blob = src.read(info.filename)
        low = blob.lower()
        if not any(marker in low for marker in _FMT_MARKERS):
            continue
        try:
            root = etree.fromstring(blob)
        except Exception:  # noqa: BLE001 - an unparsable part is left alone
            continue
        if _fmt_rewrite_tree(root):
            parts[info.filename] = etree.tostring(
                root, xml_declaration=True, encoding="UTF-8", standalone=True)
    if not parts:
        return data
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            dst.writestr(info, parts.get(info.filename)
                         or src.read(info.filename))
    return out.getvalue()


PASSES = (hyperlink_unnest, phantom_column_flatten, span_space_repair, line_space_realign, br_row_split, label_row_split,
          header_footer_parts,
          date_column_untable, fused_line_split, tabbed_subline_split,
          centred_indent_drop, heading_styles,
          bullet_image_lists, list_numbering, paragraph_reflow, list_wrap_merge,
          list_hanging_indent, hyperlink_autolink, font_names, font_metric_twin,
          section_rules, empty_para_prune, section_rule_dedupe,
          section_break_tidy, wrap_tab_unfold, tab_stop_normalize,
          char_scale_normalize, stray_mark_cleanup,
          illegible_shading_drop)


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
