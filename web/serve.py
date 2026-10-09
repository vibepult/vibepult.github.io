"""Serve the desk with caching off, so a reload always runs the latest code and bands.json.
python web/serve.py [port]   (default 8000, reachable from the phone on the same network)"""
import functools
import http.server
import sys
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCache, directory=str(Path(__file__).parent))
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
