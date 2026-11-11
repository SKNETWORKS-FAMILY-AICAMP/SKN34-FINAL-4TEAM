"""실제 loopback HTTP로 Content 위임 재확인과 AI Run 경계를 연결한다. DB·모델 없음."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
import time

from fastapi.testclient import TestClient
import pytest

from test_mock_retrievers import story, content
from test_run_service import binding
from app.main import create_app


pytestmark = pytest.mark.integration


def test_real_content_http_authorization_revocation_and_refused_retrieval(content, monkeypatch):
    request, _, _ = binding(content)
    body = request.model_dump(mode="json", by_alias=True)
    token = "fixture-service-token-at-least-32-characters"
    state = {"active": True, "calls": 0}
    class Authority(BaseHTTPRequestHandler):
        def do_POST(self):
            state["calls"] += 1
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            allowed = (state["active"] and data == body and self.headers.get("X-Internal-Token") == token
                       and self.path == f"/internal/v1/ai/runs/{request.run_id}/verify")
            payload = {"runId": request.run_id, "threadRef": request.thread_ref, "scopeRef": "scope-hash",
                       "expiresAt": (datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()} if allowed else {}
            raw = json.dumps(payload).encode()
            self.send_response(200 if allowed else 403)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Authority)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    monkeypatch.setenv("INTERNAL_TOKEN", token)
    monkeypatch.setenv("CONTENT_AI_RUN_BASE_URL", f"http://127.0.0.1:{server.server_port}")
    headers = {"X-Internal-Token": token, "X-Grant-Ref": request.grant_ref, "X-Thread-Ref": request.thread_ref}
    try:
        with TestClient(create_app()) as client:
            path = "/internal/v1/ai/runs"
            assert client.post(path, json=body | {"workId": "foreign"}, headers=headers).status_code == 403
            assert client.post(path, json=body, headers=headers).status_code == 202
            deadline = time.monotonic()+5
            while True:
                result = client.get(f"{path}/{request.run_id}", headers=headers)
                assert result.status_code == 200
                if result.json()["status"] == "denied":
                    break
                assert time.monotonic() < deadline
                time.sleep(.01)
            assert result.json()["isMock"] is False
            assert result.json()["error"]["code"] == "refused"
            assert result.json()["result"] is None and not result.json()["tasks"]
            state["active"] = False
            assert client.get(f"{path}/{request.run_id}", headers=headers).status_code == 403
            assert state["calls"] >= 4
    finally:
        server.shutdown();server.server_close();worker.join(timeout=2)
