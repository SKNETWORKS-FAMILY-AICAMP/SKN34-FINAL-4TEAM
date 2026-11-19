"""#343 HTTP 경계. 내부 토큰 검증과 접수 뒤 백그라운드 실행 예약을 확인한다(TestClient 없이 함수로)."""
import pytest
from fastapi import BackgroundTasks, HTTPException

from app.preprocessing import router, service
from app.preprocessing.models import JobRequest

TOKEN = 'preprocessing-token'
REQUEST = JobRequest(jobId='job-1', workId='work-1', episodes=[1, 2])


def test_accepts_the_job_and_schedules_the_run_after_the_response(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    background = BackgroundTasks()
    assert router.accept_preprocessing_job(REQUEST, background, TOKEN) is None
    assert [(task.func, task.args) for task in background.tasks] == [(service.run_job, (REQUEST,))]


def test_wrong_or_missing_token_is_403_and_schedules_nothing(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    for token in ('wrong', ''):
        background = BackgroundTasks()
        with pytest.raises(HTTPException) as error:
            router.accept_preprocessing_job(REQUEST, background, token)
        assert error.value.status_code == 403 and not background.tasks


def test_route_is_the_contract_path_with_202():
    (route,) = router.router.routes
    assert (route.path, route.status_code, route.methods) == ('/internal/v1/preprocessing/jobs', 202, {'POST'})
