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


def _events(response) -> list[tuple[str, dict]]:
    import json
    lines = response.text.splitlines()
    return [(lines[i][7:], json.loads(lines[i + 1][6:])) for i, line in enumerate(lines) if line.startswith('event: ')]


def test_approval_card_round_trips_over_http_review_picks_rewrite_then_approve(monkeypatch):
    """#795 스모크: 검수 → 확정 지적 둘 고르기 → 다시 쓰기 → 승인이 같은 대화의 SSE resume으로 이어진다(모델·Content는 대역)."""
    from app.manuscript_review.models import Finding, ReviewResponse
    from app.orchestration import tools
    from app.writing.models import PatchResponse
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agents(monkeypatch, plan('manuscript_review', ('writing_editing', 'if_issues_found')))
    found = lambda q: Finding(category='spelling', quote=q, reason=f'{q} 맞춤법', status='confirmed', evidenceRefs=[], suggestion='고친 말', start=0, end=len(q))  # noqa: E731
    monkeypatch.setattr(tools.manuscript_review, 'review', lambda data: ReviewResponse(workId=data.workId, episode=data.episode, revision=4, check=data.check,
                                                                                         gaps=[], model='m', providerResponseId='r', usage=None, findings=[found('웃엇다.'), found('차가왔다.')]))
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: {'draft': {'title': '3화', 'body': '그는 웃엇다. 바람이 차가왔다.', 'revision': 4}})
    written, applied = [], []
    monkeypatch.setattr(tools.writing, 'patch', lambda data: written.append(data) or PatchResponse(before=data.selection, after=f'버전{len(written)}', model='m', providerResponseId='r', usage=None))
    monkeypatch.setattr(tools.content_mcp, 'apply_writing', lambda work, number, result, expected_revision=None: applied.append(result['after']) or {'episode': number, 'revision': 5})
    talk = {'conversation': {'threadId': 'smoke-795', 'scope': 'user:1/work:work'}}
    headers = {'X-Internal-Token': 'test-token', 'X-User-Authorization': bearer()}
    with TestClient(create_app()) as client:
        post = lambda body: _events(client.post('/internal/v1/orchestrations/stream', headers=headers, json={**talk, **body}))  # noqa: E731
        first = post({'request': '검수하고 고쳐줘', 'target': {'workId': 'work', 'episode': 3}, 'inputs': {'manuscript_review': {'check': 'mechanical'}}})
        assert first[-1][1]['missingInputs'] == ['writing_editing']
        picked = post({'resume': {'approved': True, 'inputs': {'writing_editing': {'fix': [0, 1]}}}})
        assert (picked[-1][1]['awaitingApproval'], picked[-1][1]['rewritesLeft']) == ('writing_editing', 2) and written[0].selection == '웃엇다. 바람이 차가왔다.'
        again = post({'resume': {'approved': False, 'refresh': True}})
        assert [name for name, _ in again] == ['step', 'waiting', 'done'] and again[-1][1]['rewritesLeft'] == 1 and written[1] == written[0]
        done = post({'resume': {'approved': True}})
        assert done[-1][1]['status'] == 'completed' and applied == ['버전2']


def test_edited_write_approval_round_trips_over_http_and_a_locked_edit_is_422(monkeypatch):
    """#795 스모크: Content 쓰기 승인에서 글만 고친 인자는 실행되고, 잠긴 필드를 고친 이어가기는 422로 막혀 대기가 남는다."""
    from app.intent.models import DecisionResult
    from app.orchestration import tools
    from .stubs import Planned
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    asked = {'id': 'work', 'data': {'title': '제목', 'summary': '소개', 'revision': 1}}
    fake_agents(monkeypatch, Planned(DecisionResult(allowed=True, capabilities=[]), [('work_update', asked)]))
    calls = []
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: calls.append((tool, args)) or {'revision': 2})
    talk = {'conversation': {'threadId': 'smoke-795-edit', 'scope': 'user:1/work:work'}}
    with TestClient(create_app()) as client:
        post = lambda path, body: client.post(path, headers={'X-Internal-Token': 'test-token'}, json={**talk, **body})  # noqa: E731
        waiting = post('/internal/v1/orchestrations', {'request': '소개를 바꿔 줘', 'target': {'workId': 'work', 'episode': 3}}).json()
        assert (waiting['awaitingApproval'], waiting['pendingAction']['args']) == ('content_action', asked)
        locked = post('/internal/v1/orchestrations', {'resume': {'approved': True, 'edited': {**asked, 'data': {**asked['data'], 'revision': 9}}}})
        assert locked.status_code == 422 and calls == []
        edited = {'id': 'work', 'data': {'title': '작가 제목', 'summary': '소개', 'revision': 1}}
        done = post('/internal/v1/orchestrations', {'resume': {'approved': True, 'edited': edited}}).json()
    assert done['status'] == 'completed' and [c for c in calls if c[0] == 'work_update'] == [('work_update', edited)]
