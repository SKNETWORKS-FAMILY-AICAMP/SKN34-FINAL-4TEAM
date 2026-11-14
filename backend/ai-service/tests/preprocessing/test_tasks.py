"""Celery 작업: 접수 1건 = task 1개가 그래프를 실행하고, 그래프가 올린 단계 실패를 Content 작업 상태에 남긴다."""
from app.preprocessing import service, tasks
from app.preprocessing.errors import REASONS, PreprocessingFailure

from .stubs import JOB, WORK, content_double, logic_double


def test_a_stage_failure_is_left_on_the_job_with_its_fixed_reason(monkeypatch):
    remote = content_double(monkeypatch)
    logic_double(monkeypatch)
    monkeypatch.setattr(tasks.celery.conf, 'task_always_eager', True)
    monkeypatch.setattr(tasks.celery.conf, 'task_eager_propagates', True)

    def resolve(extractions):
        raise PreprocessingFailure('MODEL_UNAVAILABLE', 503)

    monkeypatch.setattr(service, 'resolve', resolve)
    tasks.run_job.delay(JOB, WORK, [1, 2, 3])
    assert remote.progress[-1] == {'stage': 'resolving', 'done': 0, 'total': 1, 'failedEpisodes': [], 'failed': REASONS['resolving']}
    assert remote.loads == []
