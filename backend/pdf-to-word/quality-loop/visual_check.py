#!/usr/bin/env python3
"""Visual gate: render each corpus PDF page beside the converted DOCX page.

For every <name>.docx in the given out dir that has a corpus/<name>.pdf sibling,
convert the docx to PDF via Microsoft Word (AppleScript), rasterize both sides with
PyMuPDF, and write side-by-side composites to <out>/visual/<name>-pN.png.
The reviewer (Claude) then Reads every composite and records a verdict in the
iteration log; layout regressions block acceptance the same way the score gate
does. Word itself renders the DOCX, so what you see is what users get; small
line-break drift vs the PDF is still normal (different layout engines).

Usage: venv/bin/python visual_check.py out/iterN [--docs a,b,c] [--dpi 110]
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus"
PANEL_H = 1000        # composite panel height in px
HEADER_H = 34
GUTTER = 24


# Word is the renderer (true user-side fidelity; LibreOffice headless hangs on
# this machine). The script only closes documents it opened — never other open
# docs, never Word itself. PDFs are saved next to the docx (Word's sandbox has
# access there after open) and then moved into render_dir.
WORD_SCRIPT = '''
on run argv
    tell application "Microsoft Word"
        repeat with i from 1 to (count of argv) by 2
            set inPath to item i of argv
            set outPath to item (i + 1) of argv
            open inPath
            set d to active document
            save as d file format format PDF file name outPath
            close d saving no
        end repeat
    end tell
end run
'''


def ql_convert(docx_paths, render_dir):
    """First-page renders via the QuickLook thumbnail engine (true layout,
    no permissions needed, instant). Only page 1 per docx — multipage tails
    need --renderer soffice/word."""
    render_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["qlmanage", "-t", "-s", "1600", "-o", str(render_dir)] + [str(p) for p in docx_paths]
    subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    missing = []
    for p in docx_paths:
        raw = render_dir / f"{p.name}.png"
        if raw.exists():
            raw.replace(render_dir / f"{p.stem}.png")
        elif not (render_dir / f"{p.stem}.png").exists():
            missing.append(p.stem)
    if missing:
        sys.exit(f"qlmanage produced no thumbnail for {missing}")


def soffice_convert(docx_paths, render_dir):
    """Convert docx to PDF with headless LibreOffice using the warmed profile.

    First-ever run on a machine takes ~10 min building font caches (looks like
    a 99%-CPU hang; it is not); after that it is seconds. Needs an
    unsandboxed shell. Profile lives in quality-loop/.lo_profile.
    """
    render_dir.mkdir(parents=True, exist_ok=True)
    profile = HERE / ".lo_profile"
    cmd = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "--headless",
           "--norestore", f"-env:UserInstallation={profile.as_uri()}",
           "--convert-to", "pdf", "--outdir", str(render_dir)] + [str(p) for p in docx_paths]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    missing = [p.stem for p in docx_paths if not (render_dir / f"{p.stem}.pdf").exists()]
    if missing:
        sys.exit(f"soffice failed for {missing}\nstdout: {res.stdout}\nstderr: {res.stderr}")


def word_convert(docx_paths, render_dir):
    """Convert docx files to PDF by scripting Microsoft Word (one launch)."""
    render_dir.mkdir(parents=True, exist_ok=True)
    script = render_dir / ".word_convert.applescript"
    script.write_text(WORD_SCRIPT)
    args, tmp_pdfs = [], []
    for p in docx_paths:
        tmp = p.with_suffix(".render.pdf")
        args += [str(p.resolve()), str(tmp.resolve())]
        tmp_pdfs.append(tmp)
    res = subprocess.run(["osascript", str(script)] + args,
                         capture_output=True, text=True, timeout=600)
    if "-1743" in res.stderr:
        sys.exit("osascript is not authorized to control Microsoft Word — grant it in "
                 "System Settings > Privacy & Security > Automation, then rerun.")
    missing = []
    for p, tmp in zip(docx_paths, tmp_pdfs):
        if tmp.exists():
            tmp.replace(render_dir / f"{p.stem}.pdf")
        else:
            missing.append(p.stem)
    if missing:
        sys.exit(f"Word render failed for {missing}\nstderr: {res.stderr}")


def render_pages(pdf_path, dpi):
    if not pdf_path.exists():
        return []
    doc = fitz.open(pdf_path)
    pages = []
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        pages.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    doc.close()
    return pages


def scaled(img):
    w = round(img.width * PANEL_H / img.height)
    return img.resize((w, PANEL_H))


def blank_panel(width, note):
    img = Image.new("RGB", (width, PANEL_H), (225, 225, 225))
    ImageDraw.Draw(img).text((20, 20), note, fill=(90, 90, 90))
    return img


def compose(name, page_no, left, right, out_path):
    lw = left.width if left else (right.width if right else 800)
    rw = right.width if right else lw
    left = left or blank_panel(lw, "no such page in source PDF")
    right = right or blank_panel(rw, "no render for this page (QL renders page 1 only)")
    W = left.width + GUTTER + right.width
    canvas = Image.new("RGB", (W, HEADER_H + PANEL_H), (250, 250, 250))
    d = ImageDraw.Draw(canvas)
    d.text((6, 9), f"{name} p{page_no} | PDF source", fill=(0, 0, 0))
    d.text((left.width + GUTTER + 6, 9), "DOCX (converted, re-rendered)", fill=(0, 0, 0))
    canvas.paste(left, (0, HEADER_H))
    canvas.paste(right, (left.width + GUTTER, HEADER_H))
    d.rectangle(
        [left.width + GUTTER // 2 - 1, HEADER_H, left.width + GUTTER // 2 + 1, HEADER_H + PANEL_H],
        fill=(120, 120, 120),
    )
    canvas.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--docs", help="comma-separated doc names (default: all)")
    ap.add_argument("--dpi", type=int, default=110)
    ap.add_argument("--renderer", choices=["ql", "soffice", "word", "skip"], default="ql",
                    help="ql = QuickLook first-page thumbnails (default; no permissions); "
                         "skip = renders already in <out>/visual/render")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    docx_paths = sorted(out_dir.glob("*.docx"))
    if args.docs:
        keep = set(args.docs.split(","))
        docx_paths = [p for p in docx_paths if p.stem in keep]
    docx_paths = [p for p in docx_paths if (CORPUS / f"{p.stem}.pdf").exists()]
    if not docx_paths:
        sys.exit(f"no docx files with corpus siblings in {out_dir}")

    visual_dir = out_dir / "visual"
    visual_dir.mkdir(exist_ok=True)
    if args.renderer == "word":
        word_convert(docx_paths, visual_dir / "render")
    elif args.renderer == "soffice":
        soffice_convert(docx_paths, visual_dir / "render")
    elif args.renderer == "ql":
        ql_convert(docx_paths, visual_dir / "render")
    else:
        missing = [p.stem for p in docx_paths
                   if not (visual_dir / "render" / f"{p.stem}.pdf").exists()]
        if missing:
            sys.exit(f"--renderer skip but no rendered pdf for {missing}")

    manifest = {}
    for docx in docx_paths:
        name = docx.stem
        src_pages = [scaled(p) for p in render_pages(CORPUS / f"{name}.pdf", args.dpi)]
        conv_pdf = visual_dir / "render" / f"{name}.pdf"
        conv_png = visual_dir / "render" / f"{name}.png"
        if conv_pdf.exists():
            conv_pages = [scaled(p) for p in render_pages(conv_pdf, args.dpi)]
        elif conv_png.exists():
            conv_pages = [scaled(Image.open(conv_png).convert("RGB"))]
        else:
            conv_pages = []
        images = []
        for i in range(max(len(src_pages), len(conv_pages))):
            out_path = visual_dir / f"{name}-p{i + 1}.png"
            compose(
                name, i + 1,
                src_pages[i] if i < len(src_pages) else None,
                conv_pages[i] if i < len(conv_pages) else None,
                out_path,
            )
            images.append(out_path.name)
        manifest[name] = {
            "pdf_pages": len(src_pages),
            "docx_pages": len(conv_pages),
            "page_drift": len(conv_pages) - len(src_pages),
            "images": images,
            "renderer": args.renderer,
        }
        drift = manifest[name]["page_drift"]
        flag = "" if drift == 0 else f"  <-- page drift {drift:+d}"
        print(f"{name:18s} pdf={len(src_pages)}p docx={len(conv_pages)}p "
              f"-> {len(images)} composite(s){flag}")

    (visual_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"\ncomposites in {visual_dir}/ — Read every image and log the verdict.")


if __name__ == "__main__":
    main()
