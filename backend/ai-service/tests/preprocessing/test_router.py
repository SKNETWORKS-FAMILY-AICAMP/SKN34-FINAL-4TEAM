"""#343 HTTP 경계. 내부 토큰 검증과 접수 뒤 Celery 큐 발행을 확인한다(TestClient·브로커 없이 함수로)."""
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from kombu.exceptions import OperationalError

from app.preprocessing import router
from app.preprocessing.models import JobRequest

TOKEN = 'preprocessing-token'
REQUEST = JobRequest(jobId='job-1', workId='work-1', episodes=[1, 2])


def queue(monkeypatch, error=None):
    """Celery 태스크 대역. delay로 올린 페이로드를 모으고, error가 있으면 큐에 올리지 못한 것으로 던진다."""
    sent = []

    def delay(payload):
        sent.append(payload)
        if error:
            raise error
    monkeypatch.setattr(router, 'run_job', SimpleNamespace(delay=delay))
    return sent


def test_accepts_the_job_and_queues_its_json_payload_for_the_worker(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    sent = queue(monkeypatch)
    assert router.accept_preprocessing_job(REQUEST, TOKEN) is None
    assert sent == [{'jobId': 'job-1', 'workId': 'work-1', 'episodes': [1, 2]}]


def test_wrong_or_missing_token_is_403_and_queues_nothing(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    sent = queue(monkeypatch)
    for token in ('wrong', ''):
        with pytest.raises(HTTPException) as error:
            router.accept_preprocessing_job(REQUEST, token)
        assert error.value.status_code == 403
    assert sent == []


@pytest.mark.parametrize('error', [OperationalError('amqp://storyfork:비밀번호@rabbitmq 연결 실패'), ConnectionRefusedError('비밀번호')],
                         ids=['kombu-operational-error', 'connection-refused'])
def test_a_queue_failure_is_a_fixed_503_instead_of_a_hidden_202_and_only_its_class_is_logged(monkeypatch, caplog, error):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    queue(monkeypatch, error)
    with caplog.at_level(logging.ERROR), pytest.raises(HTTPException) as raised:
        router.accept_preprocessing_job(REQUEST, TOKEN)
    assert (raised.value.status_code, raised.value.detail) == (503, '전처리 작업을 큐에 올리지 못했습니다.')
    assert type(error).__name__ in caplog.text and '비밀번호' not in caplog.text


def test_route_is_the_contract_path_with_202():
    (route,) = router.router.routes
    assert (route.path, route.status_code, route.methods) == ('/internal/v1/preprocessing/jobs', 202, {'POST'})
