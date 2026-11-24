"""POST /internal/v1/optimizations HTTP 경계(CI 통합). 라우터 등록·토큰·202·요청 검증·409·큐 실패 503을 TestClient로 확인한다."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.optimization import router, service
from app.optimization.errors import OptimizationFailure

pytestmark = pytest.mark.integration

TOKEN = 't' * 32
BODY = {'prompt': 'character_simulation.act', 'version': 2, 'maxMetricCalls': 150}


def post(body=BODY, token=TOKEN):
    return TestClient(create_app()).post('/internal/v1/optimizations', json=body, headers={'X-Internal-Token': token})


@pytest.fixture
def queued(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    monkeypatch.setattr(service, 'accept', lambda request: None)
    sent = []
    monkeypatch.setattr(router, 'run_optimization', SimpleNamespace(delay=sent.append))
    return sent


def test_accepts_with_202_and_queues_the_job(queued):
    response = post()
    assert (response.status_code, response.json()) == (202, {'accepted': True}) and queued == [BODY]


def test_wrong_token_is_403_and_nothing_is_queued(queued):
    assert post(token='wrong-token').status_code == 403 and queued == []


@pytest.mark.parametrize('bad', [{'maxMetricCalls': 501}, {'maxMetricCalls': 0}, {'version': 0}])
def test_a_request_outside_the_contract_is_422(queued, bad):
    assert post({**BODY, **bad}).status_code == 422 and queued == []


def test_a_running_optimization_is_409_with_the_detail_body(queued, monkeypatch):
    def refuse(request):
        raise OptimizationFailure(409, '이 프롬프트의 자동 개선이 이미 실행 중이에요.')
    monkeypatch.setattr(service, 'accept', refuse)
    response = post()
    assert (response.status_code, response.json()) == (409, {'detail': '이 프롬프트의 자동 개선이 이미 실행 중이에요.'})


def test_a_queue_failure_is_503_with_the_fixed_message(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    monkeypatch.setattr(service, 'accept', lambda request: None)

    def refuse(payload):
        raise ConnectionRefusedError()
    monkeypatch.setattr(router, 'run_optimization', SimpleNamespace(delay=refuse))
    response = post()
    assert (response.status_code, response.json()) == (503, {'detail': '자동 개선을 큐에 올리지 못했습니다.'})
