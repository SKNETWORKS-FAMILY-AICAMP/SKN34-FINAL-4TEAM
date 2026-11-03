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
    for status, body, expected in [(200, b'{"token":"secret"}', 1), (401, b'{"errors":[{"code":"UNAUTHORIZED","message":"authentication required"}]}', 0), (403, b'{"errors":[{"code":"DENIED"}]}', 0), (401, b'{"errors":[{"code":"DENIED"}]}', 1), (403, b'{"errors":[{"code":"UNAUTHORIZED"}]}', 1), (401, b'{"errors":[{"code":"UNAUTHORIZED"},{"code":"DENIED"}]}', 1), (403, b'{"errors":[{"code":"DENIED"},{"code":"DENIED"}]}', 1), (403, b'{"errors":[]}', 1), (403, b'bad json', 1), (403, b'{"errors":[{"code":"OTHER"}]}', 1), (401, b'{}', 1), (429, b'{}', 1), (500, b'{}', 1)]:
        Handler.status, Handler.body = status, body
        result = subprocess.run([sys.executable, '-c', script], env={**os.environ, 'IMAGE': 'ghcr.io/sknetworks-family-aicamp/storyfork-web'}, capture_output=True, text=True)
        assert (result.returncode == 0) == (expected == 0), (status, result.stderr)
        assert 'secret' not in result.stdout + result.stderr
    print('GHCR preflight cases passed')
finally:
    server.shutdown()
    server.server_close()

# A connection failure must prevent publication.
result = subprocess.run([sys.executable, '-c', script], env={**os.environ, 'IMAGE': 'ghcr.io/sknetworks-family-aicamp/storyfork-web'}, capture_output=True, text=True)
assert result.returncode != 0

# Exercise the actual branch-HEAD guard against a local GitHub API substitute.
head_script = textwrap.dedent(workflow.split('          # branch-head-start\n', 1)[1].split('          # branch-head-end\n', 1)[0])
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    head_script = head_script.replace('https://api.github.com', f'http://127.0.0.1:{server.server_port}')
    for status, body, expected in [(200, b'{"object":{"sha":"abc"}}', 0), (200, b'{"object":{"sha":"old"}}', 1), (200, b'{}', 1), (403, b'{}', 1), (500, b'{}', 1), (200, b'bad json', 1)]:
        Handler.status, Handler.body = status, body
        result = subprocess.run([sys.executable, '-c', head_script], env={**os.environ, 'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_REF_NAME': 'develop', 'GITHUB_SHA': 'abc', 'GH_TOKEN': 'test-secret'}, capture_output=True, text=True)
        assert (result.returncode == 0) == (expected == 0), (status, body, result.stderr)
        assert 'test-secret' not in result.stdout + result.stderr
    assert 'docker push --all-tags' not in workflow
    assert 'docker push "$IMAGE:$GITHUB_REF_NAME"' in workflow
    assert 'docker push "$IMAGE:sha-$GITHUB_SHA"' in workflow
    print('Branch HEAD and explicit tag cases passed')
finally:
    server.shutdown()
    server.server_close()

# A connection failure must also prevent publication.
result = subprocess.run([sys.executable, '-c', head_script], env={**os.environ, 'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_REF_NAME': 'develop', 'GITHUB_SHA': 'abc', 'GH_TOKEN': 'test-secret'}, capture_output=True, text=True)
assert result.returncode != 0 and 'test-secret' not in result.stdout + result.stderr
assert workflow.index('# branch-head-end') < workflow.index('docker push "$IMAGE:sha-$GITHUB_SHA"')
print('Branch lookup failure case passed')
