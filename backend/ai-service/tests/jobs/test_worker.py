"""ai-jobs-worker 태스크(큐 jobs). 전처리와 같은 Celery 앱·설정, 회귀 평가 실행, 운영 정기 작업 실행 호출을 확인한다."""
import logging

import httpx
import pytest
from pydantic import ValidationError

from app.jobs import worker

RUN = {'runId': 'run-1', 'kind': 'regression_eval'}


def operations(monkeypatch, status=200):
    """운영 대역. httpx.post로 나간 호출을 (url, 옵션)으로 모으고 status로 답한다."""
    calls = []

    def post(url, **options):
        calls.append((url, options))
        return httpx.Response(status, request=httpx.Request('POST', url))
    monkeypatch.setattr(worker.httpx, 'post', post)
    monkeypatch.setenv('OPERATIONS_SERVICE_BASE_URL', 'http://operations-service:8082/')
    monkeypatch.setenv('INTERNAL_TOKEN', 'internal-token')
    return calls


def test_the_tasks_are_the_contract_ones_on_the_jobs_queue():
    assert (worker.run_evaluation.name, worker.run_evaluation.queue) == ('evaluation.run', 'jobs')
    assert (worker.run_operations_job.name, worker.run_operations_job.queue) == ('operations.run_job', 'jobs')
    assert (worker.run_optimization.name, worker.run_optimization.queue) == ('optimization.run', 'jobs')


def test_only_the_optimization_task_is_acknowledged_when_it_is_received_so_a_slow_run_is_not_delivered_twice():
    """개선은 수십 분 걸려 RabbitMQ 확인 제한(30분)을 넘기면 늦은 확인(acks_late) 때문에 같은 작업이 다시 배달돼 중복 실행·과금이 된다(자문 P0)."""
    assert worker.run_optimization.acks_late is False
    assert worker.run_evaluation.acks_late is True and worker.run_operations_job.acks_late is True   # 나머지는 앱 설정(늦은 확인) 그대로다


def test_the_optimization_task_hands_its_job_to_the_optimization_service(monkeypatch):
    ran = []
    monkeypatch.setattr(worker.optimization, 'run_job', ran.append)
    worker.run_optimization({'prompt': 'character_simulation.act', 'version': 2, 'maxMetricCalls': 150})
    assert ran == [{'prompt': 'character_simulation.act', 'version': 2, 'maxMetricCalls': 150}]


def test_the_tasks_join_the_preprocessing_celery_app_and_leave_its_task_and_queue_alone():
    preprocessing = worker.celery.tasks['preprocessing.run']  # 같은 앱(설정 포함)에 이미 있는 전처리 태스크
    assert (preprocessing.name, preprocessing.queue) == ('preprocessing.run', 'preprocessing')


def test_the_evaluation_task_hands_its_job_to_the_evaluation_service(monkeypatch):
    ran = []
    monkeypatch.setattr(worker.evaluation, 'run_job', ran.append)
    worker.run_evaluation({'runName': 'qa.answer@v3-x'})
    assert ran == [{'runName': 'qa.answer@v3-x'}]


def test_the_operations_task_asks_operations_to_execute_the_run_with_the_internal_token_and_no_body(monkeypatch, caplog):
    calls = operations(monkeypatch)
    with caplog.at_level(logging.INFO):
        assert worker.run_operations_job(RUN) is None
    [(url, options)] = calls
    assert url == 'http://operations-service:8082/internal/v1/jobs/runs/run-1/execute'
    assert options['headers'] == {'X-Internal-Token': 'internal-token'} and set(options) == {'headers', 'timeout'}
    assert options['timeout'].read >= 300  # 핸들러를 동기로 실행하므로 짧은 기본 제한으로는 끊긴다
    assert 'run-1' in caplog.text and 'regression_eval' in caplog.text  # 어떤 작업이 돌았는지 로그에 남는다


@pytest.mark.parametrize('status', [401, 409, 500])
def test_a_refused_or_failed_execution_fails_the_task_instead_of_passing_as_done(monkeypatch, status):
    operations(monkeypatch, status)
    with pytest.raises(httpx.HTTPStatusError):
        worker.run_operations_job(RUN)


def test_a_run_id_that_is_not_path_safe_never_reaches_operations(monkeypatch):
    calls = operations(monkeypatch)
    with pytest.raises(ValidationError):
        worker.run_operations_job({'runId': '../x', 'kind': 'regression_eval'})
    assert calls == []
