"""#343 HTTP 경계(CI 통합). 라우터 등록·토큰 검증·202·요청 검증을 TestClient로 확인한다."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.preprocessing import router

pytestmark = pytest.mark.integration

TOKEN = 't' * 32
BODY = {'jobId': 'job-1', 'workId': 'work-1', 'episodes': [1, 2]}


def post(body=BODY, token=TOKEN):
    return TestClient(create_app()).post('/internal/v1/preprocessing/jobs', json=body, headers={'X-Internal-Token': token})


def test_accepts_with_202_and_runs_the_job_after_the_response(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    ran = []
    monkeypatch.setattr(router, 'run_job', lambda request: ran.append(request.jobId))
    assert post().status_code == 202
    assert ran == ['job-1']


def test_wrong_token_is_403_and_nothing_runs(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    ran = []
    monkeypatch.setattr(router, 'run_job', lambda request: ran.append(request.jobId))
    assert post(token='wrong-token').status_code == 403
    assert ran == []


def test_malformed_body_is_422(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    assert post({**BODY, 'episodes': []}).status_code == 422
