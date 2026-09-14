"""Run: python3 docs/design/proposals/canvas-v0.5/serve.py

Read-only, localhost-only design prototype. Serves three allowlisted files.
No app API, credentials, persistence or model calls. Stop with Ctrl-C.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

here = Path(__file__).resolve().parent
repo = here.parents[3]
paths = {
    "/": (here / "index.html", "text/html; charset=utf-8"),
    "/key-reference.png": (repo / "apps/web/public/demo/workspace-v2/key-reference.png", "image/png"),
    "/key-candidate-c.png": (repo / "apps/web/public/demo/workspace-v2/key-candidate-c.png", "image/png"),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        item = paths.get(urlsplit(self.path).path)
        if item is None:
            self.send_error(404)
            return
        path, content_type = item
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print("Canvas design prototype: http://127.0.0.1:4318/?variant=A", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 4318), Handler).serve_forever()
