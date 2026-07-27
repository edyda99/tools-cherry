"""Recover real text from stencil-text PDFs before pdf2docx conversion.

Some producers (Word plus certain sanitizer/DLP pipelines) draw body text as
1-bit glyph stencils: a 2x2-pixel colour chip stretched over the text line,
masked by a 600-dpi bitmap of the glyphs. No text layer exists, so pdf2docx
either drowns in the image swarm or, with chips filtered, emits empty pages.

This module rewrites such a PDF in place of the original:

  1. census   - tiny (<=8x8 intrinsic) images split into text stencils (smask)
                and shading fills (no smask); chips are shared across pages so
                nothing is mutated until every page has been read
  2. OCR      - tesseract runs per merged stencil block (psm 6), never per
                page: full-page layout analysis loses half the words inside
                bordered tables; the stencil rects say exactly where text is
  3. rewrite  - OCR words become real positioned text (colour sampled from the
                chip, size fitted to the OCR line and box), shading chips
                become vector rect fills, stencil chips are blanked
  4. rescue   - stencil rects no OCR word landed on (lone digits in table
                cells) get a targeted single-line pass

The result converts through pdf2docx like a born-digital PDF: editable text,
tables detected from the (vector) borders, real pictures untouched.

postprocess_docx() then narrows run glyphs to 88% (the source face is
condensed - unscaled Helvetica re-wraps 2-line cells into 3) and raises the
handful of exact-height table rows whose text provably cannot fit, capped so a
mis-estimate cannot reflow the document.
"""
import csv
import io
import math
import re
import subprocess
import zipfile

import fitz

TINY = 64            # intrinsic w*h at or below this = colour chip, not a picture
DPI = 300
SCALE = 72.0 / DPI
FS = 0.60            # fontsize = OCR line height * FS
FIT = 0.93           # width-fit target: docx cells lose ~10pt to margins
PAD = 2.5            # stencil-rect merge/crop padding, points
MIN_STENCILS = 8     # fewer masked chips than this on every page = not a stencil doc
TESSERACT = "tesseract"


def is_stencil_pdf(doc):
    """True when any page draws enough masked colour chips to be stencil text."""
    for pg in doc:
        n = 0
        for im in pg.get_images(full=True):
            if im[2] * im[3] <= TINY and im[1]:
                n += 1
                if n >= MIN_STENCILS:
                    return True
    return False


def _chip_color(doc, xref):
    try:
        pix = fitz.Pixmap(doc, xref)
        if pix.colorspace is None or pix.colorspace.n != 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        n, s = pix.width * pix.height, pix.samples
        stride = len(s) // n
        return tuple(sum(s[i * stride + c] for i in range(n)) / n / 255 for c in range(3))
    except Exception:
        return (0.12, 0.12, 0.12)


def _merge_blocks(rects):
    blocks = []
    for r in rects:
        r = fitz.Rect(r.x0 - PAD, r.y0 - PAD, r.x1 + PAD, r.y1 + PAD)
        merged = True
        while merged:
            merged = False
            for i, b in enumerate(blocks):
                if r.intersects(b):
                    r |= b
                    del blocks[i]
                    merged = True
                    break
        blocks.append(r)
    return blocks


def _tsv_words(raw, ox, oy):
    """tesseract TSV -> [(line_height, [(abs_rect, text), ...])]."""
    lines = {}
    rd = csv.DictReader(io.StringIO(raw), delimiter="\t")
    for row in rd:
        try:
            lvl = int(row["level"])
            x, y, w, h = (int(row[k]) for k in ("left", "top", "width", "height"))
            r = fitz.Rect(ox + x * SCALE, oy + y * SCALE,
                          ox + (x + w) * SCALE, oy + (y + h) * SCALE)
            key = (row["block_num"], row["par_num"], row["line_num"])
            if lvl == 4:
                lines[key] = (r.height, [])
            elif lvl == 5:
                text = row["text"].strip()
                conf = float(row["conf"])
                # short numerics carry table data but OCR at low confidence
                floor = 15 if (len(text) <= 2 and text and all(
                    c.isdigit() or c in "-–." for c in text)) else 40
                if text and conf >= floor and key in lines:
                    lines[key][1].append((r, text))
        except (KeyError, ValueError):
            continue
    return [v for v in lines.values() if v[1]]


