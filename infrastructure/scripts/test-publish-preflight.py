"""Exercise the workflow's anonymous GHCR preflight against a local HTTP server."""
import http.server
import os
from pathlib import Path
import subprocess
import sys
import textwrap
import threading

workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/ci.yml').read_text()
script = textwrap.dedent(workflow.split('          # preflight-start\n', 1)[1].split('          # preflight-end\n', 1)[0])

class Handler(http.server.BaseHTTPRequestHandler):
    status, body = 403, b'{"errors":[{"code":"DENIED"}]}'
    def do_GET(self):
        self.send_response(self.status)
        self.end_headers()
        self.wfile.write(self.body)
    def log_message(self, *args):
        pass

server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    script = script.replace('https://ghcr.io/token', f'http://127.0.0.1:{server.server_port}/token')
    for status, body, expected in [(200, b'{"token":"secret"}', 1), (403, b'{"errors":[{"code":"DENIED"}]}', 0), (403, b'bad json', 1), (403, b'{"errors":[{"code":"OTHER"}]}', 1), (401, b'{}', 1), (429, b'{}', 1), (500, b'{}', 1)]:
        Handler.status, Handler.body = status, body
        result = subprocess.run([sys.executable, '-c', script], env={**os.environ, 'IMAGE': 'ghcr.io/sknetworks-family-aicamp/storyfork-web'}, capture_output=True, text=True)
        assert (result.returncode == 0) == (expected == 0), (status, result.stderr)
        assert 'secret' not in result.stdout + result.stderr
    print('GHCR preflight cases passed')
finally:
    server.shutdown()
    server.server_close()
