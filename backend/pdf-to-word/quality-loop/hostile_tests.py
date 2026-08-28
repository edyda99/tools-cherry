"""Hostile-input regression suite for docx_enhance passes.

Every case here either predates a pass (design guards) or reproduces a defect
found by the adversarial review of iteration 2 (link/image destruction, stream
misalignment, nested-ordered renumbering, OOXML sequence breaks). Run on every
loop iteration: venv/bin/python hostile_tests.py  — exit 0 only when all pass.
"""
import io
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt

import docx_enhance as de

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("FAIL:", msg)


def run_pass(doc):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.list_numbering(buf.getvalue())
    return Document(io.BytesIO(out)), out


def has_numpr(p):
    ppr = p._p.find(qn("w:pPr"))
    return ppr is not None and ppr.find(qn("w:numPr")) is not None


def ilvl_of(p):
    el = p._p.find(qn("w:pPr")).find(qn("w:numPr")).find(qn("w:ilvl"))
    return int(el.get(qn("w:val")))


def numid_of(p):
    el = p._p.find(qn("w:pPr")).find(qn("w:numPr")).find(qn("w:numId"))
    return int(el.get(qn("w:val")))


def count_tag(docx_bytes, tag):
    import zipfile
    xml = zipfile.ZipFile(io.BytesIO(docx_bytes)).read("word/document.xml").decode()
    return xml.count("<" + tag)


def full_text(doc):
    """Every w:t in the body, including inside hyperlinks."""
    return "".join(t.text or "" for p in doc.paragraphs for t in p._p.iter(qn("w:t")))


# --- A: prose that must never convert, lists that must -----------------------
d = Document()
cases = ["3.14 is the ratio of circumference to diameter",
         "- a lone dash aside, prose not list",
         "2. starts at two so numbering must not touch it",
         "2026. was a fine year for the project",
         "1. one", "2. two", "3. three",
         "• bullet keeps its inline • dot",
         "10) parenthesised but starting at ten"]
for c in cases:
    d.add_paragraph(c)
r, _ = run_pass(d)
p = r.paragraphs
check(p[0].text == cases[0] and not has_numpr(p[0]), "A: 3.14 corrupted")
check(p[1].text == cases[1] and not has_numpr(p[1]), "A: lone dash converted")
check(p[2].text == cases[2] and not has_numpr(p[2]), "A: starts-at-two converted")
check(p[3].text == cases[3] and not has_numpr(p[3]), "A: year corrupted")
check(p[4].text == "one" and has_numpr(p[4]), "A: 1..3 not converted")
check(p[6].text == "three" and has_numpr(p[6]), "A: third item wrong")
check(p[7].text == "bullet keeps its inline • dot" and has_numpr(p[7]), "A: inline dot wrong")
check(p[8].text == cases[8] and not has_numpr(p[8]), "A: starts-at-ten converted")

d = Document()
for c in ["- first dash item", "- second dash item", "regular prose after"]:
    d.add_paragraph(c)
r, _ = run_pass(d)
check(r.paragraphs[0].text == "first dash item" and has_numpr(r.paragraphs[0]),
      "A: dash pair not converted")
check(not has_numpr(r.paragraphs[2]), "A: prose after converted")

# --- B: pdf2docx-shaped hyperlink (w:hyperlink nested INSIDE a w:r) ----------
d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve">• Start with the </w:t></w:r>'))
para._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:rPr/><w:hyperlink {nsdecls("w")} w:anchor="x">'
    f'<w:r><w:t>tools-berry homepage</w:t></w:r></w:hyperlink></w:r>'))
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve"> for context.</w:t></w:r>'))
d.add_paragraph("• second item so the block is unambiguous")
r, out = run_pass(d)
check(count_tag(out, "w:hyperlink") == 1, "B: nested hyperlink deleted")
check("tools-berry homepage" in full_text(r), "B: link text deleted")
check(has_numpr(r.paragraphs[0]), "B: numPr missing")
check(full_text(r).startswith("Start with the "), "B: marker not stripped cleanly")

# --- C: standards-shaped hyperlink carrying the marker => skip entirely ------
d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(f'<w:hyperlink {nsdecls("w")} w:anchor="x">'
                         f'<w:r><w:t>1. Annual Report</w:t></w:r></w:hyperlink>'))
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve"> (PDF, 2 MB)</w:t></w:r>'))
para2 = d.add_paragraph()
para2._p.append(parse_xml(f'<w:hyperlink {nsdecls("w")} w:anchor="y">'
                          f'<w:r><w:t>2. Board Minutes</w:t></w:r></w:hyperlink>'))
r, out = run_pass(d)
check(full_text(r) == "1. Annual Report (PDF, 2 MB)2. Board Minutes",
      "C: hyperlink-marker paragraph text corrupted: %r" % full_text(r))
check(not has_numpr(r.paragraphs[0]) and not has_numpr(r.paragraphs[1]),
      "C: hyperlink-marker paragraph got numPr")

# --- D: paragraph that is entirely one hyperlink => untouched ----------------
d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(f'<w:hyperlink {nsdecls("w")} w:anchor="x">'
                         f'<w:r><w:t>• Entirely linked item</w:t></w:r></w:hyperlink>'))
r, out = run_pass(d)
check(not has_numpr(r.paragraphs[0]) and "• Entirely linked item" in full_text(r),
      "D: whole-hyperlink paragraph modified")

# --- E/F/G: images and references survive ------------------------------------
d = Document()
para = d.add_paragraph("• chart below ")
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:drawing/></w:r>'))
d.add_paragraph("• second")
r, out = run_pass(d)
check(count_tag(out, "w:drawing") == 1, "E: drawing-only run deleted")
check(has_numpr(r.paragraphs[0]) and r.paragraphs[0].text == "chart below ",
      "E: marker strip wrong around image")

d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve">• </w:t><w:drawing/></w:r>'))
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve">caption text</w:t></w:r>'))
d.add_paragraph("• second")
r, out = run_pass(d)
check(count_tag(out, "w:drawing") == 1, "F: drawing sharing marker run deleted")
check("caption text" in full_text(r), "F: caption lost")

d = Document()
para = d.add_paragraph("• see note")
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:footnoteReference w:id="2"/></w:r>'))
d.add_paragraph("• second")
r, out = run_pass(d)
check(count_tag(out, "w:footnoteReference") == 1, "G: footnoteReference run deleted")

# --- H: ordered nested under a bullet must still render decimal --------------
d = Document()
d.add_paragraph("• Before you begin")
for t in ["1. Install the vendor driver", "2. Reboot the machine", "3. Run the self-test"]:
    pp = d.add_paragraph(t)
    pp.paragraph_format.left_indent = Pt(42)
r, out = run_pass(d)
steps = r.paragraphs[1:4]
check(all(has_numpr(s) for s in steps), "H: nested ordered not converted")
lvls = {ilvl_of(s) for s in steps}
check(len(lvls) == 1, "H: ordered stretch split across levels")
import zipfile
numxml = zipfile.ZipFile(io.BytesIO(out)).read("word/numbering.xml").decode()
check('w:val="lowerLetter"' not in numxml and 'w:val="lowerRoman"' not in numxml,
      "H: ordered levels not all decimal")

# --- I: indent jitter inside a flat ordered list => one level ----------------
d = Document()
for i, t in enumerate(["1. first", "2. second", "3. third"]):
    pp = d.add_paragraph(t)
    pp.paragraph_format.left_indent = Pt(20 if i == 1 else 0)
r, out = run_pass(d)
check(len({ilvl_of(pp) for pp in r.paragraphs}) == 1, "I: jitter split the sequence")

# --- J: numPr must land after keepNext/pageBreakBefore/widowControl ----------
d = Document()
pp = d.add_paragraph("• formatted item")
pp.paragraph_format.keep_with_next = True
pp.paragraph_format.page_break_before = True
pp.paragraph_format.widow_control = True
d.add_paragraph("• second")
r, out = run_pass(d)
ppr = r.paragraphs[0]._p.find(qn("w:pPr"))
tags = [c.tag.split("}")[1] for c in ppr]
check("numPr" in tags and tags.index("numPr") > tags.index("keepNext"),
      "J: numPr precedes keepNext in pPr sequence: %s" % tags)

# --- K: w:num insertion respects numIdMacAtCleanup ---------------------------
d = Document()
d.add_paragraph("• one")
d.add_paragraph("• two")
numbering = de._numbering_root(d)
numbering.append(parse_xml(f'<w:numIdMacAtCleanup {nsdecls("w")} w:val="9"/>'))
r, out = run_pass(d)
numxml = zipfile.ZipFile(io.BytesIO(out)).read("word/numbering.xml").decode()
check(numxml.rstrip().endswith("numIdMacAtCleanup w:val=\"9\"/></w:numbering>")
      or numxml.find("<w:num ", numxml.find("numIdMacAtCleanup")) == -1,
      "K: w:num appended after numIdMacAtCleanup")

# --- L: w:ind @w:start honoured for levels -----------------------------------
d = Document()
for t, tw in [("• top", 0), ("◦ nested", 720)]:
    pp = d.add_paragraph(t)
    ppr = pp._p.get_or_add_pPr()
    ppr.append(parse_xml(f'<w:ind {nsdecls("w")} w:start="{tw}"/>'))
r, out = run_pass(d)
check(ilvl_of(r.paragraphs[0]) == 0 and ilvl_of(r.paragraphs[1]) == 1,
      "L: @w:start indents not levelled")

# --- M: noBreakHyphen survives a strip in the same run -----------------------
d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:t>1.</w:t><w:tab/><w:t>state</w:t>'
    f'<w:noBreakHyphen/><w:t>of-the-art</w:t></w:r>'))
d.add_paragraph("2. two")
r, out = run_pass(d)
check(count_tag(out, "w:noBreakHyphen") == 1, "M: noBreakHyphen destroyed")
check(r.paragraphs[0].text == "state-of-the-art", "M: text wrong: %r" % r.paragraphs[0].text)

# --- N: marker-only paragraph stays untouched --------------------------------
d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve">• </w:t></w:r>'))
d.add_paragraph("• real item")
d.add_paragraph("• real item two")
r, out = run_pass(d)
check(not has_numpr(r.paragraphs[0]) and r.paragraphs[0].text == "• ",
      "N: marker-only paragraph converted")

# --- O: regression set the reviewers verified --------------------------------
d = Document()
tbl = d.add_table(rows=1, cols=2)
tbl.rows[0].cells[0].text = "• cell bullet"
tbl.rows[0].cells[1].text = "1. cell ordered"
before = io.BytesIO()
d.save(before)
out = de.list_numbering(before.getvalue())
check(out == before.getvalue(), "O: table-cell lists modified")

d = Document()
r, out = run_pass(d)  # empty document
check(len(r.paragraphs) <= 1, "O: empty doc changed shape")

d = Document()
for t in ["1. a", "2. b", "3. c"]:
    d.add_paragraph(t)
d.add_paragraph("prose between")
for t in ["1. x", "2. y", "3. z"]:
    d.add_paragraph(t)
r, out = run_pass(d)
check(numid_of(r.paragraphs[0]) != numid_of(r.paragraphs[4]),
      "O: two ordered lists share a numId (no restart)")

d = Document()
for i in range(1, 13):
    d.add_paragraph(f"{i}. item {i}")
r, out = run_pass(d)
check(all(has_numpr(pp) for pp in r.paragraphs), "O: 1..12 not fully converted")

d = Document()
for t, ind in [("• l0", 0), ("◦ l1", 36), ("▪ l2", 72), ("▪ l3", 108)]:
    pp = d.add_paragraph(t)
    pp.paragraph_format.left_indent = Pt(ind)
r, out = run_pass(d)
check([ilvl_of(pp) for pp in r.paragraphs] == [0, 1, 2, 2], "O: level cap wrong")

# --- P: hyperlink first, marker in a later direct run => skip ----------------
d = Document()
para = d.add_paragraph()
para._p.append(parse_xml(f'<w:hyperlink {nsdecls("w")} w:anchor="x">'
                         f'<w:r><w:t>See </w:t></w:r></w:hyperlink>'))
para._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t>2. something</w:t></w:r>'))
r, out = run_pass(d)
check(not has_numpr(r.paragraphs[0]) and full_text(r) == "See 2. something",
      "P: mid-paragraph marker after hyperlink converted")

# === header/footer pass ======================================================
import fitz


def make_pdf(pages):
    """pages: list of [(y, text) or (y, text, x), ...] on A4."""
    pdf = fitz.open()
    for lines in pages:
        pg = pdf.new_page(width=595, height=842)
        for entry in lines:
            y, t = entry[0], entry[1]
            x = entry[2] if len(entry) > 2 else 72
            pg.insert_text((x, y), t, fontsize=9)
    return pdf


