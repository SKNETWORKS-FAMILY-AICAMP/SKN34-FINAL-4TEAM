"""POST /internal/v1/optimizations 접수. 내부 토큰·지원 대상·실행 중 확인 뒤 Celery 큐(jobs)에 올린다(TestClient·브로커 없이 함수로)."""
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from kombu.exceptions import OperationalError

from app.evaluation.errors import EvaluationFailure
from app.main import create_app
from app.optimization import router, service
from app.optimization.errors import OptimizationFailure
from app.optimization.models import OptimizationAccepted, OptimizationRequest

TOKEN = 'optimize-token'
REQUEST = OptimizationRequest(prompt='character_simulation.act', version=2, maxMetricCalls=150)


def queue(monkeypatch, error=None, refused=None):
    """접수 확인(service.accept)과 Celery 태스크 대역. delay로 올린 페이로드를 모은다."""
    sent = []

    def accept(request):
        if refused:
            raise refused
    monkeypatch.setattr(service, 'accept', accept)

    def delay(payload):
        sent.append(payload)
        if error:
            raise error
    monkeypatch.setattr(router, 'run_optimization', SimpleNamespace(delay=delay))
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    return sent


def test_accepts_the_request_and_queues_its_json_payload_for_the_worker(monkeypatch):
    sent = queue(monkeypatch)

    assert router.start(REQUEST, TOKEN) == OptimizationAccepted()
    assert sent == [{'prompt': 'character_simulation.act', 'version': 2, 'maxMetricCalls': 150}]


def test_wrong_or_missing_token_is_403_and_checks_and_queues_nothing(monkeypatch):
    sent = queue(monkeypatch, refused=AssertionError('토큰이 틀리면 확인도 하지 않는다'))
    for token in ('wrong', ''):
        with pytest.raises(HTTPException) as error:
            router.start(REQUEST, token)
        assert error.value.status_code == 403
    assert sent == []


@pytest.mark.parametrize('refused, status', [
    (OptimizationFailure(422, '지원하지 않는 프롬프트예요.'), 422), (OptimizationFailure(409, '이미 실행 중이에요.'), 409), (EvaluationFailure(503, '평가 모델 설정이 필요합니다.'), 503)])
def test_a_refused_request_keeps_the_status_and_message_and_queues_nothing(monkeypatch, refused, status):
    sent = queue(monkeypatch, refused=refused)

    with pytest.raises(HTTPException) as error:
        router.start(REQUEST, TOKEN)

    assert (error.value.status_code, error.value.detail) == (status, str(refused)) and sent == []   # 409는 {"detail": …}로 운영에 그대로 간다


@pytest.mark.parametrize('error', [OperationalError('amqp://storyfork:비밀번호@rabbitmq 연결 실패'), ConnectionRefusedError('비밀번호')], ids=['kombu', 'refused'])
def test_a_queue_failure_is_a_fixed_503_instead_of_a_hidden_202_and_only_its_class_is_logged(monkeypatch, caplog, error):
    queue(monkeypatch, error)

    with caplog.at_level(logging.ERROR), pytest.raises(HTTPException) as raised:
        router.start(REQUEST, TOKEN)

    assert (raised.value.status_code, raised.value.detail) == (503, '자동 개선을 큐에 올리지 못했습니다.')
    assert type(error).__name__ in caplog.text and '비밀번호' not in caplog.text


def test_route_is_the_contract_path_with_202_and_the_application_serves_it():
    (route,) = router.router.routes
    assert (route.path, route.status_code, route.methods) == ('/internal/v1/optimizations', 202, {'POST'})
    assert 'post' in create_app().openapi()['paths']['/internal/v1/optimizations']
