"""AWS Lambda handler: convert an uploaded PDF to a Word (.docx) document.

Invoked via a Lambda Function URL. Two protocols share the one handler; which one
runs is detected from the decoded request body:

  1. Legacy INLINE path — body starts with ``%PDF-`` (raw PDF bytes; the Function
     URL delivers them base64-encoded). We convert with pdf2docx and return the
     .docx base64-encoded in the response. Capped at 5 MB in / ~6 MB out.

  2. R2 path — body is JSON ``{"key": "uploads/<uuid>.pdf"}``. We pull the PDF from
     the Cloudflare R2 bucket, convert it, and write the .docx back to R2 under
     ``results/<uuid>.docx``, returning only JSON metadata (no size cap on the
     result, since it never travels in the response). Lets the browser handle
     files far larger than the Function URL's 6 MB payload cap.

Anything that is neither a PDF nor R2-key JSON is rejected 415.
"""

import base64
import io
import json
import os
import re
import time
import uuid
import zipfile

import fitz  # PyMuPDF, pdf2docx's PDF engine — patched below before pdf2docx loads

from pdf2docx import Converter
from PIL import Image

import stencil_ocr


def _install_fill_chip_filter():
    """Hide sub-pixel-art "images" from pdf2docx, process-wide.

    pdf2docx reaches every image through fitz.Page.get_images, so one filter here
    covers extraction, grouping and the page re-renders it drives. See TINY_IMAGE_PX
    below for why these entries exist and what dropping them costs.
    """
    original = fitz.Page.get_images

    def get_images(self, full=False):
        return [im for im in original(self, full=full) if im[2] * im[3] > TINY_IMAGE_PX]

    fitz.Page.get_images = get_images
    # stencil_ocr must see the chips this filter hides
    stencil_ocr.set_raw_get_images(original)
    # and pdf2docx must not see the hidden zero-advance text a sanitiser leaves
    # behind; the repair stays dormant until a stencil document is recovered
    stencil_ocr.install_span_repair()

# Recompress embedded images larger than this; cap their longest side; JPEG quality.
IMG_RECOMPRESS_THRESHOLD = 300_000
IMG_MAX_SIDE = 4000
JPEG_QUALITY = 85

# Function URL hard-caps request/response payloads at 6 MB. Leave headroom.
MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 50  # bound per-invocation work so a crafted PDF can't max the 180s timeout

# CORRECTED 2026-07-29. The comment here used to say Word stores cell shading as a
# 2x2-pixel image instead of a colour. That is FALSE and was never measured. Word
# exports cell shading as a vector fill, as the PDF spec expects: a control Word PDF
# measured with PyMuPDF holds 148 grey and 142 blue filled paths at cell dimensions and
# ZERO images under 64 intrinsic pixels, and four other Word PDFs match. The document
# that triggered this work stores its own shading the same way, 936 cell-sized fills.
#
# What the tiny chips actually are: rasterised LINES OF TEXT. Every one of the 640
# distinct 2x2 XObjects in that report carries a soft mask, and the masks are
# text-line shaped, uniformly 110 px tall at widths from 100 to 858. A sanitizer or DLP
# pipeline flattened the body text into glyph stencils, which is why that PDF has only
# ~1,100 characters of selectable text across 19 pages. See stencil_ocr.py, whose
# docstring had this right all along.
#
# The performance story is unchanged and still correct. pdf2docx's ImagesExtractor
# collects every image occurrence, groups them by pairwise intersection (quadratic),
# then RE-RENDERS the page region for each group at 4x (converter.py:101,
# 'clip_image_res_ratio': 4.0; the 3.0 in ImagesExtractor's signature is a dead default
# the Converter never passes). Hundreds of adjacent stencils
# all intersect, so the report timed out at 60s and again at 180s. Profiling put the
# time in ImagesExtractor.extract_images -> Collection.group.
#
# So this filter is right, for a different reason than the old comment gave: the chips
# are not pictures, and pdf2docx cannot make text out of them anyway. They must still
# reach stencil_ocr, which OCRs them back into real positioned text, or the conversion
# emits empty pages. Filter on INTRINSIC pixel size, never on the drawn rectangle, since
# a stencil's rectangle is line-sized, which is why pdf2docx's own "ignore small images"
# test (bbox area <= 4) never catches one.
TINY_IMAGE_PX = 64  # 8x8 intrinsic and under: a fill, never a picture

# Even with chips filtered, a document can hold more real images than we can rebuild in
# the time available. Counted AFTER the filter, so shading never trips it. Mirrors
# MAX_SERVER_IMAGES in src/assets/pdf-to-word.js, which stops such files in the browser;
# this copy is what protects a caller posting straight at the API.
MAX_IMAGES = 400

_install_fill_chip_filter()

# R2 path: the PDF arrives via object storage, not the response, so it can be much
# larger than the inline 6 MB cap. Still bounded so a crafted PDF can't run the
# function to its 180s timeout / exhaust /tmp.
R2_MAX_MB = 25
R2_MAX_BYTES = R2_MAX_MB * 1024 * 1024