def run_hf(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.header_footer_parts(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def hf_part_text(docx_bytes, which):
    z = zipfile.ZipFile(io.BytesIO(docx_bytes))
    texts = []
    for n in z.namelist():
        if n.startswith(f"word/{which}"):
            import xml.etree.ElementTree as ET
            root = ET.fromstring(z.read(n))
            texts.extend(t.text or "" for t in root.iter(
                "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
    return "".join(texts)


# HF1: repeated band furniture moves into real parts
pdf = make_pdf([[(30, "Acme Internal"), (400, "content one"), (820, "Confidential")],
                [(30, "Acme Internal"), (400, "content two"), (820, "Confidential")]])
d = Document()
for t in ["Acme Internal", "content one", "Confidential",
          "Acme Internal", "content two", "Confidential"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
body = [p.text for p in r.paragraphs if p.text.strip()]
check(body == ["content one", "content two"], "HF1: body not cleaned: %s" % body)
check("Acme Internal" in hf_part_text(out, "header"), "HF1: header part missing text")
check("Confidential" in hf_part_text(out, "footer"), "HF1: footer part missing text")

# HF2: varying page numbers stay (no exact repeat)
pdf = make_pdf([[(400, "content one"), (820, "1")], [(400, "content two"), (820, "2")]])
d = Document()
for t in ["content one", "1", "content two", "2"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check([p.text for p in r.paragraphs] == ["content one", "1", "content two", "2"],
      "HF2: varying page numbers touched")

# HF3: repeated text mid-page is content, not furniture
pdf = make_pdf([[(400, "Same refrain"), (500, "other a")], [(400, "Same refrain"), (500, "other b")]])
d = Document()
for t in ["Same refrain", "other a", "Same refrain", "other b"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Same refrain") == 2,
      "HF3: mid-page repeat treated as furniture")

# HF4: single page never converts
pdf = make_pdf([[(30, "Lone header"), (400, "content")]])
d = Document()
for t in ["Lone header", "content"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check([p.text for p in r.paragraphs] == ["Lone header", "content"], "HF4: 1-page doc touched")

# HF5: more body matches than pages => ambiguous, skip
pdf = make_pdf([[(30, "Motto"), (400, "a")], [(30, "Motto"), (400, "b")]])
d = Document()
for t in ["Motto", "a", "Motto", "b", "Motto", "Motto"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Motto") == 4, "HF5: over-matched text removed")

# HF6: a match carrying a section break is never removed
pdf = make_pdf([[(30, "Banner"), (400, "a")], [(30, "Banner"), (400, "b")]])
d = Document()
d.add_paragraph("Banner")
d.add_paragraph("a")
p2 = d.add_paragraph("Banner")
p2._p.get_or_add_pPr().append(parse_xml(f"<w:sectPr {nsdecls('w')}/>"))
d.add_paragraph("b")
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Banner") == 2, "HF6: sectPr paragraph removed")

# HF7: furniture must cover EVERY page — 2 of 3 declines, 3 of 3 converts
pdf = make_pdf([[(400, "x"), (820, "Draft")], [(400, "y"), (820, "Draft")], [(400, "z")]])
d = Document()
for t in ["x", "Draft", "y", "Draft", "z"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Draft") == 2 and
      "Draft" not in hf_part_text(out, "footer"), "HF7a: partial-coverage footer converted")
pdf = make_pdf([[(400, "x"), (820, "Draft")], [(400, "y"), (820, "Draft")], [(400, "z"), (820, "Draft")]])
d = Document()
for t in ["x", "Draft", "y", "Draft", "z", "Draft"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check("Draft" in hf_part_text(out, "footer") and
      all(p.text != "Draft" for p in r.paragraphs), "HF7b: full-coverage footer not converted")

# HF8: cover-title collision — header on pages 2-6 only, title on page 1 => decline
pdf = make_pdf([[(300, "Quarterly Report")]] +
               [[(30, "Quarterly Report"), (400, f"body {i}")] for i in range(5)])
d = Document()
d.add_paragraph("Quarterly Report")
for i in range(5):
    d.add_paragraph("Quarterly Report")
    d.add_paragraph(f"body {i}")
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Quarterly Report") == 6,
      "HF8: cover title deleted with running headers")

# HF9: under-match (one occurrence merged/missing) => decline, no half-removal
pdf = make_pdf([[(30, "ACME Holdings"), (400, "a")], [(30, "ACME Holdings"), (400, "b")],
                [(30, "ACME Holdings"), (400, "c")]])
d = Document()
for t in ["ACME Holdings", "a", "ACME Holdings", "b", "ACME Holdings and page text", "c"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if "ACME Holdings" in p.text) == 3,
      "HF9: half-removal on merged occurrence")
check("ACME" not in hf_part_text(out, "header"), "HF9: header installed despite mismatch")

# HF10: text also inside a table cell => decline
pdf = make_pdf([[(30, "Classified"), (400, "a")], [(30, "Classified"), (400, "b")]])
d = Document()
d.add_paragraph("Classified")
d.add_paragraph("a")
tbl = d.add_table(rows=1, cols=1)
tbl.rows[0].cells[0].text = "Classified"
d.add_paragraph("Classified")
d.add_paragraph("b")
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Classified") == 2,
      "HF10: cell-shadowed furniture removed")

# HF11: same text qualifying in both bands => decline
pdf = make_pdf([[(30, "Everywhere"), (820, "Everywhere"), (400, "a")],
                [(30, "Everywhere"), (820, "Everywhere"), (400, "b")]])
d = Document()
for t in ["Everywhere", "a", "Everywhere", "Everywhere", "b", "Everywhere"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Everywhere") == 4,
      "HF11: both-band text swept")

# HF12: bookmark/footnote-bearing furniture => decline (range pairs stay whole)
pdf = make_pdf([[(30, "Marked"), (400, "a")], [(30, "Marked"), (400, "b")]])
d = Document()
pm = d.add_paragraph("Marked")
pm._p.insert(0, parse_xml(f'<w:bookmarkStart {nsdecls("w")} w:id="7" w:name="top"/>'))
d.add_paragraph("a")
d.add_paragraph("Marked")
d.add_paragraph("b")
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Marked") == 2, "HF12: bookmark furniture moved")

pdf = make_pdf([[(30, "Noted"), (400, "a")], [(30, "Noted"), (400, "b")]])
d = Document()
pn = d.add_paragraph("Noted")
pn._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:footnoteReference w:id="2"/></w:r>'))
d.add_paragraph("a")
d.add_paragraph("Noted")
d.add_paragraph("b")
r, out = run_hf(d, pdf)
check("Noted" not in hf_part_text(out, "header"), "HF12b: footnote ref moved into header")

# HF13: existing header part => decline entirely; and the pass is idempotent
pdf = make_pdf([[(30, "Fresh"), (400, "a")], [(30, "Fresh"), (400, "b")]])
d = Document()
sec = d.sections[0]
sec.header.is_linked_to_previous = False
sec.header.paragraphs[0].text = "COMPANY LETTERHEAD - keep me"
for t in ["Fresh", "a", "Fresh", "b"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Fresh") == 2 and
      "keep me" in hf_part_text(out, "header"), "HF13: existing header not respected")

d = Document()
for t in ["Fresh", "a", "Fresh", "b"]:
    d.add_paragraph(t)
buf = io.BytesIO()
d.save(buf)
once = de.header_footer_parts(buf.getvalue(), pdf)
twice = de.header_footer_parts(once, pdf)
check(once == twice, "HF13b: pass not idempotent")

# HF14: titlePg set => decline (default header would skip page 1)
pdf = make_pdf([[(30, "Banner"), (400, "a")], [(30, "Banner"), (400, "b")]])
d = Document()
d.sections[0]._sectPr.append(parse_xml(f'<w:titlePg {nsdecls("w")}/>'))
for t in ["Banner", "a", "Banner", "b"]:
    d.add_paragraph(t)
r, out = run_hf(d, pdf)
check(sum(1 for p in r.paragraphs if p.text == "Banner") == 2, "HF14: titlePg doc converted")

# HF15: restarting ordered lists made adjacent still convert, separately
d = Document()
for t in ["1. alpha", "2. beta", "3. gamma", "1. delta", "2. epsilon", "3. zeta"]:
    d.add_paragraph(t)
r, out = run_pass(d)
check(all(has_numpr(pp) for pp in r.paragraphs), "HF15: adjacent restarting lists dropped")
check(numid_of(r.paragraphs[0]) != numid_of(r.paragraphs[3]),
      "HF15: restart shares a numId (would renumber 4,5,6)")

# HF16: small outline docs keep their headings (share-bail exemption)
d = Document()
for t in ["First Heading", "Second Heading", "Third Heading",
          "a single body paragraph long enough that the body size vote lands on "
          "eleven points, the way a real short outline document reads"]:
    pp = d.add_paragraph()
    run = pp.add_run(t)
    run.bold = "Heading" in t
    run.font.size = Pt(16 if "Heading" in t else 11)
buf = io.BytesIO()
d.save(buf)
res = Document(io.BytesIO(de.heading_styles(buf.getvalue())))
styled = [p.text for p in res.paragraphs if (p.style.name or "").startswith("Heading")]
check(len(styled) == 3, "HF16: small-doc headings bailed: %s" % styled)


# --- bold ALL-CAPS section headings (D2) -------------------------------------

BODY_FILLER = ("a body paragraph long enough that the character-weighted body "
               "size vote lands on nine and a half points, the way a real "
               "resume section reads under its own heading")


def caps_doc(lines, body_pt=9.5):
    """lines: (text, size_pt, bold). Returns the styled paragraphs by text."""
    d = Document()
    for text, size, bold in lines:
        pp = d.add_paragraph()
        run = pp.add_run(text)
        run.bold = bold
        run.font.size = Pt(size)
    buf = io.BytesIO()
    d.save(buf)
    res = Document(io.BytesIO(de.heading_styles(buf.getvalue())))
    return {p.text: (p.style.name or "") for p in res.paragraphs}, res


# HF17: caps headings only 1.1x the body still get Heading 2, under a big title
styles, _ = caps_doc([
    ("Maroun Daher", 19.0, True),
    ("SUMMARY", 10.5, True),
    (BODY_FILLER, 9.5, False),
    ("EDUCATION", 10.5, True),
    (BODY_FILLER, 9.5, False),
    ("TECHNICAL SKILLS", 10.5, True),
    (BODY_FILLER, 9.5, False),
])
check(styles["Maroun Daher"] == "Heading 1", "HF17: title lost Heading 1: %s" % styles)
for t in ("SUMMARY", "EDUCATION", "TECHNICAL SKILLS"):
    check(styles[t] == "Heading 2", "HF17: %s not Heading 2: %s" % (t, styles[t]))
check(styles[BODY_FILLER] == "Normal", "HF17: body styled as %s" % styles[BODY_FILLER])

# HF18: caps text that reads as a sentence or a label is left alone
styles, _ = caps_doc([
    ("REPORT", 10.5, True),
    ("WARNING: DO NOT OPEN THE VALVE.", 10.5, True),
    ("PLEASE NOTE:", 10.5, True),
    (BODY_FILLER, 9.5, False),
    (BODY_FILLER + " second", 9.5, False),
])
check(styles["REPORT"].startswith("Heading"), "HF18: plain caps heading missed")
check(styles["WARNING: DO NOT OPEN THE VALVE."] == "Normal",
      "HF18: caps sentence styled as %s" % styles["WARNING: DO NOT OPEN THE VALVE."])
check(styles["PLEASE NOTE:"] == "Normal", "HF18: caps label styled")

# HF19: caps alone is not enough - the line must be bold and body-sized or bigger
styles, _ = caps_doc([
    ("SUMMARY", 10.5, False),          # caps, not bold
    ("Technical Skills", 10.5, True),  # bold, not caps
    ("FOOTNOTE", 8.0, True),           # bold caps, smaller than the body
    (BODY_FILLER, 9.5, False),
    (BODY_FILLER + " second", 9.5, False),
])
for t in ("SUMMARY", "Technical Skills", "FOOTNOTE"):
    check(styles[t] == "Normal", "HF19: %s styled as %s" % (t, styles[t]))

# HF20: a long caps run is prose set in capitals, not a heading
shout = ("WE HEREBY CERTIFY THAT EVERY CLAUSE OF THIS AGREEMENT HAS BEEN READ "
         "AND ACCEPTED BY BOTH PARTIES IN FULL")
check(len(shout) > 90, "HF20: fixture is not longer than the 90-char cap")
styles, _ = caps_doc([
    ("AGREEMENT", 10.5, True),
    (shout, 10.5, True),
    (BODY_FILLER, 9.5, False),
    (BODY_FILLER + " second", 9.5, False),
])
check(styles["AGREEMENT"].startswith("Heading"), "HF20: short caps heading missed")
check(styles[shout] == "Normal", "HF20: caps prose styled as %s" % styles[shout])

# HF21: a caps line that is not one clean text-only line is declined, and the
# pass is idempotent on the shape it does accept
d = Document()
pp = d.add_paragraph()
r1 = pp.add_run("CONTACT")
r1.bold = True
r1.font.size = Pt(10.5)
r1._r.append(parse_xml('<w:br %s/>' % nsdecls("w")))
r2 = pp.add_run(" DETAILS")
r2.bold = True
r2.font.size = Pt(10.5)
for text in ("SUMMARY", BODY_FILLER, BODY_FILLER + " second"):
    pp = d.add_paragraph()
    run = pp.add_run(text)
    run.bold = text == "SUMMARY"
    run.font.size = Pt(10.5 if text == "SUMMARY" else 9.5)
buf = io.BytesIO()
d.save(buf)
once = de.heading_styles(buf.getvalue())
res = Document(io.BytesIO(once))
styles = {p.text: (p.style.name or "") for p in res.paragraphs}
broken = "CONTACT\n DETAILS"
check(styles.get(broken) == "Normal",
      "HF21: line-broken caps paragraph styled as %s" % styles.get(broken))
check(styles.get("SUMMARY", "").startswith("Heading"), "HF21: clean caps heading missed")
check(de.heading_styles(once) == once, "HF21: caps heading pass not idempotent")

# === paragraph reflow pass ============================================
def run_reflow(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.paragraph_reflow(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


# R1: fragments of one PDF block merge (lines 12pt apart share a block)
pdf = make_pdf([[(100, "the quick brown fox jumps across the sleeping meadow and"),
                 (112, "over the lazy dog.")]])
d = Document()
d.add_paragraph("the quick brown fox jumps across the sleeping meadow and")
d.add_paragraph("over the lazy dog.")
r, out = run_reflow(d, pdf)
texts = [p.text for p in r.paragraphs if p.text.strip()]
check(texts == ["the quick brown fox jumps across the sleeping meadow and over the lazy dog."],
      "R1: same-block fragments not merged: %s" % texts)

# R2: separate PDF blocks stay separate paragraphs
pdf = make_pdf([[(100, "the quick brown fox jumps"), (400, "over the lazy dog.")]])
d = Document()
d.add_paragraph("the quick brown fox jumps")
d.add_paragraph("over the lazy dog.")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R2: separate blocks merged")

# R3: styled / numbered / section-break paragraphs never merge
pdf = make_pdf([[(100, "alpha beta gamma"), (112, "delta epsilon.")]])
d = Document()
d.add_paragraph("alpha beta gamma")
pb = d.add_paragraph("delta epsilon.")
pb._p.get_or_add_pPr().append(parse_xml(f"<w:sectPr {nsdecls('w')}/>"))
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R3: sectPr paragraph merged")

# R4: typographic (U+2010) line-break hyphens heal; ASCII ones never do
pdf = fitz.open()
pg = pdf.new_page(width=595, height=842)
pg.insert_font(fontname="hv", fontfile="/System/Library/Fonts/Helvetica.ttc")
pg.insert_text((72, 100), "the grand equip‐", fontsize=9, fontname="hv")
pg.insert_text((72, 112), "ment failed early on the very first day of trials.",
               fontsize=9, fontname="hv")
d = Document()
d.add_paragraph("the grand equip‐ment failed early on the very first day of trials.")
r, out = run_reflow(d, pdf)
check(r.paragraphs[0].text == "the grand equipment failed early on the very first day of trials.",
      "R4: typographic hyphen not healed: %r" % r.paragraphs[0].text)
pdf = make_pdf([[(100, "the grand equip-"), (112, "ment failed early."),
                 (400, "equipment budgets grew.")]])
d = Document()
d.add_paragraph("the grand equip-ment failed early.")
d.add_paragraph("equipment budgets grew.")
r, out = run_reflow(d, pdf)
check("equip-ment" in r.paragraphs[0].text, "R4b: ASCII hyphen fused")

# R11: a compound word broken on its own hyphen at a line end stays hyphenated
pdf = make_pdf([[(100, "that fact is well-"), (112, "known to every reader.")]])
d = Document()
d.add_paragraph("that fact is well-known to every reader.")
r, out = run_reflow(d, pdf)
check(r.paragraphs[0].text == "that fact is well-known to every reader.",
      "R11: compound hyphen fused: %r" % r.paragraphs[0].text)

# R5: a real hyphen with no line-break evidence stays
pdf = make_pdf([[(100, "a well- known fact stands.")]])
d = Document()
d.add_paragraph("a well- known fact stands.")
r, out = run_reflow(d, pdf)
check(r.paragraphs[0].text == "a well- known fact stands.", "R5: legit hyphen removed")

# R6: a table between paragraphs breaks adjacency
pdf = make_pdf([[(100, "alpha beta gamma"), (112, "delta epsilon.")]])
d = Document()
d.add_paragraph("alpha beta gamma")
d.add_table(rows=1, cols=1).rows[0].cells[0].text = "cell"
d.add_paragraph("delta epsilon.")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R6: merged across a table")

# R7: idempotent on bytes
pdf = make_pdf([[(100, "the quick brown fox jumps"), (112, "over the lazy dog.")]])
d = Document()
d.add_paragraph("the quick brown fox jumps")
d.add_paragraph("over the lazy dog.")
buf = io.BytesIO()
d.save(buf)
once = de.paragraph_reflow(buf.getvalue(), pdf)
twice = de.paragraph_reflow(once, pdf)
check(once == twice, "R7: reflow not idempotent")

# R8: no joining across page breaks (glued page-boundary text corrupted docs)
pdf = make_pdf([[(800, "the meeting ran long and")], [(50, "nobody minded at all.")]])
d = Document()
d.add_paragraph("the meeting ran long and")
d.add_paragraph("nobody minded at all.")
r, out = run_reflow(d, pdf)
check(len([p.text for p in r.paragraphs if p.text.strip()]) == 2,
      "R8: merged across a page break")

# R21: a compound broken once at a line end never fuses, even with the fused
# word used elsewhere ("re-form" vs "reform" inverts meaning)
pdf = make_pdf([[(100, "the panel would have to re-"),
                 (112, "form before the review could restart in earnest."),
                 (300, "the reform of the charter is complete.")]])
d = Document()
d.add_paragraph("the panel would have to re-form before the review could restart in earnest.")
d.add_paragraph("the reform of the charter is complete.")
r, out = run_reflow(d, pdf)
check("re-form" in r.paragraphs[0].text, "R21: compound fused into its homograph")

# R22: lowercase unterminated paragraphs in separate blocks never weld
pdf = make_pdf([[(100, "max_retries the number of attempts made before the call fails and"),
                 (112, "an error is returned to the caller"),
                 (127, "timeout the number of seconds the client waits before closing"),
                 (139, "the socket entirely"),
                 (154, "verify_tls whether the certificate chain is validated at all")]])
d = Document()
d.add_paragraph("max_retries the number of attempts made before the call fails and an error is returned to the caller")
d.add_paragraph("timeout the number of seconds the client waits before closing the socket entirely")
d.add_paragraph("verify_tls whether the certificate chain is validated at all")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 3,
      "R22: config paragraphs welded: %d" % len([p for p in r.paragraphs if p.text.strip()]))

# R9: a paragraph that already equals a full PDF paragraph absorbs nothing
pdf = make_pdf([[(100, "first sentence stands alone"), (400, "second one also complete.")]])
d = Document()
d.add_paragraph("first sentence stands alone")
d.add_paragraph("second one also complete.")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R9: complete para absorbed next")

# R10: empty spacer between fragments rides along; a sectPr spacer blocks
pdf = make_pdf([[(100, "columns split this long sentence apart without any real warning"),
                 (112, "into two ragged pieces.")]])
d = Document()
d.add_paragraph("columns split this long sentence apart without any real warning")
d.add_paragraph("")
d.add_paragraph("into two ragged pieces.")
r, out = run_reflow(d, pdf)
check([p.text for p in r.paragraphs if p.text.strip()] ==
      ["columns split this long sentence apart without any real warning into two ragged pieces."],
      "R10: spacer merge missed")
d = Document()
d.add_paragraph("columns split this long sentence apart without any real warning")
ps = d.add_paragraph("")
ps._p.get_or_add_pPr().append(parse_xml(f"<w:sectPr {nsdecls('w')}/>"))
d.add_paragraph("into two ragged pieces.")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R10b: merged across sectPr spacer")

# R12: two sentences single-spaced in one block stay two paragraphs
pdf = make_pdf([[(100, "The first policy took effect in March."),
                 (112, "Employees must file the new form.")]])
d = Document()
d.add_paragraph("The first policy took effect in March.")
d.add_paragraph("Employees must file the new form.")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R12: sentence pair merged")

# R13: a lowercase word list is not a wrapped paragraph
pdf = make_pdf([[(100, "apples"), (114, "bananas"), (128, "cherries"), (142, "dates")]])
d = Document()
for t in ["apples", "bananas", "cherries", "dates"]:
    d.add_paragraph(t)
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 4, "R13: word list merged")

# R14: a non-Latin paragraph between Latin ones survives and blocks merging
pdf = make_pdf([[(100, "the reading room stays open"), (400, "until the last train leaves.")]])
d = Document()
d.add_paragraph("the reading room stays open")
d.add_paragraph("читальный зал открыт")
d.add_paragraph("until the last train leaves.")
r, out = run_reflow(d, pdf)
texts = [p.text for p in r.paragraphs if p.text.strip()]
check(len(texts) == 3 and "читальный зал открыт" in texts, "R14: non-Latin paragraph lost: %s" % texts)

# R15/R16: image-only and page-break paragraphs are content, never spacers
pdf = make_pdf([[(100, "the report continues past the small inline"),
                 (112, "figure and finishes on this line.")]])
d = Document()
d.add_paragraph("the report continues past the small inline")
pimg = d.add_paragraph()
pimg._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:drawing/></w:r>'))
d.add_paragraph("figure and finishes on this line.")
r, out = run_reflow(d, pdf)
check(count_tag(out, "w:drawing") == 1, "R15: image paragraph swept")
check(len([p for p in r.paragraphs]) == 3, "R15b: merged across image paragraph")
d = Document()
d.add_paragraph("the report continues past the small inline")
pbr = d.add_paragraph()
pbr._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:br w:type="page"/></w:r>'))
d.add_paragraph("figure and finishes on this line.")
r, out = run_reflow(d, pdf)
check('w:type="page"' in zipfile.ZipFile(io.BytesIO(out)).read("word/document.xml").decode(),
      "R16: page break swept")

# R17: a form the document also hyphenates mid-line is spelling, never fused
pdf = make_pdf([[(100, "contractors are asked to re-"),
                 (112, "sign the schedule every season and the"),
                 (124, "manager may also re-sign the cover page.")]])
d = Document()
d.add_paragraph("contractors are asked to re-sign the schedule every season and the "
                "manager may also re-sign the cover page.")
r, out = run_reflow(d, pdf)
check(r.paragraphs[0].text.count("re-sign") == 2,
      "R17: interior-evidenced hyphen fused: %r" % r.paragraphs[0].text)

# R18/R19: joiner space carries no underline and never doubles whitespace
pdf = make_pdf([[(100, "the final section of the annual report was written and"),
                 (112, "was revised again last week.")]])
d = Document()
pa = d.add_paragraph()
run = pa.add_run("the final section of the annual report was written and")
run.underline = True
d.add_paragraph("was revised again last week.")
r, out = run_reflow(d, pdf)
merged = r.paragraphs[0]
check(merged.text == "the final section of the annual report was written and was revised again last week.",
      "R18: merge text wrong: %r" % merged.text)
check(not any(run.text == " " and run.underline for run in merged.runs),
      "R18b: joiner space underlined")
d = Document()
d.add_paragraph("the final section of the annual report was written and ")
d.add_paragraph("was revised again last week.")
r, out = run_reflow(d, pdf)
check("and  was" not in r.paragraphs[0].text, "R19: doubled joiner space")

# R20: a first-line indent inside one block separates paragraphs
pdf = make_pdf([[(100, "the committee met for hours on the budget and"),
                 (112, "the debate ran long without a formal close"),
                 (124, "next quarter brought entirely new rules", 90)]])
d = Document()
d.add_paragraph("the committee met for hours on the budget and the debate ran long without a formal close")
d.add_paragraph("next quarter brought entirely new rules")
r, out = run_reflow(d, pdf)
check(len([p for p in r.paragraphs if p.text.strip()]) == 2, "R20: merged across indent")

# === span-boundary space repair =======================================
def run_space(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.span_space_repair(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


# S1: evidenced lost space at a run boundary is restored
pdf = make_pdf([[(100, "Start with the deployment checklist before touching anything.")]])
d = Document()
p = d.add_paragraph()
p.add_run("Start with the")
p.add_run("deployment checklist before touching anything.")
r, out = run_space(d, pdf)
check(r.paragraphs[0].text == "Start with the deployment checklist before touching anything.",
      "S1: lost space not restored: %r" % r.paragraphs[0].text)

# S2: a word split across styled runs is never broken apart
pdf = make_pdf([[(100, "an unbelievable outcome was reported by everyone involved.")]])
d = Document()
p = d.add_paragraph()
p.add_run("an un")
p.add_run("believable outcome was reported by everyone involved.")
r, out = run_space(d, pdf)
check("un believable" not in r.paragraphs[0].text, "S2: intra-word split spaced")

# S3: fused form that is also a real PDF word stays untouched
pdf = make_pdf([[(100, "a round of talks began, and around the corner more waited.")]])
d = Document()
p = d.add_paragraph()
p.add_run("a")
p.add_run("round of talks began, and around the corner more waited.")
r, out = run_space(d, pdf)
check(r.paragraphs[0].text.startswith("around of talks"), "S3: ambiguous fusion modified")

# S4: already-spaced seams and seams across breaks stay untouched
pdf = make_pdf([[(100, "plain text with the deployment checklist ready.")]])
d = Document()
p = d.add_paragraph()
p.add_run("plain text with the ")
p.add_run("deployment checklist ready.")
buf = io.BytesIO()
d.save(buf)
check(de.span_space_repair(buf.getvalue(), pdf) == buf.getvalue(), "S4: spaced seam modified")

# S5: the pdf2docx hyperlink-wrapper shape is repaired through the nesting
pdf = make_pdf([[(100, "Start with the deployment checklist before touching production.")]])
d = Document()
p = d.add_paragraph()
p.add_run("Start with the")
p._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:rPr/><w:hyperlink {nsdecls("w")} w:anchor="x">'
    f'<w:r><w:t>deployment checklist</w:t></w:r></w:hyperlink></w:r>'))
p._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:t xml:space="preserve"> before touching production.</w:t></w:r>'))
r, out = run_space(d, pdf)
check(count_tag(out, "w:hyperlink") == 1 and
      full_text(r) == "Start with the deployment checklist before touching production.",
      "S5: hyperlink seam not repaired: %r" % full_text(r))

# S6: idempotent
r2out = de.span_space_repair(out, pdf)
check(r2out == out, "S6: span repair not idempotent")

# S7: punctuation at the seam always declines, even with a tempting bigram
pdf = make_pdf([[(100, "Escalations go to the on-call engineer first thing."),
                 (114, "Every engineer takes a turn on call each quarter.")]])
d = Document()
p = d.add_paragraph()
p.add_run("Escalations go to the on")
p.add_run("-call engineer first thing.")
r, out = run_space(d, pdf)
check("on -call" not in r.paragraphs[0].text and "on-call" in r.paragraphs[0].text,
      "S7: hyphen seam spaced: %r" % r.paragraphs[0].text)

# S8: standards ids, ranges and apostrophe names decline
pdf = make_pdf([[(100, "Certified to ISO-9001 since 2018 and the ISO 9001 audit is annual."),
                 (114, "Coverage 2019-2024 inclusive; years 2019 2024 compared."),
                 (128, "O'Brien and O Brien both signed the register.")]])
d = Document()
p1 = d.add_paragraph()
p1.add_run("Certified to ISO")
p1.add_run("-9001 since 2018.")
p2 = d.add_paragraph()
p2.add_run("Coverage 2019")
p2.add_run("-2024 inclusive.")
p3 = d.add_paragraph()
p3.add_run("O'")
p3.add_run("Brien signed.")
r, out = run_space(d, pdf)
check("ISO-9001" in r.paragraphs[0].text, "S8a: ISO id spaced")
check("2019-2024" in r.paragraphs[1].text, "S8b: year range spaced")
check("O'Brien" in r.paragraphs[2].text, "S8c: apostrophe name spaced")

# S9: CJK line-wrap seams never receive a space
pdf = fitz.open()
pg = pdf.new_page(width=595, height=842)
pg.insert_font(fontname="cjk", fontfile="/System/Library/Fonts/Hiragino Sans GB.ttc")
pg.insert_text((72, 100), "日本語のテキス", fontsize=9, fontname="cjk")
pg.insert_text((72, 114), "トです", fontsize=9, fontname="cjk")
d = Document()
p = d.add_paragraph()
p.add_run("日本語のテキス")
p.add_run("トです")
buf = io.BytesIO()
d.save(buf)
check(de.span_space_repair(buf.getvalue(), pdf) == buf.getvalue(), "S9: CJK seam spaced")

# S11: a seam word with an interior hyphen is never probed as its substring
pdf = make_pdf([[(100, "The X-Rayscanner model 7 shipped this week to the lab."),
                 (114, "Each ray scanner was recalibrated on site by the crew.")]])
d = Document()
p = d.add_paragraph()
p.add_run("The X-Ray")
p.add_run("scanner model 7 shipped this week to the lab.")
r, out = run_space(d, pdf)
check("X-Rayscanner" in r.paragraphs[0].text,
      "S11: hyphen-interior token split: %r" % r.paragraphs[0].text)

# S12: accented seam words are whole tokens too, never their ASCII substrings
pdf = fitz.open()
pg = pdf.new_page(width=595, height=842)
pg.insert_font(fontname="hv", fontfile="/System/Library/Fonts/Helvetica.ttc")
pg.insert_text((72, 100), "Zürichbank AG posted quarterly results this morning.",
               fontsize=9, fontname="hv")
pg.insert_text((72, 114), "It is a rich bank with deep reserves and long history.",
               fontsize=9, fontname="hv")
d = Document()
p = d.add_paragraph()
p.add_run("Zürich")
p.add_run("bank AG posted quarterly results this morning.")
r, out = run_space(d, pdf)
check("Zürichbank" in r.paragraphs[0].text,
      "S12: accented token split: %r" % r.paragraphs[0].text)

# S10: drawing/text-box content is out of scope
pdf = make_pdf([[(100, "Charton call duty roster for the on call rotation.")]])
d = Document()
p = d.add_paragraph("Body text mentioning Charton")
p._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:drawing><wps:txbx xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
    f'<w:txbxContent><w:p><w:r><w:t>on</w:t></w:r><w:r><w:t>call duty</w:t></w:r></w:p>'
    f'</w:txbxContent></wps:txbx></w:drawing></w:r>'))
buf = io.BytesIO()
d.save(buf)
out2 = de.span_space_repair(buf.getvalue(), pdf)
import xml.etree.ElementTree as _ET
doc_xml = _ET.fromstring(zipfile.ZipFile(io.BytesIO(out2)).read("word/document.xml"))
W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
box = doc_xml.find(f".//{W_NS}txbxContent")
box_ts = [t.text for t in box.iter(f"{W_NS}t")]
check(box_ts == ["on", "call duty"], "S10: text-box seam edited: %s" % box_ts)

# ---- hyperlink_unnest cases (L) --------------------------------------------

W_MAIN = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def run_unnest(doc):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.hyperlink_unnest(buf.getvalue())
    return Document(io.BytesIO(out)), out


def _hyperlinks(out_bytes):
    root = _ET.fromstring(zipfile.ZipFile(io.BytesIO(out_bytes)).read("word/document.xml"))
    return root, root.findall(f".//{W_MAIN}hyperlink")


# L1: nested hyperlink lifts to paragraph level; stream order and the tail text
# after the link (which strict readers were dropping) both survive; idempotent.
d = Document()
p = d.add_paragraph()
p._p.append(parse_xml(
    f'<w:r {nsdecls("w", "r")}><w:rPr><w:u w:val="single"/><w:color w:val="0645AD"/></w:rPr>'
    f'<w:t xml:space="preserve">See </w:t>'
    f'<w:hyperlink r:id="rId99" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>'
    f'<w:t>the site</w:t></w:r></w:hyperlink>'
    f'<w:t xml:space="preserve"> for details.</w:t></w:r>'))
r1, out1 = run_unnest(d)
check(r1.paragraphs[0].text == "See the site for details.",
      "L1: stream changed: %r" % r1.paragraphs[0].text)
root1, links1 = _hyperlinks(out1)
check(len(links1) == 1, "L1: expected 1 hyperlink, got %d" % len(links1))
para1 = root1.find(f".//{W_MAIN}p")
check(any(child is links1[0] for child in para1),
      "L1: hyperlink is not a direct child of the paragraph")
out1b = de.hyperlink_unnest(out1)
check(out1b == out1, "L1: not idempotent")

# L2: directly adjacent same-rid fragments merge into one link; a different-rid
# neighbour stays separate.
d = Document()
p = d.add_paragraph()
for rid, txt in (("rId7", "speci"), ("rId7", "fication"), ("rId8", "elsewhere")):
    p._p.append(parse_xml(
        f'<w:r {nsdecls("w", "r")}><w:rPr><w:u w:val="single"/></w:rPr>'
        f'<w:hyperlink r:id="{rid}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>'
        f'<w:t>{txt}</w:t></w:r></w:hyperlink></w:r>'))
r2, out2 = run_unnest(d)
root2, links2 = _hyperlinks(out2)
check(len(links2) == 2, "L2: expected 2 hyperlinks after merge, got %d" % len(links2))
first_text = "".join(t.text or "" for t in links2[0].iter(f"{W_MAIN}t"))
check(first_text == "specification", "L2: merged link text %r" % first_text)
check(r2.paragraphs[0].text == "specificationelsewhere", "L2: stream changed")

# L3: rPr merge emits schema order even from two ordered inputs — wrapper
# [rFonts,color,u] + inner [rStyle,b,sz] must come out canonically ordered.
d = Document()
p = d.add_paragraph()
p._p.append(parse_xml(
    f'<w:r {nsdecls("w", "r")}><w:rPr><w:rFonts w:ascii="X"/><w:color w:val="FF0000"/>'
    f'<w:u w:val="single"/></w:rPr>'
    f'<w:hyperlink r:id="rId5"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>'
    f'<w:b/><w:sz w:val="28"/></w:rPr><w:t>x</w:t></w:r></w:hyperlink></w:r>'))
r3, out3 = run_unnest(d)
root3, links3 = _hyperlinks(out3)
inner_rpr = links3[0].find(f"{W_MAIN}r/{W_MAIN}rPr")
tags = [c.tag.split('}')[1] for c in inner_rpr]
check(tags == ["rStyle", "rFonts", "b", "color", "sz", "u"],
      "L3: merged rPr order %s" % tags)

# R23: a U+2010 compound broken at its own hyphen across a merge boundary is
# reconstructed exactly (no fuse, no injected space), while genuine
# hyphenation in the same document still heals. (iter-9; embedded font so the
# PDF text layer really carries U+2010.)
def _pdf_u2010(lines):
    pdf = fitz.open()
    pg = pdf.new_page(width=595, height=842)
    y = 80
    for t in lines:
        pg.insert_text((72, y), t, fontsize=11,
                       fontname="helv2", fontfile="/System/Library/Fonts/Helvetica.ttc")
        y += 15
    return pdf


CH1 = "The lab replaced all of its ageing equipment with modern state‐"
CH2 = "of‐the‐art spectrometers for the quarterly contamination analysis."
pdf = _pdf_u2010([CH1, CH2])
d = Document()
d.add_paragraph(CH1)
d.add_paragraph(CH2)
r, out = run_reflow(d, pdf)
body = " ".join(p.text for p in r.paragraphs if p.text)
check("state‐of‐the‐art" in body, "R23: compound chain not reconstructed: %r" % body[:90])
check("stateof" not in body.replace("‐", "").replace(" ", "")[:40] or "state‐of" in body,
      "R23: compound fused")

G1 = "A consistent grind and a level bed remove most of the equip‐"
G2 = "ment variability that beginners blame on the machine itself."
pdf = _pdf_u2010([G1, G2])
d = Document()
d.add_paragraph(G1)
d.add_paragraph(G2)
r, out = run_reflow(d, pdf)
body = " ".join(p.text for p in r.paragraphs if p.text)
check("equipment" in body, "R23b: genuine hyphenation no longer heals: %r" % body[:90])

# ---- date_column_untable cases (T) ------------------------------------------
# pdf2docx turns a CV line whose date is flush right into a 2-column table, and
# absorbs the section rule above it as the table's top border. The pass may
# dissolve only that shape: anything with real gridlines, a third column, or a
# left-aligned second column is a table and must survive untouched.
BORDER = ('<w:tcBorders %s><w:top w:val="single" w:sz="8"/>'
          '<w:start w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/>'
          '<w:end w:val="single" w:sz="8"/></w:tcBorders>')
RULE = '<w:tcBorders %s><w:top w:val="single" w:sz="6"/></w:tcBorders>'


def build_table(rows, boxed=False, rule=False, width=4000):
    """rows: [[(text, jc), ...], ...]. boxed = real gridlines on every cell."""
    d = Document()
    t = d.add_table(rows=0, cols=max(len(r) for r in rows))
    for ri, cells in enumerate(rows):
        tr = t.add_row()._tr
        for tc in tr.findall(qn("w:tc"))[len(cells):]:
            tr.remove(tc)
        for tc, (text, jc) in zip(tr.findall(qn("w:tc")), cells):
            tcpr = tc.get_or_add_tcPr()
            for el in tcpr.findall(qn("w:tcW")):
                tcpr.remove(el)
            tcpr.append(parse_xml('<w:tcW %s w:w="%d" w:type="dxa"/>'
                                  % (nsdecls("w"), width)))
            if boxed:
                tcpr.append(parse_xml(BORDER % nsdecls("w")))
            elif rule and ri == 0:
                tcpr.append(parse_xml(RULE % nsdecls("w")))
            p = tc.findall(qn("w:p"))[0]
            ppr = p.get_or_add_pPr()
            ppr.append(parse_xml('<w:jc %s w:val="%s"/>' % (nsdecls("w"), jc)))
            p.append(parse_xml('<w:r %s><w:t xml:space="preserve">%s</w:t></w:r>'
                               % (nsdecls("w"), text)))
    return d


def run_untable(d):
    buf = io.BytesIO()
    d.save(buf)
    out = de.date_column_untable(buf.getvalue())
    return Document(io.BytesIO(out)), out


DATE_ROWS = [[("Eurisko, Adma", "left"), ("Mar 2025 - Present", "right")]]

# T1: the date shape dissolves into one tabbed paragraph with a right tab stop
r, out = run_untable(build_table(DATE_ROWS, rule=True))
check(not r.tables, "T1: date table survived")
body = [p for p in r.paragraphs if p.text.strip()]
check(len(body) == 1, "T1: expected one paragraph, got %d" % len(body))
if body:
    check(body[0].text == "Eurisko, Adma \tMar 2025 - Present",
          "T1: text not flowed: %r" % body[0].text)
    tab = body[0]._p.find(qn("w:pPr") + "/" + qn("w:tabs") + "/" + qn("w:tab"))
    check(tab is not None and tab.get(qn("w:val")) == "right",
          "T1: no right tab stop")
    check(body[0]._p.find(qn("w:pPr") + "/" + qn("w:jc")) is None,
          "T1: flush-right alignment left on the flowed paragraph")
    check(body[0]._p.find(qn("w:pPr") + "/" + qn("w:pBdr") + "/" + qn("w:top"))
          is not None, "T1: absorbed section rule dropped")

# T2: a naive w:t-only reader must still see two words, not "AdmaMar"
check("Adma" in full_text(r) and "AdmaMar" not in full_text(r),
      "T2: label welded to date for w:t-only extraction: %r" % full_text(r))

# T3: real gridlines => a real table, never dissolved
r, _ = run_untable(build_table(DATE_ROWS, boxed=True))
check(len(r.tables) == 1, "T3: bordered date-shaped table dissolved")

# T4: three columns => a real table even with a right-aligned last column
r, _ = run_untable(build_table(
    [[("Instrument", "left"), ("SN-88231", "left"), ("12 March", "right")],
     [("Micro-balance", "left"), ("SN-7", "left"), ("9 February", "right")]]))
check(len(r.tables) == 1, "T4: 3-column table dissolved")

# T5: a left-aligned second column is a text column, not a flush-right date
r, _ = run_untable(build_table(
    [[("Eurisko, Adma", "left"), ("Mar 2025 - Present", "left")]]))
check(len(r.tables) == 1, "T5: side-by-side text columns dissolved")

# T6: a long right cell is prose in a second column, not a date
LONG = "an entire sentence of commentary that is far too long to be a date column"
r, _ = run_untable(build_table([[("Eurisko, Adma", "left"), (LONG, "right")]]))
check(len(r.tables) == 1, "T6: long right-hand cell dissolved")

# T7: no qualifying table => byte-identical no-op
d = Document()
d.add_paragraph("just prose, no tables at all")
buf = io.BytesIO()
d.save(buf)
check(de.date_column_untable(buf.getvalue()) == buf.getvalue(), "T7: no-op rewrote the file")
r, _ = run_untable(build_table(
    [[("Region", "left"), ("Revenue", "left")],
     [("North", "left"), ("1,240", "left")]]))
check(len(r.tables) == 1, "T7b: borderless 2-col table with no date row dissolved")

# T8: every token survives, in order, across a multi-row dissolve
d = build_table([[("Eurisko, Adma", "left"), ("Mar 2025 - Present", "right")],
                 [("Built the thing", "left")],
                 [("Lebanese University", "left"), ("2016 - 2021", "right")]], rule=True)
r, _ = run_untable(d)
check(not r.tables, "T8: multi-row date table survived")
flowed = " ".join(p.text for p in r.paragraphs if p.text.strip())
for word in ("Eurisko,", "Mar", "Built", "the", "thing", "Lebanese", "2016"):
    check(word in flowed.split() or word in flowed, "T8: %r lost" % word)
check(0 <= flowed.find("Built") < flowed.find("Lebanese"), "T8: rows reordered")

# T9: a textless leading cell is the line's bullet glyph — its drawing must
# survive, moved to the head of the text it belongs to, never deleted
d = build_table([[("Eurisko, Adma", "left"), ("Mar 2025 - Present", "right")],
                 [("", "center"), ("Intensive training in React", "left")]], rule=True)
glyph = d.tables[0].rows[1].cells[0].paragraphs[0]
glyph._p.append(parse_xml(
    '<w:r %s><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/'
    'drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.'
    'openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic='
    '"http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill>'
    '<a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>'
    '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
    "</w:r>" % nsdecls("w")))
r, out = run_untable(d)
check(not r.tables, "T9: glyph-row table survived")
check(count_tag(out, "w:drawing") == 1, "T9: bullet glyph destroyed")
check("Intensive training in React" in full_text(r), "T9: glyph-row text lost")

# T10: a table gridded by a STYLE draws lines this pass cannot inspect (it only
# reads explicit tcBorders/tblBorders), so a styled table is never dissolved
d = build_table(DATE_ROWS, rule=True)
d.tables[0]._tbl.find(qn("w:tblPr")).insert(
    0, parse_xml('<w:tblStyle %s w:val="TableGrid"/>' % nsdecls("w")))
r, _ = run_untable(d)
check(len(r.tables) == 1, "T10: style-gridded table dissolved")

# T11: a flush-right tail repeated down many rows is a COLUMN (a ledger, a
# contents list), not a one-off tabbed line. Three dissolve, four do not.
def date_row(n):
    return [("Consulting engagement %d" % n, "left"), ("Mar 202%d" % n, "right")]


r, _ = run_untable(build_table([date_row(n) for n in range(3)], rule=True))
check(not r.tables, "T11: 3 date rows should still dissolve")
r, _ = run_untable(build_table([date_row(n) for n in range(4)], rule=True))
check(len(r.tables) == 1, "T11: 4-row date column dissolved (max %d)" % de.DATE_ROW_MAX)

# T12: figures on the left are an amount grid, not "Employer — City"
r, _ = run_untable(build_table([[("40,912.55", "left"), ("1,204.00", "right")]],
                               rule=True))
check(len(r.tables) == 1, "T12: numeric-left amount row dissolved")

# T13: pdf2docx writes a raw float into w:sz (xsd:unsignedLong) and a CSS
# "#RRGGBB" into w:color (a bare hex triplet). Inside its own tcBorders that is
# its bug; re-emitted as this pass's OWN w:pBdr it becomes this pass's bug.
d = build_table(DATE_ROWS, rule=True)
top = d.tables[0]._tbl.find(".//" + qn("w:tcBorders") + "/" + qn("w:top"))
top.set(qn("w:sz"), "5.599999999999909")
top.set(qn("w:color"), "#1A1A1A")
r, _ = run_untable(d)
bdr = r.paragraphs[0]._p.find(qn("w:pPr") + "/" + qn("w:pBdr") + "/" + qn("w:top"))
check(bdr is not None, "T13: section rule dropped")
if bdr is not None:
    check(bdr.get(qn("w:sz")) == "6",
          "T13: w:sz not an integer: %r" % bdr.get(qn("w:sz")))
    check(bdr.get(qn("w:color")) == "1A1A1A",
          "T13: w:color kept its '#': %r" % bdr.get(qn("w:color")))

# T14-T17: pdf2docx pads a cell out to the row height with trailing empty
# paragraphs. The date has to land on the LABEL, so the last paragraph of the
# label cell cannot be one of those pads.
PAD = "<w:p %s><w:pPr/><w:r %s><w:rPr/></w:r></w:p>"


def pad_cell(d, row, col, n=1):
    tc = d.tables[0].rows[row].cells[col]._tc
    for _ in range(n):
        tc.append(parse_xml(PAD % (nsdecls("w"), nsdecls("w"))))
    return d


# T14: a padded label cell still yields ONE paragraph -- label, tab, date -- and
# the pad does not survive into the body as a stray blank line
r, out = run_untable(pad_cell(build_table(DATE_ROWS, rule=True), 0, 0, n=2))
check(not r.tables, "T14: padded date table survived")
body = r.paragraphs
check(len(body) == 1, "T14: expected 1 paragraph, got %d: %r"
      % (len(body), [p.text for p in body]))
if body:
    check(body[0].text == "Eurisko, Adma \tMar 2025 - Present",
          "T14: date detached from its label: %r" % body[0].text)

# T14b: the tab character must have the label's text BEFORE it. This is the
# invariant a trailing pad broke: the date moved INTO the pad, so the paragraph
# still held text and a naive "is it empty" check passed while the label sat
# stranded on the line above.
if body:
    seen, before = False, []
    for child in body[0]._p:
        if child.tag == qn("w:pPr") or seen:      # w:pPr holds the tab STOP
            continue
        for node in child.iter():
            if node.tag == qn("w:tab"):
                seen = True
                break
            if node.tag == qn("w:t"):
                before.append(node.text or "")
    check(seen, "T14b: no tab character emitted")
    check("".join(before).strip() == "Eurisko, Adma",
          "T14b: label text does not precede the tab: %r" % "".join(before))

# T15: only TRAILING pads are dropped. A blank paragraph BETWEEN two lines of
# cell text is a gap the source asked for and must survive.
d = build_table(DATE_ROWS, rule=True)
tc = d.tables[0].rows[0].cells[0]._tc
tc.append(parse_xml(PAD % (nsdecls("w"), nsdecls("w"))))
tc.append(parse_xml('<w:p %s><w:r %s><w:t>second line</w:t></w:r></w:p>'
                    % (nsdecls("w"), nsdecls("w"))))
r, _ = run_untable(d)
texts = [p.text for p in r.paragraphs]
check(len(texts) == 3 and texts[1] == "" and "second line" in texts[2],
      "T15: interior blank line not preserved: %r" % texts)

# T16: a paragraph is padding only when it renders NOTHING. One holding a line
# break is content, so it is kept and the date lands after it.
d = build_table(DATE_ROWS, rule=True)
d.tables[0].rows[0].cells[0]._tc.append(parse_xml(
    '<w:p %s><w:r %s><w:br/></w:r></w:p>' % (nsdecls("w"), nsdecls("w"))))
r, out = run_untable(d)
check(count_tag(out, "w:br") == 1, "T16: the line break was destroyed")
check(len(r.paragraphs) == 2,
      "T16: a break-carrying paragraph was treated as padding: %r"
      % [p.text for p in r.paragraphs])

# T17: an auto-width table (no usable w:tcW) still gets a RIGHT tab stop -- at
# the section text margin -- instead of falling to Word's default half-inch grid
d = build_table(DATE_ROWS, rule=True, width=0)
r, _ = run_untable(d)
check(not r.tables, "T17: auto-width date table survived")
tab = r.paragraphs[0]._p.find(qn("w:pPr") + "/" + qn("w:tabs") + "/" + qn("w:tab"))
check(tab is not None and tab.get(qn("w:val")) == "right",
      "T17: no right tab stop on an auto-width table")
if tab is not None:
    check(int(tab.get(qn("w:pos"))) > 5000,
          "T17: tab stop is not at the text margin: %r" % tab.get(qn("w:pos")))

# T18-T24: one cell can hold SEVERAL dates stacked behind soft line breaks, one
# per label line in the cell beside it -- pdf2docx merges a whole run of CV
# entries into a single 1x2 row that way. Each date belongs to its own label;
# moving the cell wholesale stacks them all on the first label and leaves every
# later entry dateless. Pair them 1:1, or refuse the table.
STACK_LABELS = ["ETSTC, Lebanon", "Val Pere Jacques, Bkennaya"]
STACK_DATES = ["2020 - 2023", "2007 - 2019"]


def stack_table(labels, dates, rule=True, bold=False, nest=False):
    """A 1x2 row: N label paragraphs on the left, M br-separated dates right."""
    d = build_table([[(labels[0], "left"), (dates[0], "right")]], rule=rule)
    tc = d.tables[0].rows[0].cells[0]._tc
    for text in labels[1:]:
        tc.append(parse_xml(
            '<w:p %s><w:pPr><w:jc w:val="left"/></w:pPr>'
            '<w:r %s><w:t xml:space="preserve">%s</w:t></w:r></w:p>'
            % (nsdecls("w"), nsdecls("w"), text)))
    p = d.tables[0].rows[0].cells[1]._tc.findall(qn("w:p"))[0]
    for text in dates[1:]:
        if nest:
            # the break lives inside a hyperlink, not a direct w:r child
            p.append(parse_xml(
                '<w:hyperlink %s><w:r><w:br/><w:t>%s</w:t></w:r></w:hyperlink>'
                % (nsdecls("w"), text)))
        elif bold:
            # one run carrying text on BOTH sides of the break
            p.append(parse_xml(
                '<w:r %s><w:rPr><w:b/></w:rPr><w:br/>'
                '<w:t>%s</w:t></w:r>' % (nsdecls("w"), text)))
        else:
            p.append(parse_xml('<w:r %s><w:br/></w:r>' % nsdecls("w")))
            p.append(parse_xml('<w:r %s><w:t>%s</w:t></w:r>'
                               % (nsdecls("w"), text)))
    return d


# T18: two stacked dates, two labels -> one date per label, each behind its own
# right tab stop, and no line break left anywhere
r, out = run_untable(stack_table(STACK_LABELS, STACK_DATES))
check(not r.tables, "T18: stacked date table survived")
texts = [p.text for p in r.paragraphs]
check(texts == ["ETSTC, Lebanon \t2020 - 2023",
                "Val Pere Jacques, Bkennaya \t2007 - 2019"],
      "T18: dates not paired with their own labels: %r" % texts)
check(count_tag(out, "w:br") == 0,
      "T18: a stacked date kept its line break")
for i, p in enumerate(r.paragraphs):
    tab = p._p.find(qn("w:pPr") + "/" + qn("w:tabs") + "/" + qn("w:tab"))
    check(tab is not None and tab.get(qn("w:val")) == "right",
          "T18: paragraph %d has no right tab stop" % i)
    check(p._p.find(qn("w:pPr") + "/" + qn("w:jc")) is None,
          "T18: flush-right alignment left on paragraph %d" % i)

# T19: a naive w:t-only reader must still see a gap between label and date
check("Lebanon2020" not in full_text(r) and "Bkennaya2007" not in full_text(r),
      "T19: label welded to its date: %r" % full_text(r))

# T20: three dates against two labels cannot be paired -- refuse to untable
# rather than stack the leftovers on somebody else's line
buf = io.BytesIO()
stack_table(STACK_LABELS, STACK_DATES + ["1999 - 2007"]).save(buf)
check(de.date_column_untable(buf.getvalue()) == buf.getvalue(),
      "T20: unpairable 3-dates-2-labels row was untabled anyway")

# T21: two dates against ONE label -- the original defect's shape. Refuse.
buf = io.BytesIO()
stack_table(STACK_LABELS[:1], STACK_DATES).save(buf)
check(de.date_column_untable(buf.getvalue()) == buf.getvalue(),
      "T21: two dates were stacked onto a single label")

# T22: a run carrying text on both sides of the break splits into two runs that
# each keep the original rPr -- the second date must not lose its bold
r, out = run_untable(stack_table(STACK_LABELS, STACK_DATES, bold=True))
texts = [p.text for p in r.paragraphs]
check(texts == ["ETSTC, Lebanon \t2020 - 2023",
                "Val Pere Jacques, Bkennaya \t2007 - 2019"],
      "T22: split run lost or reordered text: %r" % texts)
check(count_tag(out, "w:br") == 0, "T22: the split run kept its break")
bolds = [t.text for run in r.paragraphs[1]._p.iter(qn("w:r"))
         if run.find(qn("w:rPr") + "/" + qn("w:b")) is not None
         for t in run.iter(qn("w:t"))]
check("2007 - 2019" in bolds,
      "T22: the second date lost its run properties: %r" % bolds)

# T23: a label line with no words (a rule glyph, a stray bullet) is not a label
# this pass can pair a date with -- leave the table alone
buf = io.BytesIO()
stack_table(["ETSTC, Lebanon", "---"], STACK_DATES).save(buf)
check(de.date_column_untable(buf.getvalue()) == buf.getvalue(),
      "T23: a wordless label line was paired with a date")

# T24: a break nested somewhere this pass cannot slice (inside a hyperlink) is
# not a shape to guess at -- refuse
buf = io.BytesIO()
stack_table(STACK_LABELS, STACK_DATES, nest=True).save(buf)
check(de.date_column_untable(buf.getvalue()) == buf.getvalue(),
      "T24: a nested line break was sliced anyway")
# T25-T31: the SECOND spelling of a flush-right date cell. pdf2docx does not
# always write w:jc="right": on some layouts it reproduces the position it
# measured as a large w:ind on an otherwise left-aligned line, so the date sits
# at the right of its cell with no w:jc to say so. That spelling made the whole
# plan return None and left a live 2-column table in the body (a CV's ADDITIONAL
# EXPERIENCE line, with the section rule frozen into a tcBorders top). The
# indent has to clear BOTH a share of the cell width and an absolute floor, so a
# cell margin or an ordinary paragraph indent in a genuine second text column
# cannot pass for a date.
def indent_cell(d, row, col, tw, jc="left"):
    """Rewrite a cell's single paragraph as jc + a w:ind left of tw twips."""
    p = d.tables[0].rows[row].cells[col]._tc.findall(qn("w:p"))[0]
    ppr = p.get_or_add_pPr()
    for el in ppr.findall(qn("w:jc")) + ppr.findall(qn("w:ind")):
        ppr.remove(el)
    ppr.append(parse_xml('<w:jc %s w:val="%s"/>' % (nsdecls("w"), jc)))
    ppr.append(parse_xml('<w:ind %s w:left="%d"/>' % (nsdecls("w"), tw)))
    return d


def indent_rows(tw, width=4000, jc="left", rule=True):
    d = build_table([[("Royal Reality Real Estate, Mount Lebanon", "left"),
                      ("Jun 2025 - Nov 2025", "left")]], rule=rule, width=width)
    return indent_cell(d, 0, 1, tw, jc=jc)


# T25: an indent-pushed date dissolves exactly like the w:jc="right" spelling
r, out = run_untable(indent_rows(722, width=3866))
check(not r.tables, "T25: indent-pushed date table survived")
body = [p for p in r.paragraphs if p.text.strip()]
check(len(body) == 1, "T25: expected one paragraph, got %d" % len(body))
if body:
    check(body[0].text ==
          "Royal Reality Real Estate, Mount Lebanon \tJun 2025 - Nov 2025",
          "T25: text not flowed: %r" % body[0].text)
    tab = body[0]._p.find(qn("w:pPr") + "/" + qn("w:tabs") + "/" + qn("w:tab"))
    check(tab is not None and tab.get(qn("w:val")) == "right",
          "T25: no right tab stop on the indent-pushed spelling")
    check(body[0]._p.find(qn("w:pPr") + "/" + qn("w:pBdr") + "/" + qn("w:top"))
          is not None, "T25: absorbed section rule dropped")

# T26: a cell margin's worth of indent is not a date. 300tw is under the
# absolute floor even though it clears the share of a narrow cell.
r, _ = run_untable(indent_rows(300, width=1600))
check(len(r.tables) == 1, "T26: a cell-margin indent was read as a date column")

# T27: half an inch of indent inside a WIDE column is an ordinary paragraph
# indent -- it clears the absolute floor but not the share.
r, _ = run_untable(indent_rows(720, width=6000))
check(len(r.tables) == 1, "T27: a paragraph indent in a wide cell dissolved")

# T28: T5's unindented left-aligned second column must still survive -- the new
# spelling widens what counts as flush right, it does not replace the old test.
r, _ = run_untable(indent_rows(0, width=4000))
check(len(r.tables) == 1, "T28: an unindented second text column dissolved")

# T29: centred is a third thing. A centred short cell is not pushed right, and
# an indent under a centred line is a centring offset, not a date gap.
r, _ = run_untable(indent_rows(2000, width=4000, jc="center"))
check(len(r.tables) == 1, "T29: a centred short cell was read as a date")

# T30: every other guard still applies to this spelling. A long indent-pushed
# cell is prose in a second column, not a date.
d = build_table([[("Royal Reality Real Estate", "left"), (LONG, "left")]],
                rule=True, width=4000)
r, _ = run_untable(indent_cell(d, 0, 1, 900))
check(len(r.tables) == 1, "T30: a long indent-pushed cell dissolved")

# T31: an indent-pushed LEFT cell is a second column read from the wrong side,
# never a label. Both sides are judged by the same rule.
d = indent_rows(722, width=3866)
indent_cell(d, 0, 0, 900)
r, _ = run_untable(d)
check(len(r.tables) == 1, "T31: a table with both cells pushed right dissolved")

# T32: a MULTI-LINE right cell is a second column, whatever its first line's
# indent. w:jc="right" states that a whole cell is right-aligned; a w:ind states
# only where the first line starts. The letterhead in the real-world corpus is
# the case: a phone/fax/web block, under DATE_CELL_MAX_CHARS in total, that this
# pass would otherwise inline behind the postal address beside it.
d = indent_rows(722, width=3866)
tc = d.tables[0].rows[0].cells[1]._tc
tc.findall(qn("w:p"))[0].append(parse_xml(
    '<w:r %s><w:br/><w:t>F +966.11.463.8750</w:t></w:r>' % nsdecls("w")))
r, _ = run_untable(d)
check(len(r.tables) == 1, "T32: a multi-line indent-pushed cell dissolved")

# ---- reflow first-line-indent oracle (R24-R25) ------------------------------
# A block's leftmost line is not its paragraph margin. When the block also holds
# a line further left than the body — the flush-left label of a CV entry whose
# date sits flush right, the same shape T1 untables — every wrapped body line
# below it measured as "first-line indented" and the paragraph was cut at every
# single line break. The indent test now also needs a step right of the PREVIOUS
# line, which can only ever merge lines the old rule split.
LABEL = "React and React Native Academy, Eurisko Adma"
DATE = "Mar 2025 to Present"
LEAD = ("Intensive training in React and React Native for web and mobile applications "
        "covering component architecture and")
TAIL = "navigation and routing and REST API integration and state management for teams."
# one MuPDF block, four lines at three different left edges: label x0=45,
# flush-right date x0=460, body x0=57. Block minimum is the label's 45, so the
# body lines used to read as first-line indents and never rejoined.
pdf = make_pdf([[(100, LABEL, 45), (100, DATE, 460), (112, LEAD, 57), (124, TAIL, 57)]])
d = Document()
for t in (LABEL, DATE, LEAD, TAIL):
    d.add_paragraph(t)
r, _ = run_reflow(d, pdf)
texts = [p.text for p in r.paragraphs if p.text.strip()]
check(texts == [LABEL, DATE, LEAD + " " + TAIL],
      "R24: body lines under a further-left label not rejoined: %s" % texts)

# R25: the indent predicate itself. End-to-end coverage cannot reach a genuine
# mid-block first-line indent — MuPDF starts a NEW block at a vertical step
# right, so the only step-rights that survive inside one block are same-baseline
# flush-right tails (R24's shape). So assert the predicate directly, including
# the property that makes the change safe: it is a strict narrowing, true only
# where the old block-edge-only rule was true.
# a body line whose predecessor sits further RIGHT (the flush-right date) is a
# wrap, not an indent -- the whole point of the change
check(not de._first_line_indent(57.0, 460.0, 45.0, 9.0),
      "R25: body line under a flush-right tail still reads as an indent")
# an ordinary block, every line flush left with the block: unchanged both ways
check(de._first_line_indent(90.0, 57.0, 57.0, 9.0),
      "R25: a real first-line indent no longer breaks the paragraph")
check(not de._first_line_indent(57.0, 57.0, 57.0, 9.0), "R25: flush line reads as indent")
check(not de._first_line_indent(59.0, 57.0, 57.0, 9.0),
      "R25: sub-half-em jitter reads as an indent")
# --- BI: bullet glyphs rasterised as tiny inline images (D1) -----------------
# The pass may only promote a picture that is structurally a marker: a run
# holding nothing but a tiny near-square image at the head of a text line, and
# never fewer than two of them in one document.
import base64  # noqa: E402

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8"
    "BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
assert len(TINY_PNG) <= de.BULLET_IMG_MAX_BYTES


def _noisy_png(n=48):
    """A PNG that is genuinely bigger than the marker byte ceiling."""
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, n, n), False)
    v = 7
    for y in range(n):
        for x in range(n):
            v = (v * 1103515245 + 12345) & 0xFFFFFF
            pix.set_pixel(x, y, (v & 255, (v >> 8) & 255, (v >> 16) & 255))
    return pix.tobytes("png")


NOISY_PNG = _noisy_png()
assert len(NOISY_PNG) > de.BULLET_IMG_MAX_BYTES


def mark_para(doc, text, png=TINY_PNG, pt=4, before=None):
    p = doc.add_paragraph()
    if before:
        p.add_run(before)
    p.add_run().add_picture(io.BytesIO(png), width=Pt(pt), height=Pt(pt))
    if text:
        p.add_run(text)
    return p


def run_bullet_img(doc):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.bullet_image_lists(buf.getvalue())
    return Document(io.BytesIO(out)), out


def blip_count(docx_bytes):
    return count_tag(docx_bytes, "a:blip")


# BI1: three marked lines become three list items and the images go away.
d = Document()
for t in ("first item", "second item", "third item"):
    mark_para(d, t)
d.add_paragraph("closing prose that carries no marker at all")
r, out = run_bullet_img(d)
check(all(has_numpr(x) for x in r.paragraphs[:3]), "BI1: marks not converted")
check([x.text for x in r.paragraphs[:3]] == ["first item", "second item", "third item"],
      "BI1: text changed: %r" % [x.text for x in r.paragraphs[:3]])
check(blip_count(out) == 0, "BI1: %d image(s) left behind" % blip_count(out))
check(not has_numpr(r.paragraphs[3]), "BI1: unmarked prose numbered")
check(len({numid_of(x) for x in r.paragraphs[:3]}) == 1, "BI1: split across counters")
check(de.bullet_image_lists(out) == out, "BI1: not idempotent")

# BI2: ONE tiny image in the whole document is decoration, not a list.
d = Document()
mark_para(d, "the only marked line in this document")
d.add_paragraph("ordinary prose")
r, out = run_bullet_img(d)
check(not has_numpr(r.paragraphs[0]), "BI2: single mark converted")
check(blip_count(out) == 1, "BI2: lone image destroyed")

# BI3: real artwork is never a marker — neither when it is drawn large nor
# when it is small on the page but heavy in bytes.
d = Document()
for t in ("caption one", "caption two", "caption three"):
    mark_para(d, t, pt=200)
r, out = run_bullet_img(d)
check(not any(has_numpr(x) for x in r.paragraphs), "BI3: large images converted")
check(blip_count(out) == 3, "BI3: large images destroyed")

d = Document()
for t in ("chip one", "chip two", "chip three"):
    mark_para(d, t, png=NOISY_PNG)
r, out = run_bullet_img(d)
check(not any(has_numpr(x) for x in r.paragraphs), "BI3b: byte-heavy images converted")
check(blip_count(out) == 3, "BI3b: byte-heavy images destroyed")

# BI4: a mark that does not lead the line is an inline glyph, not a marker.
d = Document()
for t in ("trailing text", "more trailing text", "still more"):
    mark_para(d, t, before="lead-in ")
r, out = run_bullet_img(d)
check(not any(has_numpr(x) for x in r.paragraphs), "BI4: mid-line images converted")
check(blip_count(out) == 3, "BI4: mid-line images destroyed")

# BI5: a marker with no text of its own, and no text cell beside it, declines.
d = Document()
for _ in range(3):
    mark_para(d, "")
r, out = run_bullet_img(d)
check(not any(has_numpr(x) for x in r.paragraphs), "BI5: text-less marks converted")
check(blip_count(out) == 3, "BI5: text-less marks destroyed")

# BI6: the marker parked alone in its own cell numbers the text cell next to it.
d = Document()
tbl = d.add_table(rows=2, cols=2)
for i, t in enumerate(("cell item one", "cell item two")):
    tbl.cell(i, 0).paragraphs[0].add_run().add_picture(
        io.BytesIO(TINY_PNG), width=Pt(4), height=Pt(4))
    tbl.cell(i, 1).text = t
r, out = run_bullet_img(d)
cells = [r.tables[0].cell(i, 1).paragraphs[0] for i in range(2)]
check(all(has_numpr(x) for x in cells), "BI6: cell marks not converted")
check([x.text for x in cells] == ["cell item one", "cell item two"],
      "BI6: cell text changed")
check(blip_count(out) == 0, "BI6: cell images left behind")
check(all(not has_numpr(r.tables[0].cell(i, 0).paragraphs[0]) for i in range(2)),
      "BI6: the emptied marker cell was numbered")

# BI7: same shape but the marker is in the LAST cell of the row: nothing to
# number, so nothing moves.
d = Document()
tbl = d.add_table(rows=2, cols=2)
for i, t in enumerate(("text first", "text again")):
    tbl.cell(i, 0).text = t
    tbl.cell(i, 1).paragraphs[0].add_run().add_picture(
        io.BytesIO(TINY_PNG), width=Pt(4), height=Pt(4))
r, out = run_bullet_img(d)
check(blip_count(out) == 2, "BI7: trailing cell images destroyed")
check(not any(has_numpr(r.tables[0].cell(i, 0).paragraphs[0]) for i in range(2)),
      "BI7: trailing cell marks converted")

# BI8: a paragraph that is ALREADY a list item keeps its own numbering.
d = Document()
ps = [mark_para(d, t) for t in ("kept one", "kept two")]
buf = io.BytesIO()
d.save(buf)
pre = Document(io.BytesIO(buf.getvalue()))
numbering = de._numbering_root(pre)
nid = de._add_num(numbering, "bul")
for x in pre.paragraphs:
    de._set_numpr(x, 0, nid)
buf2 = io.BytesIO()
pre.save(buf2)
out = de.bullet_image_lists(buf2.getvalue())
r = Document(io.BytesIO(out))
check(all(numid_of(x) == nid for x in r.paragraphs), "BI8: existing numbering changed")
check(blip_count(out) == 2, "BI8: images stripped from existing list items")


# BI9: the emitted bullet is drawn at the size of the text it marks, so a list
# on a 9.5pt CV does not gain a line of height per item and overflow the page.
d = Document()
for t in ("sized one", "sized two"):
    par = mark_para(d, "")
    r_ = par.add_run(t)
    r_.font.size = Pt(9.5)
r, out = run_bullet_img(d)
import zipfile as _zf  # noqa: E402
numxml = _zf.ZipFile(io.BytesIO(out)).read("word/numbering.xml").decode()
check('<w:sz w:val="19"/>' in numxml, "BI9: bullet level not sized to the item text")
check(all(has_numpr(x) for x in r.paragraphs), "BI9: sized marks not converted")

# BI10: with no size on the item runs the level stays unsized rather than
# guessing one, and ordinary character-bullet lists are untouched by the change.
d = Document()
for t in ("plain one", "plain two"):
    mark_para(d, t)
r, out = run_bullet_img(d)
numxml = _zf.ZipFile(io.BytesIO(out)).read("word/numbering.xml").decode()
added = numxml[numxml.rfind("<w:abstractNum "):].split("</w:abstractNum>")[0]
check("<w:sz " not in added, "BI10: a size was invented for unsized items")
check('<w:numFmt w:val="bullet"/>' in added, "BI10: the added counter is not a bullet")

# === fused line split / centred indent passes =========================# A4 text column used by every case below, so "flush right" and "room to spare"
# mean the same thing here as they do on a real page.
FS_L, FS_R = 72.0, 523.0
FS_WIDE = "a full measure line that runs the whole width of this text column ok"


def fs_width(text, size):
    return fitz.get_text_length(text, fontname="helv", fontsize=size)


def fs_pdf(lines):
    """lines: (y, text, size, align) with align in left / right / centre / x."""
    pdf = fitz.open()
    pg = pdf.new_page(width=595, height=842)
    for y, t, size, align in lines:
        w = fs_width(t, size)
        if align == "left":
            x = FS_L
        elif align == "right":
            x = FS_R - w
        elif align == "centre":
            x = (FS_L + FS_R) / 2 - w / 2
        else:
            x = float(align)
        pg.insert_text((x, y), t, fontsize=size)
    return pdf


def fs_page(lines):
    """The same, with a full-width line on it so the column edge is real."""
    return fs_pdf(list(lines) + [(760, FS_WIDE, 11, "left")])


def run_fs(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.fused_line_split(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def fs_para(doc, runs, jc=None):
    """One paragraph, one w:r per (text, size) pair."""
    p = doc.add_paragraph()
    for text, size in runs:
        r = p.add_run(text)
        r.font.size = Pt(size)
    if jc:
        p._p.get_or_add_pPr().append(
            parse_xml('<w:jc %s w:val="%s"/>' % (nsdecls("w"), jc)))
    return p


def fs_texts(doc):
    return [p.text for p in doc.paragraphs if p.text.strip()]


# FS0: the typography half of the deliberate-break test. One block at one size
# is flowing text; a block change or a real size step is a candidate line.
def fs_line(block, size, x0=FS_L, x1=200.0, text="a short line"):
    return {"block": block, "size": size, "x0": x0, "x1": x1, "text": text,
            "page_left": FS_L, "page_right": FS_R}


A = fs_line((0, 1), 9.6)
check(not de._fs_deliberate(A, fs_line((0, 1), 9.6)), "FS0: wrap read as a line")
check(de._fs_deliberate(A, fs_line((0, 2), 9.6)), "FS0: block change missed")
check(de._fs_deliberate(A, fs_line((0, 1), 8.8)), "FS0: size change missed")
check(not de._fs_deliberate(A, fs_line((0, 1), 9.3)),
      "FS0: sub-0.5pt jitter read as a size change")

# FS0b: the geometry half. A block change is NOT enough on its own: when the
# sizes on a page vary, fitz returns one block per visual line, so wrapped prose
# arrives as a block change on every break. A line that ran out of room stays
# joined to the one that continues it.
full = fs_line((0, 1), 11, x0=FS_L, x1=FS_R, text="y" * 60)
check(not de._fs_deliberate(full, fs_line((0, 2), 9, x0=FS_L, x1=200.0,
                                          text="continuation of the sentence")),
      "FS0b: forced wrap across blocks read as a deliberate line")
check(de._fs_deliberate(fs_line((0, 1), 11, x0=FS_L, x1=200.0, text="short line"),
                        fs_line((0, 2), 9, x0=FS_L, x1=300.0, text="next line")),
      "FS0b: line with room to spare not read as deliberate")

# FS1: two centred lines welded into one paragraph are split, and every
# character survives the cut. Centred lines share an axis but not a left edge,
# which is what tells them apart from a wrap even though the second one is a
# long unbreakable URL that could not have fitted on the first.
pdf = fs_page([(100, "Baouchrieh, Lebanon | +961 81 527 424 | m@example.com", 9, "centre"),
               (112, "linkedin.com/in/someone-87140a42a", 9, "centre")])
d = Document()
fs_para(d, [("Baouchrieh, Lebanon | +961 81 527 424 | m@example.com ", 9),
            ("linkedin.com/in/someone-87140a42a", 9)], jc="center")
r, out = run_fs(d, pdf)
check(fs_texts(r) == ["Baouchrieh, Lebanon | +961 81 527 424 | m@example.com ",
                      "linkedin.com/in/someone-87140a42a"],
      "FS1: contact lines not split: %s" % fs_texts(r))
check(full_text(r).replace(" ", "") ==
      "Baouchrieh,Lebanon|+96181527424|m@example.comlinkedin.com/in/someone-87140a42a",
      "FS1: text lost or reordered by the split")

# FS2: wrapped prose — one block, one size — is never split, however many runs
# pdf2docx happened to break it into.
pdf = fs_page([(100, "the quick brown fox jumps across the sleeping meadow and", 9, "left"),
               (112, "over the lazy dog every single evening.", 9, "left")])
d = Document()
fs_para(d, [("the quick brown fox jumps across the sleeping meadow and ", 9),
            ("over the lazy dog every single evening.", 9)])
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS2: wrapped prose split into %d paragraphs" % len(fs_texts(r)))

# FS3: a size change at a line break, on a line that stopped with most of the
# column still free, is a deliberate line: a CV entry title and the degree line
# underneath it.
pdf = fs_page([(100, "ETSTC Technical Education Institution, Lebanon", 10, "left"),
               (112, "Technical Baccalaureate in Computer Programming", 8, "left")])
d = Document()
fs_para(d, [("ETSTC Technical Education Institution, Lebanon ", 10),
            ("Technical Baccalaureate in Computer Programming", 8)])
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 2, "FS3: size step at a line break not split: %s" % fs_texts(r))

# FS3b: the same shape with an inline size change inside real prose, where the
# line ran to the margin and the next word could not have fitted, stays one
# paragraph. This is the corpus's inline_styles document in miniature.
lead = "This sentence is set larger at fourteen points"
while fs_width(lead + " and", 11) < FS_R - FS_L:
    lead += " and"
tail_ = "measure completely before returning to the body size."
pdf = fs_page([(100, lead, 11, "left"), (114, tail_, 9, "left")])
d = Document()
fs_para(d, [(lead + " ", 11), (tail_, 9)])
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS3b: an inline size change split prose: %s" % fs_texts(r))

# FS4: a tab at the seam is a label/date column on ONE visual line, not two
# lines — cutting there would strand the date on a line of its own.
pdf = fs_page([(100, "ETSTC Technical Education Institution", 10, "left"),
               (100, "2020 - 2023", 8, "right")])
d = Document()
p = d.add_paragraph()
p.add_run("ETSTC Technical Education Institution ").font.size = Pt(10)
p.add_run().add_tab()
p.add_run("2020 - 2023").font.size = Pt(8)
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS4: label/date columns split apart: %s" % fs_texts(r))

# FS4b: the line AFTER a flush-right date is still its own line. The date ends
# hard against the right margin, so the room-to-spare test alone would read
# every break behind it as forced, and the CV's degree line would stay welded
# to its own entry's date.
pdf = fs_page([(100, "ETSTC Technical Education Institution", 10, "left"),
               (100, "2020 - 2023", 8, "right"),
               (112, "Technical Baccalaureate in Computer Programming", 9, "left")])
d = Document()
p = d.add_paragraph()
p.add_run("ETSTC Technical Education Institution ").font.size = Pt(10)
p.add_run().add_tab()
p.add_run("2020 - 2023 ").font.size = Pt(8)
p.add_run("Technical Baccalaureate in Computer Programming").font.size = Pt(9)
r, out = run_fs(d, pdf)
check(fs_texts(r) == ["ETSTC Technical Education Institution \t2020 - 2023 ",
                      "Technical Baccalaureate in Computer Programming"],
      "FS4b: date entry not split from its degree line: %s" % fs_texts(r))

# FS5: an ambiguous match cuts nothing. The same two lines appear twice on the
# page, so no window is unique and the pass cannot know which one it is looking
# at — it leaves the paragraph alone rather than guessing.
pdf = fs_page([(100, "Head of Platform", 10, "left"), (112, "since 2019", 8, "left"),
               (300, "Head of Platform", 10, "left"), (312, "since 2019", 8, "left")])
d = Document()
fs_para(d, [("Head of Platform ", 10), ("since 2019", 8)])
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS5: ambiguous match split anyway: %s" % fs_texts(r))

# FS6: when the line break falls INSIDE a run there is no clean boundary, so
# nothing is cut — the pass never slices a run or invents run properties.
pdf = fs_page([(100, "Head of Platform", 10, "left"), (112, "since 2019", 8, "left")])
d = Document()
fs_para(d, [("Head of Platform since 2019", 10), ("", 10)])
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS6: run sliced mid-run: %s" % fs_texts(r))

# FS7: list items, hard-broken paragraphs and drawings are out of scope.
pdf = fs_page([(100, "Alpha beta gamma", 10, "left"), (112, "delta epsilon", 8, "left")])
d = Document()
lp = fs_para(d, [("Alpha beta gamma ", 10), ("delta epsilon", 8)])
numbering = de._numbering_root(d)
nid = de._add_num(numbering, "bul")
de._set_numpr(lp, 0, nid)
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS7: a list item was split")

d = Document()
p = d.add_paragraph()
p.add_run("Alpha beta gamma ").font.size = Pt(10)
p.runs[0]._r.append(parse_xml("<w:br %s/>" % nsdecls("w")))
p.add_run("delta epsilon").font.size = Pt(8)
r, out = run_fs(d, pdf)
check(len(fs_texts(r)) == 1, "FS7: a hard-broken paragraph was split")

# FS8: no PDF, no evidence, no change; and the pass is idempotent — a second
# run finds the lines already separate and returns the bytes untouched.
d = Document()
fs_para(d, [("Alpha beta gamma ", 10), ("delta epsilon", 8)])
buf = io.BytesIO()
d.save(buf)
check(de.fused_line_split(buf.getvalue(), None) == buf.getvalue(),
      "FS8: pass acted without a source PDF")
once = de.fused_line_split(buf.getvalue(), pdf)
check(len(fs_texts(Document(io.BytesIO(once)))) == 2, "FS8: nothing to be idempotent about")
check(de.fused_line_split(once, pdf) == once, "FS8: pass is not idempotent")

# FS9: paragraph properties ride along with each piece, so a split never drops
# the alignment, spacing or tab stops the source line was carrying.
pdf = fs_page([(100, "Baouchrieh, Lebanon", 9, "centre"),
               (112, "linkedin.com/in/x", 9, "centre")])
d = Document()
fs_para(d, [("Baouchrieh, Lebanon ", 9), ("linkedin.com/in/x", 9)], jc="center")
r, out = run_fs(d, pdf)
check([de._p_jc(p._p) for p in r.paragraphs if p.text.strip()] == ["center", "center"],
      "FS9: alignment lost on the split-off line")


def ci_para(doc, text, jc=None, **ind):
    p = doc.add_paragraph(text)
    ppr = p._p.get_or_add_pPr()
    attrs = " ".join('w:%s="%d"' % (k, v) for k, v in ind.items())
    ppr.append(parse_xml("<w:ind %s %s/>" % (nsdecls("w"), attrs)))
    if jc:
        ppr.append(parse_xml('<w:jc %s w:val="%s"/>' % (nsdecls("w"), jc)))
    return p


def ci_ind(p):
    el = p._p.find(qn("w:pPr") + "/" + qn("w:ind"))
    if el is None:
        return None
    return {k.split("}")[1]: v for k, v in el.attrib.items()}


# CI1: a centred line carrying pdf2docx's measured x-offset as a symmetric
# left+right indent loses it — that indent cannot move centred text, it can only
# squeeze the box until Word re-wraps a line that fitted.
d = Document()
ci_para(d, "Baouchrieh, Lebanon | m@example.com", jc="center", left=2160, right=2160)
buf = io.BytesIO()
d.save(buf)
r = Document(io.BytesIO(de.centred_indent_drop(buf.getvalue())))
check(ci_ind(r.paragraphs[0]) is None, "CI1: phantom centred indent kept: %s"
      % ci_ind(r.paragraphs[0]))

# CI2: an asymmetric indent is doing real work (it does move centred text), so
# it stays.
d = Document()
ci_para(d, "Pulled to the right", jc="center", left=2160, right=0)
buf = io.BytesIO()
d.save(buf)
r = Document(io.BytesIO(de.centred_indent_drop(buf.getvalue())))
check(ci_ind(r.paragraphs[0]) == {"left": "2160", "right": "0"},
      "CI2: asymmetric centred indent dropped")

# CI3: a small symmetric indent does not squeeze anything worth repairing, and
# CI4: a left-aligned paragraph's indent is an indent, never a centring artefact.
d = Document()
ci_para(d, "Slightly inset", jc="center", left=360, right=360)
ci_para(d, "Left aligned block quote", left=2160, right=2160)
buf = io.BytesIO()
d.save(buf)
check(de.centred_indent_drop(buf.getvalue()) == buf.getvalue(),
      "CI3/CI4: small or non-centred indents were dropped")

# CI5: only the two sides are removed. A first-line indent on the same w:ind is
# a different property and survives.
d = Document()
ci_para(d, "Centred with a first line", jc="center",
        left=2160, right=2160, firstLine=240)
buf = io.BytesIO()
d.save(buf)
r = Document(io.BytesIO(de.centred_indent_drop(buf.getvalue())))
check(ci_ind(r.paragraphs[0]) == {"firstLine": "240"},
      "CI5: firstLine lost with the phantom sides: %s" % ci_ind(r.paragraphs[0]))
# ---- hyperlink_autolink cases (M) ------------------------------------------

HYPERLINK_RT = ("http://schemas.openxmlformats.org/officeDocument/2006/"
                "relationships/hyperlink")


def run_autolink(doc):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.hyperlink_autolink(buf.getvalue())
    return Document(io.BytesIO(out)), out


def _al_links(out_bytes):
    root = _ET.fromstring(zipfile.ZipFile(io.BytesIO(out_bytes)).read("word/document.xml"))
    return root, root.findall(f".//{W_MAIN}hyperlink")


def _al_targets(out_bytes):
    rels = _ET.fromstring(
        zipfile.ZipFile(io.BytesIO(out_bytes)).read("word/_rels/document.xml.rels"))
    return sorted(r.get("Target") for r in rels if r.get("Type") == HYPERLINK_RT)


def _al_no_nesting(root, tag):
    for r in root.iter(f"{W_MAIN}r"):
        check(not list(r.iter(f"{W_MAIN}hyperlink")),
              "%s: w:hyperlink nested inside a w:r" % tag)


# M1: a CV contact line -- plain e-mail plus a scheme-less linkedin address --
# becomes two sibling hyperlinks with two external rels, the character stream is
# untouched, and a second application is a no-op.
d = Document()
d.add_paragraph("Beirut, Lebanon  |  Maroundaher03@gmail.com "
                "linkedin.com/in/maroun-daher-87140a42a")
rM1, outM1 = run_autolink(d)
rootM1, linksM1 = _al_links(outM1)
check(len(linksM1) == 2, "M1: expected 2 hyperlinks, got %d" % len(linksM1))
_al_no_nesting(rootM1, "M1")
paraM1 = list(rootM1.iter(f"{W_MAIN}p"))[0]
check(all(any(c is lk for c in paraM1) for lk in linksM1),
      "M1: hyperlink is not a direct child of the paragraph")
check(full_text(rM1) == ("Beirut, Lebanon  |  Maroundaher03@gmail.com "
                         "linkedin.com/in/maroun-daher-87140a42a"),
      "M1: stream changed: %r" % full_text(rM1))
check(_al_targets(outM1) == ["https://linkedin.com/in/maroun-daher-87140a42a",
                             "mailto:Maroundaher03@gmail.com"],
      "M1: targets %s" % _al_targets(outM1))
check(de.hyperlink_autolink(outM1) == outM1, "M1: not idempotent")

# M2: ordinary prose must never be linked. Abbreviations, file paths, version
# numbers and decimals all carry dots but none is a URL shape.
d = Document()
for t in ("Acme Inc. shipped in Q3, i.e. before the freeze, per the S.E.C. filing.",
          "Open src/main.py and lib/util.js, then bump to 2.10.3 (see notes).",
          "The ratio was 1.5 vs. 2.75 across e.g. Berlin, Paris and Rome.",
          "Contact the desk at extension 4021 or ask in the Monday sync."):
    d.add_paragraph(t)
before_text = full_text(d)
rM2, outM2 = run_autolink(d)
rootM2, linksM2 = _al_links(outM2)
check(len(linksM2) == 0, "M2: prose linked: %s" % [
    "".join(t.text or "" for t in lk.iter(f"{W_MAIN}t")) for lk in linksM2])
check(full_text(rM2) == before_text, "M2: stream changed")

# M3: sentence punctuation after a URL stays outside the hyperlink.
d = Document()
d.add_paragraph("Full details live at https://example.com/reports/2026-q1, "
                "and the mirror is www.example.org/mirror.")
rM3, outM3 = run_autolink(d)
rootM3, linksM3 = _al_links(outM3)
check(len(linksM3) == 2, "M3: expected 2 hyperlinks, got %d" % len(linksM3))
textsM3 = ["".join(t.text or "" for t in lk.iter(f"{W_MAIN}t")) for lk in linksM3]
check(textsM3 == ["https://example.com/reports/2026-q1", "www.example.org/mirror"],
      "M3: link text %s" % textsM3)
check(_al_targets(outM3) == ["https://example.com/reports/2026-q1",
                             "https://www.example.org/mirror"],
      "M3: targets %s" % _al_targets(outM3))
check(full_text(rM3).endswith("www.example.org/mirror."), "M3: trailing dot eaten")

# M4: an address pdf2docx split across three adjacent runs is wrapped once,
# with no character lost at the seams.
d = Document()
p_m4 = d.add_paragraph()
for frag in ("Write to ", "maroun", "daher03@gm", "ail.com today"):
    p_m4.add_run(frag)
rM4, outM4 = run_autolink(d)
rootM4, linksM4 = _al_links(outM4)
check(len(linksM4) == 1, "M4: expected 1 hyperlink, got %d" % len(linksM4))
_al_no_nesting(rootM4, "M4")
t4 = "".join(t.text or "" for t in linksM4[0].iter(f"{W_MAIN}t"))
check(t4 == "maroundaher03@gmail.com", "M4: link text %r" % t4)
check(full_text(rM4) == "Write to maroundaher03@gmail.com today",
      "M4: stream changed: %r" % full_text(rM4))

# M5: text already inside a w:hyperlink is left alone -- no second wrapper, no
# extra relationship, and the pass reports no change at all.
d = Document()
p_m5 = d.add_paragraph()
p_m5._p.append(parse_xml(
    f'<w:hyperlink {nsdecls("w", "r")} r:id="rId42"><w:r><w:rPr>'
    f'<w:rStyle w:val="Hyperlink"/></w:rPr>'
    f'<w:t>https://example.com/already</w:t></w:r></w:hyperlink>'))
buf_m5 = io.BytesIO()
d.save(buf_m5)
inM5 = buf_m5.getvalue()
outM5 = de.hyperlink_autolink(inM5)
check(outM5 == inM5, "M5: already-linked text was rewritten")
rootM5, linksM5 = _al_links(outM5)
check(len(linksM5) == 1, "M5: expected 1 hyperlink, got %d" % len(linksM5))
_al_no_nesting(rootM5, "M5")

# M6: the whole enhance() pipeline (autolink runs last) still emits schema-valid
# placement and leaves ordinary prose untouched.
d = Document()
d.add_paragraph("Maroun Daher")
d.add_paragraph("Beirut  |  maroundaher03@gmail.com  |  "
                "linkedin.com/in/maroun-daher-87140a42a")
d.add_paragraph("Acme Inc. shipped in Q3, i.e. before the freeze.")
buf_m6 = io.BytesIO()
d.save(buf_m6)
outM6 = de.enhance(buf_m6.getvalue())
rootM6, linksM6 = _al_links(outM6)
check(len(linksM6) == 2, "M6: expected 2 hyperlinks through enhance(), got %d"
      % len(linksM6))
_al_no_nesting(rootM6, "M6")
check("Acme Inc." in "".join(t.text or "" for t in rootM6.iter(f"{W_MAIN}t")),
      "M6: prose lost")


# ---- font_names cases (F) ---------------------------------------------------


def _font_pdf(lines):
    """lines: [(text, fitz fontname)] -> one-page pdf carrying those fonts."""
    pdf = fitz.open()
    pg = pdf.new_page(width=595, height=842)
    y = 80
    for text, fname in lines:
        pg.insert_text((72, y), text, fontsize=11, fontname=fname)
        y += 18
    return pdf


def _rfonts(out_bytes):
    root = _ET.fromstring(zipfile.ZipFile(io.BytesIO(out_bytes)).read("word/document.xml"))
    named = {}
    for r in root.iter(f"{W_MAIN}r"):
        txt = "".join(t.text or "" for t in r.findall(f"{W_MAIN}t"))
        if not txt.strip():
            continue
        rpr = r.find(f"{W_MAIN}rPr")
        rf = rpr.find(f"{W_MAIN}rFonts") if rpr is not None else None
        named[txt] = None if rf is None else (rf.get(f"{W_MAIN}ascii") or None)
    return named


# F1: PostScript name -> Word family, including the shapes that must map to
# nothing at all (system-internal, unnamed, digits-only).
for raw, want in [
    ("ABCDEF+Calibri-Bold", "Calibri"),
    ("HelveticaNeue-Bold", "Helvetica Neue"),
    ("HelveticaNeue", "Helvetica Neue"),
    ("ArialMT", "Arial"),
    ("Arial-BoldMT", "Arial"),
    ("TimesNewRomanPSMT", "Times New Roman"),
    ("Times-Roman", "Times New Roman"),
    ("JacobsChronos,Bold", "Jacobs Chronos"),
    ("JacobsChronosLight", "Jacobs Chronos"),
    ("BookAntiqua", "Book Antiqua"),
    ("Book-Antiqua", "Book Antiqua"),
    ("LMRoman10-Regular", "Latin Modern Roman"),
    ("SFHello-Semibold", "SF Hello"),
    (".SFNS-Regular_wdth_opsz1", None),
    ("Unnamed-T3", None),
    ("", None),
    (None, None),
    ("X", None),
    ("A" * 40, None),
]:
    got = de._font_family(raw)
    check(got == want, "F1: %r -> %r, want %r" % (raw, got, want))

# F2: no PDF => byte-identical no-op (the pass has no evidence to act on).
d = Document()
d.add_paragraph("Nothing to name here.")
buf = io.BytesIO()
d.save(buf)
raw = buf.getvalue()
check(de.font_names(raw, None) == raw, "F2: pass edited the docx without a PDF")

# F3: a run that already names a font is never touched, whether the name is a
# literal family or a theme reference; only the empty pdf2docx shape is filled.
pdf = _font_pdf([("Alpha beta gamma", "helv")])
d = Document()
p = d.add_paragraph()
p._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>'
    f'<w:t>Alpha</w:t></w:r>'))
p._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr>'
    f'<w:t xml:space="preserve"> beta</w:t></w:r>'))
