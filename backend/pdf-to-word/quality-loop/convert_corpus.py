"""Convert the corpus through the same pipeline the Lambda runs, locally.

Mirrors lambda_function._convert(): fill-chip filter + span-repair wiring at import,
stencil detection -> OCR recovery, pdf2docx, stencil postprocess, then the
docx_enhance.enhance() seam the quality loop iterates on. The only prod step skipped
is _shrink_docx_images (JPEG recompression), which cannot affect structure or text.

Usage:  venv/bin/python convert_corpus.py <outdir> [name ...]
        (default: every corpus/*.pdf)
"""
import io
import json
import logging
import pathlib
import sys
import time

BASE = pathlib.Path(__file__).resolve().parent
BACKEND = BASE.parent
sys.path.insert(0, str(BACKEND))

import fitz

TINY_IMAGE_PX = 64 * 64  # keep in sync with lambda_function.TINY_IMAGE_PX

_original_get_images = fitz.Page.get_images


def _filtered_get_images(self, full=False):
    return [im for im in _original_get_images(self, full=full) if im[2] * im[3] > TINY_IMAGE_PX]


fitz.Page.get_images = _filtered_get_images

from pdf2docx import Converter  # noqa: E402  (must import after the patch)
import stencil_ocr  # noqa: E402
import docx_enhance  # noqa: E402

stencil_ocr.set_raw_get_images(_original_get_images)
stencil_ocr.install_span_repair()
logging.disable(logging.WARNING)  # pdf2docx is chatty


def convert_one(pdf_path, out_path):
    doc = fitz.open(pdf_path)
    stenciled = stencil_ocr.is_stencil_pdf(doc)
    src = str(pdf_path)
    if stenciled:
        stencil_ocr.recover_text(doc)
        src = str(out_path) + ".ocr.pdf"
        doc.save(src, garbage=4, deflate=True)
    doc.close()

    stencil_ocr.set_span_repair(stenciled)
    try:
        cv = Converter(src)
        cv.convert(str(out_path))
        cv.close()
    finally:
        stencil_ocr.set_span_repair(False)

    data = out_path.read_bytes()
    if stenciled:
        data = stencil_ocr.postprocess_docx(data)
    pdf_doc = fitz.open(pdf_path)
    try:
        data = docx_enhance.enhance(data, pdf_doc)
    finally:
        pdf_doc.close()
    out_path.write_bytes(data)
    return stenciled


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: convert_corpus.py <outdir> [name ...]")
    outdir = pathlib.Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    names = sys.argv[2:] or sorted(p.stem for p in (BASE / "corpus").glob("*.pdf"))
    timings = {}
    for name in names:
        pdf = BASE / "corpus" / f"{name}.pdf"
        out = outdir / f"{name}.docx"
        t0 = time.time()
        try:
            stenciled = convert_one(pdf, out)
        except Exception as e:
            timings[name] = {"error": f"{type(e).__name__}: {e}"}
            print(f"{name}: FAILED {type(e).__name__}: {e}")
            continue
        timings[name] = {"s": round(time.time() - t0, 2), "stencil": stenciled}
        print(f"{name}: {timings[name]['s']}s{' (stencil)' if stenciled else ''}")
    (outdir / "timings.json").write_text(json.dumps(timings, indent=1))


if __name__ == "__main__":
    main()
