"""AWS Lambda handler: convert an uploaded PDF to a Word (.docx) document.

Invoked via a Lambda Function URL. The frontend POSTs raw PDF bytes
(Content-Type: application/pdf); the Function URL delivers them base64-encoded.
We convert with pdf2docx and return the .docx, also base64-encoded.
"""

import base64
import json
import os

from pdf2docx import Converter

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


def handler(event, context):
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

    return _resp(
        200,
        base64.b64encode(out).decode("ascii"),
        {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": 'attachment; filename="converted.docx"',
        },
        b64=True,
    )