p._p.append(parse_xml(
    f'<w:r {nsdecls("w")}><w:rPr><w:rFonts w:ascii="" w:hAnsi="" w:eastAsia=""/></w:rPr>'
    f'<w:t xml:space="preserve"> gamma</w:t></w:r>'))
buf = io.BytesIO()
d.save(buf)
out = de.font_names(buf.getvalue(), pdf)
got = _rfonts(out)
check(got["Alpha"] == "Georgia", "F3: overwrote a named font: %r" % got)
check(got[" beta"] is None, "F3: overwrote a theme font: %r" % got)
check(got[" gamma"] == "Helvetica", "F3: empty rFonts not filled: %r" % got)

# F4: one-family PDF names every text run (including one in a table and one
# with no rPr at all), leaves the blank run alone, and is idempotent.
pdf = _font_pdf([("Alpha beta gamma", "helv"), ("Delta epsilon", "helv")])
d = Document()
d.add_paragraph("Alpha beta gamma")
d.add_paragraph("   ")
d.add_paragraph()
t = d.add_table(rows=1, cols=1)
t.cell(0, 0).paragraphs[0].add_run("Delta epsilon")
buf = io.BytesIO()
d.save(buf)
out = de.font_names(buf.getvalue(), pdf)
got = _rfonts(out)
check(got.get("Alpha beta gamma") == "Helvetica", "F4: body run unnamed: %r" % got)
check(got.get("Delta epsilon") == "Helvetica", "F4: table run unnamed: %r" % got)
check("   " not in got, "F4: a blank run was named")
check(de.font_names(out, pdf) == out, "F4: not idempotent")