DEFAULT_R2_ENDPOINT = "https://42e1924f6e9903245ece8f5adb11d737.r2.cloudflarestorage.com"
DEFAULT_R2_BUCKET = "pdf-to-word-files"
# Only ever fetch upload keys this shape ("uploads/<uuid4>.pdf") — never an
# attacker-chosen arbitrary object.
R2_KEY_RE = re.compile(r"^uploads/[0-9a-f-]{36}\.pdf$")

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

CORS = {
    "Access-Control-Allow-Origin": os.environ.get("ALLOW_ORIGIN", "*"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, cf-turnstile-token",
}


class _HandlerError(Exception):
    """Carries an HTTP status + client-safe message up to the handler boundary."""

    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status
        self.msg = msg


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
    are below the threshold and skipped). Still worth running on the R2 path — a
    smaller result means less R2 storage + egress.
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


def _reset(*paths):
    for p in paths:
        try:
            os.remove(p)
        except FileNotFoundError:
            pass


def _pdf_pages(data):
    """Validate PDF magic + page count + image census on the raw bytes.

    Returns the page count. Shared by both protocols. Raises _HandlerError(415) for a
    non-PDF / unreadable file and _HandlerError(413) when the page count exceeds
    MAX_PAGES or the image count exceeds MAX_IMAGES — the same taxonomy the inline
    path has always used.
    """
    if data[:5] != b"%PDF-":
        raise _HandlerError(415, "Not a PDF")
    try:
        with fitz.open(stream=data, filetype="pdf") as _doc:
            pages = _doc.page_count
            images = 0
            # get_images is filtered (see _install_fill_chip_filter), so this counts
            # real pictures only. Stop early once it's hopeless; the exact total
            # doesn't change the answer.
            for _page in _doc:
                images += len(_page.get_images())
                if images > MAX_IMAGES:
                    break
    except Exception:
        raise _HandlerError(415, "Could not read that PDF.")
    if pages > MAX_PAGES:
        raise _HandlerError(413, f"That PDF has {pages} pages; the limit is {MAX_PAGES}.")
    if images > MAX_IMAGES:
        raise _HandlerError(
            413,
            f"That PDF embeds more than {MAX_IMAGES} images, which this converter cannot "
            "rebuild in the time it has. Use the in-browser converter, which has no time limit.",
        )
    return pages


def _convert(in_path, out_path):
    """Run pdf2docx (with stencil-text recovery when needed) then the
    image-shrink pass. Returns the .docx bytes.

    Raises _HandlerError(500) if pdf2docx fails, surfacing the message to the client
    exactly as the inline path always has.
    """
    stenciled = False
    try:
        # Stencil-text documents (text drawn as masked colour chips, no text
        # layer) must be OCR-rewritten first or the .docx comes out empty.
        # Ordinary PDFs skip this entirely - is_stencil_pdf is a cheap census.
        doc = fitz.open(in_path)
        if stencil_ocr.is_stencil_pdf(doc):
            stenciled = True
            t = time.time()
            stencil_ocr.recover_text(doc)
            doc.save(in_path + ".ocr.pdf", garbage=4, deflate=True)
            in_path = in_path + ".ocr.pdf"
            print(json.dumps({"m": "stencil_ocr", "ms": int((time.time() - t) * 1000)}))
        doc.close()
    except Exception as e:  # noqa: BLE001
        raise _HandlerError(500, f"Conversion failed: {e}")
    # the hidden-text repair applies to stencil documents only, and only for
    # this conversion - warm containers serve later, ordinary PDFs too
    stencil_ocr.set_span_repair(stenciled)
    try:
        cv = Converter(in_path)
        cv.convert(out_path)
        cv.close()
    except Exception as e:  # noqa: BLE001 - surface any conversion error to the client
        raise _HandlerError(500, f"Conversion failed: {e}")
    finally:
        stencil_ocr.set_span_repair(False)
    with open(out_path, "rb") as f:
        out = f.read()
    if stenciled:
        # narrow glyphs + grow provably-overflowing rows; only worthwhile (and
        # only tuned) for OCR-recovered documents
        try:
            out = stencil_ocr.postprocess_docx(out)
        except Exception:
            pass
    # pdf2docx re-saves embedded photos as lossless PNG; recompress back to JPEG.
    return _shrink_docx_images(out)


def _metric(proto, in_sz, out_sz, b64_sz, pages, over, t0):
    """One structured metric line per conversion — sizes only, no filename/content/PII.

    Powers the over-cap-rate dashboard via CloudWatch Logs Insights (filter m="conv").
    The field set is identical across protocols so cap-monitor.py parses both; the new
    "proto" key ("inline" | "r2") just rides alongside and is ignored by the parser.
    """
    print(json.dumps({
        "m": "conv",
        "proto": proto,
        "in": in_sz,
        "out": out_sz,
        "b64": b64_sz,
        "pages": pages,
        "over": over,
        "ms": int((time.time() - t0) * 1000),
    }))


