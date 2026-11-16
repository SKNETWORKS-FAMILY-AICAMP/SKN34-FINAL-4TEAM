import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .stubs import QA, fake_agents, plan

pytestmark = pytest.mark.integration


def test_orchestration_route_runs_graph(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agents(monkeypatch, plan('story_context'))
    with TestClient(create_app()) as client:
        response = client.post('/internal/v1/orchestrations', headers={'X-Internal-Token': 'test-token'},
                               json={'request': '길드 규칙 알려줘', 'inputs': {'story_context': QA}})
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'completed' and body['steps'][0]['result']['claims'][0]['sourceIds'] == ['a']


def test_orchestration_stream_sends_sse_events(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agents(monkeypatch, plan('story_context'))
    with TestClient(create_app()) as client:
        denied = client.post('/internal/v1/orchestrations/stream', json={'request': '요청'})
        response = client.post('/internal/v1/orchestrations/stream', headers={'X-Internal-Token': 'test-token'},
                               json={'request': '길드 규칙 알려줘', 'inputs': {'story_context': QA}})
    assert denied.status_code == 403
    assert response.headers['content-type'].startswith('text/event-stream')
    assert [line[7:] for line in response.text.splitlines() if line.startswith('event: ')] == [
        'plan', 'started', 'step', 'done']