# F5: two families => each run takes the family of the span its text came from,
# and a run whose text the PDF does not carry stays unnamed rather than guess.
pdf = _font_pdf([("Alpha beta gamma", "helv"), ("Delta epsilon zeta", "tiro")])
d = Document()
d.add_paragraph("Alpha beta gamma")
d.add_paragraph("Delta epsilon zeta")
d.add_paragraph("Quixotic zzyzx jabberwock")
buf = io.BytesIO()
d.save(buf)
got = _rfonts(de.font_names(buf.getvalue(), pdf))
check(got.get("Alpha beta gamma") == "Helvetica", "F5: wrong family: %r" % got)
check(got.get("Delta epsilon zeta") == "Times New Roman", "F5: wrong family: %r" % got)
check(got.get("Quixotic zzyzx jabberwock") is None,
      "F5: guessed a family for text the PDF has no evidence for: %r" % got)

# F6: a PDF whose only font carries no family name leaves the docx byte-identical.
# (fitz rewrites an embedded font's name to its base name, so the unusable
# names this guards - system-internal, Unnamed-Tn - are staged directly.)
class _FontlessPage:
    def get_text(self, kind):
        return {"blocks": [{"lines": [{"spans": [
            {"text": "Alpha beta", "font": ".SFNS-Regular_wdth_opsz1"},
            {"text": "gamma delta", "font": "Unnamed-T3"}]}]}]}


pdf = [_FontlessPage()]
d = Document()
d.add_paragraph("Alpha beta")
buf = io.BytesIO()
d.save(buf)
raw = buf.getvalue()
check(de.font_names(raw, pdf) == raw, "F6: edited with no usable family in the PDF")

# F7: the pass only ever adds rFonts — text, styles and run count are untouched.
pdf = _font_pdf([("Alpha beta gamma", "helv")])
d = Document()
d.add_paragraph("Alpha beta gamma", style="Heading 1")
buf = io.BytesIO()
d.save(buf)
before = Document(io.BytesIO(buf.getvalue()))
after = Document(io.BytesIO(de.font_names(buf.getvalue(), pdf)))
check([p.text for p in before.paragraphs] == [p.text for p in after.paragraphs],
      "F7: text changed")
check([p.style.name for p in before.paragraphs] == [p.style.name for p in after.paragraphs],
      "F7: styles changed")
check(len(before.paragraphs[0].runs) == len(after.paragraphs[0].runs), "F7: run count changed")
# ---- section_rules / empty_para_prune cases (S, E) -------------------------
def rule_pdf_pages(pages):
    """pages: [(lines, rules)]; lines [(y, text)], rules [(y, x0, x1)], A4."""
    pdf = fitz.open()
    for lines, rules in pages:
        pg = pdf.new_page(width=595, height=842)
        for y, t in lines:
            pg.insert_text((72, y), t, fontsize=10)
        # one path per rule: a real PDF strokes each hairline separately, and
        # batching them into one shape would hide them behind a single tall
        # bounding rect
        for y, x0, x1 in rules:
            shape = pg.new_shape()
            shape.draw_rect(fitz.Rect(x0, y, x1, y + 0.8))
            shape.finish(fill=(0, 0, 0), color=None)
            shape.commit()
    return pdf


def rule_pdf(lines, rules):
    """One-page shorthand for rule_pdf_pages."""
    return rule_pdf_pages([(lines, rules)])


def run_rules(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.section_rules(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def bdr_texts(doc):
    out = []
    for p in doc.paragraphs:
        ppr = p._p.find(qn("w:pPr"))
        if ppr is not None and ppr.find(qn("w:pBdr")) is not None:
            out.append(p.text.strip())
    return out


def run_prune(doc):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.empty_para_prune(buf.getvalue())
    return Document(io.BytesIO(out)), out


# S1: a hairline under a short heading becomes that heading's bottom border
pdf = rule_pdf([(100, "SUMMARY"), (130, "One line of body text.")],
               [(104, 60, 540)])
d = Document()
d.add_paragraph("SUMMARY")
d.add_paragraph("One line of body text.")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == ["SUMMARY"], "S1: rule not re-emitted as a border: %r" % bdr_texts(r))
check(len(r.paragraphs) == 2, "S1: paragraph count changed")

# S2: the same rule already absorbed as the following table's top border =>
# adding a paragraph border would draw the line twice
pdf = rule_pdf([(100, "EDUCATION"), (130, "AUST")], [(104, 60, 540)])
d = Document()
d.add_paragraph("EDUCATION")
t = d.add_table(rows=1, cols=2)
t.cell(0, 0).text = "AUST"
t.cell(0, 0)._tc.get_or_add_tcPr().append(parse_xml(
    '<w:tcBorders %s><w:top w:val="single" w:sz="6" w:color="1A1A1A"/></w:tcBorders>'
    % nsdecls("w")))
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S2: duplicated an absorbed rule: %r" % bdr_texts(r))

# S2b: a borderless layout table below the heading does NOT block the rule
pdf = rule_pdf([(100, "EDUCATION"), (130, "AUST")], [(104, 60, 540)])
d = Document()
d.add_paragraph("EDUCATION")
t = d.add_table(rows=1, cols=2)
t.cell(0, 0).text = "AUST"
r, out = run_rules(d, pdf)
check(bdr_texts(r) == ["EDUCATION"], "S2b: borderless table blocked the rule")

# S3: a ruled grid (many hairlines on one page) is a table, not section furniture
lines = [(90 + 20 * i, "Row %d value" % i) for i in range(14)]
rules = [(94 + 20 * i, 60, 540) for i in range(14)]
pdf = rule_pdf(lines, rules)
d = Document()
for _, t in lines:
    d.add_paragraph(t)
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S3: fired on a ruled grid: %r" % bdr_texts(r)[:3])

# S4: a rule under a long prose line is an underline/strike artefact, not a
# section divider
prose = ("The committee reviewed every submission received before the closing "
         "date and published its findings in full.")
pdf = rule_pdf([(100, prose)], [(104, 60, 540)])
d = Document()
d.add_paragraph(prose)
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S4: fired on a prose line")

# S5: no PDF, no evidence, no change
d = Document()
d.add_paragraph("SUMMARY")
buf = io.BytesIO()
d.save(buf)
check(de.section_rules(buf.getvalue(), None) == buf.getvalue(),
      "S5: changed the document without a PDF")

# S6: pBdr lands in the CT_PPrBase sequence (before spacing/ind/jc) and an
# existing border is never doubled
pdf = rule_pdf([(100, "PROJECTS")], [(104, 60, 540)])
d = Document()
p = d.add_paragraph("PROJECTS")
p.paragraph_format.space_after = Pt(6)
p.paragraph_format.left_indent = Pt(12)
r, out = run_rules(d, pdf)
ppr = r.paragraphs[0]._p.find(qn("w:pPr"))
tags = [c.tag for c in ppr]
check(qn("w:pBdr") in tags, "S6: no border emitted")
check(tags.index(qn("w:pBdr")) < tags.index(qn("w:spacing")),
      "S6: pBdr out of schema order: %r" % [t.split('}')[1] for t in tags])
again = de.section_rules(out, pdf)
check(count_tag(again, "w:pBdr") == 1, "S6: border duplicated on a second run")

# S7: the anchor is consumed in reading order - a later paragraph repeating the
# heading text does not steal a second rule
pdf = rule_pdf([(100, "SKILLS"), (140, "SKILLS")], [(104, 60, 540)])
d = Document()
d.add_paragraph("SKILLS")
d.add_paragraph("SKILLS")
r, out = run_rules(d, pdf)
check(count_tag(out, "w:pBdr") == 1, "S7: one rule produced %d borders"
      % count_tag(out, "w:pBdr"))

# S8: an anchor is matched exactly, never as a prefix. A short page-header
# anchor whose words also open a body sentence must not draw a rule through
# the middle of that sentence.
pdf = rule_pdf([(100, "Transformers"), (130, "other text")], [(104, 60, 540)])
d = Document()
d.add_paragraph("Design notes")
d.add_paragraph("Transformers including outline and support point dimensions "
                "of enclosures and accessories, as scheduled.")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S8: prefix match ruled a body sentence: %r" % bdr_texts(r))

# S9: a line that anchors a rule on 3+ pages is a running page header, not
# section furniture - it is dropped even when a paragraph matches it exactly,
# while a real one-page section rule on the same document still fires.
pdf = rule_pdf_pages([
    ([(60, "Transformers"), (100, "SCOPE"), (140, "Body of the scope clause.")],
     [(64, 60, 540), (104, 60, 540)]),
    ([(60, "Transformers"), (100, "More body text on page two.")], [(64, 60, 540)]),
    ([(60, "Transformers"), (100, "More body text on page three.")], [(64, 60, 540)]),
])
d = Document()
d.add_paragraph("Transformers")
d.add_paragraph("SCOPE")
d.add_paragraph("Body of the scope clause.")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == ["SCOPE"], "S9: running header ruled or section rule lost: %r"
      % bdr_texts(r))

# S9b: two pages is not yet a running header - a rule repeated on a short
# document still fires on both of its anchors
pdf = rule_pdf_pages([
    ([(60, "NOTES"), (100, "First.")], [(64, 60, 540)]),
    ([(60, "NOTES"), (100, "Second.")], [(64, 60, 540)]),
])
d = Document()
d.add_paragraph("NOTES")
d.add_paragraph("First.")
d.add_paragraph("NOTES")
d.add_paragraph("Second.")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == ["NOTES", "NOTES"], "S9b: two pages treated as a running "
      "header: %r" % bdr_texts(r))

