from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.evaluation import router, service
from app.evaluation.models import EvaluationRequest
from app.main import create_app

pytestmark = pytest.mark.integration

START = {'dataset': 'qa.grounding', 'prompt': 'qa.answer', 'version': 3}
LEAK = {'response': '응답', 'references': ['비공개 카드']}


def test_routes_are_registered_behind_the_internal_token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')
    client = TestClient(create_app())

    for path, body in (('/internal/v1/evaluations', START), ('/internal/v1/evaluations/leak-check', LEAK)):
        assert client.post(path, json=body, headers={'X-Internal-Token': 'wrong-token'}).status_code == 403


def test_start_answers_202_with_the_run_name_and_queues_the_plan_for_the_worker(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')
    queued = []
    plan = service.Plan(EvaluationRequest(**START), 'run-1', None, '프롬프트 본문', 0.05, None)
    monkeypatch.setattr(router.service, 'prepare', lambda data: plan)
    monkeypatch.setattr(router, 'run_evaluation', SimpleNamespace(delay=queued.append))

    response = TestClient(create_app()).post('/internal/v1/evaluations', json=START, headers={'X-Internal-Token': 'eval-token'})

    assert (response.status_code, response.json(), queued) == (202, {'runName': 'run-1'}, [service.to_job(plan)])


def test_a_queue_failure_is_503_with_the_fixed_message(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')
    monkeypatch.setattr(router.service, 'prepare', lambda data: service.Plan(EvaluationRequest(**START), 'run-1', None, '프롬프트 본문', 0.05, None))

    def refuse(job):
        raise ConnectionRefusedError()
    monkeypatch.setattr(router, 'run_evaluation', SimpleNamespace(delay=refuse))

    response = TestClient(create_app()).post('/internal/v1/evaluations', json=START, headers={'X-Internal-Token': 'eval-token'})

    assert (response.status_code, response.json()) == (503, {'detail': '평가를 큐에 올리지 못했습니다.'})
