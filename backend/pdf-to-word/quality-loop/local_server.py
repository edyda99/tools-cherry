"""Local test server for the WIRED converter pipeline.

Runs the exact code the Lambda runs — lambda_function._convert(), which now
includes docx_enhance.enhance() — so a PDF dropped here produces byte-for-byte
what prod would produce after deploy. Local only; never touches AWS.

Usage:  venv/bin/python local_server.py   →  open http://127.0.0.1:8123
"""
import html
import pathlib
import sys
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent))
import lambda_function  # noqa: E402  (import installs the fill-chip filter)

PAGE = """<!doctype html><meta charset="utf-8">
<title>PDF → Word (wired pipeline, local)</title>
<style>body{font:16px/1.5 -apple-system,sans-serif;max-width:560px;margin:60px auto;padding:0 20px}
#drop{border:2px dashed #999;border-radius:10px;padding:40px;text-align:center;color:#555}
#drop.over{border-color:#0a7;color:#0a7}#status{margin-top:16px;white-space:pre-wrap}</style>
<h1>PDF → Word — wired pipeline</h1>
<p>Runs <code>lambda_function._convert()</code> with the season 1+2 enhancement
passes wired in, exactly as prod would run after deploy. Local only.</p>
<div id="drop">Drop a PDF here or <input type="file" id="f" accept="application/pdf"></div>
<div id="status"></div>
<script>
const drop=document.getElementById('drop'),st=document.getElementById('status');
async function send(file){
  st.textContent='Converting '+file.name+' …';
  const r=await fetch('/convert?name='+encodeURIComponent(file.name),{method:'POST',body:file});
  if(!r.ok){st.textContent='FAILED: '+await r.text();return}
  const blob=await r.blob();
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=file.name.replace(/\\.pdf$/i,'')+'.docx';
  a.click();
  st.textContent='Done: '+a.download+' ('+blob.size.toLocaleString()+' bytes) — check your Downloads.';
}
document.getElementById('f').onchange=e=>e.target.files[0]&&send(e.target.files[0]);
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');
  e.dataTransfer.files[0]&&send(e.dataTransfer.files[0])};
</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(n)
            with tempfile.TemporaryDirectory() as td:
                ip = pathlib.Path(td) / "in.pdf"
                op = pathlib.Path(td) / "out.docx"
                ip.write_bytes(data)
                out = lambda_function._convert(str(ip), str(op))
            self.send_response(200)
            self.send_header("Content-Type",
                             "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except lambda_function._HandlerError as e:
            msg = html.escape(e.msg).encode()
            self.send_response(e.status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
        except Exception:
            msg = traceback.format_exc().encode()
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def log_message(self, fmt, *args):  # quiet request lines, keep errors
        pass


if __name__ == "__main__":
    print("serving on http://127.0.0.1:8123")
    ThreadingHTTPServer(("127.0.0.1", 8123), Handler).serve_forever()
