#!/usr/bin/env python3
"""Accessibility Atlas: local dev server (static files + HTTP Range, which PMTiles needs).

  python3 dev-server.py                     # http://127.0.0.1:8126/
  python3 dev-server.py --port 8126 --data <folder holding endpoints.json + data/>

Serves this folder at / and the data folder at /_data/, which is where config.js points
DATA_URL on localhost. Live, the same layout sits on the observatory server at
https://api.urbanobservatory.in/access/. Nothing is cached, so edits show on reload.
"""
import argparse, os, re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
# Until the pipeline writes elsewhere, endpoints.json + data/ sit in Amruth's checkout.
DEFAULT_DATA = HERE.parent / "hyderabad-urban-observatory" / "accessibility atlas"

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8126)
ap.add_argument("--data", default=str(DEFAULT_DATA))
args = ap.parse_args()
DATA = Path(args.data).resolve()


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".json": "application/json",
                      ".geojson": "application/geo+json", ".pmtiles": "application/octet-stream",
                      ".woff2": "font/woff2"}

    def translate_path(self, path):
        p = unquote(urlsplit(path).path)
        if p.startswith("/_data/"):
            rel = os.path.normpath(p[len("/_data/"):]).lstrip("/")
            if rel.startswith(".."):
                return str(HERE / "__nope__")
            return str(DATA / rel)
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)$", rng or "")
        if not m or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
        else:                                   # suffix range: last N bytes
            start, end = max(size - int(m.group(2) or 0), 0), size - 1
        if start > end:
            self.send_error(416)
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_len = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        n = getattr(self, "_range_len", None)
        if n is None:
            return super().copyfile(source, outputfile)
        outputfile.write(source.read(n))
        self._range_len = None

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"http://127.0.0.1:{args.port}/  (data: {DATA})")
    ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(HERE))).serve_forever()
