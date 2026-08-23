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

# === header/footer pass ===============================================import fitz


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

print("hostile suite:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURES")
sys.exit(1 if FAILS else 0)
