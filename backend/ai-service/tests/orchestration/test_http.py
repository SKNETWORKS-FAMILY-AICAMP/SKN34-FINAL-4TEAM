import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from traced import MEMBER, attrs, bearer, status_of

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
    events = [line[7:] for line in response.text.splitlines() if line.startswith('event: ')]
    assert events == ['activity', 'activity', 'plan', 'started', 'activity', 'activity', 'step', 'done']
    activity = [json.loads(block.splitlines()[1][6:]) for block in response.text.replace('\r\n', '\n').split('\n\n')
                if block.startswith('event: activity\n')]
    assert [row['status'] for row in activity] == ['running', 'done', 'running', 'done']
    assert activity[0]['id'] == activity[1]['id'] != activity[2]['id'] == activity[3]['id']



def test_orchestration_stream_is_one_request_trace_of_the_author(monkeypatch, spans):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agents(monkeypatch, plan('story_context'))
    with TestClient(create_app()) as client:
        client.post('/internal/v1/orchestrations/stream', headers={'X-Internal-Token': 'test-token', 'X-User-Authorization': bearer()},
                    json={'request': '길드 규칙 알려줘', 'inputs': {'story_context': QA}})
    [request] = [s for s in spans() if s.name == 'orchestration']  # SSE를 끝까지 흘린 요청의 루트
    found = attrs(request)
    assert found['user.id'] == MEMBER and found['langfuse.trace.tags'] == ['feature:orchestration'] and status_of(request) == 'success'
    assert request.parent is None  # 스트림 전체를 덮는 trace의 유일한 루트
