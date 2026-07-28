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

print("hostile suite:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURES")
sys.exit(1 if FAILS else 0)
