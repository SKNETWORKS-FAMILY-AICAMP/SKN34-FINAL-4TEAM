"""POST /internal/v1/jobs HTTP 경계(CI 통합). 라우터 등록·토큰 검증·202·요청 검증·큐 실패 503을 TestClient로 확인한다."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.jobs import router
from app.main import create_app

pytestmark = pytest.mark.integration

TOKEN = 't' * 32
BODY = {'runId': 'run-1', 'kind': 'llm_alert_check'}


def post(body=BODY, token=TOKEN):
    return TestClient(create_app()).post('/internal/v1/jobs', json=body, headers={'X-Internal-Token': token})


def test_accepts_with_202_and_queues_the_run_for_the_worker(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    queued = []
    monkeypatch.setattr(router, 'run_operations_job', SimpleNamespace(delay=queued.append))
    assert post().status_code == 202
    assert queued == [BODY]


def test_wrong_token_is_403_and_nothing_is_queued(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    queued = []
    monkeypatch.setattr(router, 'run_operations_job', SimpleNamespace(delay=queued.append))
    assert post(token='wrong-token').status_code == 403
    assert queued == []


def test_malformed_body_is_422(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    assert post({**BODY, 'runId': '../x'}).status_code == 422


def test_a_queue_failure_is_503_with_the_fixed_message(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)

    def refuse(payload):
        raise ConnectionRefusedError()
    monkeypatch.setattr(router, 'run_operations_job', SimpleNamespace(delay=refuse))
    response = post()
    assert (response.status_code, response.json()) == (503, {'detail': '작업을 큐에 올리지 못했습니다.'})
