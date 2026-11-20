import pytest
from fastapi.testclient import TestClient

from app.evaluation import router
from app.main import create_app

pytestmark = pytest.mark.integration

START = {'dataset': 'qa.grounding', 'prompt': 'qa.answer', 'version': 3}
LEAK = {'response': '응답', 'references': ['비공개 카드']}


def test_routes_are_registered_behind_the_internal_token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')
    client = TestClient(create_app())

    for path, body in (('/internal/v1/evaluations', START), ('/internal/v1/evaluations/leak-check', LEAK)):
        assert client.post(path, json=body, headers={'X-Internal-Token': 'wrong-token'}).status_code == 403


def test_start_answers_202_with_the_run_name_then_runs_in_the_background(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')
    ran = []
    monkeypatch.setattr(router.service, 'prepare', lambda data: type('Plan', (), {'run_name': 'run-1'})())
    monkeypatch.setattr(router.service, 'run', lambda plan: ran.append(plan.run_name))

    response = TestClient(create_app()).post('/internal/v1/evaluations', json=START, headers={'X-Internal-Token': 'eval-token'})

    assert (response.status_code, response.json(), ran) == (202, {'runName': 'run-1'}, ['run-1'])
