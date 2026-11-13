import asyncio
import json
from uuid import uuid4

import pytest

from app.intent.errors import IntentFailure
from app.manuscript.errors import ManuscriptFailure
from app.orchestration import service
from app.orchestration.models import OrchestrationRequest
from app.research.errors import ResearchFailure

from app.retrieval.errors import RetrievalFailure
from app.retrieval.models import RetrievalResult

from .stubs import COVERAGE, DRAFT, PATCH, QA, SCOPE, WEB, fake_agents, plan


def run(request='요청', **body):
    return asyncio.run(service.run(OrchestrationRequest(request=request, **body)))


def names(calls):
    return [name for name, *_ in calls]


@pytest.mark.parametrize('routed', [
    plan(status='clarify', message='어떤 작업을 원하시나요?'),
    plan(status='rejected', reason='greeting', message='안녕하세요.'),
])
def test_clarify_and_rejected_run_nothing_and_keep_router_message(monkeypatch, routed):
    calls = fake_agents(monkeypatch, routed)
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == (routed.status, routed.message, [])
    assert names(calls) == ['route']


def test_router_receives_request_operation_and_materials(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run('규칙 알려줘', operation='story_context', materials=['자료'], inputs={'story_context': QA})
    assert calls[0][1] == ('규칙 알려줘', 'story_context', ['자료'], [])


@pytest.mark.parametrize('steps, unsupported', [
    (['review'], ['review']),
    (['story_development', 'writing_editing'], ['story_development']),
    (['character_simulation'], ['character_simulation']),
    (['web_research', ('writing_editing', 'if_issues_found')], ['writing_editing']),
])
def test_plan_with_unimplemented_or_conditional_step_runs_nothing(monkeypatch, steps, unsupported):
    calls = fake_agents(monkeypatch, plan(*steps))
    result = run(inputs={'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'unsupported' and result.unsupported == unsupported
    assert [s.status for s in result.steps] == ['not_started'] * len(steps)
    assert names(calls) == ['route']


def test_missing_input_of_any_step_runs_nothing(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.missingInputs) == ('needs_input', ['web_research'])
    assert names(calls) == ['route']


def test_independent_steps_run_in_plan_order_with_own_inputs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('web_research', 'story_context', 'writing_editing'))
    result = run(inputs={'story_context': QA, 'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'completed'
    assert names(calls) == ['route', 'web_research', 'story_context', 'draft']
    assert [s.feature for s in result.steps] == ['web_research', 'story_context', 'writing_editing']
    assert result.steps[1].result.claims[0].sourceIds == ['a']
    assert calls[1][1][0].question == WEB['question']


def test_writing_patch_input_runs_patch(monkeypatch):
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    result = run(inputs={'writing_editing': PATCH})
    assert names(calls) == ['route', 'patch']
    assert result.steps[0].result.after == '그는 차갑게 웃었다.'


def test_failed_step_keeps_earlier_result_and_starts_no_new_step(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research', 'writing_editing'),
                        fail={'web_research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    result = run(inputs={'story_context': QA, 'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'failed'
    assert [(s.status, s.error) for s in result.steps] == [
        ('completed', None), ('failed', '웹 검색에 실패했습니다.'), ('not_started', None)]
    assert names(calls) == ['route', 'story_context', 'web_research']


def test_router_failure_propagates(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'route': IntentFailure()})
    with pytest.raises(IntentFailure):
        run(inputs={'story_context': QA})


def stream(request='요청', **body):
    async def collect():
        return [(e.event, e.data) async for e in service.stream(OrchestrationRequest(request=request, **body))]
    return asyncio.run(collect())


def test_stream_reports_plan_each_step_start_and_result_then_done(monkeypatch):
    fake_agents(monkeypatch, plan('story_context', 'web_research'))
    events = stream(inputs={'story_context': QA, 'web_research': WEB})
    assert [(name, data.get('feature')) for name, data in events] == [
        ('plan', None), ('started', 'story_context'), ('step', 'story_context'),
        ('started', 'web_research'), ('step', 'web_research'), ('done', None)]
    assert [s['feature'] for s in events[0][1]['steps']] == ['story_context', 'web_research']
    assert events[2][1]['status'] == 'completed' and events[2][1]['result']['claims'][0]['sourceIds'] == ['a']
    assert events[-1][1]['status'] == 'completed' and len(events[-1][1]['steps']) == 2


def test_stream_stops_starting_steps_after_failure(monkeypatch):
    fake_agents(monkeypatch, plan('story_context', 'web_research'),
                fail={'story_context': ManuscriptFailure(502, 'Q&A 모델 응답을 확인할 수 없습니다.')})
    events = stream(inputs={'story_context': QA, 'web_research': WEB})
    assert [name for name, _ in events] == ['plan', 'started', 'step', 'done']
    assert events[2][1]['error'] == 'Q&A 모델 응답을 확인할 수 없습니다.'
    assert events[-1][1]['status'] == 'failed'


def test_stream_without_execution_ends_with_done_status(monkeypatch):
    fake_agents(monkeypatch, plan(status='clarify', message='어떤 작업을 원하시나요?'))
    events = stream()
    assert [name for name, _ in events] == ['plan', 'done']
    assert events[-1][1]['status'] == 'clarify'


def test_stream_router_failure_is_an_error_event(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'route': IntentFailure()})
    assert stream() == [('error', {'message': '요청 분류에 실패했습니다.'})]


def chat(thread, scope='user:1/work:1', **body):
    return run(conversation={'threadId': thread, 'scope': scope}, **body)


def test_follow_up_turn_gets_previous_requests_and_qa_history(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='카이의 목표는?', inputs={'story_context': QA})
    chat(thread, request='그 목표가 바뀐 이유는?', inputs={'story_context': QA})
    route, qa = [c for c in calls if c[0] == 'route'], [c for c in calls if c[0] == 'story_context']
    assert route[0][1][3] == [] and route[1][1][3] == ['카이의 목표는?']
    assert qa[0][1][0].history == []
    assert [(t.question, t.answer) for t in qa[1][1][0].history] == [(QA['question'], '밤에 닫는다')]


def test_each_turn_starts_without_previous_turn_results(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    assert chat(thread).status == 'waiting'
    second = chat(thread, inputs={'story_context': QA})  # 대기 중이어도 새 요청은 새 턴으로 시작한다.
    assert (second.status, second.missingInputs, second.message) == ('completed', [], None)


def test_conversation_of_another_scope_is_refused(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, inputs={'story_context': QA})
    with pytest.raises(service.ConversationMismatch):
        chat(thread, scope='user:2/work:1', inputs={'story_context': QA})
    assert len([c for c in calls if c[0] == 'route']) == 1


def test_requests_without_conversation_share_no_history(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run('첫 질문', inputs={'story_context': QA})
    run('둘째 질문', inputs={'story_context': QA})
    assert [c[1][3] for c in calls if c[0] == 'route'] == [[], []]


def resume(thread, approved=True, inputs=None, scope='user:1/work:1'):
    return chat(thread, scope=scope, request=None, resume={'approved': approved, 'inputs': inputs or {}})


def test_missing_input_in_conversation_waits_with_plan_and_runs_nothing(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = chat(str(uuid4()), inputs={'story_context': QA})
    assert (result.status, result.missingInputs) == ('waiting', ['web_research'])
    assert [s.feature for s in result.steps] == ['story_context', 'web_research']
    assert names(calls) == ['route']


def test_resume_with_inputs_runs_saved_plan_without_routing_again(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    chat(thread, inputs={'story_context': QA})
    result = resume(thread, inputs={'web_research': WEB})
    assert result.status == 'completed' and [s.status for s in result.steps] == ['completed', 'completed']
    assert names(calls) == ['route', 'story_context', 'web_research']


def test_resume_still_missing_waits_again(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context', 'web_research'))
    chat(thread)
    again = resume(thread, inputs={'story_context': QA})
    assert (again.status, again.missingInputs) == ('waiting', ['web_research'])
    assert resume(thread, inputs={'web_research': WEB}).status == 'completed'


def test_rejected_resume_cancels_without_running(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('web_research'))
    chat(thread)
    assert resume(thread, approved=False).status == 'cancelled'
    assert names(calls) == ['route']
    with pytest.raises(service.NothingToResume):
        resume(thread)


def test_resume_needs_a_waiting_run_of_the_same_scope(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('web_research'))
    with pytest.raises(service.NothingToResume):
        resume(thread)
    chat(thread)
    with pytest.raises(service.ConversationMismatch):
        resume(thread, scope='user:2/work:1', inputs={'web_research': WEB})


def test_conversation_without_configured_store_is_unavailable(monkeypatch):
    monkeypatch.setattr(service, 'CHAT', None)
    calls = fake_agents(monkeypatch, plan('story_context'))
    with pytest.raises(service.ConversationUnavailable):
        chat(str(uuid4()), inputs={'story_context': QA})
    assert calls == []


def test_stream_reports_waiting_then_resume_streams_steps(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('web_research'))
    conversation = {'threadId': thread, 'scope': 'user:1/work:1'}
    first = stream(conversation=conversation)
    assert [name for name, _ in first] == ['plan', 'waiting', 'done']
    assert first[1][1]['missingInputs'] == ['web_research'] and first[-1][1]['status'] == 'waiting'
    second = stream(request=None, conversation=conversation, resume={'approved': True, 'inputs': {'web_research': WEB}})
    assert [name for name, _ in second] == ['started', 'step', 'done']
    assert second[-1][1]['status'] == 'completed'


def test_run_id_is_the_trace_of_plan_and_steps(monkeypatch, spans):
    fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = run(inputs={'story_context': QA, 'web_research': WEB})
    found = {s.name: s for s in spans()}
    assert {'writing_ai.orchestration', 'plan', 'step.story_context', 'step.web_research'} <= set(found)
    root = found['writing_ai.orchestration']
    assert result.runId == format(root.context.trace_id, '032x')
    assert all(found[n].parent.span_id == root.context.span_id for n in ('plan', 'step.story_context', 'step.web_research'))
    assert json.loads(root.attributes['langfuse.observation.input']) == {'request': '요청'}
    assert json.loads(found['plan'].attributes['langfuse.observation.input']) == {'request': '요청'}


def test_failed_step_is_traced_as_error(monkeypatch, spans):
    fake_agents(monkeypatch, plan('web_research'), fail={'web_research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    run(inputs={'web_research': WEB})
    step = next(s for s in spans() if s.name == 'step.web_research')
    assert step.attributes['langfuse.observation.level'] == 'ERROR'
    assert step.attributes['langfuse.observation.status_message'] == '웹 검색에 실패했습니다.'


def test_resumed_steps_join_the_trace_of_the_waiting_turn(monkeypatch, spans):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('web_research'))
    waiting = chat(thread)
    done = resume(thread, inputs={'web_research': WEB})
    step = next(s for s in spans() if s.name == 'step.web_research')
    assert done.runId == waiting.runId == format(step.context.trace_id, '032x')


def test_scope_lets_qa_retrieve_its_own_evidence_through_content(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    result = run('길드 규칙은?', scope=SCOPE)
    assert result.status == 'completed' and names(calls) == ['route', 'retrieval', 'story_context']
    scope, question = calls[1][1]
    assert (scope.scopeToken, question) == ('signed.token', '길드 규칙은?')
    asked = calls[2][1][0]
    assert asked.question == '길드 규칙은?' and [e.id for e in asked.excerpts] == ['a']
    qa = result.steps[0].result
    assert [s.id for s in qa.sources] == ['a'] and qa.coverage.expected[0].versionId == 'r4'
    assert qa.gaps == ['제외한 결과가 있어요.']


def test_insufficient_evidence_answers_with_gaps_without_model(monkeypatch):
    empty = RetrievalResult(status='insufficient', excerpts=[], coverage=COVERAGE, steps=[],
                            gaps=[{'code': 'NO_EVIDENCE', 'detail': '근거를 확인하지 못했어요.'}])
    calls = fake_agents(monkeypatch, plan('story_context'), retrieved=empty)
    result = run('길드 규칙은?', scope=SCOPE)
    assert names(calls) == ['route', 'retrieval']
    qa = result.steps[0].result
    assert (result.status, qa.claims, qa.gaps) == ('completed', [], ['근거를 확인하지 못했어요.'])


def test_retrieval_failure_fails_the_qa_step(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'),
                        fail={'retrieval': RetrievalFailure(409, '공개 원고 범위가 변경됐어요.')})
    result = run(scope=SCOPE, inputs={'web_research': WEB})
    assert [(s.status, s.error) for s in result.steps] == [('failed', '공개 원고 범위가 변경됐어요.'), ('not_started', None)]
    assert names(calls) == ['route', 'retrieval']


def test_given_excerpts_win_over_scope_and_skip_retrieval(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run(scope=SCOPE, inputs={'story_context': QA})
    assert names(calls) == ['route', 'story_context']


def test_scope_does_not_satisfy_other_features(monkeypatch):
    fake_agents(monkeypatch, plan('web_research'))
    assert run(scope=SCOPE).missingInputs == ['web_research']


def test_stream_unexpected_failure_still_ends_with_error_event(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'route': RuntimeError('원고 본문이 담긴 메시지')})
    assert stream(inputs={'story_context': QA}) == [('error', {'message': '작업을 완료할 수 없습니다.'})]


def test_resume_uses_the_fresh_scope_token_from_content(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    conversation = {'threadId': thread, 'scope': 'user:1/work:1'}
    run(conversation=conversation, scope={'scopeToken': 'old.token'})
    resumed = run(None, conversation=conversation, resume={
        'approved': True, 'inputs': {'web_research': WEB}, 'scope': {'scopeToken': 'fresh.token'}})
    assert resumed.status == 'completed'
    assert [c[1][0].scopeToken for c in calls if c[0] == 'retrieval'] == ['fresh.token']


TARGET = {'workId': 'work', 'episode': 3}


def writer(monkeypatch, fail=None):
    """Content MCP 초안 반영 대역. 호출마다 (작품, 회차, 결과, 그때의 사용자 토큰)을 남긴다."""
    applied = []

    def apply_writing(work_id, number, result):
        applied.append((work_id, number, result, service.content_mcp.AUTHORIZATION.get()))
        if fail:
            raise fail
        return {'episode': number, 'revision': 8}

    monkeypatch.setattr(service.content_mcp, 'apply_writing', apply_writing)
    return applied


def write_turn(thread, authorization='Bearer user', **body):
    data = OrchestrationRequest(conversation={'threadId': thread, 'scope': 'user:1/work:1'}, **body)
    return asyncio.run(service.run(data, authorization))


def test_writing_result_waits_for_author_approval_before_any_write(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing'))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request='고쳐줘', target=TARGET, inputs={'writing_editing': PATCH})
    assert (result.status, result.awaitingApproval) == ('waiting', 'writing_editing')
    assert result.steps[0].status == 'completed' and result.steps[0].result.after == '그는 차갑게 웃었다.'
    assert applied == []


def test_approval_writes_the_same_result_with_the_resuming_users_token(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    applied = writer(monkeypatch)
    write_turn(thread, request='고쳐줘', target=TARGET, inputs={'writing_editing': PATCH})
    done = write_turn(thread, 'Bearer fresh', resume={'approved': True})
    assert done.status == 'completed' and done.awaitingApproval is None
    assert (done.steps[0].approval, done.steps[0].applied.revision) == ('approved', 8)
    assert applied == [('work', 3, {'before': '그는 웃었다.', 'after': '그는 차갑게 웃었다.', 'model': 'm',
                                    'providerResponseId': 'r', 'usage': None}, 'Bearer fresh')]
    assert names(calls) == ['route', 'patch']  # 승인 뒤 모델을 다시 부르지 않는다.


def test_declined_result_is_kept_but_never_written(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('writing_editing'))
    applied = writer(monkeypatch)
    write_turn(thread, request='써줘', target=TARGET, inputs={'writing_editing': DRAFT})
    done = write_turn(thread, resume={'approved': False})
    assert done.status == 'completed' and done.steps[0].approval == 'declined' and done.steps[0].applied is None
    assert applied == []


def test_failed_write_fails_the_step_and_stops_later_steps(monkeypatch):
    from app.content_mcp.errors import ContentMcpFailure
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('writing_editing', 'web_research'))
    writer(monkeypatch, fail=ContentMcpFailure(409, '초안이 최신이 아니에요.'))
    write_turn(thread, request='고치고 조사해줘', target=TARGET, inputs={'writing_editing': PATCH, 'web_research': WEB})
    done = write_turn(thread, resume={'approved': True})
    assert done.status == 'failed' and done.steps[0].error == '초안이 최신이 아니에요.'
    assert done.steps[0].result.after == '그는 차갑게 웃었다.' and done.steps[1].status == 'not_started'
    assert 'web_research' not in names(calls)


def test_writing_without_target_or_conversation_only_returns_a_proposal(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing'))
    applied = writer(monkeypatch)
    assert write_turn(str(uuid4()), request='써줘', inputs={'writing_editing': DRAFT}).status == 'completed'
    assert run('써줘', target=TARGET, inputs={'writing_editing': DRAFT}).status == 'completed'
    assert applied == []


def test_stream_reports_approval_wait_then_the_applied_step(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('writing_editing'))
    writer(monkeypatch)
    conversation = {'threadId': thread, 'scope': 'user:1/work:1'}
    first = stream(conversation=conversation, target=TARGET, inputs={'writing_editing': PATCH})
    assert [name for name, _ in first] == ['plan', 'started', 'step', 'waiting', 'done']
    assert first[3][1]['awaitingApproval'] == 'writing_editing' and first[-1][1]['status'] == 'waiting'
    second = stream(request=None, conversation=conversation, resume={'approved': True})
    assert [name for name, _ in second] == ['step', 'done']
    assert second[0][1]['applied'] == {'episode': 3, 'revision': 8} and second[-1][1]['status'] == 'completed'