def _ocr(png, psm):
    p = subprocess.run([TESSERACT, "stdin", "stdout", "--dpi", str(DPI),
                        "--psm", str(psm), "tsv"], input=png, capture_output=True)
    return p.stdout.decode("utf8", "ignore")


def _ocr_block(pg, clip):
    clip = clip & pg.rect
    if clip.is_empty or clip.width < 3 or clip.height < 3:
        return []
    png = pg.get_pixmap(dpi=DPI, clip=clip).tobytes("png")
    return _tsv_words(_ocr(png, 6), clip.x0, clip.y0)


def _ocr_rect(pg, rect):
    """Single-line pass over one rect the block pass missed."""
    clip = fitz.Rect(rect.x0 - 1.5, rect.y0 - 1.5, rect.x1 + 1.5, rect.y1 + 1.5) & pg.rect
    if clip.is_empty or clip.width < 2 or clip.height < 2:
        return None
    try:
        png = pg.get_pixmap(dpi=DPI, clip=clip).tobytes("png")
    except Exception:
        return None
    words = []
    rd = csv.DictReader(io.StringIO(_ocr(png, 7)), delimiter="\t")
    for row in rd:
        try:
            if int(row["level"]) == 5 and row["text"].strip() and float(row["conf"]) >= 50:
                words.append(row["text"].strip())
        except (KeyError, ValueError):
            continue
    return " ".join(words) or None


def recover_text(doc):
    """Rewrite a stencil-text document with real OCR text. Mutates doc."""
    # PASS 1 - read everything first: chips are shared doc-wide, and blanking
    # one on page N erases it from every later page's render
    plan, kill = [], set()
    for pg in doc:
        stencil, fills = [], []
        for im in pg.get_images(full=True):
            xref, smask, w, h = im[0], im[1], im[2], im[3]
            if w * h > TINY:
                continue
            col = _chip_color(doc, xref)
            rects = pg.get_image_rects(xref)
            (stencil if smask else fills).extend((r, col) for r in rects)
            kill.add(xref)
        seen, uniq = set(), []
        for r, c in stencil:
            k = (round(r.x0), round(r.y0), round(r.x1), round(r.y1))
            if k not in seen:
                seen.add(k)
                uniq.append((r, c))
        plan.append((uniq, fills))

    # PASS 2 - OCR blocks and write real text + vector fills into each page
    for pg, (stencil, fills) in zip(doc, plan):
        for r, col in fills:
            pg.draw_rect(r, color=None, fill=col, overlay=False)
        if not stencil:
            continue
        # never duplicate genuine text; a word box taller than a line is a
        # corrupt text object (sanitizers leave these) and must not veto a region
        exclude = [r for r in (fitz.Rect(w[:4]) for w in pg.get_text("words"))
                   if r.height <= 30 and r.width <= 250]

        def excluded(wr):
            a = wr.get_area()
            return any(wr.intersects(ex) and (wr & ex).get_area() > 0.5 * a
                       for ex in exclude)

        def chip_col(wr):
            best, bc = 0.0, (0.12, 0.12, 0.12)
            for cr, col in stencil:
                if wr.intersects(cr):
                    ov = (wr & cr).get_area()
                    if ov > best:
                        best, bc = ov, col
            return bc

        inserted = []
        for block in _merge_blocks([r for r, _ in stencil]):
            for line_h, words in _ocr_block(pg, block):
                fs_line = max(5.0, min(26.0, line_h * FS))
                words = [w for w in words if not excluded(w[0])]
                # split the OCR line at gaps wide enough to be table-column
                # boundaries; each segment becomes ONE naturally-spaced run
                segs, cur = [], []
                for wr, text in words:
                    if cur and wr.x0 - cur[-1][0].x1 > max(6.0, 0.9 * line_h):
                        segs.append(cur)
                        cur = []
                    cur.append((wr, text))
                if cur:
                    segs.append(cur)
                for seg in segs:
                    srect = fitz.Rect(seg[0][0])
                    for wr, _ in seg[1:]:
                        srect |= wr
                    text = " ".join(t for _, t in seg)
                    fs = fs_line
                    tw = fitz.get_text_length(text, fontname="helv", fontsize=fs)
                    if tw > FIT * srect.width and tw > 0:
                        fs = max(4.5, fs * FIT * srect.width / tw)
                    pg.insert_text((srect.x0, srect.y1 - 0.24 * srect.height), text,
                                   fontsize=fs, fontname="helv", color=chip_col(srect))
                    inserted.append(srect)
        # rescue: rects the block pass never covered (lone digits in cells)
        for cr, col in stencil:
            if cr.width < 3 or cr.height < 3 or cr.height > 16:
                continue
            if any(cr.intersects(w) for w in inserted) or excluded(cr):
                continue
            text = _ocr_rect(pg, cr)
            if not text or not any(c.isalnum() or c in "-–" for c in text):
                continue
            fs = max(4.5, min(12.0, cr.height * 0.68))
            tw = fitz.get_text_length(text, fontname="helv", fontsize=fs)
            if tw > FIT * cr.width and tw > 0:
                fs = max(4.5, fs * FIT * cr.width / tw)
            pg.insert_text((cr.x0 + 1, cr.y1 - 0.24 * cr.height), text,
                           fontsize=fs, fontname="helv", color=col)

    # blank the chips last (transparent 1x1 swap is doc-wide per xref)
    removed = set()
    for pg in doc:
        for im in pg.get_images(full=True):
            if im[0] in kill and im[0] not in removed:
                try:
                    pg.delete_image(im[0])
                    removed.add(im[0])
                except Exception:
                    pass


