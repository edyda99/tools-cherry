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


def _add_num(numbering, kind, bullet_chars=None):
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
                    f'<w:lvlText w:val="{txt}"/><w:lvlJc w:val="left"/></w:lvl>')
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


PASSES = (header_footer_parts, heading_styles, list_numbering)


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