# --- E6: duplicated strokes, damaged anchors, and the rule's own weight -----
def rule_pdf_strokes(lines, strokes):
    """A page whose rules are STROKED lines, optionally more than once.

    strokes: [(y, x0, x1, colour, width, times)].  A real generator commonly
    lays the same hairline down twice (once per content-stream pass); PyMuPDF
    reports both, and the raw count used to look like a form grid.
    """
    pdf = fitz.open()
    pg = pdf.new_page(width=595, height=842)
    for y, t in lines:
        pg.insert_text((72, y), t, fontsize=10)
    for y, x0, x1, color, width, times in strokes:
        for _ in range(times):
            shape = pg.new_shape()
            shape.draw_line(fitz.Point(x0, y), fitz.Point(x1, y))
            shape.finish(color=color, width=width)
            shape.commit()
    return pdf


S_HEADS = ["CAREER OBJECTIVE", "EDUCATION", "TECHNICAL SKILLS",
           "ACADEMIC PROJECTS", "TRAINING & ACADEMIES",
           "ADDITIONAL EXPERIENCE", "SOFT SKILLS & LANGUAGES"]
S_GREY = (0.4, 0.4, 0.4)

# S10: the CV defect. Seven section rules, each stroked twice, is seven rules
# and not a fourteen-line grid: every heading gets its border.
lines, strokes = [], []
for i, h in enumerate(S_HEADS):
    lines.append((100 + 60 * i, h))
    lines.append((130 + 60 * i, "Body line %d." % i))
    strokes.append((104 + 60 * i, 60, 540, S_GREY, 0.75, 2))
pdf = rule_pdf_strokes(lines, strokes)
d = Document()
for _, t in lines:
    d.add_paragraph(t)
r, out = run_rules(d, pdf)
check(bdr_texts(r) == S_HEADS,
      "S10: doubled strokes lost the section rules: %r" % bdr_texts(r))

# S10b: and the double stroke produces ONE border per heading, not two
check(count_tag(out, "w:pBdr") == len(S_HEADS),
      "S10b: %d borders for %d rules" % (count_tag(out, "w:pBdr"), len(S_HEADS)))

# S11: the grid guard still holds after the dedupe - 13 DISTINCT hairlines is
# a ruled table however many times each one is stroked
lines, strokes = [], []
for i in range(13):
    lines.append((90 + 20 * i, "Row %d value" % i))
    strokes.append((94 + 20 * i, 60, 540, S_GREY, 0.75, 2))
pdf = rule_pdf_strokes(lines, strokes)
d = Document()
for _, t in lines:
    d.add_paragraph(t)
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S11: fired on a doubly-stroked grid: %r" % bdr_texts(r)[:3])

# S12: the anchor match survives the converter's own spacing damage - pdf2docx
# emits "TECHNICAL SKILLS" as "TECHNICALSKILLS" and it is still that heading
pdf = rule_pdf_strokes([(100, "TECHNICAL SKILLS"), (130, "C++, Java")],
                       [(104, 60, 540, S_GREY, 0.75, 1)])
d = Document()
d.add_paragraph("TECHNICALSKILLS")
d.add_paragraph("C++, Java")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == ["TECHNICALSKILLS"],
      "S12: welded heading lost its rule: %r" % bdr_texts(r))

# S12b: it is still WHOLE-line equality, not a prefix - a body sentence that
# merely opens with the anchor's words gets no rule through its middle
pdf = rule_pdf_strokes([(100, "SKILLS"), (130, "other")],
                       [(104, 60, 540, S_GREY, 0.75, 1)])
d = Document()
d.add_paragraph("Skills matrix and the competency levels behind it.")
d.add_paragraph("other")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S12b: squashed key matched a body sentence: %r"
      % bdr_texts(r))

# S12c: an anchor with almost no alphanumeric content ("1.", a bullet glyph)
# cannot identify a paragraph, so it is declined
pdf = rule_pdf_strokes([(100, "1."), (130, "1.")],
                       [(104, 60, 540, S_GREY, 0.75, 1)])
d = Document()
d.add_paragraph("1.")
d.add_paragraph("1.")
r, out = run_rules(d, pdf)
check(bdr_texts(r) == [], "S12c: a two-character anchor drew a rule: %r"
      % bdr_texts(r))


def s_bdr_style(doc):
    out = []
    for p in doc.paragraphs:
        ppr = p._p.find(qn("w:pPr"))
        pbdr = ppr.find(qn("w:pBdr")) if ppr is not None else None
        if pbdr is None:
            continue
        b = pbdr.find(qn("w:bottom"))
        out.append((b.get(qn("w:sz")), b.get(qn("w:color"))))
    return out


# S13: weight and colour come from the stroke itself, so a re-emitted rule
# matches the one pdf2docx absorbed as a table border on the same page
pdf = rule_pdf_strokes([(100, "SUMMARY"), (130, "body")],
                       [(104, 60, 540, S_GREY, 0.75, 2)])
d = Document()
d.add_paragraph("SUMMARY")
d.add_paragraph("body")
r, out = run_rules(d, pdf)
check(s_bdr_style(r) == [("6", "666666")],
      "S13: border style not taken from the stroke: %r" % s_bdr_style(r))

# S13b: a hairline thinner than a quarter point clamps to the thinnest border
# Word will draw rather than emitting w:sz="0" (which draws nothing)
pdf = rule_pdf_strokes([(100, "SUMMARY"), (130, "body")],
                       [(104, 60, 540, (0, 0, 0), 0.1, 1)])
d = Document()
d.add_paragraph("SUMMARY")
d.add_paragraph("body")
r, out = run_rules(d, pdf)
check(s_bdr_style(r) == [("2", "000000")],
      "S13c: thin stroke not clamped: %r" % s_bdr_style(r))

# E1: leading and trailing empties go, a run between blocks collapses to one
d = Document()
d.add_paragraph("")
d.add_paragraph("First block.")
for _ in range(3):
    d.add_paragraph("")
d.add_paragraph("Second block.")
d.add_paragraph("")
d.add_paragraph("")
r, out = run_prune(d)
kinds = ["T" if p.text.strip() else "_" for p in r.paragraphs]
check(kinds == ["T", "_", "T"], "E1: prune shape %r" % kinds)

# E2: an empty-looking paragraph that carries a drawing, a break or a border is
# load-bearing and survives
d = Document()
d.add_paragraph("Text.")
img = d.add_paragraph()
img._p.append(parse_xml(
    '<w:r %s><w:br/></w:r>' % nsdecls("w")))
bordered = d.add_paragraph()
bordered._p.get_or_add_pPr().append(parse_xml(
    '<w:pBdr %s><w:bottom w:val="single" w:sz="6" w:color="auto"/></w:pBdr>'
    % nsdecls("w")))
d.add_paragraph("More text.")
r, out = run_prune(d)
check(count_tag(out, "w:br") == 1, "E2: dropped a paragraph carrying a break")
check(count_tag(out, "w:pBdr") == 1, "E2: dropped a bordered rule paragraph")

# E3: the section-break paragraph is never deleted, and the padding around it is
d = Document()
d.add_paragraph("Page one.")
d.add_paragraph("")
brk = d.add_paragraph()
brk._p.get_or_add_pPr().append(parse_xml(
    '<w:sectPr %s><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' % nsdecls("w")))
d.add_paragraph("")
d.add_paragraph("Page two.")
r, out = run_prune(d)
sect_paras = [p for p in r.paragraphs
              if p._p.find(qn("w:pPr")) is not None
              and p._p.find(qn("w:pPr")).find(qn("w:sectPr")) is not None]
check(len(sect_paras) == 1, "E3: the section break was deleted")
kinds = ["T" if p.text.strip() else "_" for p in r.paragraphs]
check(kinds == ["T", "_", "T"], "E3: padding around the break survived: %r" % kinds)

# E4: an NBSP-only paragraph is content, not blankness
d = Document()
d.add_paragraph("A.")
d.add_paragraph(" ")
d.add_paragraph("B.")
r, out = run_prune(d)
check(len(r.paragraphs) == 3, "E4: dropped an NBSP paragraph")

# E5: a cell must keep its paragraphs - an empty cell that loses its only
# paragraph is invalid OOXML
d = Document()
t = d.add_table(rows=1, cols=2)
t.cell(0, 0).text = "x"
r, out = run_prune(d)
check(len(r.tables[0].cell(0, 1).paragraphs) == 1, "E5: emptied a table cell")

# E6: a document with nothing to prune comes back byte-identical
d = Document()
d.add_paragraph("Only text.")
buf = io.BytesIO()
d.save(buf)
check(de.empty_para_prune(buf.getvalue()) == buf.getvalue(),
      "E6: rewrote a document with no stray empties")

# ---- list_hanging_indent cases (L) ----------------------------------------
# The CV defect: pdf2docx numbers the bullets but gives the list no hanging
# indent, leaves each paragraph a different left indent (4 twips / 96 twips) and
# drops a stray w:right on one item.  Geometry has to come from the PDF, and no
# document that does not exhibit the defect may be touched.
LI_MARK_X, LI_TEXT_X = 43.5, 54.75          # the CV's own bullet geometry
LI_PG_W, LI_PG_H = 595.0, 842.0
LI_MAR_L, LI_MAR_R = 856, 810               # twips, as pdf2docx wrote them


def li_pdf(n_marks=4, mark_x=LI_MARK_X, text_x=LI_TEXT_X, glyph=None,
           page_w=LI_PG_W):
    """A page drawing n bullets: vector squares by default, typed glyphs when
    `glyph` is given.  Text always starts at text_x."""
    pdf = fitz.open()
    pg = pdf.new_page(width=page_w, height=LI_PG_H)
    for i in range(n_marks):
        y = 200.0 + 30.0 * i
        if glyph:
            pg.insert_text((mark_x, y), glyph, fontsize=9.5)
        else:
            shape = pg.new_shape()
            shape.draw_rect(fitz.Rect(mark_x, y - 3.0, mark_x + 3.0, y))
            shape.finish(fill=(0, 0, 0), color=None)
            shape.commit()
        pg.insert_text((text_x, y), "Bullet item number %d here" % i, fontsize=9.5)
    return pdf


def li_frame(doc, page_w_tw=int(LI_PG_W * 20)):
    sect = doc.element.body.find(qn("w:sectPr"))
    for tag, attrs in (("w:pgSz", {"w:w": str(page_w_tw), "w:h": str(int(LI_PG_H * 20))}),
                       ("w:pgMar", {"w:left": str(LI_MAR_L), "w:right": str(LI_MAR_R),
                                    "w:top": "400", "w:bottom": "400",
                                    "w:header": "720", "w:footer": "720",
                                    "w:gutter": "0"})):
        el = sect.find(qn(tag))
        if el is None:
            el = parse_xml("<%s %s/>" % (tag, nsdecls("w")))
            sect.insert(0, el)
        for k, v in attrs.items():
            el.set(qn(k), v)


def li_item(doc, text, nid, left, right=0, ilvl=0):
    p = doc.add_paragraph(text)
    de._set_numpr(p, ilvl, nid)
    ppr = p._p.get_or_add_pPr()
    ind = parse_xml('<w:ind %s w:left="%d" w:right="%d" w:firstLine="0"/>'
                    % (nsdecls("w"), left, right))
    ppr.append(ind)
    return p


def li_ind(p):
    ppr = p._p.find(qn("w:pPr"))
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    if ind is None:
        return None
    return tuple(int(ind.get(qn(k)) or 0) for k in ("w:left", "w:hanging", "w:right"))


