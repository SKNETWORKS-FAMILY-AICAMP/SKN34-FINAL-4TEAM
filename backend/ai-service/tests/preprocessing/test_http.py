"""CI HTTP 경계: 미구현 전처리는 202나 완료로 노출하지 않는다."""
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.preprocessing import tasks
from .stubs import JOB, WORK

pytestmark = pytest.mark.integration


def test_unimplemented_preprocessing_is_not_accepted_or_queued(monkeypatch):
    sent = []
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    monkeypatch.setenv('CELERY_BROKER_URL', 'amqp://broker.invalid//')
    monkeypatch.setattr(tasks, 'run_job', SimpleNamespace(apply_async=lambda args: sent.append(args)))
    with TestClient(create_app()) as client:
        body = {'jobId': JOB, 'workId': WORK, 'episodes': [1, 2]}
        denied = client.post('/internal/v1/preprocessing/jobs', json=body)
        unavailable = client.post('/internal/v1/preprocessing/jobs', json=body, headers={'X-Internal-Token': 'test-token'})
    assert denied.status_code == 403
    assert unavailable.status_code == 503
    assert unavailable.json() == {'detail': 'PREPROCESSING_NOT_IMPLEMENTED'}
    assert sent == []
