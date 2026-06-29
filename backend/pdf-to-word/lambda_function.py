"""AWS Lambda handler: convert an uploaded PDF to a Word (.docx) document.

Invoked via a Lambda Function URL. The frontend POSTs raw PDF bytes
(Content-Type: application/pdf); the Function URL delivers them base64-encoded.
We convert with pdf2docx and return the .docx, also base64-encoded.
"""

import base64
import io
import json
import os
import time
import zipfile

from pdf2docx import Converter
from PIL import Image

# Recompress embedded images larger than this; cap their longest side; JPEG quality.
IMG_RECOMPRESS_THRESHOLD = 300_000
IMG_MAX_SIDE = 4000
JPEG_QUALITY = 85

# Function URL hard-caps request/response payloads at 6 MB. Leave headroom.
MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 50  # bound per-invocation work so a crafted PDF can't max the 60s timeout

CORS = {
    "Access-Control-Allow-Origin": os.environ.get("ALLOW_ORIGIN", "*"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, cf-turnstile-token",
}


def _resp(status, body, headers=None, b64=False):
    h = dict(CORS)
    if headers:
        h.update(headers)
    return {"statusCode": status, "headers": h, "body": body, "isBase64Encoded": b64}


def _err(status, msg):
    return _resp(status, json.dumps({"error": msg}), {"Content-Type": "application/json"})


def _shrink_docx_images(docx_bytes):
    """Recompress large lossless (PNG) images inside a .docx to JPEG.

    pdf2docx extracts embedded photos as lossless PNG, so a single photo page can
    turn a ~1.5 MB PDF into a ~5 MB .docx and blow the Function URL's 6 MB response
    cap. Re-encoding those images to JPEG shrinks them ~10x with no visible quality
    loss. Fully guarded: on any error it returns the original bytes, so it can never
    break an otherwise-good conversion. Text/vector PDFs are untouched (their images
    are below the threshold and skipped).
    """
    try:
        zin = zipfile.ZipFile(io.BytesIO(docx_bytes), "r")
        items = {n: zin.read(n) for n in zin.namelist()}
        zin.close()
    except Exception:
        return docx_bytes

    renames = {}
    for name in [n for n in items if n.startswith("word/media/")]:
        if name.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg"):
            continue
        data = items[name]
        if len(data) < IMG_RECOMPRESS_THRESHOLD:
            continue
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
                im = Image.alpha_composite(bg, im).convert("RGB")
            else:
                im = im.convert("RGB")
            w, h = im.size
            scale = min(1.0, IMG_MAX_SIDE / max(w, h))
            if scale < 1.0:
                im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
            jpg = buf.getvalue()
        except Exception:
            continue
        if len(jpg) >= len(data):  # recompression didn't help; keep the original
            continue
        newname = name.rsplit(".", 1)[0] + ".jpg"
        del items[name]
        items[newname] = jpg
        renames[name.split("/")[-1]] = newname.split("/")[-1]

    if not renames:
        return docx_bytes

    # Patch image references: .rels Targets point at media/imageN.png -> .jpg, and
    # [Content_Types].xml needs a jpg default. (document.xml refers to images by
    # rId, not filename, so only the .rels Targets change.)
    for n in [x for x in items if x.endswith(".rels")]:
        t = items[n].decode("utf-8", "replace")
        for old, new in renames.items():
            t = t.replace("media/" + old, "media/" + new)
        items[n] = t.encode("utf-8")
    ct = items.get("[Content_Types].xml", b"").decode("utf-8", "replace")
    if ct and 'Extension="jpg"' not in ct:
        ct = ct.replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>')
        items["[Content_Types].xml"] = ct.encode("utf-8")

    try:
        out = io.BytesIO()
        zo = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
        for n, d in items.items():
            zo.writestr(n, d)
        zo.close()
        return out.getvalue()
    except Exception:
        return docx_bytes


def handler(event, context):
    t0 = time.time()
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if method == "OPTIONS":
        return _resp(200, "")
    if method != "POST":
        return _err(405, "Method not allowed")

    # Auth happens at the Function URL (AWS_IAM): only SigV4-signed requests from the
    # Cloudflare gate's scoped IAM user reach this handler, so no in-handler secret is
    # needed. Unsigned/forged hits are rejected by AWS before invocation, at $0.
    raw = event.get("body") or ""
    try:
        data = base64.b64decode(raw) if event.get("isBase64Encoded") else raw.encode()
    except Exception:
        return _err(400, "Invalid request body")

    if not data:
        return _err(400, "Empty body")
    if len(data) > MAX_BYTES:
        return _err(413, "PDF too large (max 5 MB)")
    if data[:5] != b"%PDF-":
        return _err(415, "Not a PDF")

    # Bound per-invocation work: reject pathological page counts so a crafted PDF
    # can't deterministically run the function to its 60s timeout. (Turnstile is
    # verified at the Cloudflare edge; the IAM-authed Function URL is this Lambda's
    # auth, so no in-handler token check is needed.)
    try:
        import fitz  # PyMuPDF, a pdf2docx dependency

        with fitz.open(stream=data, filetype="pdf") as _doc:
            pages = _doc.page_count
    except Exception:
        return _err(415, "Could not read that PDF.")
    if pages > MAX_PAGES:
        return _err(413, f"That PDF has {pages} pages; the limit is {MAX_PAGES}.")

    in_path, out_path = "/tmp/in.pdf", "/tmp/out.docx"
    for p in (in_path, out_path):
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
    with open(in_path, "wb") as f:
        f.write(data)

    try:
        cv = Converter(in_path)
        cv.convert(out_path)
        cv.close()
    except Exception as e:  # noqa: BLE001 - surface any conversion error to the client
        return _err(500, f"Conversion failed: {e}")

    with open(out_path, "rb") as f:
        out = f.read()

    # pdf2docx re-saves embedded photos as lossless PNG, so a photo PDF's .docx can
    # balloon ~10x and blow the Function URL's 6 MB response cap. Recompress those
    # images back to JPEG (visually ~identical) so the file fits — this turns most
    # "too large" cases into successful conversions. Text/vector PDFs are untouched.
    out = _shrink_docx_images(out)

    # Final safety net: if even the recompressed .docx still exceeds the ~6 MB
    # response cap (e.g. a many-page photo PDF), return a clean error instead of
    # crashing the runtime, and steer the user to the in-browser converter.
    body = base64.b64encode(out).decode("ascii")
    over_cap = len(body) > 6_200_000
    # One structured metric line per conversion — sizes only, no filename/content/PII.
    # Powers the over-cap-rate dashboard via CloudWatch Logs Insights (filter m="conv").
    print(json.dumps({
        "m": "conv",
        "in": len(data),
        "out": len(out),
        "b64": len(body),
        "pages": pages,
        "over": over_cap,
        "ms": int((time.time() - t0) * 1000),
    }))
    if over_cap:
        return _err(413, "The converted Word file is too large for the server path. Use the in-browser converter above — it has no size limit.")

    return _resp(
        200,
        body,
        {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": 'attachment; filename="converted.docx"',
        },
        b64=True,
    )
