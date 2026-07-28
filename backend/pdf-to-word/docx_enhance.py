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
        if c.tag != qn("w:r"):
            break
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
    if len(found) > HEAD_MAX_ABS or (nonempty and len(found) / nonempty > HEAD_MAX_SHARE):
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


PASSES = (heading_styles,)


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
