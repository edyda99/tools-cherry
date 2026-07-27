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
  3. rewrite  - OCR words become real positioned text: colour sampled from the
                chip, size fitted to the WIDTH the glyphs occupy, weight taken
                from the measured stem thickness; shading chips become vector
                rect fills and stencil chips are blanked
  4. rescue   - stencil rects no OCR word landed on (lone digits in table
                cells) get a targeted single-line pass

install_span_repair() then guards the hand-off: these files also carry the
document's words as hidden zero-advance text, which pdf2docx would otherwise
emit a second time, mispositioned, on top of everything above.

The result converts through pdf2docx like a born-digital PDF: editable text,
tables detected from the (vector) borders, real pictures untouched.

postprocess_docx() shrinks the few cell lines pdf2docx gave a narrower column
than the page had, then raises the exact-height rows whose text provably
cannot fit, capped so a mis-estimate cannot reflow the document.
"""
import csv
import io
import math
import os
import re
import subprocess
import zipfile

import fitz
import numpy as np

TINY = 64            # intrinsic w*h at or below this = colour chip, not a picture
DPI = 300
SCALE = 72.0 / DPI
FIT = 0.97           # width-fit target: the run must not wrap inside its docx cell
H_CAP = 1.12         # fontsize ceiling as a multiple of the OCR line height
FS_MAX = 44.0
FS_MIN = 4.5
PAD = 2.5            # stencil-rect merge/crop padding, points
MIN_STENCILS = 8     # fewer masked chips than this on every page = not a stencil doc
BOLD_RATIO = 0.145   # stem thickness / em above which a run is set in bold
INK_DELTA = 60       # |pixel - local background| above this counts as ink
TESSERACT = "tesseract"
DEBUG = bool(os.environ.get("STENCIL_DEBUG"))

# lambda_function monkey-patches fitz.Page.get_images to hide colour chips from
# pdf2docx - which would blind this module to the very chips it exists to find.
# It hands us the unpatched original via set_raw_get_images() at import time.
_raw_get_images = None


def set_raw_get_images(fn):
    global _raw_get_images
    _raw_get_images = fn


def _get_images(pg, full=False):
    if _raw_get_images is not None:
        return _raw_get_images(pg, full=full)
    return pg.get_images(full=full)


def is_stencil_pdf(doc):
    """True when any page draws enough masked colour chips to be stencil text."""
    for pg in doc:
        n = 0
        for im in _get_images(pg, full=True):
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


def _render(pg, clip):
    """(png for tesseract, greyscale array for stroke measurement, clip used)."""
    clip = clip & pg.rect
    if clip.is_empty or clip.width < 3 or clip.height < 3:
        return None, None, clip
    pm = pg.get_pixmap(dpi=DPI, clip=clip)
    arr = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, pm.n)
    # luma, not min/max: text may be dark on light OR white on a coloured band
    gray = (arr[:, :, 0] if pm.n < 3 else
            (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]))
    return pm.tobytes("png"), gray.astype(np.int16), clip


def _ocr_block(pg, clip):
    png, gray, clip = _render(pg, clip)
    if png is None:
        return [], None, clip
    return _tsv_words(_ocr(png, 6), clip.x0, clip.y0), gray, clip


def _stroke_ratio(gray, clip, rect, fs):
    """Mean horizontal ink-run thickness over the em box: the stem weight.

    Ink is measured against the LOCAL background, so white-on-teal table
    headers weigh the same as black-on-white body text, and coverage is summed
    from the anti-aliased greys rather than a binary threshold - at 300 dpi a
    7pt stem is only ~2.5 px wide, and rounding that to whole pixels made every
    small run look bold. Measured on this report: regular 0.09-0.14, bold
    0.15-0.21.
    """
    if gray is None or fs <= 0:
        return None
    x0 = int(max(0, (rect.x0 - clip.x0) / SCALE))
    x1 = int(min(gray.shape[1], (rect.x1 - clip.x0) / SCALE + 1))
    y0 = int(max(0, (rect.y0 - clip.y0) / SCALE))
    y1 = int(min(gray.shape[0], (rect.y1 - clip.y0) / SCALE + 1))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    crop = np.abs(gray[y0:y1, x0:x1] - int(np.median(gray[y0:y1, x0:x1])))
    ink = crop > INK_DELTA
    if ink.sum() < 40:
        return None
    pad = np.zeros((ink.shape[0], 1), dtype=bool)
    flat = np.hstack([pad, ink, pad]).ravel()
    edges = np.flatnonzero(flat[1:] != flat[:-1])
    n_runs = edges.size // 2
    if n_runs < 6:
        return None
    coverage = float(crop.clip(0, 255).sum()) / 255.0
    return coverage / n_runs / (fs / SCALE)


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


_repair_spans = False


def _repair_raw_dict(raw):
    """Drop hidden glyphs and re-derive every span box from the glyphs drawn.

    The sanitiser keeps the document's words in the file but writes them with
    ZERO ADVANCE - 925 characters stacked on a single 2.8pt-wide spot, drawn
    with blank glyphs, the visible page being the stencil images on top.

    pdf2docx reads pages with get_text('rawdict', flags=64). Under those flags
    MuPDF merges consecutive spans of a line into one and reports the FIRST
    span's box and size, so such a hidden run swallows the OCR text we insert
    after it and hands pdf2docx a 2.8pt-wide "span" holding half a page of
    words: the cover title came out a second time as an 11pt run-on at the top
    of the page, the contacts block burst out of its cell. The same merge, in
    its harmless-looking form, glues a real bullet glyph to the OCR line beside
    it and reports the pair with the bullet's 5pt box.

    Redacting the hidden runs out of the PDF does not work - MuPDF skips
    zero-area glyph quads - so the repair happens on the way out instead:
    hidden glyphs are dropped, and each remaining span is measured from the
    glyphs that are actually painted.
    """
    for b in raw.get("blocks", ()):
        if b.get("type") != 0:
            continue
        lines = []
        for ln in b.get("lines", ()):
            spans = []
            for s in ln.get("spans", ()):
                chars = s.get("chars")
                if not chars:
                    spans.append(s)
                    continue
                drawn = [c for c in chars
                         if c["bbox"][2] - c["bbox"][0] >= 0.05 * s["size"]]
                ink = [c for c in drawn if c["c"].strip()]
                if not ink:
                    continue
                if len(drawn) != len(chars):
                    s["chars"] = drawn
                r = fitz.Rect(ink[0]["bbox"])
                for c in ink[1:]:
                    r |= fitz.Rect(c["bbox"])
                s["bbox"] = tuple(r)
                spans.append(s)
            if not spans:
                continue
            r = fitz.Rect(spans[0]["bbox"])
            for s in spans[1:]:
                r |= fitz.Rect(s["bbox"])
            ln["spans"] = spans
            ln["bbox"] = tuple(r)
            lines.append(ln)
        b["lines"] = lines
        if lines:
            r = fitz.Rect(lines[0]["bbox"])
            for ln in lines[1:]:
                r |= fitz.Rect(ln["bbox"])
            b["bbox"] = tuple(r)
    raw["blocks"] = [b for b in raw.get("blocks", ())
                     if b.get("type") != 0 or b.get("lines")]
    return raw


def install_span_repair():
    """Patch fitz.Page.get_text so the repair reaches pdf2docx.

    Armed only once recover_text() has run, i.e. only for the stencil-text
    documents that need it; every other conversion sees stock PyMuPDF.
    """
    original = fitz.Page.get_text

    def get_text(self, option="text", **kwargs):
        res = original(self, option, **kwargs)
        if _repair_spans and option == "rawdict" and isinstance(res, dict):
            return _repair_raw_dict(res)
        return res

    fitz.Page.get_text = get_text


def set_span_repair(on):
    """Arm/disarm the repair. Lambda containers are reused, so it must be per
    conversion: a stencil document must not leave it armed for the next file."""
    global _repair_spans
    _repair_spans = bool(on)


def recover_text(doc):
    """Rewrite a stencil-text document with real OCR text. Mutates doc."""
    # PASS 1 - read everything first: chips are shared doc-wide, and blanking
    # one on page N erases it from every later page's render
    plan, kill = [], set()
    for pg in doc:
        stencil, fills = [], []
        for im in _get_images(pg, full=True):
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
        # never duplicate the text that is genuinely on the page already
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
            lines, gray, clip = _ocr_block(pg, block)
            for line_h, words in lines:
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
                    # size from the WIDTH the glyphs actually occupy, capped by
                    # the line height. Height alone under-sizes badly (a 20pt
                    # title came out at 11pt); width reproduces the original
                    # line break-for-break, which is what keeps tables intact.
                    ratio = _stroke_ratio(gray, clip, srect, line_h)
                    # digits carry more ink per stem than letters, so a bare
                    # number in a table cell would read as bold at any usable
                    # threshold - never promote one
                    bold = (ratio is not None and ratio > BOLD_RATIO
                            and not text.replace(",", "").replace(".", "").isdigit())
                    font = "hebo" if bold else "helv"
                    unit = fitz.get_text_length(text, fontname=font, fontsize=1.0)
                    fs = line_h * H_CAP
                    if unit > 0:
                        fs = min(fs, FIT * srect.width / unit)
                    fs = max(FS_MIN, min(FS_MAX, fs))
                    if DEBUG:
                        print(f"    seg fs={fs:5.1f} lh={line_h:5.1f} "
                              f"r={ratio if ratio is None else round(ratio, 3)} "
                              f"{'B' if bold else ' '} {text[:60]!r}")
                    pg.insert_text((srect.x0, srect.y1 - 0.22 * srect.height), text,
                                   fontsize=fs, fontname=font, color=chip_col(srect))
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
        for im in _get_images(pg, full=True):
            if im[0] in kill and im[0] not in removed:
                try:
                    pg.delete_image(im[0])
                    removed.add(im[0])
                except Exception:
                    pass


# --------------------------------------------------------------------------- #
# docx post-pass                                                              #
# --------------------------------------------------------------------------- #
_CHAR_W = 0.5          # helv average char width, in em
MAX_SHRINK_OVERFLOW = 1.7  # wider than this = wrapped body text, not a long line
MIN_SHRINK = 0.72          # never scale a run below this
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


_RUN_RE = re.compile(r"<w:r>(?:(?!</w:r>).)*</w:r>", re.S)
_SZ_RE = re.compile(r'<w:sz w:val="(\d+)"/>')
_TXT_RE = re.compile(r"<w:t[^>]*>([^<]*)</w:t>", re.S)


def _shrink_overflowing_lines(xml):
    """Shrink the few single-line cells whose run is wider than its column.

    Each OCR run is sized to the width the words occupy on the page, which is
    right until pdf2docx gives the cell a narrower column than the source had
    (a heading that spanned two columns, say). Word would wrap that line and
    push the table around, so those lines - and only those - are scaled down to
    fit. A paragraph that is far too wide is genuine wrapped body text and is
    left alone.
    """
    def fix_cell(mc):
        tc = mc.group(0)
        wm = re.search(r'<w:tcW[^>]*w:w="(\d+)"', tc)
        if not wm:
            return tc
        usable = (int(wm.group(1)) - 216) / 20.0
        if usable < 20:
            return tc

        def fix_par(mp):
            par = mp.group(0)
            runs = []
            for mr in _RUN_RE.finditer(par):
                sm, tm = _SZ_RE.search(mr.group(0)), _TXT_RE.search(mr.group(0))
                if sm and tm and tm.group(1):
                    runs.append((int(sm.group(1)), tm.group(1),
                                 "<w:b/>" in mr.group(0)))
            if not runs:
                return par
            width = sum(fitz.get_text_length(t, fontsize=sz / 2.0,
                                             fontname="hebo" if b else "helv")
                        for sz, t, b in runs)
            if width <= usable or width > MAX_SHRINK_OVERFLOW * usable:
                return par
            scale = max(MIN_SHRINK, usable / width)
            # one pass over the sizes: replacing them by value could rescale a
            # run twice, once for its own size and again for a later one
            return re.sub(r'<w:(sz|szCs) w:val="(\d+)"/>',
                          lambda m: f'<w:{m.group(1)} w:val='
                                    f'"{max(9, int(int(m.group(2)) * scale))}"/>',
                          par)

        return re.sub(r"<w:p\b(?:(?!</w:p>).)*</w:p>", fix_par, tc, flags=re.S)

    return re.sub(r"<w:tc>(?:(?!</w:tc>).)*</w:tc>", fix_cell, xml, flags=re.S)


def postprocess_docx(data):
    """Fit over-wide cell lines, then raise rows whose text cannot fit."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        docs = {n: z.read(n) for n in names}
    xml = _shrink_overflowing_lines(docs["word/document.xml"].decode("utf8"))

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