# --------------------------------------------------------------------------- #
# Legacy INLINE path                                                          #
# --------------------------------------------------------------------------- #
def _handle_inline(data, t0):
    if len(data) > MAX_BYTES:
        raise _HandlerError(413, "PDF too large (max 5 MB)")
    pages = _pdf_pages(data)

    in_path, out_path = "/tmp/in.pdf", "/tmp/out.docx"
    _reset(in_path, out_path)
    with open(in_path, "wb") as f:
        f.write(data)
    out = _convert(in_path, out_path)

    # Final safety net: if even the recompressed .docx still exceeds the ~6 MB
    # response cap (e.g. a many-page photo PDF), return a clean error instead of
    # crashing the runtime, and steer the user to the in-browser converter.
    body = base64.b64encode(out).decode("ascii")
    over_cap = len(body) > 6_200_000
    _metric("inline", len(data), len(out), len(body), pages, over_cap, t0)
    if over_cap:
        raise _HandlerError(413, "The converted Word file is too large for the server path. Use the in-browser converter above — it has no size limit.")

    return _resp(
        200,
        body,
        {
            "Content-Type": DOCX_CONTENT_TYPE,
            "Content-Disposition": 'attachment; filename="converted.docx"',
        },
        b64=True,
    )


# --------------------------------------------------------------------------- #
# R2 path                                                                     #
# --------------------------------------------------------------------------- #
def _r2_env():
    """Read the R2 config at call time. Endpoint/bucket fall back to defaults; the
    two credentials are required — a missing one is a clear 500 naming the var."""
    endpoint = os.environ.get("R2_ENDPOINT") or DEFAULT_R2_ENDPOINT
    bucket = os.environ.get("R2_BUCKET") or DEFAULT_R2_BUCKET
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    for name, val in (("R2_ACCESS_KEY_ID", access_key), ("R2_SECRET_ACCESS_KEY", secret_key)):
        if not val:
            raise _HandlerError(500, f"Server misconfigured: {name} is not set")
    return endpoint, bucket, access_key, secret_key


def _r2_client(endpoint, access_key, secret_key):
    import boto3

    # region_name='auto' is what Cloudflare R2 expects for SigV4; boto3 accepts it as
    # an opaque signing region (it isn't validated against AWS's region list when a
    # custom endpoint_url is set). A custom endpoint_url also makes botocore default
    # to path-style addressing, which R2 supports — so no addressing config needed.
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


def _handle_r2(key, t0):
    if not R2_KEY_RE.match(key):
        raise _HandlerError(400, "Invalid key")

    endpoint, bucket, access_key, secret_key = _r2_env()
    client = _r2_client(endpoint, access_key, secret_key)

    in_path, out_path = "/tmp/in.pdf", "/tmp/out.docx"
    _reset(in_path, out_path)

    result_key = None
    try:
        try:
            client.download_file(bucket, key, in_path)
        except Exception as e:  # noqa: BLE001
            # Detail stays in the logs; the message travels to the end user via the gate.
            print(json.dumps({"m": "r2_error", "op": "download", "detail": str(e)[:500]}))
            raise _HandlerError(500, "The server converter could not process that file. Try the in-browser converter.")

        size = os.path.getsize(in_path)
        if size > R2_MAX_BYTES:
            raise _HandlerError(413, f"PDF too large (max {R2_MAX_MB} MB)")
        with open(in_path, "rb") as f:
            data = f.read()
        pages = _pdf_pages(data)

        out = _convert(in_path, out_path)

        result_key = f"results/{uuid.uuid4()}.docx"
        try:
            client.put_object(Bucket=bucket, Key=result_key, Body=out, ContentType=DOCX_CONTENT_TYPE)
        except Exception as e:  # noqa: BLE001
            result_key = None  # nothing landed → nothing to roll back
            print(json.dumps({"m": "r2_error", "op": "upload", "detail": str(e)[:500]}))
            raise _HandlerError(500, "The server converter could not process that file. Try the in-browser converter.")

        _metric("r2", len(data), len(out), 0, pages, False, t0)
        return _resp(
            200,
            json.dumps({
                "resultKey": result_key,
                "pages": pages,
                "in": len(data),
                "out": len(out),
                "ms": int((time.time() - t0) * 1000),
            }),
            {"Content-Type": "application/json"},
        )
    except BaseException:
        # A step after the result upload failed → delete the orphaned result. On the
        # success path we've already returned, so this only runs on failure.
        if result_key:
            try:
                client.delete_object(Bucket=bucket, Key=result_key)
            except Exception:
                pass
        raise
    finally:
        # The input object is always removed — whether we succeeded or failed.
        try:
            client.delete_object(Bucket=bucket, Key=key)
        except Exception:
            pass


def _parse_r2_key(data):
    """Return the R2 key from a JSON body, or None if the body isn't R2-key JSON."""
    try:
        obj = json.loads(data)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    key = obj.get("key")
    return key if isinstance(key, str) else None


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

    try:
        # Protocol detection: raw PDF -> inline; else JSON {"key"} -> R2; else 415.
        if data[:5] == b"%PDF-":
            return _handle_inline(data, t0)
        key = _parse_r2_key(data)
        if key is not None:
            return _handle_r2(key, t0)
        return _err(415, "Not a PDF")
    except _HandlerError as e:
        return _err(e.status, e.msg)