# --------------------------------------------------------------------------- #
# docx post-pass                                                              #
# --------------------------------------------------------------------------- #
_CHAR_W = 0.5 * 0.88   # helv average char width x the 88% horizontal scale
_LINE_H = 1.45


def _needed_height_twips(tr):
    need = 0
    for tc in re.findall(r"<w:tc>.*?</w:tc>", tr, re.S):
        m = re.search(r'<w:tcW[^>]*w:w="(\d+)"', tc)
        if not m:
            continue
        usable = max(int(m.group(1)) - 216, 100)
        cell_need = 0
        for p in re.findall(r"<w:p\b.*?</w:p>", tc, re.S):
            runs = re.findall(r'<w:sz w:val="(\d+)"/>.*?<w:t[^>]*>([^<]*)</w:t>', p, re.S)
            if not runs:
                continue
            sz = max(int(s) for s, _ in runs)
            text = "".join(t for _, t in runs)
            lines = max(1, math.ceil(len(text) * sz * 10 * _CHAR_W / usable))
            cell_need += lines * sz * 10 * _LINE_H
        need = max(need, cell_need)
    return int(need)


def postprocess_docx(data):
    """Narrow run glyphs to 88% and raise provably-overflowing exact rows."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        docs = {n: z.read(n) for n in names}
    xml = docs["word/document.xml"].decode("utf8")

    xml = xml.replace("<w:rPr><w:rFonts", '<w:rPr><w:w w:val="88"/><w:rFonts')

    out, pos = [], 0
    for m in re.finditer(r"<w:tr\b.*?</w:tr>", xml, re.S):
        tr = m.group(0)
        hm = re.search(r'<w:trHeight w:hRule="exact" w:val="(\d+)"/>', tr)
        if hm:
            have, need = int(hm.group(1)), _needed_height_twips(tr)
            if need > have:
                # the estimate is rough - grant at most ~1.5 extra text lines
                grant = min(need, have + 260)
                tr = tr.replace(hm.group(0),
                                f'<w:trHeight w:hRule="exact" w:val="{grant}"/>', 1)
        out.append(xml[pos:m.start()])
        out.append(tr)
        pos = m.end()
    out.append(xml[pos:])
    docs["word/document.xml"] = "".join(out).encode("utf8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, docs[n])
    return buf.getvalue()