def run_li(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.list_hanging_indent(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


LI_UNTOUCHED = [(4, 0, 0), (96, 0, 720), (4, 0, 288), (4, 0, 0)]


def li_case(kind="bul", lefts=(4, 96, 4, 4), rights=(0, 720, 288, 0)):
    d = Document()
    li_frame(d)
    nid = de._add_num(de._numbering_root(d), kind)
    for i, (lf, rt) in enumerate(zip(lefts, rights)):
        li_item(d, "Bullet item number %d here" % i, nid, lf, rt)
    return d, nid


# L1: the geometry the PDF draws lands on every paragraph, identically, and the
# stray right indent is gone
d, nid = li_case()
r, out = run_li(d, li_pdf())
inds = [li_ind(p) for p in r.paragraphs]
check(len(set(inds)) == 1, "L1: list paragraphs still disagree on indent: %r" % (inds,))
left, hang, right = inds[0]
check(abs(hang - 225) <= 10, "L1: hanging %r is not the drawn 11.25pt" % (hang,))
check(abs(left - 239) <= 10, "L1: left %r is not the drawn text x" % (left,))
check(right == 0, "L1: the stray right indent survived: %r" % (right,))

# L1b: the numbering level carries the same hanging, so an item typed in Word
# after conversion inherits it
num_root = de._numbering_root(Document(io.BytesIO(out)))
hung = []
for a in num_root.findall(qn("w:abstractNum")):
    lvl = de._li_lvl(a, 0)
    ppr = lvl.find(qn("w:pPr")) if lvl is not None else None
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    if ind is not None and ind.get(qn("w:hanging")) == str(hang):
        hung.append(a)
check(len(hung) == 1, "L1b: the numbering level did not get the hanging indent")

# L2: no PDF, no geometry, no edit - byte-identical
d, nid = li_case()
buf = io.BytesIO()
d.save(buf)
check(de.list_hanging_indent(buf.getvalue()) == buf.getvalue(),
      "L2: rewrote the document without any PDF geometry")

# L3: numbering that already states its own indent is left alone
d, nid = li_case()
abs_el = de._li_num_map(de._numbering_root(d))[str(nid)]
de._li_lvl(abs_el, 0).append(parse_xml(
    '<w:pPr %s><w:ind w:left="1440" w:hanging="360"/></w:pPr>' % nsdecls("w")))
r, out = run_li(d, li_pdf())
check([li_ind(p) for p in r.paragraphs] == LI_UNTOUCHED,
      "L3: overwrote a list that already declares its own indent")

# L4: ordered lists are not bullet geometry and are never touched
d, nid = li_case(kind="ord")
r, out = run_li(d, li_pdf())
check([li_ind(p) for p in r.paragraphs] == LI_UNTOUCHED,
      "L4: applied bullet geometry to a numbered list")

# L5: prose is out of reach - a paragraph without numPr keeps its indent
d, nid = li_case()
prose = d.add_paragraph("A quoted block indented on purpose, not a list item.")
prose._p.get_or_add_pPr().append(parse_xml(
    '<w:ind %s w:left="720" w:right="720" w:firstLine="360"/>' % nsdecls("w")))
r, out = run_li(d, li_pdf())
check(li_ind(r.paragraphs[-1]) == (720, 0, 720),
      "L5: rewrote a non-list paragraph: %r" % (li_ind(r.paragraphs[-1]),))
check(r.paragraphs[-1]._p.find(qn("w:pPr")).find(qn("w:ind")).get(qn("w:firstLine")) == "360",
      "L5: dropped a real first-line indent from prose")

# L6: one mark is a decoration, not a list - too little evidence to act on
d, nid = li_case()
r, out = run_li(d, li_pdf(n_marks=1))
check([li_ind(p) for p in r.paragraphs] == LI_UNTOUCHED,
      "L6: derived a list geometry from a single mark")

# L7: the right indent is lower-only - a right indent every sibling shares is a
# real one and must survive, even when the drawn text runs wider
d, nid = li_case(rights=(576, 576, 576, 576))
r, out = run_li(d, li_pdf())
rights = {li_ind(p)[2] for p in r.paragraphs}
check(rights == {576}, "L7: raised or dropped a right indent the whole list shares: %r"
      % (rights,))

# L8: a docx page that does not match the PDF page carries a scale this pass
# cannot invert - no-op rather than a guess
d, nid = li_case()
li_frame(d, page_w_tw=int(LI_PG_W * 20 * 1.5))
r, out = run_li(d, li_pdf())
check([li_ind(p) for p in r.paragraphs] == LI_UNTOUCHED,
      "L8: derived an indent across a page-scale mismatch")

# L9: a typed bullet glyph gives the same geometry as a drawn one
d, nid = li_case()
r, out = run_li(d, li_pdf(glyph="•"))
inds = {li_ind(p) for p in r.paragraphs}
check(len(inds) == 1, "L9: typed-glyph bullets left the list inconsistent: %r" % (inds,))
check(list(inds)[0][1] > 0, "L9: typed-glyph bullets produced no hanging indent")

# L10: a mark drawn to the RIGHT of its text is not a bullet, so no geometry
d, nid = li_case()
r, out = run_li(d, li_pdf(mark_x=300.0, text_x=54.75))
check([li_ind(p) for p in r.paragraphs] == LI_UNTOUCHED,
      "L10: took a mark that sits right of its own text as a bullet")


# ---- list_wrap_merge cases (W) ---------------------------------------------
# The CV defect: pdf2docx cuts a wrapped bullet into a numbered paragraph plus a
# plain, hand-indented orphan carrying the rest of the sentence, so the item
# never reflows when edited.  The merge is authorised only when the PDF shows
# the two as consecutive lines INSIDE one block; every other shape is a no-op.
WM_X, WM_SIZE = 54.75, 9.5
WM_A = "Intensive training in React and React Native for web applications"
WM_B = "and routing REST API integration and performance optimisation."


def wm_pdf(blocks, gap=60.0, x=WM_X):
    """One page; each inner list becomes one MuPDF text block (the big vertical
    gap between them is what forces the split — asserted by W2)."""
    pdf = fitz.open()
    pg = pdf.new_page(width=595.0, height=842.0)
    y = 100.0
    for lines in blocks:
        for ln in lines:
            pg.insert_text((x, y), ln, fontsize=WM_SIZE)
            y += 11.0
        y += gap
    return pdf


def wm_doc(anchor=WM_A, orphan=WM_B, numbered=True, style=None, spacer=False,
           png=None, orphan_numbered=False):
    d = Document()
    nid = de._add_num(de._numbering_root(d), "bul")
    a = d.add_paragraph(anchor)
    if numbered:
        de._set_numpr(a, 0, nid)
    if spacer:
        d.add_paragraph("")
    o = d.add_paragraph(orphan, style=style) if style else d.add_paragraph(orphan)
    if orphan_numbered:
        de._set_numpr(o, 0, nid)
    if png:
        o.add_run().add_picture(io.BytesIO(png), width=Pt(4))
    o._p.get_or_add_pPr().append(parse_xml(
        '<w:ind %s w:left="240" w:firstLine="0"/>' % nsdecls("w")))
    return d


def run_wm(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.list_wrap_merge(buf.getvalue(), pdf)
    return Document(io.BytesIO(out))


WM_ONE_BLOCK = wm_pdf([[WM_A, WM_B]])
WM_TWO_BLOCKS = wm_pdf([[WM_A], [WM_B]])

# W1: the CV shape - the orphan is folded into the list paragraph, seam spaced,
# nothing else left behind
r = run_wm(wm_doc(), WM_ONE_BLOCK)
check(len(r.paragraphs) == 1, "W1: orphan paragraph survived: %d paragraphs"
      % (len(r.paragraphs),))
check(r.paragraphs[0].text == WM_A + " " + WM_B,
      "W1: merged text is wrong: %r" % (r.paragraphs[0].text,))
check(has_numpr(r.paragraphs[0]), "W1: the merged paragraph lost its numbering")

# W2: the orphan starts its own PDF block - a real new paragraph, never merged
r = run_wm(wm_doc(), WM_TWO_BLOCKS)
check(len(r.paragraphs) == 2, "W2: merged across a PDF block boundary")

# W3: an upper-case start after a finished sentence is a new paragraph, even
# when the PDF wrapped it inside one block
a3 = "Closed 8 transactions in 5 months generating revenue in total."
b3 = "Secured a 3-month exclusive mandate on a development project."
r = run_wm(wm_doc(a3, b3), wm_pdf([[a3, b3]]))
check(len(r.paragraphs) == 2, "W3: swallowed a new capitalised sentence")

# W3b: lower-case is not enough on its own - a terminated anchor still declines
a3b = WM_A + "."
r = run_wm(wm_doc(a3b, WM_B), wm_pdf([[a3b, WM_B]]))
check(len(r.paragraphs) == 2, "W3b: merged past a sentence-ending period")

# W4: the previous paragraph is prose, not a list item - out of scope
r = run_wm(wm_doc(numbered=False), WM_ONE_BLOCK)
check(len(r.paragraphs) == 2, "W4: merged into a paragraph that is not a list item")

# W5: the orphan is a heading - never merged, whatever the PDF says
r = run_wm(wm_doc(orphan="and routing rest api integration", style="Heading 2"),
           wm_pdf([[WM_A, "and routing rest api integration"]]))
check(len(r.paragraphs) == 2, "W5: swallowed a styled heading")

# W6: the orphan carries a drawing (a rasterised glyph pdf2docx left inline) -
# a list item of its own, not a continuation
r = run_wm(wm_doc(png=TINY_PNG), WM_ONE_BLOCK)
check(len(r.paragraphs) == 2, "W6: swallowed a paragraph holding a drawing")

# W6b: an orphan that is already a list item is another bullet, not a wrap
r = run_wm(wm_doc(orphan_numbered=True), WM_ONE_BLOCK)
check(len(r.paragraphs) == 2, "W6b: merged two numbered list items together")

# W7: the following PDF line opens with a bullet glyph - a second item that
# merely lost its number, which list_numbering owns
r = run_wm(wm_doc(), wm_pdf([[WM_A, "• " + WM_B]]))
check(len(r.paragraphs) == 2, "W7: merged a line that draws its own bullet glyph")

# W8: no PDF - no evidence, no merge
d = wm_doc()
buf = io.BytesIO()
d.save(buf)
check(de.list_wrap_merge(buf.getvalue(), None) == buf.getvalue(),
      "W8: acted without the source PDF")

# W9: a paragraph sits between the item and the orphan - not a continuation
r = run_wm(wm_doc(spacer=True), WM_ONE_BLOCK)
check(len(r.paragraphs) == 3, "W9: merged across an intervening paragraph")

# W10: the docx text is not what the PDF block spells - the two are not the
# same content and must not be joined on shape alone
r = run_wm(wm_doc(orphan="and something the source page never printed here"),
           WM_ONE_BLOCK)
check(len(r.paragraphs) == 2, "W10: merged text absent from the PDF block")

# W11: a hyphen seam can flip meaning (re-sign / resign) - always declines
a11, b11 = WM_A + " re-", "sign the mandate before the end of the quarter."
r = run_wm(wm_doc(a11, b11), wm_pdf([[a11, b11]]))
check(len(r.paragraphs) == 2, "W11: fused a hyphenated line seam")

# W12: a two-word tail is too weak an anchor to identify a line
a12, b12 = "the full", "cycle from first contact to contract signing."
r = run_wm(wm_doc(a12, b12), wm_pdf([[a12, b12]]))
check(len(r.paragraphs) == 2, "W12: matched on a two-token anchor")

# W13: a document with no such shape at all is byte-identical
d = Document()
d.add_paragraph("An ordinary paragraph.")
d.add_paragraph("Another ordinary paragraph.")
buf = io.BytesIO()
d.save(buf)
check(de.list_wrap_merge(buf.getvalue(), WM_ONE_BLOCK) == buf.getvalue(),
      "W13: rewrote a document holding no wrapped list item")

# ---- tab_stop_normalize cases (TS) -----------------------------------------
# The CV shape: three date lines are flush right on a RIGHT stop written by
# date_column_untable, the fourth (never a table) carries pdf2docx's LEFT stop
# at the x it measured, so it floats short of the margin, and the line below it
# inherited that stop without ever using it.  TS_WIDTH is the text column,
# read off the template rather than hard-coded, so a template change cannot
# quietly move the cases out of the right zone.
_TS_SEC = Document().sections[0]
TS_WIDTH = int(round(
    (_TS_SEC.page_width - _TS_SEC.left_margin - _TS_SEC.right_margin) / 635))
TS_FAR = int(TS_WIDTH * 0.95)      # in the right zone, short of the margin
TS_MID = int(TS_WIDTH * 0.40)      # a real mid-line column stop
TS_LABEL = "ETSTC - Technical Education Institution, Lebanon"
TS_DATE = "2020 - 2023"


def ts_stops(p, stops):
    if not stops:
        return
    inner = "".join('<w:tab w:val="%s" w:pos="%d"/>' % (v, pos) for v, pos in stops)
    p._p.get_or_add_pPr().append(
        parse_xml("<w:tabs %s>%s</w:tabs>" % (nsdecls("w"), inner)))


def ts_tab(p):
    p._p.append(parse_xml("<w:r %s><w:tab/></w:r>" % nsdecls("w")))


def ts_doc(stops=(("left", TS_FAR),), head=TS_LABEL, tail=TS_DATE, tabs=1,
           numpr=False, extra=None):
    d = Document()
    p = d.add_paragraph()
    if head:
        p.add_run(head)
    for i in range(tabs):
        ts_tab(p)
        if i < tabs - 1:
            p.add_run("middle")
    if tail:
        p.add_run(tail)
    ts_stops(p, stops)
    if numpr:
        de._set_numpr(p, 0, de._add_num(de._numbering_root(d), "bul"))
    if extra is not None:
        extra(d, p)
    return d


def run_ts(d):
    buf = io.BytesIO()
    d.save(buf)
    out = de.tab_stop_normalize(buf.getvalue())
    return Document(io.BytesIO(out)), out, buf.getvalue()


def ts_read(doc, i=0):
    p = doc.paragraphs[i]._p
    ppr = p.find(qn("w:pPr"))
    tabs = ppr.find(qn("w:tabs")) if ppr is not None else None
    if tabs is None:
        return None
    return [(t.get(qn("w:val")), int(t.get(qn("w:pos"))))
            for t in tabs if t.tag == qn("w:tab")]


# TS1: pdf2docx's left stop deep in the right zone becomes a right stop at the
# text-column edge - the only shape that stays flush right in any font
r, _, _ = run_ts(ts_doc())
check(ts_read(r) == [("right", TS_WIDTH)],
      "TS1: left date stop not right-aligned at the margin: %r" % (ts_read(r),))

# TS2: a right stop short of the edge (date_column_untable measures the row,
# not the margin) is pulled onto the margin so every date line agrees
r, _, _ = run_ts(ts_doc(stops=(("right", TS_FAR),)))
check(ts_read(r) == [("right", TS_WIDTH)],
      "TS2: right stop left off the text margin: %r" % (ts_read(r),))

# TS3: a stop in the middle of the line is a real column, not a right margin
r, _, _ = run_ts(ts_doc(stops=(("left", TS_MID),)))
check(ts_read(r) == [("left", TS_MID)],
      "TS3: rewrote a mid-line column stop: %r" % (ts_read(r),))

# TS4: two tab characters is a multi-column row, not label + date
r, _, _ = run_ts(ts_doc(tabs=2))
check(ts_read(r) == [("left", TS_FAR)],
      "TS4: rewrote a two-tab row: %r" % (ts_read(r),))

# TS5: a stop no tab character uses (fused_line_split copies the pPr onto the
# half it cuts off) is dropped, w:tabs and all
r, _, _ = run_ts(ts_doc(tabs=0, head="Technical Baccalaureate (BT3)", tail=""))
check(ts_read(r) is None, "TS5: phantom tab stop survived: %r" % (ts_read(r),))

# TS6: on a list item the same unused stop is the number-to-text gap that
# list_hanging_indent owns - never touched
r, _, _ = run_ts(ts_doc(stops=(("left", 240),), tabs=0, tail="", numpr=True))
check(ts_read(r) == [("left", 240)],
      "TS6: stripped a list item's hanging-indent stop: %r" % (ts_read(r),))

# TS7: a long tail is a second column of prose, not a date
r, _, _ = run_ts(ts_doc(tail="a tail far too long to be a date column entry, "
                             "so it is prose in a second column"))
check(ts_read(r) == [("left", TS_FAR)],
      "TS7: rewrote a stop in front of a prose tail: %r" % (ts_read(r),))

# TS8: nothing before the tab - an indent gesture, not a label/date pair
r, _, _ = run_ts(ts_doc(head=""))
check(ts_read(r) == [("left", TS_FAR)],
      "TS8: rewrote a leading-tab indent: %r" % (ts_read(r),))

# TS9: two stops is a real tab grid
r, _, _ = run_ts(ts_doc(stops=(("left", TS_MID), ("left", TS_FAR))))
check(ts_read(r) == [("left", TS_MID), ("left", TS_FAR)],
      "TS9: rewrote one stop of a two-stop grid: %r" % (ts_read(r),))

# TS10: a w:val="clear" stop cancels an inherited stop - leave it saying so
r, _, _ = run_ts(ts_doc(stops=(("clear", TS_FAR),)))
check(ts_read(r) == [("clear", TS_FAR)],
      "TS10: rewrote a clear stop: %r" % (ts_read(r),))

# TS11: trailing whitespace baked into the last run is stripped, and a run that
# holds nothing else goes with it
d = Document()
p = d.add_paragraph()
p.add_run("Baouchrieh, Lebanon  |  +961 81 527 424")
p.add_run("   ")
r, _, _ = run_ts(d)
check(r.paragraphs[0].text == "Baouchrieh, Lebanon  |  +961 81 527 424",
      "TS11: trailing whitespace survived: %r" % (r.paragraphs[0].text,))
check(len(r.paragraphs[0].runs) == 1,
      "TS11: the whitespace-only run survived: %d runs"
      % (len(r.paragraphs[0].runs),))

# TS11b: the same on the date line, where the stop is rewritten in the same pass
r, _, _ = run_ts(ts_doc(head=TS_LABEL + " ", tail=TS_DATE + " "))
check(r.paragraphs[0].text == TS_LABEL + " \t" + TS_DATE,
      "TS11b: date line not rstripped / head damaged: %r"
      % (r.paragraphs[0].text,))

# TS12: whitespace in FRONT of a tab is date_column_untable's deliberate seam
# space - the only thing keeping a w:t-only extractor from welding the label
# onto the date. It must survive.
r, _, _ = run_ts(ts_doc(head=TS_LABEL + " "))
check(r.paragraphs[0].text.startswith(TS_LABEL + " \t"),
      "TS12: ate the seam space in front of the tab: %r"
      % (r.paragraphs[0].text,))

# TS13: a paragraph that is only whitespace is empty_para_prune's call, and a
# document with nothing to normalise comes back byte-identical
d = Document()
d.add_paragraph("   ")
d.add_paragraph("An ordinary paragraph with no tabs and no dangling space.")
_, out, src = run_ts(d)
check(out == src, "TS13: rewrote a document holding neither tabs nor whitespace")

# TS14: whitespace in front of a trailing break/picture is positioning, not
# dangling text
def _ts_br(d, p):
    p.add_run(" ")
    p._p.append(parse_xml("<w:r %s><w:br/></w:r>" % nsdecls("w")))


d = ts_doc(stops=None, tabs=0, head="Line one", tail="", extra=_ts_br)
_, out, src = run_ts(d)
check(out == src, "TS14: stripped whitespace held in place by a trailing break")

# TS15: a trailing space inside a hyperlink is stripped and the link survives
d = Document()
p = d.add_paragraph()
p.add_run("mail: ")
p._p.append(parse_xml(
    '<w:hyperlink %s r:id="rId99"><w:r><w:t xml:space="preserve">a@b.com </w:t>'
    "</w:r></w:hyperlink>" % nsdecls("w", "r")))
r, out, _ = run_ts(d)
check(full_text(r) == "mail: a@b.com",
      "TS15: hyperlink text not rstripped: %r" % (full_text(r),))
check(count_tag(out, "w:hyperlink") == 1, "TS15: lost the hyperlink")

# TS16: no text is ever lost - the CV line keeps every token it arrived with
r, _, _ = run_ts(ts_doc())
check(r.paragraphs[0].text == TS_LABEL + "\t" + TS_DATE,
      "TS16: text changed beyond whitespace: %r" % (r.paragraphs[0].text,))

# TS17: pdf2docx writes pgMar left/right = 0 on some documents and positions
# everything by absolute indent instead. There pgSz - pgMar is the PAPER edge,
# not a text column, and a footer page number already sitting a few points in
# would be shoved into the printer's unprintable border. No text margin, no
# rewrite - whatever stop the paragraph arrived with is the best guess there is.
def _ts_nomargin(d, p):
    sec = d.sections[0]
    sec.left_margin = 0
    sec.right_margin = 0


r, _, _ = run_ts(ts_doc(extra=_ts_nomargin))
check(ts_read(r) == [("left", TS_FAR)],
      "TS17: rewrote a stop against a zero-margin page edge: %r" % (ts_read(r),))

# TS17b: the same for a stop that was ALREADY right - the applepay footer shape
r, _, _ = run_ts(ts_doc(stops=(("right", TS_FAR),), extra=_ts_nomargin))
check(ts_read(r) == [("right", TS_FAR)],
      "TS17b: moved an already-right stop onto a zero-margin page edge: %r"
      % (ts_read(r),))

# TS18: dropping a stop nothing uses needs no margin to reason about, so that
# rule still fires on a zero-margin document
r, _, _ = run_ts(ts_doc(tabs=0, head="Technical Baccalaureate (BT3)", tail="",
                        extra=_ts_nomargin))
check(ts_read(r) is None,
      "TS18: phantom stop survived on a zero-margin page: %r" % (ts_read(r),))

# TS19: a sectPr rides on the LAST paragraph of its own section, so the section
# governing a paragraph is the first one recorded at or after it. Reading the
# NEXT sectPr instead would align this line to the wrong column.
d = Document()
p = d.add_paragraph()
p.add_run(TS_LABEL)
ts_tab(p)
p.add_run(TS_DATE)
ts_stops(p, (("left", 12312),))      # 0.95 of this section's own 12960
p._p.get_or_add_pPr().append(parse_xml(
    '<w:sectPr %s><w:pgSz w:w="15840" w:h="12240"/>'
    '<w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/>'
    "</w:sectPr>" % nsdecls("w")))
d.add_paragraph("second section body")   # the trailing sectPr is 9360 wide
r, _, _ = run_ts(d)
check(ts_read(r) == [("right", 12960)],
      "TS19: aligned to the wrong section's text column: %r" % (ts_read(r),))

# ---- br_row_split cases (S) -------------------------------------------------
# A pdf2docx weld of two independent "Label: value" rows must become two
# paragraphs; every other w:br in the corpus must survive untouched.

def run_split(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.br_row_split(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def s_pdf(rows):
    """rows: [(y, text)] on one A4 page at 9pt, x=72."""
    return make_pdf([[(y, t) for y, t in rows]])


def s_doc(paras, welded, bold=True):
    """paras: list of (text, is_welded_pair). A welded entry is a tuple of the
    two segments joined by a w:br, exactly as pdf2docx emits it."""
    d = Document()
    for entry in paras:
        para = d.add_paragraph()
        para.paragraph_format.space_before = Pt(6)
        if isinstance(entry, tuple):
            r = para.add_run(entry[0])
            r.bold = bold
            para.add_run().add_break()
            r2 = para.add_run(entry[1])
            r2.bold = bold
        else:
            r = para.add_run(entry)
            r.bold = bold
    return d


S_L = "Languages: Python, SQL"
S_W = "Web and Mobile: React Native"
S_A = "AI and Vision: TensorFlow, PyTorch"
S_D = "Databases and Tools: SQLite, Git"

# S1: the CV shape -- welded label rows split, siblings' spacing inherited
pdf = s_pdf([(100, S_L), (140, S_W), (152, S_A), (192, S_D)])
d = s_doc([S_L, (S_W, S_A), S_D], True)
r, out = run_split(d, pdf)
texts = [x.text for x in r.paragraphs]
check(texts == [S_L, S_W, S_A, S_D], "S1: rows not split into siblings: %r" % texts)
check(count_tag(out, "w:br") == 0, "S1: w:br left behind")
check(all(x.runs and x.runs[0].bold for x in r.paragraphs),
      "S1: run formatting lost on split")
sp = [x.paragraph_format.space_before for x in r.paragraphs]
check(len(set(v.twips for v in sp)) == 1,
      "S1: split row did not inherit sibling spacing: %r" % sp)

# S2: wrapped prose with a soft break -- one logical paragraph, never split
P1 = "The committee met on Tuesday to review the quarterly figures and"
P2 = "agreed that the revised forecast should be circulated before Friday."
pdf = s_pdf([(100, P1), (112, P2), (152, S_D)])
d = s_doc([(P1, P2), S_D], True)
r, out = run_split(d, pdf)
check(len(r.paragraphs) == 2, "S2: prose soft break was split")
check(count_tag(out, "w:br") == 1, "S2: prose w:br removed")

# S3: forced wrap of a long label row -- the next word had no room, keep it
LONG1 = ("Responsibilities: designed and shipped the reporting service, the "
         "ingest workers and the")
LONG2 = "Operations: nightly reconciliation of the ledger against the warehouse"
pdf = s_pdf([(100, LONG1), (112, LONG2), (152, S_D)])
d = s_doc([(LONG1, LONG2), S_D], True)
r, out = run_split(d, pdf)
check(count_tag(out, "w:br") == 1, "S3: forced wrap was split")

# S4: no adjacent standalone row of the same shape -- no sibling, no split
pdf = s_pdf([(100, S_W), (112, S_A)])
d = s_doc([(S_W, S_A)], True)
r, out = run_split(d, pdf)
check(count_tag(out, "w:br") == 1, "S4: split without sibling evidence")

# S5: the two rows sit far apart -- a gap, not normal leading
pdf = s_pdf([(100, S_L), (140, S_W), (185, S_A), (225, S_D)])
d = s_doc([S_L, (S_W, S_A), S_D], True)
r, out = run_split(d, pdf)
check(count_tag(out, "w:br") == 1, "S5: split across a paragraph gap")

# S6: a page break is never a row boundary
pdf = s_pdf([(100, S_L), (140, S_W), (152, S_A), (192, S_D)])
d = Document()
d.add_paragraph(S_L)
para = d.add_paragraph()
para.add_run(S_W)
para.add_run()._r.append(parse_xml('<w:br %s w:type="page"/>' % nsdecls("w")))
para.add_run(S_A)
d.add_paragraph(S_D)
r, out = run_split(d, pdf)
check(count_tag(out, "w:br") == 1, "S6: page break consumed")

# S7: a br inside a w:hyperlink is out of reach and must stay
pdf = s_pdf([(100, S_L), (140, S_W), (152, S_A), (192, S_D)])
d = Document()
d.add_paragraph(S_L)
para = d.add_paragraph()
para._p.append(parse_xml(
    '<w:hyperlink %s><w:r><w:t xml:space="preserve">%s</w:t><w:br/>'
    '<w:t xml:space="preserve">%s</w:t></w:r></w:hyperlink>'
    % (nsdecls("w"), S_W, S_A)))
d.add_paragraph(S_D)
r, out = run_split(d, pdf)
check(count_tag(out, "w:br") == 1, "S7: br inside a hyperlink was split")

# S8: the same two rows appear twice on the page -- ambiguous, decline
pdf = s_pdf([(100, S_L), (140, S_W), (152, S_A), (192, S_D),
             (300, S_W), (312, S_A)])
d = s_doc([S_L, (S_W, S_A), S_D], True)
r, out = run_split(d, pdf)
check(count_tag(out, "w:br") == 1, "S8: split on ambiguous block evidence")

# S9: no PDF at all -- the pass is a no-op
d = s_doc([S_L, (S_W, S_A), S_D], True)
buf = io.BytesIO()
d.save(buf)
check(de.br_row_split(buf.getvalue(), None) == buf.getvalue(),
      "S9: pass mutated the document without PDF evidence")

# ---- label_row_split cases (L) ---------------------------------------------
# The general form of the S cases: rows welded into ONE paragraph with only
# SOME of the boundaries carrying a w:br (and sometimes none at all), split at
# the source lines instead of at the breaks.

def run_lrs(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.label_row_split(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


L_ROWS = ["Languages: Python, SQL",
          "Web and Mobile: React Native",
          "AI and Vision: TensorFlow"]


def l_pdf(rows=L_ROWS, y0=100, dy=12.0, x=72, extra=()):
    lines = [(y0 + i * dy, t, x) for i, t in enumerate(rows)]
    return make_pdf([list(lines) + list(extra)])


def l_doc(rows=L_ROWS, breaks=(), before=6, tail=None, fuse=None):
    """One paragraph holding every row: a bold label run and a value run each.
    `breaks` are the row boundaries (1-based) that carry a w:br; the rest carry
    nothing at all. `fuse` welds that boundary's label into the run before it,
    so the cut would fall inside a run."""
    d = Document()
    para = d.add_paragraph()
    para.paragraph_format.space_before = Pt(before)
    for i, row in enumerate(rows):
        head, sep, value = row.partition(": ")
        lead = "" if i == 0 else " "
        if i and i in breaks:
            para.add_run().add_break()
            lead = ""
        if not sep:
            para.add_run(lead + row)
            continue
        if i and fuse == i:
            para.runs[-1].text = para.runs[-1].text + lead + head + ": "
        else:
            r = para.add_run(lead + head + ": ")
            r.bold = True
        para.add_run(value)
    if tail is not None:
        t = d.add_paragraph()
        t.paragraph_format.space_before = Pt(tail)
        t.add_run(L_ROWS[0]).bold = True
    return d


def l_texts(doc):
    return [p.text.strip() for p in doc.paragraphs]


L_JOINED = " ".join(L_ROWS)

# L1: no break element anywhere -- three source lines, three paragraphs
r, out = run_lrs(l_doc(), l_pdf())
check(l_texts(r) == L_ROWS, "L1: rows not split at source lines: %r" % l_texts(r))
check(" ".join(full_text(r).split()) == L_JOINED,
      "L1: text changed by the split: %r" % full_text(r))
check(all(p.runs and p.runs[0].bold for p in r.paragraphs),
      "L1: label run formatting lost")

# L2: a br on the first boundary and nothing on the second -- both are cut
r, out = run_lrs(l_doc(breaks=(1,)), l_pdf())
check(l_texts(r) == L_ROWS, "L2: mixed break/no-break rows: %r" % l_texts(r))
check(count_tag(out, "w:br") == 0, "L2: w:br left behind")

# L3: wrapped prose, no label heads -- never split
PROSE = ["The committee met on Tuesday to review the quarterly figures",
         "and agreed the revised forecast should be circulated on Friday",
         "before the board sits again at the end of the month."]
r, out = run_lrs(l_doc(PROSE), l_pdf(PROSE))
check(len(r.paragraphs) == 1, "L3: prose block was split")

# L4: the rows sit far apart -- a gap between paragraphs, not row leading
r, out = run_lrs(l_doc(), l_pdf(dy=45.0))
check(len(r.paragraphs) == 1, "L4: split across a paragraph gap")

# L5: the second label is welded inside the first row's value run -- the cut
# would fall inside a run, so nothing is cut at all (never a partial split)
r, out = run_lrs(l_doc(fuse=1), l_pdf())
check(len(r.paragraphs) == 1, "L5: cut inside a run")

# L6: the same rows appear twice on the page -- ambiguous, decline
r, out = run_lrs(l_doc(), l_pdf(extra=[(400, L_ROWS[0], 72), (412, L_ROWS[1], 72),
                                       (424, L_ROWS[2], 72)]))
check(len(r.paragraphs) == 1, "L6: split on ambiguous block evidence")

# L7: no PDF at all -- the pass is a no-op
buf = io.BytesIO()
l_doc().save(buf)
check(de.label_row_split(buf.getvalue(), None) == buf.getvalue(),
      "L7: pass mutated the document without PDF evidence")

# L8: a tab means a label/date column, which is not this pass's shape
d = l_doc()
d.paragraphs[0].runs[1]._r.append(parse_xml("<w:tab %s/>" % nsdecls("w")))
r, out = run_lrs(d, l_pdf())
check(len(r.paragraphs) == 1, "L8: split a tabbed paragraph")

# L9: the rows do not share a left edge -- a stepped panel, not a row block
pdf = make_pdf([[(100, L_ROWS[0], 72), (112, L_ROWS[1], 90),
                 (124, L_ROWS[2], 72)]])
r, out = run_lrs(l_doc(), pdf)
check(len(r.paragraphs) == 1, "L9: split rows off a shared left edge")

# L10: a page break is never a row boundary
d = Document()
d.add_paragraph().add_run(L_ROWS[0] + " ").bold = True
para = d.paragraphs[0]
para.add_run()._r.append(parse_xml('<w:br %s w:type="page"/>' % nsdecls("w")))
para.add_run(L_ROWS[1] + " ").bold = True
para.add_run(L_ROWS[2])
r, out = run_lrs(d, l_pdf())
check(count_tag(out, "w:br") == 1, "L10: page break consumed")

# L11: with no sibling row to copy, continuation rows take w:before=0, which is
# the leading they had inside the paragraph they came out of
r, out = run_lrs(l_doc(before=6), l_pdf())
sp = [p.paragraph_format.space_before for p in r.paragraphs]
check(sp[0].pt == 6 and all(v.pt == 0 for v in sp[1:]),
      "L11: continuation rows did not take zero leading: %r" % sp)

# L12: an adjacent standalone row of the same shape IS the spacing to inherit
r, out = run_lrs(l_doc(before=6, tail=3), l_pdf(extra=[(200, L_ROWS[0], 72)]))
sp = [p.paragraph_format.space_before for p in r.paragraphs]
check(l_texts(r)[:3] == L_ROWS and all(v.pt == 3 for v in sp[1:3]),
      "L12: sibling spacing not inherited: %r %r" % (l_texts(r), sp))

# L14-L17: fitz groups a stepped or gapped run of lines into separate blocks,
# so the end-to-end cases above cannot reach the row geometry itself. These
# drive _lrs_rows_ok directly, on line records of the shape _wb_blocks emits.
def l_lines(specs):
    return [{"text": t, "x0": x, "x1": x + 200.0, "y0": y, "y1": y + 11.0}
            for t, x, y in specs]


check(de._lrs_rows_ok(l_lines([(L_ROWS[0], 72.0, 100.0),
                               (L_ROWS[1], 72.0, 112.0),
                               (L_ROWS[2], 72.0, 124.0)])),
      "L14: a flush, normally-led row block was rejected")
check(not de._lrs_rows_ok(l_lines([(L_ROWS[0], 72.0, 100.0),
                                   (L_ROWS[1], 96.0, 112.0)])),
      "L15: rows off a shared left edge accepted")
check(not de._lrs_rows_ok(l_lines([(L_ROWS[0], 72.0, 100.0),
                                   (L_ROWS[1], 72.0, 145.0)])),
      "L16: a paragraph gap accepted as row leading")
check(not de._lrs_rows_ok(l_lines([(L_ROWS[0], 72.0, 100.0),
                                   ("and the forecast was circulated", 72.0, 112.0)])),
      "L17: a line that is not a label row accepted")

# L13: a list paragraph is a list, whatever its text looks like
d = l_doc()
d.paragraphs[0]._p.get_or_add_pPr().append(parse_xml(
    '<w:numPr %s><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' % nsdecls("w")))
r, out = run_lrs(d, l_pdf())
check(len(r.paragraphs) == 1, "L13: split a numbered list paragraph")


# ---- section_rule_dedupe cases (D) ----------------------------------------
D_H = "TRAINING & PROFESSIONAL DEVELOPMENT"
D_E = "React Native Academy, Eurisko"


def d_bdr(p, side):
    ppr = p._p.get_or_add_pPr()
    pbdr = ppr.find(qn("w:pBdr"))
    if pbdr is None:
        pbdr = parse_xml("<w:pBdr %s/>" % nsdecls("w"))
        de._ppr_insert(ppr, pbdr)
    pbdr.append(parse_xml('<w:%s %s w:val="single" w:sz="6" w:color="auto"/>'
                          % (side, nsdecls("w"))))


def d_doc(head=D_H, entry=D_E, table=False):
    d = Document()
    d_bdr(d.add_paragraph(head), "bottom")
    if table:
        d.add_table(rows=1, cols=1).cell(0, 0).text = "spacer"
    d_bdr(d.add_paragraph(entry), "top")
    return d


def run_dd(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.section_rule_dedupe(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def d_sides(doc):
    out = []
    for p in doc.paragraphs:
        ppr = p._p.find(qn("w:pPr"))
        pbdr = ppr.find(qn("w:pBdr")) if ppr is not None else None
        if pbdr is not None:
            out.append((p.text.strip(),
                        tuple(c.tag.split("}")[1] for c in pbdr)))
    return out


# D1: one heading, one entry, exactly one hairline between them in the source
# => the entry's top border is that same rule, drop it, keep the heading's
pdf = rule_pdf([(100, D_H), (130, D_E)], [(104, 60, 540)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",))],
      "D1: duplicate top border survived: %r" % d_sides(r))

# D1b: the date column date_column_untable welds onto the entry line still
# leaves the source line as a prefix, which is the honest match
pdf = rule_pdf([(100, D_H), (130, D_E), (130, "Mar 2025")], [(104, 60, 540)])
r, out = run_dd(d_doc(entry=D_E + " Mar 2025"), pdf)
check(d_sides(r) == [(D_H, ("bottom",))],
      "D1b: prefix match missed: %r" % d_sides(r))

# D2: the source really does draw two rules in that gap -- both borders stay
pdf = rule_pdf([(100, D_H), (130, D_E)], [(104, 60, 540), (112, 60, 540)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("top",))],
      "D2: dropped a border from a genuinely double-ruled gap: %r" % d_sides(r))

# D3: no hairline at all between them -- neither border is PDF-backed, so
# there is no evidence for which of the two is the duplicate
pdf = rule_pdf([(100, D_H), (130, D_E)], [(500, 60, 540)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("top",))],
      "D3: acted without a rule in the gap: %r" % d_sides(r))

# D4: a table sits between them -- they are not a pair
pdf = rule_pdf([(100, D_H), (130, D_E)], [(104, 60, 540)])
r, out = run_dd(d_doc(table=True), pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("top",))],
      "D4: paired across an intervening table: %r" % d_sides(r))

# D5: the heading text appears twice in the source -- which gap to measure is
# ambiguous, so decline
pdf = rule_pdf([(100, D_H), (130, D_E), (300, D_H), (330, "other")],
               [(104, 60, 540)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("top",))],
      "D5: acted on an ambiguous anchor: %r" % d_sides(r))

# D6: the paragraph under the heading is not the source line under it -- the
# docx order and the page order disagree, so the gap proves nothing
pdf = rule_pdf([(100, D_H), (130, "A completely different line")],
               [(104, 60, 540)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("top",))],
      "D6: matched the wrong source line: %r" % d_sides(r))

# D7: a page carrying a hairline grid is a form or a ruled table, never
# section furniture
pdf = rule_pdf([(100, D_H), (130, D_E)],
               [(104, 60, 540)] + [(140 + 20 * i, 60, 540) for i in range(13)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("top",))],
      "D7: deduped on a grid page: %r" % d_sides(r))

# D7b: the grid guard counts DISTINCT hairlines, so a page whose single rule
# is stroked twice is still section furniture and the dedupe still referees
pdf = rule_pdf_strokes([(100, D_H), (130, D_E)],
                       [(104, 60, 540, (0.4, 0.4, 0.4), 0.75, 2)])
r, out = run_dd(d_doc(), pdf)
check(d_sides(r) == [(D_H, ("bottom",))],
      "D7b: a doubly-stroked rule disabled the dedupe: %r" % d_sides(r))

# D8: without a PDF the pass cannot know anything -- byte-identical no-op
d = d_doc()
buf = io.BytesIO()
d.save(buf)
check(de.section_rule_dedupe(buf.getvalue(), None) == buf.getvalue(),
      "D8: pass mutated the document without PDF evidence")

# D9: nothing to dedupe -- also byte-identical, and the text is never touched
d = Document()
d_bdr(d.add_paragraph(D_H), "bottom")
d.add_paragraph(D_E)
buf = io.BytesIO()
d.save(buf)
pdf = rule_pdf([(100, D_H), (130, D_E)], [(104, 60, 540)])
check(de.section_rule_dedupe(buf.getvalue(), pdf) == buf.getvalue(),
      "D9: rewrote a document with no duplicate pair")

# D10: the dedupe removes only the one side; a top border sharing its pBdr
# with a left border leaves the left one behind
d = Document()
d_bdr(d.add_paragraph(D_H), "bottom")
p = d.add_paragraph(D_E)
d_bdr(p, "top")
d_bdr(p, "left")
pdf = rule_pdf([(100, D_H), (130, D_E)], [(104, 60, 540)])
r, out = run_dd(d, pdf)
check(d_sides(r) == [(D_H, ("bottom",)), (D_E, ("left",))],
      "D10: took an unrelated border side with it: %r" % d_sides(r))


# --- E6: section breaks (section_break_tidy) ---------------------------------
# pdf2docx parks each page's sectPr on an empty paragraph of its own and guesses
# that page's margins independently. The empty paragraph prints as a blank line
# the source never had; the independent guess narrows the text column halfway
# down a document whose PDF pages are all the same size.

SB_MAR = '<w:pgMar %s w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" ' \
         'w:header="720" w:footer="720" w:gutter="0"/>'
SB_SZ = '<w:pgSz %s w:w="11899" w:h="16838"/>'


def sb_sect(top=416, right=810, bottom=478, left=856, w=11899, h=16838):
    return ('<w:sectPr %s><w:pgSz %s w:w="%d" w:h="%d"/>'
            '<w:pgMar %s w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" '
            'w:header="720" w:footer="720" w:gutter="0"/><w:cols %s/></w:sectPr>'
            % (nsdecls("w"), nsdecls("w"), w, h, nsdecls("w"),
               top, right, bottom, left, nsdecls("w")))


def sb_carrier(doc, **kw):
    """The empty sectPr-only paragraph pdf2docx emits between two pages."""
    p = doc.add_paragraph()
    ppr = p._p.get_or_add_pPr()
    ppr.append(parse_xml(sb_sect(**kw)))
    return p


def sb_body_sect(doc, **kw):
    body = doc.element.body
    old = body.find(qn("w:sectPr"))
    if old is not None:
        body.remove(old)
    body.append(parse_xml(sb_sect(**kw)))


def sb_pdf(sizes):
    pdf = fitz.open()
    for w, h in sizes:
        pdf.new_page(width=w, height=h)
    return pdf


def run_sb(doc, pdf=None):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.section_break_tidy(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def sb_sects(doc):
    """[(carrier text or None, {side: twips})] in document order."""
    out = []
    body = doc.element.body
    for child in body:
        if child.tag != qn("w:p"):
            continue
        ppr = child.find(qn("w:pPr"))
        s = None if ppr is None else ppr.find(qn("w:sectPr"))
        if s is not None:
            out.append((("".join(t.text or "" for t in child.iter(qn("w:t")))),
                        sb_mar(s)))
    tail = body.find(qn("w:sectPr"))
    if tail is not None:
        out.append((None, sb_mar(tail)))
    return out


def sb_mar(sect):
    node = sect.find(qn("w:pgMar"))
    return {s: int(node.get(qn("w:" + s))) for s in de.SB_SIDES}


def sb_texts(doc):
    return [p.text for p in doc.paragraphs]


SB_UNIFORM = sb_pdf([(419.5, 595.3), (419.5, 595.3)])

# E6-1: the CV shape. The blank carrier disappears, its break moves onto the
# heading above it, and the continuation page adopts page 1's tighter margins.
d = Document()
d.add_paragraph("LANGUAGES")
sb_carrier(d)
d.add_paragraph("Arabic (native)")
sb_body_sect(d, top=404, right=1440, bottom=1440, left=856)
r, out = run_sb(d, SB_UNIFORM)
check(sb_texts(r) == ["LANGUAGES", "Arabic (native)"],
      "E6-1: content order/blank line wrong: %r" % (sb_texts(r),))
check([t for t, _ in sb_sects(r)] == ["LANGUAGES", None],
      "E6-1: break not re-attached to the paragraph above: %r"
      % ([t for t, _ in sb_sects(r)],))
check(sb_sects(r)[1][1] == {"top": 404, "right": 810, "bottom": 478,
                            "left": 856},
      "E6-1: continuation margins not carried: %r" % (sb_sects(r)[1][1],))
check(count_tag(out, "w:sectPr") == 2, "E6-1: lost or duplicated a section")

# E6-2: a carrier that holds real text is the last line of its section, not
# furniture. It must survive with its break exactly where it is.
d = Document()
d.add_paragraph("LANGUAGES")
p = sb_carrier(d)
p.add_run("still a real line of text")
d.add_paragraph("Arabic (native)")
sb_body_sect(d)
r, _ = run_sb(d, SB_UNIFORM)
check(sb_texts(r) == ["LANGUAGES", "still a real line of text",
                      "Arabic (native)"],
      "E6-2: deleted a paragraph with text: %r" % (sb_texts(r),))
check([t for t, _ in sb_sects(r)] == ["still a real line of text", None],
      "E6-2: moved a break off a paragraph that owns content")

# E6-3: the paragraph above already carries its own sectPr, so there is nowhere
# legal to move this one. Two sectPr in one pPr is invalid OOXML.
d = Document()
sb_carrier(d, right=810)
sb_carrier(d, right=810)
d.add_paragraph("body")
sb_body_sect(d)
r, out = run_sb(d, SB_UNIFORM)
check(count_tag(out, "w:sectPr") == 3, "E6-3: merged two breaks into one pPr")
xml_ppr = [len(p._p.find(qn("w:pPr")).findall(qn("w:sectPr")))
           for p in r.paragraphs if p._p.find(qn("w:pPr")) is not None]
check(max(xml_ppr) <= 1, "E6-3: a pPr ended up with two sectPr: %r" % (xml_ppr,))

# E6-4: a carrier with no paragraph above it (first block in the body) cannot
# move its break either. It is flattened to zero height instead, and the break
# still governs the same content.
d = Document()
body = d.element.body
first = body.find(qn("w:p"))
if first is not None:
    body.remove(first)
sb_carrier(d)
d.add_paragraph("body")
sb_body_sect(d)
r, out = run_sb(d, SB_UNIFORM)
check(count_tag(out, "w:sectPr") == 2, "E6-4: lost the leading break")
lead = r.paragraphs[0]
sp = lead._p.find(qn("w:pPr")).find(qn("w:spacing"))
check(sp is not None and sp.get(qn("w:line")) == "1"
      and sp.get(qn("w:lineRule")) == "exact",
      "E6-4: leading carrier not flattened")
check(sb_texts(r) == ["", "body"], "E6-4: text changed: %r" % (sb_texts(r),))

# E6-5: pages of DIFFERENT sizes are a real geometry change (a landscape insert,
# a mixed-size scan). Margins are then evidence about that page alone.
d = Document()
d.add_paragraph("LANGUAGES")
sb_carrier(d)
d.add_paragraph("Arabic (native)")
sb_body_sect(d, top=404, right=1440, bottom=1440, left=856)
r, _ = run_sb(d, sb_pdf([(419.5, 595.3), (595.3, 841.9)]))
check(sb_sects(r)[1][1] == {"top": 404, "right": 1440, "bottom": 1440,
                            "left": 856},
      "E6-5: harmonised margins across differently sized pages: %r"
      % (sb_sects(r)[1][1],))

# E6-6: no PDF at all -> no geometry evidence -> margins are left alone (the
# blank-carrier repair is structural and still runs).
d = Document()
d.add_paragraph("LANGUAGES")
sb_carrier(d)
d.add_paragraph("Arabic (native)")
sb_body_sect(d, top=404, right=1440, bottom=1440, left=856)
r, _ = run_sb(d, None)
check(sb_sects(r)[1][1]["right"] == 1440,
      "E6-6: changed margins with no PDF evidence")
check(sb_texts(r) == ["LANGUAGES", "Arabic (native)"],
      "E6-6: structural repair skipped along with the margin rule")

# E6-7: only-smaller. A continuation section whose margins are TIGHTER than the
# first section's keeps them: widening a margin shrinks the text area and can
# push laid-out content off the bottom of the page.
d = Document()
d.add_paragraph("LANGUAGES")
sb_carrier(d, top=1440, right=1440, bottom=1440, left=1440)
d.add_paragraph("Arabic (native)")
sb_body_sect(d, top=200, right=300, bottom=400, left=500)
r, _ = run_sb(d, SB_UNIFORM)
check(sb_sects(r)[1][1] == {"top": 200, "right": 300, "bottom": 400,
                            "left": 500},
      "E6-7: widened a continuation margin: %r" % (sb_sects(r)[1][1],))

# E6-8: pdf2docx's zero-margin mode (everything positioned by absolute indent).
# A zero is not a margin measurement, so it is never propagated as one.
d = Document()
d.add_paragraph("LANGUAGES")
sb_carrier(d, top=0, right=0, bottom=0, left=0)
d.add_paragraph("Arabic (native)")
sb_body_sect(d, top=404, right=1440, bottom=1440, left=856)
r, _ = run_sb(d, SB_UNIFORM)
check(sb_sects(r)[1][1] == {"top": 404, "right": 1440, "bottom": 1440,
                            "left": 856},
      "E6-8: propagated a zero margin: %r" % (sb_sects(r)[1][1],))

# E6-9: a differently sized continuation page inside an otherwise uniform PDF
# is identified by its own pgSz, not by the PDF alone.
d = Document()
d.add_paragraph("LANGUAGES")
sb_carrier(d)
d.add_paragraph("Arabic (native)")
sb_body_sect(d, top=404, right=1440, bottom=1440, left=856, w=16838, h=11899)
r, _ = run_sb(d, SB_UNIFORM)
check(sb_sects(r)[1][1]["right"] == 1440,
      "E6-9: carried margins onto a different paper size")

# E6-10: nothing to do -> byte-identical output, no re-save churn
d = Document()
d.add_paragraph("LANGUAGES")
d.add_paragraph("Arabic (native)")
sb_body_sect(d)
buf = io.BytesIO()
d.save(buf)
check(de.section_break_tidy(buf.getvalue(), SB_UNIFORM) == buf.getvalue(),
      "E6-10: rewrote a document with one section and no blank carrier")

# E6-11: the paragraph the break moves onto keeps every property it had, and
# the pPr stays in schema order (pStyle first, sectPr last).
d = Document()
h = d.add_paragraph("LANGUAGES")
h.style = d.styles["Heading 2"]
h.paragraph_format.space_before = Pt(10)
sb_carrier(d)
d.add_paragraph("Arabic (native)")
sb_body_sect(d)
r, _ = run_sb(d, SB_UNIFORM)
hp = r.paragraphs[0]
check(hp.style.name == "Heading 2" and hp.paragraph_format.space_before == Pt(10),
      "E6-11: lost the host paragraph's properties")
kids = [c.tag for c in hp._p.find(qn("w:pPr"))]
check(kids[0] == qn("w:pStyle") and kids[-1] == qn("w:sectPr"),
      "E6-11: pPr out of schema order: %r" % (kids,))

# E6-12: a carrier directly below a TABLE has no paragraph above it, so its
# break is flattened rather than moved (a sectPr cannot live on a w:tbl).
d = Document()
d.add_table(rows=1, cols=1).cell(0, 0).text = "cell"
sb_carrier(d)
d.add_paragraph("body")
sb_body_sect(d)
r, out = run_sb(d, SB_UNIFORM)
check(count_tag(out, "w:sectPr") == 2, "E6-12: lost the break below a table")
check(len(r.tables) == 1 and r.tables[0].cell(0, 0).text == "cell",
      "E6-12: lost the table above the carrier")

# ---------------------------------------------------------------- E7 char scale
# ST_TextScale is an integer percent; pdf2docx emits float noise.

def cs_run(doc):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.char_scale_normalize(buf.getvalue())
    return Document(io.BytesIO(out)), out


def cs_set(run, val):
    rpr = run._r.get_or_add_rPr()
    rpr.append(parse_xml('<w:w %s w:val="%s"/>' % (nsdecls("w"), val)))


def cs_vals(doc):
    return [el.get(qn("w:val")) for el in doc.element.body.iter(qn("w:w"))]


# E7-1: a float scale is rounded to the nearest whole percent, text untouched.
d = Document()
cs_set(d.add_paragraph().add_run("Beirut, Lebanon"), "97.74999618530273")
cs_set(d.add_paragraph().add_run("Senior Engineer"), "101.05263559441818")
r, _ = cs_run(d)
check(cs_vals(r) == ["98", "101"], "E7-1: bad rounding: %r" % (cs_vals(r),))
check(full_text(r) == "Beirut, LebanonSenior Engineer", "E7-1: text changed")

# E7-2: anything that rounds to 100 is dropped entirely (100% is the default),
# and the emptied rPr keeps the run's other properties.
d = Document()
run = d.add_paragraph().add_run("bold body")
run.bold = True
cs_set(run, "99.99998474121094")
cs_set(d.add_paragraph().add_run("plain"), "100.4")
r, out = cs_run(d)
check(cs_vals(r) == [], "E7-2: kept a 100 percent scale: %r" % (cs_vals(r),))
check(r.paragraphs[0].runs[0].bold is True, "E7-2: lost bold with the scale")
check(full_text(r) == "bold bodyplain", "E7-2: text changed")

# E7-3: an already-integer scale that is not 100 is left byte-identical (the
# pass must be a no-op, not a rewrite, on a clean document).
d = Document()
cs_set(d.add_paragraph().add_run("clean"), "98")
_cs_buf = io.BytesIO()
d.save(_cs_buf)
check(de.char_scale_normalize(_cs_buf.getvalue()) == _cs_buf.getvalue(),
      "E7-3: rewrote a document whose scales were already integers")

# E7-4: a w:w that is not character scaling (same tag, different parent) is not
# touched, and a non-numeric val is left for Word to reject rather than guessed.
d = Document()
_cs_r = d.add_paragraph().add_run("x")._r
_cs_r.append(parse_xml('<w:w %s w:val="12.5"/>' % nsdecls("w")))  # direct child of w:r
cs_set(d.add_paragraph().add_run("y"), "not-a-number")
r, _ = cs_run(d)
check("12.5" in cs_vals(r), "E7-4: rewrote a w:w outside w:rPr")
check("not-a-number" in cs_vals(r), "E7-4: guessed at a non-numeric scale")

# E7-5: the measurement form ("98.6%") normalises to the integer form, and a
# value outside ST_TextScale's 1..600 range is clamped into it.
d = Document()
cs_set(d.add_paragraph().add_run("pct"), "98.6%")
cs_set(d.add_paragraph().add_run("huge"), "980")
cs_set(d.add_paragraph().add_run("zero"), "0.2")
r, _ = cs_run(d)
check(cs_vals(r) == ["99", "600", "1"], "E7-5: bad clamp/percent: %r" % (cs_vals(r),))

# E7-6: scales inside a header part are normalised too, not just the body.
d = Document()
_cs_hdr = d.sections[0].header
_cs_hdr.is_linked_to_previous = False
cs_set(_cs_hdr.paragraphs[0].add_run("Maroun Daher"), "97.95000076293945")
r, _ = cs_run(d)
_cs_hp = r.sections[0].header.paragraphs[0]
check([el.get(qn("w:val")) for el in _cs_hp._p.iter(qn("w:w"))] == ["98"],
      "E7-6: left a float scale in the header part")


# === E8: phantom two-column bands (phantom_column_flatten) ===================
# pdf2docx reads a CV's flush-right dates as a real second page column and
# emits <w:cols w:num="2">; inside the narrowed first column it also welds the
# source lines it folded. These cases pin both halves of the repair and, more
# importantly, the refusals: a genuine two-column page, an ambiguous run, and a
# band the pass may not take apart must all come out untouched.
PCB_W, PCB_H = 612, 792          # letter, so pgSz w=12240 matches at 20 tw/pt
PCB_SECT = ('<w:sectPr %s>%s<w:pgSz w:w="12240" w:h="15840"/>'
            '<w:pgMar w:top="208" w:right="814" w:bottom="510" w:left="832"'
            ' w:header="720" w:footer="720" w:gutter="0"/>%s'
            '<w:docGrid w:linePitch="360"/></w:sectPr>')
PCB_COLS2 = ('<w:cols w:num="2" w:equalWidth="0">'
             '<w:col w:w="6505" w:space="0"/><w:col w:w="4087" w:space="0"/></w:cols>')


def pcb_pdf(lines):
    """lines: [(x, y, text)] on one letter page."""
    pdf = fitz.open()
    pg = pdf.new_page(width=PCB_W, height=PCB_H)
    for x, y, t in lines:
        pg.insert_text((x, y), t, fontsize=9)
    return pdf


def pcb_sect(kind, cols):
    typ = '<w:type w:val="%s"/>' % kind if kind else ""
    return PCB_SECT % (nsdecls("w"), typ, cols or "<w:cols/>")


def pcb_para(doc, runs, kind=None, cols=None):
    p = doc.add_paragraph()
    for text in runs:
        p.add_run(text)
    if kind is not None or cols is not None:
        p._p.get_or_add_pPr().append(parse_xml(pcb_sect(kind, cols)))
    return p


def pcb_run(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.phantom_column_flatten(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def pcb_texts(doc):
    return [p.text for p in doc.paragraphs]


# the CV shape: one text column, two body lines straddling pdf2docx's gutter,
# and an entry whose date is set flush right on the school's own line.
PCB_BODY = [(42, 60, "A determined graduate with a passion for the field and "
                     "an appetite for work that lasts a long time indeed"),
            (42, 76, "committed to projects that foster growth and expertise "
                     "through practical experience over many long years"),
            (42, 92, "EDUCATION")]
PCB_ENTRY = [(42, 110, "Acme University of Somewhere, Anywhere"),
             (430, 110, "Graduated August 2026"),
             (42, 124, "BA in Computer Science")]


def pcb_cv_doc():
    d = Document()
    pcb_para(d, ["EDUCATION"], kind=None, cols="<w:cols/>")   # nextPage break
    pcb_para(d, ["Acme University of Somewhere, Anywhere ",
                 "BA in Computer Science"], kind="continuous", cols=PCB_COLS2)
    pcb_para(d, ["Graduated August 2026"], kind="nextColumn", cols=PCB_COLS2)
    pcb_para(d, ["Afterwards, prose that is not in the band at all."])
    return d


# E8-1: the band is rebuilt into the PDF's own lines, date back on line one.
r, out = pcb_run(pcb_cv_doc(), pcb_pdf(PCB_BODY + PCB_ENTRY))
check(pcb_texts(r) == ["EDUCATION",
                       "Acme University of Somewhere, Anywhere \tGraduated August 2026",
                       "BA in Computer Science",
                       "Afterwards, prose that is not in the band at all."],
      "E8-1: band not rebuilt into source lines: %r" % (pcb_texts(r),))

# E8-2: no multi-column section survives, and the date row gets a right stop.
check(count_tag(out, 'w:cols w:num="2"') == 0, "E8-2: a w:cols num=2 survived")
_e8_stops = [int(s.get(qn("w:pos"))) for s in r.paragraphs[1]._p.iter(qn("w:tab"))
             if s.get(qn("w:val")) == "right"]
check(len(_e8_stops) == 1 and de.PCB_MIN_TAB_TW <= _e8_stops[0] <= 12240 - 832 - 814,
      "E8-2: no usable right stop on the date row: %r" % (_e8_stops,))
check(len(r.paragraphs[1]._p.findall(qn("w:r") + "/" + qn("w:tab"))) == 1,
      "E8-2: the date row is not joined by exactly one tab")

# E8-3: the nextPage break in front of the band becomes continuous - the PDF
# puts the heading and the entry on one page, so a page break there is wrong.
_e8_types = [t.get(qn("w:val")) for t in r.paragraphs[0]._p.iter(qn("w:type"))]
check(_e8_types == ["continuous"], "E8-3: leading break not demoted: %r" % (_e8_types,))

# E8-4: not one character is gained or lost by the rebuild.
check(sorted(full_text(r)) == sorted(full_text(pcb_cv_doc())),
      "E8-4: text changed by the rebuild")

# E8-5: a GENUINE two-column page is left alone - no line crosses the gutter.
_e8_two = pcb_pdf([(42, 60, "left column line one"), (42, 74, "left column line two"),
                   (42, 88, "EDUCATION"),
                   (42, 110, "Acme University of Somewhere, Anywhere"),
                   (430, 110, "Graduated August 2026"),
                   (42, 124, "BA in Computer Science")])
r2, out2 = pcb_run(pcb_cv_doc(), _e8_two)
check(pcb_texts(r2) == pcb_texts(pcb_cv_doc()), "E8-5: flattened a real two-column page")
check(count_tag(out2, 'w:cols w:num="2"') == 2, "E8-5: real column spec destroyed")

# E8-6: an ambiguous run - its text is on two source lines - cuts nothing.
_e8_amb = pcb_pdf(PCB_BODY + PCB_ENTRY + [(42, 300, "BA in Computer Science")])
r3, _ = pcb_run(pcb_cv_doc(), _e8_amb)
check(pcb_texts(r3) == pcb_texts(pcb_cv_doc()), "E8-6: rebuilt on an ambiguous run")

# E8-7: a band the pass may not take apart (a list paragraph) is left alone.
_e8_list = pcb_cv_doc()
_e8_list.paragraphs[1]._p.get_or_add_pPr().insert(0, parse_xml(
    '<w:numPr %s><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' % nsdecls("w")))
r4, _ = pcb_run(_e8_list, pcb_pdf(PCB_BODY + PCB_ENTRY))
check([p.text for p in r4.paragraphs] == pcb_texts(pcb_cv_doc()),
      "E8-7: took apart a band containing a list paragraph")

# E8-8: no PDF, no evidence, no change.
_e8_none = pcb_cv_doc()
_e8_buf = io.BytesIO()
_e8_none.save(_e8_buf)
check(de.phantom_column_flatten(_e8_buf.getvalue(), None) == _e8_buf.getvalue(),
      "E8-8: changed the document without a PDF")

# E8-9: a lone multi-column section (no second column) is not a band.
_e8_solo = Document()
pcb_para(_e8_solo, ["EDUCATION"], kind=None, cols="<w:cols/>")
pcb_para(_e8_solo, ["Acme University of Somewhere, Anywhere ",
                    "BA in Computer Science"], kind="continuous", cols=PCB_COLS2)
pcb_para(_e8_solo, ["Graduated August 2026"])
r5, out5 = pcb_run(_e8_solo, pcb_pdf(PCB_BODY + PCB_ENTRY))
check(count_tag(out5, 'w:cols w:num="2"') == 1 and
      [p.text for p in r5.paragraphs][1] ==
      "Acme University of Somewhere, Anywhere BA in Computer Science",
      "E8-9: treated a single multi-column section as a band")

# E8-10: prose whose page size does not match the docx page is out of scale
# and must not be reflowed on a guess.
_e8_a4 = fitz.open()
_e8_pg = _e8_a4.new_page(width=595, height=842)
for x, y, t in PCB_BODY + PCB_ENTRY:
    _e8_pg.insert_text((x, y), t, fontsize=9)
r6, _ = pcb_run(pcb_cv_doc(), _e8_a4)
check(pcb_texts(r6) == pcb_texts(pcb_cv_doc()), "E8-10: reflowed across a page-size mismatch")


# --- wrap_tab_unfold ---------------------------------------------------------
# pdf2docx encodes a wrapped continuation line as a TAB when the continuation
# sits right of the paragraph indent, so a bare tab run paints a blank hole in
# the middle of a sentence. The pass unfolds it to one space, but ONLY where
# the PDF says the two sides are consecutive lines of one forced wrap; every
# case below is a way that evidence can be absent, ambiguous, or contradicted.

WT_L = 72.0
WT_HEAD = ("alpha bravo charlie delta echo foxtrot golf hotel india juliet "
           "kilo lima mike november oscar papa")
WT_TAIL = "quebec romeo sierra tango."


def wt_pdf(lines):
    """lines: (x, y, text) drawn at 10pt on one page."""
    pdf = fitz.open()
    pg = pdf.new_page(width=595, height=842)
    for x, y, t in lines:
        pg.insert_text((x, y), t, fontsize=10)
    return pdf


def wt_wrapped(head=WT_HEAD, tail=WT_TAIL, cont_x=WT_L + 18, dy=12.0, extra=()):
    """The live shape: a full-measure line, its continuation offset right on
    the next row. The head line is the widest thing on the page, so the row it
    wrapped on had no room left at all."""
    return wt_pdf([(WT_L, 100.0, head), (cont_x, 100.0 + dy, tail)] + list(extra))


def wt_para(doc, head, tail, bare=True):
    """head <tab> tail; the tab alone in its run unless bare is False (which
    is how date_column_untable writes its own tabs: ' \t' inside a text run)."""
    p = doc.add_paragraph()
    p.add_run(head)
    r = p.add_run("" if bare else " ")
    r._r.append(parse_xml("<w:tab %s/>" % nsdecls("w")))
    p.add_run(tail)
    return p


def run_wt(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.wrap_tab_unfold(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def wt_texts(doc):
    return ["".join(de._char_of(el) for el in de._wb_items(p._p))
            for p in doc.paragraphs]


# WT-1: the live defect. The tab goes, the sentence keeps exactly one space,
# and no word is lost on either side of the seam.
d = Document()
wt_para(d, WT_HEAD + " ", WT_TAIL)
r, _ = run_wt(d, wt_wrapped())
check(wt_texts(r) == [WT_HEAD + " " + WT_TAIL],
      "WT-1: mid-sentence tab not unfolded to one space: %r" % (wt_texts(r),))

# WT-2: a REAL tab. Label and value sit on the SAME PDF line (a flush-right
# date), so there is no second line to be the continuation of anything.
d = Document()
wt_para(d, WT_HEAD + " ", WT_TAIL)
r, _ = run_wt(d, wt_pdf([(WT_L, 100.0, WT_HEAD + "    " + WT_TAIL)]))
check("\t" in wt_texts(r)[0], "WT-2: ate a real tab between same-line text")

# WT-3: no PDF, no evidence, no edit -- and byte-identical, not a re-save.
d = Document()
wt_para(d, WT_HEAD + " ", WT_TAIL)
_wt_buf = io.BytesIO()
d.save(_wt_buf)
check(de.wrap_tab_unfold(_wt_buf.getvalue()) == _wt_buf.getvalue(),
      "WT-3: touched the document with no pdf_doc to judge it by")

# WT-4: date_column_untable's own output (' \t' in one text run) is not a bare
# tab run and stays, even though the geometry would otherwise qualify.
d = Document()
wt_para(d, WT_HEAD, WT_TAIL, bare=False)
r, _ = run_wt(d, wt_wrapped())
check("\t" in wt_texts(r)[0], "WT-4: unfolded a tab that shares its run with text")

# WT-5: ambiguous evidence. The same word pair wraps twice on the page, so no
# single line pair can be bound to this paragraph and the tab is kept.
d = Document()
wt_para(d, WT_HEAD + " ", WT_TAIL)
r, _ = run_wt(d, wt_wrapped(extra=[(WT_L, 300.0, WT_HEAD),
                                   (WT_L + 18, 312.0, WT_TAIL)]))
check("\t" in wt_texts(r)[0], "WT-5: bound a tab to one of two identical wraps")

# WT-6: a hyphen at the seam keeps its tab. Unfolding "re-\tsign" would print
# "re- sign", and fusing it would print "resign" -- a different word.
d = Document()
wt_para(d, WT_HEAD + "- ", WT_TAIL)
r, _ = run_wt(d, wt_wrapped(head=WT_HEAD + "-"))
check("\t" in wt_texts(r)[0], "WT-6: unfolded across a hyphen")

# WT-7: the continuation is NOT offset right of its own first line, so nothing
# about it explains a tab and the geometry is not the defect's.
d = Document()
wt_para(d, WT_HEAD + " ", WT_TAIL)
r, _ = run_wt(d, wt_wrapped(cont_x=WT_L))
check("\t" in wt_texts(r)[0], "WT-7: unfolded a tab with no leading offset")

# WT-8: the wrap was CHOSEN, not forced -- the first line stops well short of
# the measure and the next line's first word would have fitted easily. That is
# an author's line, and its tab may be their own.
d = Document()
wt_para(d, "mike november oscar papa ", "a decision engine follows.")
r, _ = run_wt(d, wt_pdf([(WT_L, 100.0, "mike november oscar papa"),
                         (WT_L + 18, 112.0, "a decision engine follows."),
                         (WT_L, 700.0, WT_HEAD + " " + WT_HEAD)]))
check("\t" in wt_texts(r)[0], "WT-8: unfolded a short, unforced line")

# WT-9: whitespace already borders the seam on BOTH sides. The tab must leave
# one space behind, not two.
d = Document()
wt_para(d, WT_HEAD + " ", " " + WT_TAIL)
r, _ = run_wt(d, wt_wrapped())
check(wt_texts(r) == [WT_HEAD + " " + WT_TAIL],
      "WT-9: left a double space at the seam: %r" % (wt_texts(r),))

# WT-10: another line lies between the two, so they are not consecutive rows of
# one wrapped paragraph however well their words match.
d = Document()
wt_para(d, WT_HEAD + " ", WT_TAIL)
r, _ = run_wt(d, wt_pdf([(WT_L, 100.0, WT_HEAD),
                         (WT_L, 112.0, "an unrelated line in between"),
                         (WT_L + 18, 124.0, WT_TAIL)]))
check("\t" in wt_texts(r)[0], "WT-10: joined two lines with a line between them")

# WT-11: too little context to bind anything -- one word each side is a
# coincidence, not evidence.
d = Document()
wt_para(d, "papa ", "quebec")
r, _ = run_wt(d, wt_wrapped(head="papa", tail="quebec"))
check("\t" in wt_texts(r)[0], "WT-11: unfolded on a two-word n-gram")

# ---- line_space_realign cases (E4) -----------------------------------------
# The pass may only ADD a space, and only when the paragraph's whole text stream
# is character-identical to exactly one PDF line that carries more whitespace.
def lsr_run(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.line_space_realign(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def lsr_doc(*frags):
    d = Document()
    par = d.add_paragraph()
    for f in frags:
        par.add_run(f)
    return d


# E4-1: the reported defect — per-glyph shattering hides the inter-word space
# from span_space_repair's bigram probe; whole-line alignment restores it.
_d = lsr_doc("TE", "CHNICAL", "S", "K", "I", "L", "LS")
_r, _ = lsr_run(_d, rule_pdf([(100, "TECHNICAL SKILLS")], []))
check(_r.paragraphs[0].text == "TECHNICAL SKILLS", "E4-1: not repaired: %r"
      % (_r.paragraphs[0].text,))
check(len(_r.paragraphs[0].runs) == 7, "E4-1: run count changed")

# E4-2: same shattering, but the PDF has no such line -> no evidence, no edit.
_d = lsr_doc("AC", "ADEMIC", "P", "R", "OJECTS")
_r, _ = lsr_run(_d, rule_pdf([(100, "SOMETHING ELSE ENTIRELY")], []))
check(_r.paragraphs[0].text == "ACADEMICPROJECTS", "E4-2: invented a space")

# E4-3: letter-spaced display text. pdf2docx correctly joined "H E L L O" into
# "HELLO"; re-splitting it would be the corruption, so the line is unusable.
_d = lsr_doc("HELLO")
_r, _ = lsr_run(_d, rule_pdf([(100, "H E L L O")], []))
check(_r.paragraphs[0].text == "HELLO", "E4-3: re-split letter-spaced text: %r"
      % (_r.paragraphs[0].text,))

# E4-4: two PDF lines share the despaced key with different spacings. There is
# no safe choice, so the pass declines rather than guessing.
_d = lsr_doc("ABC", "DEF")
_r, _ = lsr_run(_d, rule_pdf([(100, "AB CDEF"), (130, "ABC DEF")], []))
check(_r.paragraphs[0].text == "ABCDEF", "E4-4: resolved an ambiguous key")

# E4-5: a tab (or break) in the paragraph means docx offsets and PDF-line
# offsets are not comparable -> decline.
_d = lsr_doc("FOO", "BAR")
_d.paragraphs[0].runs[0]._r.append(parse_xml("<w:tab %s/>" % nsdecls("w")))
_r, _ = lsr_run(_d, rule_pdf([(100, "FOO BAR")], []))
check(_r.paragraphs[0].text == "FOO\tBAR", "E4-5: edited a tabbed paragraph: %r"
      % (_r.paragraphs[0].text,))

# E4-6: the paragraph already carries the line's spaces -> exact match, no-op,
# and no duplicated space.
_d = lsr_doc("TECHNICAL ", "SKILLS")
_r, out = lsr_run(_d, rule_pdf([(100, "TECHNICAL SKILLS")], []))
check(_r.paragraphs[0].text == "TECHNICAL SKILLS", "E4-6: doubled a space: %r"
      % (_r.paragraphs[0].text,))

# E4-7: prose. A lost space inside a wrapped sentence is NOT a whole PDF line,
# so this pass leaves it to span_space_repair instead of splicing blind.
_d = lsr_doc("Aligned with the", "deploymentchecklist agreed last week")
_r, _ = lsr_run(_d, rule_pdf([(100, "Aligned with the deployment checklist"),
                              (114, "agreed last week")], []))
check(_r.paragraphs[0].text == "Aligned with thedeploymentchecklist agreed last week",
      "E4-7: touched a multi-line prose paragraph: %r" % (_r.paragraphs[0].text,))

# E4-8: a missing space whose position falls exactly on a run boundary lands on
# the left run, and the space is marked preserve so Word keeps it.
_d = lsr_doc("CAREER", "OBJECTIVE")
_r, out = lsr_run(_d, rule_pdf([(100, "CAREER OBJECTIVE")], []))
check(_r.paragraphs[0].text == "CAREER OBJECTIVE", "E4-8: boundary seam missed")
check(_r.paragraphs[0].runs[0].text == "CAREER ", "E4-8: space on the wrong run")
_e48 = _r.paragraphs[0].runs[0]._r.find(qn("w:t"))
check(_e48.get("{http://www.w3.org/XML/1998/namespace}space") == "preserve",
      "E4-8: trailing space not marked preserve")

# E4-9: no PDF at all (browser/no-evidence path) is a clean no-op.
_r, _ = lsr_run(lsr_doc("TE", "CHNICALSKILLS"), None)
check(_r.paragraphs[0].text == "TECHNICALSKILLS", "E4-9: edited without a PDF")

# E4-10: the pass is insertion-only — it never deletes a character even when the
# PDF line is shorter than what the docx holds.
_d = lsr_doc("TECHNICALSKILLSEXTRA")
_r, _ = lsr_run(_d, rule_pdf([(100, "TECHNICAL SKILLS")], []))
check(_r.paragraphs[0].text == "TECHNICALSKILLSEXTRA", "E4-10: mangled a longer run")



# ---- tabbed_subline_split cases (F1) ----------------------------------------
# A bold institution line welded to the lighter sub-line beneath it, with the
# entry's flush-right date at the end of the pair, must become two paragraphs:
# institution + tab + date, then the sub-line on its own. Every case where the
# page does not prove that shape must be a no-op.

TSS_H = "Val Pere Jacques - Bkennaya, Lebanon"
TSS_S = "Primary and Secondary Education"
TSS_D = "2007 - 2019"


def tss_pdf(head=TSS_H, sub=TSS_S, date=TSS_D, dy=12.0, sub_x=72,
            date_x=400, date_dy=0.0, extra=()):
    rows = [(100.0, head), (100.0 + date_dy, date, date_x), (100.0 + dy, sub, sub_x)]
    rows.extend(extra)
    return make_pdf([rows])


def tss_doc(head=TSS_H, sub=TSS_S, date=TSS_D, head_bold=True, sub_bold=False,
            tabs=1, numbered=False, extra_run=None):
    d = Document()
    p = d.add_paragraph()
    r = p.add_run(head + " ")
    r.bold = head_bold
    r2 = p.add_run(sub)
    r2.bold = sub_bold
    if extra_run is not None:
        r3 = p.add_run(extra_run[0])
        r3.bold = extra_run[1]
    for _ in range(tabs):
        p.add_run().add_tab()
    p.add_run(date)
    if numbered:
        ppr = p._p.get_or_add_pPr()
        ppr.append(parse_xml(
            '<w:numPr %s><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
            % nsdecls("w")))
    return d


def run_tss(doc, pdf):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.tabbed_subline_split(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def tss_texts(doc):
    return [p.text for p in doc.paragraphs]


# F1-1: the canonical shape splits, and the date stays on the institution line.
_r, _ = run_tss(tss_doc(), tss_pdf())
check(tss_texts(_r) == [TSS_H + " \t" + TSS_D, TSS_S],
      "F1-1: not split as institution+date / sub-line: %r" % (tss_texts(_r),))
check(_r.paragraphs[0].runs[0].bold is True and _r.paragraphs[1].runs[0].bold is False,
      "F1-1: run weights not preserved across the split")

# F1-2: no PDF (browser path, no evidence) is a clean no-op.
_r, _ = run_tss(tss_doc(), None)
check(len(_r.paragraphs) == 1, "F1-2: split without any PDF evidence")

# F1-3: no bold flip - both halves the same weight - is wrapped prose, untouched.
_r, _ = run_tss(tss_doc(sub_bold=True), tss_pdf())
check(len(_r.paragraphs) == 1, "F1-3: split a paragraph with no weight change")

# F1-4: the tail is NOT on the institution's own baseline, so it is not that
# entry's date column and the pair is not the education shape.
_r, _ = run_tss(tss_doc(), tss_pdf(date_dy=24.0))
check(len(_r.paragraphs) == 1, "F1-4: split with the tail on another row")

# F1-5: the sub-line does not share the institution's left edge -> a wrapped
# continuation or an indented note, never a sub-line.
_r, _ = run_tss(tss_doc(), tss_pdf(sub_x=110))
check(len(_r.paragraphs) == 1, "F1-5: split lines that do not share a left edge")

# F1-6: something else is printed between the two baselines, so they are not
# adjacent lines of one entry.
_r, _ = run_tss(tss_doc(), tss_pdf(dy=24.0, extra=((112.0, "intervening line"),)))
check(len(_r.paragraphs) == 1, "F1-6: split across an intervening line")

# F1-7: two tabs - a multi-column row, not an institution + date.
_r, _ = run_tss(tss_doc(tabs=2), tss_pdf())
check(len(_r.paragraphs) == 1, "F1-7: split a two-tab column row")

# F1-8: a sentence after the tab is not a date column.
_long = "a full sentence of prose that is certainly not a date column"
_r, _ = run_tss(tss_doc(date=_long), tss_pdf(date=_long))
check(len(_r.paragraphs) == 1, "F1-8: split with a sentence in the tail")

# F1-9: the sub-line text occurs twice on the page - ambiguous, so nothing.
_r, _ = run_tss(tss_doc(), tss_pdf(extra=((300.0, TSS_S),)))
check(len(_r.paragraphs) == 1, "F1-9: split on an ambiguous page match")

# F1-10: bold -> regular -> bold is two flips, not the one this pass owns.
_r, _ = run_tss(tss_doc(extra_run=(" Honours", True)), tss_pdf())
check(len(_r.paragraphs) == 1, "F1-10: split a paragraph with two weight flips")

# F1-11: a list paragraph is never cut (_fs_children refuses it).
_r, _ = run_tss(tss_doc(numbered=True), tss_pdf())
check(len(_r.paragraphs) == 1, "F1-11: split a numbered list paragraph")

# F1-12: the sub-line paragraph keeps the entry's pPr but drops the tab stops,
# which belong to the date column it no longer carries.
_d = tss_doc()
_d.paragraphs[0].paragraph_format.left_indent = Pt(9)
_d.paragraphs[0]._p.get_or_add_pPr().append(parse_xml(
    '<w:tabs %s><w:tab w:val="right" w:pos="9360"/></w:tabs>' % nsdecls("w")))
_r, _ = run_tss(_d, tss_pdf())
check(len(_r.paragraphs) == 2, "F1-12: canonical shape with tab stops did not split")
check(_r.paragraphs[1].paragraph_format.left_indent == Pt(9),
      "F1-12: sub-line lost the entry indent")
check(_r.paragraphs[1]._p.find(qn("w:pPr")).find(qn("w:tabs")) is None,
      "F1-12: sub-line kept the date column's tab stops")
check(_r.paragraphs[0]._p.find(qn("w:pPr")).find(qn("w:tabs")) is not None,
      "F1-12: institution line lost its tab stops")

# F1-13: no tab at all - fused_line_split owns that shape, not this pass.
_d = Document()
_p = _d.add_paragraph()
_p.add_run(TSS_H + " ").bold = True
_p.add_run(TSS_S)
_r, _ = run_tss(_d, tss_pdf())
check(len(_r.paragraphs) == 1, "F1-13: split a paragraph carrying no tab")


# ---- F2: date_column_untable indent repair ----------------------------------
# A right tab stop is measured from the left text margin; the paragraph's text
# area ends at (section width - right indent). pdf2docx hands every cell
# paragraph the cell's own right indent, so once the cells are flowed back into
# the body the stop this pass writes at the text margin can sit outside the
# text area and the date wraps onto its own line instead of going flush right.
# The cell's indents are furniture and are repaired; a reachable stop, a real
# indent, and an undissolved table are all left exactly as they were.

F2_SECT = 9360  # python-docx default: 12240 page - 2 x 1440 margin


def f2_doc(cell_right=0, cell_left=None, width=6000, extra=(), body_left=None,
           second_line=None):
    """A date-shaped table whose cells carry pdf2docx's own indents, sitting in
    a body whose own paragraphs establish a dominant left edge."""
    d = build_table([[("Eurisko, Adma", "left"), ("Mar 2025 - Present", "right")]],
                    width=width)
    tbl = d.tables[0]._tbl
    if second_line is not None:
        tc = tbl.findall(qn("w:tr"))[0].findall(qn("w:tc"))[0]
        tc.append(parse_xml(
            '<w:p %s><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>'
            % (nsdecls("w"), second_line)))
    for tc in tbl.iter(qn("w:tc")):
        for cp in tc.findall(qn("w:p")):
            bits = []
            if cell_left is not None:
                bits.append('w:left="%d"' % cell_left)
            if cell_right:
                bits.append('w:right="%d"' % cell_right)
            if bits:
                cp.get_or_add_pPr().append(
                    parse_xml("<w:ind %s %s/>" % (nsdecls("w"), " ".join(bits))))
    for text in extra:
        para = d.add_paragraph(text)
        if body_left is not None:
            para._p.get_or_add_pPr().append(
                parse_xml('<w:ind %s w:left="%d"/>' % (nsdecls("w"), body_left)))
    return d


def f2_para(r, needle):
    for para in r.paragraphs:
        if needle in para.text:
            return para
    return None


def f2_ind(para, attr):
    ppr = para._p.find(qn("w:pPr"))
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    raw = ind.get(qn("w:" + attr)) if ind is not None else None
    return None if raw is None else int(raw)


# F2-1: the stop lands at the text margin, so ANY right indent strands it.
_r, _ = run_untable(f2_doc(cell_right=2000))
_p = f2_para(_r, "Eurisko")
check(_p is not None and f2_ind(_p, "right") == 0,
      "F2-1: stranding right indent survived: %r"
      % (None if _p is None else f2_ind(_p, "right")))
_tab = _p._p.find(qn("w:pPr") + "/" + qn("w:tabs") + "/" + qn("w:tab"))
check(_tab is not None and int(_tab.get(qn("w:pos"))) <= F2_SECT,
      "F2-1: tab stop is outside the section text width")

# F2-2: a stop the paragraph can still reach keeps the indent it came with.
# 2 x 2000 twip cells put the stop at 4000, well inside 9360 - 1000.
_r, _ = run_untable(f2_doc(cell_right=1000, width=2000))
_p = f2_para(_r, "Eurisko")
check(_p is not None and f2_ind(_p, "right") == 1000,
      "F2-2: dropped a right indent that was not stranding anything")

# F2-3: the second line of the SAME cell loses the indent too - it is the same
# cell's furniture, and leaving it narrows the entry the date belongs to.
_r, _ = run_untable(f2_doc(cell_right=2000, second_line="BA in Computer Science"))
_p = f2_para(_r, "BA in Computer")
check(_p is not None and f2_ind(_p, "right") == 0,
      "F2-3: continuation line kept the cell right indent")

# F2-4: a hair-width left difference is one edge measured twice - snap it.
_r, _ = run_untable(f2_doc(cell_left=22, extra=("CAREER OBJECTIVE", "EDUCATION"),
                           body_left=10))
_p = f2_para(_r, "Eurisko")
check(_p is not None and f2_ind(_p, "left") == 10,
      "F2-4: left edge not snapped onto the body: %r"
      % (None if _p is None else f2_ind(_p, "left")))

# F2-5: a real indent is content, never noise - 720 twips stays 720.
_r, _ = run_untable(f2_doc(cell_left=720, extra=("CAREER OBJECTIVE", "EDUCATION"),
                           body_left=10))
_p = f2_para(_r, "Eurisko")
check(_p is not None and f2_ind(_p, "left") == 720,
      "F2-5: flattened a deliberate 720-twip indent")

# F2-6: no body paragraph carries a left indent, so there is no edge to snap
# onto and the cell's own left indent is kept rather than guessed at.
_r, _ = run_untable(f2_doc(cell_left=22))
_p = f2_para(_r, "Eurisko")
check(_p is not None and f2_ind(_p, "left") == 22,
      "F2-6: snapped a left edge with no dominant body edge to snap to")

# F2-7: two body left edges tie, so the document is ambiguous and untouched.
_d = f2_doc(cell_left=22, extra=("CAREER OBJECTIVE",), body_left=10)
_extra = _d.add_paragraph("EDUCATION")
_extra._p.get_or_add_pPr().append(
    parse_xml('<w:ind %s w:left="40"/>' % nsdecls("w")))
_r, _ = run_untable(_d)
_p = f2_para(_r, "Eurisko")
check(_p is not None and f2_ind(_p, "left") == 22,
      "F2-7: snapped a left edge on a tied document")

# F2-8: a table the pass refuses to dissolve keeps every indent it had.
_d = build_table(DATE_ROWS, boxed=True)
for _tc in _d.tables[0]._tbl.iter(qn("w:tc")):
    for _cp in _tc.findall(qn("w:p")):
        _cp.get_or_add_pPr().append(
            parse_xml('<w:ind %s w:left="22" w:right="2000"/>' % nsdecls("w")))
_r, _ = run_untable(_d)
check(len(_r.tables) == 1, "F2-8: bordered table dissolved")
_cp = _r.tables[0]._tbl.findall(qn("w:tr"))[0].findall(qn("w:tc"))[0].findall(qn("w:p"))[0]
_ind = _cp.find(qn("w:pPr")).find(qn("w:ind"))
check(_ind.get(qn("w:right")) == "2000" and _ind.get(qn("w:left")) == "22",
      "F2-8: rewrote the indents of a table it did not dissolve")

# F2-9: the date still reads as its own token after the repair.
_r, _ = run_untable(f2_doc(cell_right=2000, cell_left=22,
                           extra=("CAREER OBJECTIVE", "EDUCATION"), body_left=10))
check("Adma" in full_text(_r) and "AdmaMar" not in full_text(_r),
      "F2-9: repair welded the label to the date: %r" % full_text(_r))




# ---------------------------------------------------------------------------
# F4: stray_mark_cleanup.  Three leftovers pdf2docx measures off the page
# instead of reading off the document: an inert continuous section break, a
# trailing line break on a heading, and a right indent no line ever wrapped
# against.  The guards below are the ones that keep each rule structural.
# ---------------------------------------------------------------------------
import copy as _f4_copy


def f4_run(doc, pdf=None):
    buf = io.BytesIO()
    doc.save(buf)
    out = de.stray_mark_cleanup(buf.getvalue(), pdf)
    return Document(io.BytesIO(out)), out


def f4_sect_count(doc):
    return len(list(doc.element.body.iter(qn("w:sectPr"))))


def f4_doc_with_sect(kind="continuous", tweak=None):
    """Two paragraphs; the first carries a copy of the document's own sectPr."""
    d = Document()
    d.add_paragraph("first")
    d.add_paragraph("second")
    sect = _f4_copy.deepcopy(d.element.body.find(qn("w:sectPr")))
    for t in sect.findall(qn("w:type")):
        sect.remove(t)
    if kind:
        sect.insert(0, parse_xml('<w:type %s w:val="%s"/>' % (nsdecls("w"), kind)))
    if tweak:
        tweak(sect)
    d.paragraphs[0]._p.get_or_add_pPr().append(sect)
    return d


def f4_heading(text, style="Heading 1", trailing_br=1, mid_br=False):
    d = Document()
    para = d.add_paragraph(style=style)
    para.add_run(text)
    if mid_br:
        run = para.add_run()
        run._r.append(parse_xml("<w:br %s/>" % nsdecls("w")))
        para.add_run("second line")
    for _ in range(trailing_br):
        run = para.add_run()
        run._r.append(parse_xml("<w:br %s/>" % nsdecls("w")))
    return d, para


def f4_pdf(lines, width=595, height=842):
    """lines: (x, y, text) drawn at 11pt on one page."""
    pdf = fitz.open()
    page = pdf.new_page(width=width, height=height)
    for x, y, t in lines:
        page.insert_text((x, y), t, fontsize=11)
    return pdf


def f4_right_doc(text, right=1440):
    d = Document()
    para = d.add_paragraph(text)
    para._p.get_or_add_pPr().append(
        parse_xml('<w:ind %s w:left="10" w:right="%d"/>' % (nsdecls("w"), right)))
    return d


def f4_right(doc, needle):
    for para in doc.paragraphs:
        if needle in para.text:
            ppr = para._p.find(qn("w:pPr"))
            ind = None if ppr is None else ppr.find(qn("w:ind"))
            return None if ind is None else ind.get(qn("w:right"))
    return "MISSING"


# F4-1: a continuous break with the document's own page setup changes nothing.
_r, _ = f4_run(f4_doc_with_sect())
check(f4_sect_count(_r) == 1, "F4-1: inert continuous break not removed (%d sectPr)"
      % f4_sect_count(_r))
check([p.text for p in _r.paragraphs] == ["first", "second"],
      "F4-1: removing the break lost a paragraph")

# F4-2: different margins mean the break is doing work - keep it.
_r, _ = f4_run(f4_doc_with_sect(
    tweak=lambda s: s.find(qn("w:pgMar")).set(qn("w:left"), "2880")))
check(f4_sect_count(_r) == 2, "F4-2: dropped a break that changes the margins")

# F4-3: a page break is visible output even when the geometry matches.
_r, _ = f4_run(f4_doc_with_sect(kind="nextPage"))
check(f4_sect_count(_r) == 2, "F4-3: dropped a nextPage section break")

# F4-3b: a continuous break that changes the column count stays.
_r, _ = f4_run(f4_doc_with_sect(
    tweak=lambda s: s.append(parse_xml('<w:cols %s w:num="2"/>' % nsdecls("w")))))
check(f4_sect_count(_r) == 2, "F4-3b: dropped a break that starts two columns")

# F4-3c: the document's own body sectPr is never a candidate.
_r, _ = f4_run(Document())
check(f4_sect_count(_r) == 1, "F4-3c: removed the body sectPr")

# F4-4: the heading's trailing break and trailing space both go.
_d, _ = f4_heading("Maroun Daher ")
_r, _ = f4_run(_d)
check(_r.paragraphs[0].text == "Maroun Daher",
      "F4-4: heading tail not stripped: %r" % _r.paragraphs[0].text)
check(count_tag(f4_run(_d)[1], "w:br") == 0, "F4-4: trailing w:br survived")

# F4-5: a break INSIDE the heading is content - only the tail is noise.
_d, _ = f4_heading("Title", trailing_br=1, mid_br=True)
_r, out = f4_run(_d)
check(count_tag(out, "w:br") == 1, "F4-5: removed a mid-heading line break")
check("second line" in _r.paragraphs[0].text, "F4-5: lost text after the break")

# F4-6: body prose keeps its trailing break; only headings are cleaned.
_d = Document()
_p6 = _d.add_paragraph()
_p6.add_run("plain body text ")
_p6.add_run()._r.append(parse_xml("<w:br %s/>" % nsdecls("w")))
_r, out = f4_run(_d)
check(count_tag(out, "w:br") == 1, "F4-6: stripped a break from a Normal paragraph")
check(_r.paragraphs[0].text.startswith("plain body text "),
      "F4-6: rstripped a Normal paragraph: %r" % _r.paragraphs[0].text)

# F4-7: a heading made only of a break is left alone rather than emptied.
_d = Document()
_p7 = _d.add_paragraph(style="Heading 2")
_p7.add_run()._r.append(parse_xml("<w:br %s/>" % nsdecls("w")))
_r, out = f4_run(_d)
check(count_tag(out, "w:br") == 1, "F4-7: emptied a break-only heading")

# F4-8: one PDF line, nothing to its right -> the right indent is invented.
_pdf8 = f4_pdf([(42, 100, "Databases: SQL, SQLite")])
_r, _ = f4_run(f4_right_doc("Databases: SQL, SQLite"), _pdf8)
check(f4_right(_r, "Databases") == "0",
      "F4-8: phantom right indent kept: %r" % f4_right(_r, "Databases"))

# F4-9: something printed alongside is a real column - the indent stays.
_pdf9 = f4_pdf([(42, 100, "Databases: SQL, SQLite"), (400, 100, "right column")])
_r, _ = f4_run(f4_right_doc("Databases: SQL, SQLite"), _pdf9)
check(f4_right(_r, "Databases") == "1440",
      "F4-9: cleared the indent of a genuine narrow column")

# F4-10: no matching source line means no evidence either way.
_r, _ = f4_run(f4_right_doc("Databases: SQL, SQLite"),
               f4_pdf([(42, 100, "something else entirely")]))
check(f4_right(_r, "Databases") == "1440",
      "F4-10: cleared an indent with no matching PDF line")

# F4-11: two identical source lines are ambiguous - measure nothing.
_r, _ = f4_run(f4_right_doc("Databases: SQL, SQLite"),
               f4_pdf([(42, 100, "Databases: SQL, SQLite"),
                       (42, 200, "Databases: SQL, SQLite")]))
check(f4_right(_r, "Databases") == "1440",
      "F4-11: cleared an indent on an ambiguous match")

# F4-12: without the PDF the pass has no geometry, so it must not guess.
_r, _ = f4_run(f4_right_doc("Databases: SQL, SQLite"), None)
check(f4_right(_r, "Databases") == "1440",
      "F4-12: cleared a right indent with no PDF to check against")

# F4-13: a left indent and the paragraph text are never touched.
_r, _ = f4_run(f4_right_doc("Databases: SQL, SQLite"), _pdf8)
_ind13 = _r.paragraphs[0]._p.find(qn("w:pPr")).find(qn("w:ind"))
check(_ind13.get(qn("w:left")) == "10", "F4-13: rewrote the left indent")
check(_r.paragraphs[0].text == "Databases: SQL, SQLite",
      "F4-13: rewrote the paragraph text")

# F4-14: a document with none of the three marks comes back byte-identical.
_d14 = Document()
_d14.add_paragraph("nothing to clean here")
_buf14 = io.BytesIO()
_d14.save(_buf14)
_before14 = _buf14.getvalue()
check(de.stray_mark_cleanup(_before14, _pdf8) is _before14,
      "F4-14: rewrote a document it had nothing to change")


def f4_aligned_doc(text, jc, right=1440, style=None):
    """A right indent on a paragraph whose alignment PLACES the text."""
    d = Document()
    para = d.add_paragraph(text, style=style) if style else d.add_paragraph(text)
    ppr = para._p.get_or_add_pPr()
    ppr.append(parse_xml('<w:ind %s w:right="%d"/>' % (nsdecls("w"), right)))
    if jc:
        ppr.append(parse_xml('<w:jc %s w:val="%s"/>' % (nsdecls("w"), jc)))
    return d


# F4-15: on a RIGHT-aligned paragraph the indent is the position of the text,
# not a wrap boundary - clearing it slides the line to the right margin.
_r, _ = f4_run(f4_aligned_doc("Databases: SQL, SQLite", "right"), _pdf8)
check(f4_right(_r, "Databases") == "1440",
      "F4-15: cleared the right indent of a right-aligned paragraph: %r"
      % f4_right(_r, "Databases"))

# F4-15b: w:jc="end" is the same alignment under a different name.
_r, _ = f4_run(f4_aligned_doc("Databases: SQL, SQLite", "end"), _pdf8)
check(f4_right(_r, "Databases") == "1440",
      "F4-15b: cleared the right indent of an end-aligned paragraph")

# F4-16: centred text is positioned by both indents at once.
_r, _ = f4_run(f4_aligned_doc("Databases: SQL, SQLite", "center"), _pdf8)
check(f4_right(_r, "Databases") == "1440",
      "F4-16: cleared the right indent of a centred paragraph")

# F4-16b: the alignment can be inherited from the paragraph style, and an
# inherited w:jc positions the text exactly as a direct one does.
_d16 = f4_aligned_doc("Databases: SQL, SQLite", None, style="Heading 3")
for _st in _d16.styles.element.findall(qn("w:style")):
    if _st.get(qn("w:styleId")) == "Heading3":
        _st.find(qn("w:pPr")).append(
            parse_xml('<w:jc %s w:val="right"/>' % nsdecls("w")))
_r, _ = f4_run(_d16, _pdf8)
check(f4_right(_r, "Databases") == "1440",
      "F4-16b: cleared the indent of a paragraph right-aligned by its style")

# F4-16c: left and justified paragraphs are still cleared - the guard is
# narrow, not a blanket opt-out.
for _jc in ("left", "start", "both", None):
    _r, _ = f4_run(f4_aligned_doc("Databases: SQL, SQLite", _jc), _pdf8)
    check(f4_right(_r, "Databases") == "0",
          "F4-16c: stopped clearing a phantom indent on jc=%r" % _jc)


# F4-17: a heading that ends in a hyperlink keeps that link's own trailing
# space - the tail strip is about the heading's runs, not a link's label.
_d17 = Document()
_p17 = _d17.add_paragraph(style="Heading 1")
_p17.add_run("Contact ")
_link17 = parse_xml(
    '<w:hyperlink %s><w:r><w:t xml:space="preserve">home </w:t></w:r>'
    '</w:hyperlink>' % nsdecls("w", "r"))
_p17._p.append(_link17)
_r17, _ = f4_run(_d17)
_t17 = [t.text for t in _r17.paragraphs[0]._p.iter(qn("w:t"))]
check(_t17 == ["Contact ", "home "],
      "F4-17: rewrote text inside a heading's hyperlink: %r" % _t17)

# ---------------------------------------------------------------------------
# G2: illegible_shading_drop.  pdf2docx can sample the glyph colour instead of
# the band colour and emit it as w:shd/@w:fill, giving black text on a black
# bar.  The pass drops such a fill and NEVER touches a legible one.

def g2_doc(fill, colour, text="FORMATION", shd_val="clear", second=None,
           on_para=False):
    """One table cell (or one paragraph) shaded `fill` with `colour` text."""
    d = Document()
    if on_para:
        para = d.add_paragraph()
        holder = para._p
        pr = holder.get_or_add_pPr()
    else:
        tbl = d.add_table(rows=1, cols=1)
        cell = tbl.cell(0, 0)
        para = cell.paragraphs[0]
        holder = cell._tc
        pr = holder.get_or_add_tcPr()
    if fill is not None:
        pr.append(parse_xml('<w:shd %s w:val="%s" w:fill="%s"/>'
                            % (nsdecls("w"), shd_val, fill)))
    for body, col in [(text, colour)] + ([second] if second else []):
        run = para.add_run(body)
        if col is not None:
            run._r.get_or_add_rPr().append(
                parse_xml('<w:color %s w:val="%s"/>' % (nsdecls("w"), col)))
    return d, holder


def g2_run(d):
    buf = io.BytesIO()
    d.save(buf)
    out = de.illegible_shading_drop(buf.getvalue())
    return Document(io.BytesIO(out))


def g2_fills(doc):
    """Every surviving non-auto shading fill in the body, in document order."""
    out = []
    for el in doc.element.body.iter(qn("w:tc"), qn("w:p")):
        pr = (el.find(qn("w:tcPr")) if el.tag == qn("w:tc")
              else el.find(qn("w:pPr")))
        if pr is None:
            continue
        shd = pr.find(qn("w:shd"))
        if shd is not None and shd.get(qn("w:fill")):
            out.append(shd.get(qn("w:fill")))
    return out


def g2_text(doc):
    return "".join(t.text or "" for t in doc.element.body.iter(qn("w:t")))


# G2-1: the defect itself - black fill under black text loses the fill.
_d, _ = g2_doc("000000", "000000")
_r = g2_run(_d)
check(g2_fills(_r) == [], "G2-1: kept a black fill under black text: %r"
      % g2_fills(_r))
check(g2_text(_r) == "FORMATION", "G2-1: lost the heading text: %r" % g2_text(_r))

# G2-1b: the run colour itself is never rewritten - only the fill goes.
_col = [c.get(qn("w:val")) for c in _r.element.body.iter(qn("w:color"))]
check(_col == ["000000"], "G2-1b: rewrote the run colour: %r" % _col)

# G2-2: the near-black variant pdf2docx also emits (151A21 on 000000).
_d, _ = g2_doc("151A21", "000000")
check(g2_fills(g2_run(_d)) == [], "G2-2: kept a near-black fill under black text")

# G2-3: white on black is the point of a heading band - never touched.
_d, _ = g2_doc("000000", "FFFFFF")
check(g2_fills(g2_run(_d)) == ["000000"],
      "G2-3: dropped a legible white-on-black band")

# G2-4: dark text on a light band is the source layout - never touched.
_d, _ = g2_doc("D9D9D9", "1A1A1A")
check(g2_fills(g2_run(_d)) == ["D9D9D9"],
      "G2-4: dropped a legible dark-on-light band")

# G2-5: a mid-grey band that is merely low-contrast, not unreadable, stays.
# 404040 under 000000 is ratio 2.02 - just above the threshold.
_d, _ = g2_doc("404040", "000000")
check(g2_fills(g2_run(_d)) == ["404040"],
      "G2-5: dropped a fill above the contrast threshold")

# G2-6: an inherited (unset) run colour is a guess, so the fill survives.
_d, _ = g2_doc("000000", None)
check(g2_fills(g2_run(_d)) == ["000000"],
      "G2-6: dropped a fill under a run with no explicit colour")

# G2-6b: w:color="auto" is not a colour either.
_d, _ = g2_doc("000000", "auto")
check(g2_fills(g2_run(_d)) == ["000000"], "G2-6b: treated w:color=auto as black")

# G2-7: mixed legibility - one readable run means the band is deliberate.
_d, _ = g2_doc("000000", "000000", second=("VISIBLE", "FFFFFF"))
check(g2_fills(g2_run(_d)) == ["000000"],
      "G2-7: dropped a band that one of its runs is readable against")

# G2-8: an empty shaded cell is a drawn rule, not misread text.
_d, _ = g2_doc("000000", "000000", text="")
check(g2_fills(g2_run(_d)) == ["000000"], "G2-8: dropped an empty cell's fill")

# G2-9: a patterned shd is not one flat colour, so it is not a sampling error.
_d, _ = g2_doc("000000", "000000", shd_val="pct25")
check(g2_fills(g2_run(_d)) == ["000000"], "G2-9: dropped a patterned shading")

# G2-10: w:fill="auto" carries no colour to compare against.
_d, _ = g2_doc("auto", "000000")
check(g2_fills(g2_run(_d)) == ["auto"],
      "G2-10: invented a comparison for fill=auto")

# G2-11: the same repair applies to paragraph-level shading.
_d, _ = g2_doc("000000", "000000", on_para=True)
_r = g2_run(_d)
check(g2_fills(_r) == [], "G2-11: kept a black paragraph fill under black text")
check(g2_text(_r) == "FORMATION", "G2-11: lost the shaded paragraph's text")

# G2-12: a document with no shading at all comes back byte-identical.
_d = Document()
_d.add_paragraph("Ordinary prose that no pass should rewrite.")
_buf = io.BytesIO()
_d.save(_buf)
_bytes = _buf.getvalue()
check(de.illegible_shading_drop(_bytes) is _bytes,
      "G2-12: rewrote a document that has no shading")

# G2-13: a cell judges only its own paragraphs - a legible NESTED table inside
# it must not license an unreadable outer band, and vice versa.
_d = Document()
_outer = _d.add_table(rows=1, cols=1).cell(0, 0)
_outer._tc.get_or_add_tcPr().append(
    parse_xml('<w:shd %s w:val="clear" w:fill="000000"/>' % nsdecls("w")))
_orun = _outer.paragraphs[0].add_run("OUTER")
_orun._r.get_or_add_rPr().append(
    parse_xml('<w:color %s w:val="000000"/>' % nsdecls("w")))
_inner = _outer.add_table(rows=1, cols=1).cell(0, 0)
_irun = _inner.paragraphs[0].add_run("INNER")
_irun._r.get_or_add_rPr().append(
    parse_xml('<w:color %s w:val="FFFFFF"/>' % nsdecls("w")))
_r = g2_run(_d)
check(g2_fills(_r) == [], "G2-13: a nested cell's run blocked the outer repair")
check("OUTER" in g2_text(_r) and "INNER" in g2_text(_r),
      "G2-13: lost text while repairing a nested table")


print("hostile suite:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURES")
sys.exit(1 if FAILS else 0)
