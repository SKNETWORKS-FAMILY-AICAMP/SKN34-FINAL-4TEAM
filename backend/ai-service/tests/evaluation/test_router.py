import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from kombu.exceptions import OperationalError

from app.evaluation import router, service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationAccepted, LeakCheckRequest, LeakCheckResponse

from .stubs import QA_REQUEST

LEAK = LeakCheckRequest(response='응답', references=['비공개 카드'])
PLAN = service.Plan(QA_REQUEST, 'qa.answer@v3-20261119T000000Z-abcdef', None, '프롬프트 본문', 0.05, None)  # dataset은 Langfuse 객체라 태스크 인자에 실리지 않는다


@pytest.fixture(autouse=True)
def token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')


def queue(monkeypatch, error=None):
    """Celery 태스크 대역. delay로 올린 인자를 모으고, error가 있으면 큐에 올리지 못한 것으로 던진다."""
    sent = []

    def delay(job):
        sent.append(job)
        if error:
            raise error
    monkeypatch.setattr(router, 'run_evaluation', SimpleNamespace(delay=delay))
    return sent


def test_wrong_token_is_403_on_both_routes(monkeypatch):
    sent = queue(monkeypatch)
    for call in (lambda: router.start(QA_REQUEST, 'wrong-token'), lambda: router.leak_check(LEAK, 'wrong-token')):
        with pytest.raises(HTTPException) as error:
            call()
        assert error.value.status_code == 403
    assert sent == []


def test_start_answers_with_the_run_name_and_queues_the_prepared_plan_as_json(monkeypatch):
    monkeypatch.setattr(router.service, 'prepare', lambda data: PLAN if data == QA_REQUEST else None)
    sent = queue(monkeypatch)

    assert router.start(QA_REQUEST, 'eval-token') == EvaluationAccepted(runName=PLAN.run_name)

    assert sent == [service.to_job(PLAN)]


def test_a_rejected_evaluation_keeps_status_and_message_and_queues_nothing(monkeypatch):
    def reject(_):
        raise EvaluationFailure(404, '평가 세트를 찾을 수 없어요.')
    monkeypatch.setattr(router.service, 'prepare', reject)
    sent = queue(monkeypatch)

    with pytest.raises(HTTPException) as error:
        router.start(QA_REQUEST, 'eval-token')

    assert (error.value.status_code, error.value.detail) == (404, '평가 세트를 찾을 수 없어요.') and sent == []


@pytest.mark.parametrize('error', [OperationalError('amqp://storyfork:비밀번호@rabbitmq 연결 실패'), ConnectionRefusedError('비밀번호')],
                         ids=['kombu-operational-error', 'connection-refused'])
def test_a_queue_failure_is_a_fixed_503_instead_of_a_hidden_202_and_only_its_class_is_logged(monkeypatch, caplog, error):
    monkeypatch.setattr(router.service, 'prepare', lambda data: PLAN)
    queue(monkeypatch, error)

    with caplog.at_level(logging.ERROR), pytest.raises(HTTPException) as raised:
        router.start(QA_REQUEST, 'eval-token')

    assert (raised.value.status_code, raised.value.detail) == (503, '평가를 큐에 올리지 못했습니다.')
    assert PLAN.run_name in caplog.text and type(error).__name__ in caplog.text
    assert '비밀번호' not in caplog.text and PLAN.instructions not in caplog.text


def test_leak_check_returns_the_result_or_the_failure_status(monkeypatch):
    monkeypatch.setattr(router.service, 'leak_check', lambda data: LeakCheckResponse(suspected=True, reason='근거') if data == LEAK else None)
    assert router.leak_check(LEAK, 'eval-token') == LeakCheckResponse(suspected=True, reason='근거')

    def fail(_):
        raise EvaluationFailure(503, '평가 모델 설정이 필요합니다.')
    monkeypatch.setattr(router.service, 'leak_check', fail)
    with pytest.raises(HTTPException) as error:
        router.leak_check(LEAK, 'eval-token')
    assert (error.value.status_code, error.value.detail) == (503, '평가 모델 설정이 필요합니다.')
