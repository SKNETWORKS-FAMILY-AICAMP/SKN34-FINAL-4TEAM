"""접수 API 함수: 내부 토큰이 없으면 등록하지 않는다. 브로커는 대역이다(공용 `require_internal_token`이라 거절은 403)."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.preprocessing import router, tasks
from app.preprocessing.models import JobRequest

from .stubs import JOB, WORK


def test_the_internal_token_gates_the_registration(monkeypatch):
    sent = []
    monkeypatch.setattr(tasks, 'run_job', SimpleNamespace(apply_async=lambda args: sent.append(args)))
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-internal-token')
    monkeypatch.setenv('CELERY_BROKER_URL', 'amqp://broker.invalid//')
    job = JobRequest(jobId=JOB, workId=WORK, episodes=[1, 2])
    for token in ('', 'wrong'):
        with pytest.raises(HTTPException) as failure:
            router.accept_job(job, token)
        assert failure.value.status_code == 403 and sent == []
    assert str(router.accept_job(job, 'test-internal-token').jobId) == JOB
    assert sent == [[JOB, WORK, [1, 2]]]
