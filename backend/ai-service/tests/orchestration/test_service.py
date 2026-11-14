import asyncio
import json
from uuid import uuid4

import pytest

from app.intent.errors import IntentFailure
from app.intent.prompt import CLARIFY_MESSAGE
from app.manuscript.errors import ManuscriptFailure
from app.orchestration import service
from app.orchestration.models import OrchestrationRequest
from app.research.errors import ResearchFailure

from app.retrieval.errors import RetrievalFailure
from app.retrieval.models import RetrievalResult
from app.simulation.errors import SimulationFailure, SimulationStopped
from app.simulation.models import SimulationPlan

from .stubs import COVERAGE, DRAFT, PATCH, QA, SCENE, SCOPE, SIM, WEB, fake_agents, plan, scene


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
    (['world_plot'], ['world_plot']),
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


# 인물 시뮬레이션(#58): 계획 → 장면 실행 → 작가 승인 뒤 초안 반영. 계획은 요청 문장에서 정하고 모자라면 채팅으로 되묻는다.
REQUEST = '카엘이 북문에서 리나를 막으면?'
CONVERSATION = {'threadId': 'sim-thread', 'scope': 'user:1/work:1'}
SCENE_TEXT = '카엘이 말했다. "멈춰."\n\n리나가 웃었다. "알겠어요."'


def test_simulation_is_planned_from_the_request_then_runs_and_waits_for_approval(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET)
    assert (result.status, result.awaitingApproval, result.approvalEpisode) == ('waiting', 'character_simulation', 3)
    assert '시뮬레이션' in result.message and names(calls) == ['route', 'sim_plan', 'simulation']
    assert calls[1][1] == (REQUEST, [], TARGET)
    assert calls[2][1][:4] == (SimulationPlan(**SIM), TARGET, REQUEST, SCOPE)
    step = result.steps[0]
    assert step.status == 'completed' and [t.prose for t in step.result.turns] == [t.prose for t in SCENE.turns]
    assert applied == []  # 승인 전에는 쓰지 않는다


def test_scene_approval_writes_the_paragraphs_joined_by_blank_lines_with_the_resuming_users_token(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    applied = writer(monkeypatch)
    write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    done = write_turn(thread, 'Bearer fresh', resume={'approved': True})
    assert (done.status, done.awaitingApproval) == ('completed', None)
    assert (done.steps[0].approval, done.steps[0].applied.revision) == ('approved', 8)
    assert applied == [('work', 3, {'text': SCENE_TEXT}, 'Bearer fresh')]
    assert names(calls) == ['route', 'sim_plan', 'simulation']  # 승인 뒤 계획·장면을 다시 만들지 않는다


def test_declined_scene_is_kept_but_never_written(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'))
    applied = writer(monkeypatch)
    write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    done = write_turn(thread, resume={'approved': False})
    assert (done.status, done.steps[0].approval, done.steps[0].applied) == ('completed', 'declined', None)
    assert len(done.steps[0].result.turns) == 2 and applied == []


def test_failed_scene_write_fails_the_step_and_keeps_the_scene(monkeypatch):
    from app.content_mcp.errors import ContentMcpFailure
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'))
    writer(monkeypatch, fail=ContentMcpFailure(409, '초안이 최신이 아니에요.'))
    write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    done = write_turn(thread, resume={'approved': True})
    assert (done.status, done.steps[0].error, len(done.steps[0].result.turns)) == ('failed', '초안이 최신이 아니에요.', 2)


def test_stopped_scene_fails_the_step_keeps_the_partial_scene_and_asks_no_approval(monkeypatch):
    partial = scene('카엘이 말했다.', status='stopped', reason='beat_rejected')
    stop = SimulationStopped('카엘이 비트를 따르지 않아 멈췄어요.', partial)
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'), fail={'simulation': stop})
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET, inputs={'web_research': WEB})
    assert (result.status, result.awaitingApproval) == ('failed', None)
    step = result.steps[0]
    assert (step.status, step.error) == ('failed', '카엘이 비트를 따르지 않아 멈췄어요.')
    assert (step.result.status, step.result.stopReason, len(step.result.turns)) == ('stopped', 'beat_rejected', 1)
    assert result.steps[1].status == 'not_started' and applied == [] and 'web_research' not in names(calls)


def test_simulation_failure_without_a_scene_fails_the_step(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'), fail={'simulation': SimulationFailure(409, '연결된 세계관이 없어요.')})
    result = run(REQUEST, target=TARGET)
    assert (result.status, result.steps[0].status, result.steps[0].error, result.steps[0].result) == (
        'failed', 'failed', '연결된 세계관이 없어요.', None)


@pytest.mark.parametrize('drafted, asked', [
    (SimulationPlan(characterIds=['k']), ['모드']),
    (SimulationPlan(mode='if', characterIds=['k']), ['IF 전제']),
    (SimulationPlan(mode='flow', beats=['성문 대면']), ['참여 인물']),
    (SimulationPlan(), ['모드', '참여 인물']),
])
def test_plan_the_request_does_not_settle_is_a_clarify_answer_and_runs_nothing(monkeypatch, drafted, asked):
    calls = fake_agents(monkeypatch, plan('web_research', 'character_simulation'), drafted=drafted)
    result = run(REQUEST, target=TARGET, inputs={'web_research': WEB})
    assert (result.status, result.steps, result.awaitingApproval) == ('clarify', [], None)
    assert all(label in result.message for label in asked) and '\n' not in result.message  # 빠진 것을 한 문장으로
    assert names(calls) == ['route', 'sim_plan']  # 다른 단계도 실행하지 않는다(축소 실행 금지)


def test_the_author_answers_a_clarify_in_the_next_chat_message(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'), drafted=SimulationPlan(mode='flow', beats=['성문 대면']))
    asked = write_turn(thread, request='장면 시뮬레이션', scope=SCOPE, target=TARGET)
    assert asked.status == 'clarify'
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    answered = write_turn(thread, request='카엘과 리나로 해 줘', scope=SCOPE, target=TARGET)
    assert answered.status == 'waiting' and answered.awaitingApproval == 'character_simulation'
    assert [c[1][:2] for c in calls if c[0] == 'sim_plan'] == [('카엘과 리나로 해 줘', ['장면 시뮬레이션'])]  # 앞 요청이 history로 간다


def test_planning_failure_fails_the_step_without_running_anything(monkeypatch):
    message = '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.'
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'), fail={'sim_plan': SimulationFailure(409, message)})
    result = run(REQUEST, target=TARGET, inputs={'web_research': WEB})
    assert result.status == 'failed'
    assert [(s.status, s.error) for s in result.steps] == [('failed', message), ('not_started', None)]
    assert names(calls) == ['route', 'sim_plan']


def test_failed_planning_does_not_wait_for_the_other_steps_inputs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'),
                        fail={'sim_plan': SimulationFailure(409, '연결된 세계관이 없어요.')})
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET)  # 대화 안이고 웹 조사 입력은 없다
    assert (result.status, result.missingInputs) == ('failed', [])
    assert [s.status for s in result.steps] == ['failed', 'not_started'] and names(calls) == ['route', 'sim_plan']


def test_simulation_needs_no_step_input_but_other_steps_still_wait_for_theirs(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'))
    writer(monkeypatch)
    waiting = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['web_research'])
    assert names(calls) == ['route', 'sim_plan']
    resumed = write_turn(thread, resume={'approved': True, 'inputs': {'web_research': WEB}})
    assert (resumed.status, resumed.awaitingApproval) == ('waiting', 'character_simulation')
    assert names(calls) == ['route', 'sim_plan', 'simulation']  # 계획은 다시 만들지 않고 저장된 것으로 실행한다


def test_simulation_without_a_conversation_returns_the_scene_without_approval(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    applied = writer(monkeypatch)
    result = run(REQUEST, target=TARGET)
    assert (result.status, result.steps[0].result.status, result.awaitingApproval) == ('completed', 'completed', None)
    assert applied == []


def test_scene_and_writing_results_are_approved_one_after_the_other(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation', 'writing_editing'))
    applied = writer(monkeypatch)
    first = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET, inputs={'writing_editing': PATCH})
    assert first.awaitingApproval == 'character_simulation'
    second = write_turn(thread, resume={'approved': True})
    assert (second.status, second.awaitingApproval) == ('waiting', 'writing_editing')
    done = write_turn(thread, resume={'approved': True})
    assert (done.status, [s.approval for s in done.steps]) == ('completed', ['approved', 'approved'])
    assert [a[2].get('text') or a[2].get('after') for a in applied] == [SCENE_TEXT, '그는 차갑게 웃었다.']


def test_stream_sends_each_turn_as_a_step_event_before_the_final_step(monkeypatch):
    def run_scene(plan, target, request, scope, progress=None):
        progress(scene('카엘이 말했다. "멈춰."', status='running'))
        return SCENE

    fake_agents(monkeypatch, plan('character_simulation'), simulated=run_scene)
    writer(monkeypatch)
    events = stream(request=REQUEST, conversation=CONVERSATION, scope=SCOPE, target=TARGET)
    assert [name for name, _ in events] == ['plan', 'started', 'step', 'step', 'waiting', 'done']
    running, final = events[2][1], events[3][1]
    assert (running['feature'], running['result']['status'], len(running['result']['turns'])) == ('character_simulation', 'running', 1)
    assert (final['status'], final['result']['status'], len(final['result']['turns'])) == ('completed', 'completed', 2)
    assert events[4][1]['awaitingApproval'] == 'character_simulation' and events[-1][1]['status'] == 'waiting'


def test_stream_reports_the_scene_approval_then_the_applied_step(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    writer(monkeypatch)
    stream(request=REQUEST, conversation=CONVERSATION, scope=SCOPE, target=TARGET)
    second = stream(request=None, conversation=CONVERSATION, resume={'approved': True})
    assert [name for name, _ in second] == ['step', 'done']
    assert (second[0][1]['feature'], second[0][1]['applied']) == ('character_simulation', {'episode': 3, 'revision': 8})
    assert second[-1][1]['status'] == 'completed'


def test_stream_clarify_and_planning_failure_end_with_done(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'), drafted=SimulationPlan())
    asked = stream(request=REQUEST, target=TARGET)
    assert [name for name, _ in asked] == ['plan', 'done'] and asked[-1][1]['status'] == 'clarify'
    fake_agents(monkeypatch, plan('character_simulation'), fail={'sim_plan': SimulationFailure(409, '연결된 세계관이 없어요.')})
    failed = stream(request=REQUEST, target=TARGET)
    assert [name for name, _ in failed] == ['plan', 'step', 'done']
    assert (failed[1][1]['status'], failed[1][1]['error'], failed[-1][1]['status']) == ('failed', '연결된 세계관이 없어요.', 'failed')


def test_simulation_planning_run_and_apply_join_the_trace_of_the_turn(monkeypatch, spans):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'))
    writer(monkeypatch)
    waiting = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    done = write_turn(thread, resume={'approved': True})
    found = {s.name: s for s in spans()}
    assert {'step.character_simulation.plan', 'step.character_simulation', 'step.character_simulation.apply'} <= set(found)
    assert done.runId == waiting.runId == format(found['step.character_simulation'].context.trace_id, '032x')


# 대화 세션 CRUD(#331): 저장은 체크포인터 하나뿐이고 scope가 다른 대화는 없는 것으로 본다.
ME, OTHER = 'user:1/work:1', 'user:2/work:1'


def conversation(fn, *args):
    return asyncio.run(getattr(service, fn)(*args))


def test_sessions_lists_only_threads_of_the_scope_newest_first(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    first, second, others = str(uuid4()), str(uuid4()), str(uuid4())
    chat(first, request='카이의 목표는?', inputs={'story_context': QA})
    chat(second, request='길드 규칙은?', inputs={'story_context': QA})
    chat(others, scope=OTHER, inputs={'story_context': QA})
    sessions = conversation('sessions', ME)
    assert [(s.threadId, s.title) for s in sessions] == [(second, '길드 규칙은?'), (first, '카이의 목표는?')]


def test_history_has_each_turn_with_its_reply_and_the_waiting_turn(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='첫 질문', inputs={'story_context': QA})
    fake_agents(monkeypatch, plan('web_research'))
    chat(thread, request='조사해 줘')
    history = conversation('history', thread, ME)
    assert [t.request for t in history.turns] == ['첫 질문', '조사해 줘']
    assert history.turns[0].reply.status == 'completed' and history.turns[0].reply.steps[0].result.claims
    assert (history.turns[1].reply.status, history.turns[1].reply.missingInputs) == ('waiting', ['web_research'])


@pytest.mark.parametrize('fn, args', [('history', ()), ('rename', ('새 제목',)), ('delete', ()), ('truncate', (0,))])
def test_thread_of_another_scope_or_unknown_is_not_found(monkeypatch, fn, args):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, inputs={'story_context': QA})
    for target, scope in ((thread, OTHER), (str(uuid4()), ME)):
        with pytest.raises(service.ConversationNotFound):
            conversation(fn, target, scope, *args)
    assert conversation('history', thread, ME).turns


def test_rename_keeps_turns_and_waits_for_a_finished_run(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, inputs={'story_context': QA})
    conversation('rename', thread, ME, '규칙 정리')
    history = conversation('history', thread, ME)
    assert (history.title, len(history.turns)) == ('규칙 정리', 1)
    fake_agents(monkeypatch, plan('web_research'))
    chat(thread)
    with pytest.raises(service.ConversationBusy):
        conversation('rename', thread, ME, '다른 제목')


def test_delete_removes_the_thread(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, inputs={'story_context': QA})
    conversation('delete', thread, ME)
    assert conversation('sessions', ME) == []


def test_truncate_drops_the_turn_and_everything_after(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    for text in ('하나', '둘', '셋'):
        chat(thread, request=text, inputs={'story_context': QA})
    conversation('truncate', thread, ME, 1)
    assert [t.request for t in conversation('history', thread, ME).turns] == ['하나']
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='넷', inputs={'story_context': QA})
    assert [c[1][3] for c in calls if c[0] == 'route'] == [['하나']]  # 지운 턴은 Router 기록에도 없다.
    conversation('truncate', thread, ME, 0)
    assert conversation('sessions', ME) == []


def test_edited_turn_reruns_from_that_turn_and_replaces_the_rest(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    for text in ('하나', '둘', '셋'):
        chat(thread, request=text, inputs={'story_context': QA})
    events = stream(request='둘 고침', conversation={'threadId': thread, 'scope': ME}, fromTurn=1,
                    inputs={'story_context': QA})
    assert events[-1][1]['status'] == 'completed'
    assert [t.request for t in conversation('history', thread, ME).turns] == ['하나', '둘 고침']
    stream(request='처음부터', conversation={'threadId': thread, 'scope': ME}, fromTurn=0, inputs={'story_context': QA})
    history = conversation('history', thread, ME)
    assert ([t.request for t in history.turns], history.title) == (['처음부터'], '처음부터')


def test_edit_needs_an_existing_turn(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, inputs={'story_context': QA})
    events = stream(conversation={'threadId': thread, 'scope': ME}, fromTurn=5, inputs={'story_context': QA})
    assert events == [('error', {'message': service.CONVERSATION_NOT_FOUND_MESSAGE})]


# 체크포인트 전용 DB(#337): Core·Content가 쓰는 DB와 섞이지 않게 AI가 시작할 때 storyfork_ai를 준비한다.
URL = 'postgresql://writer:secret@postgres:5432/storyfork_ai'


class FakeServer:
    """AsyncConnection.connect 대역. 접속 정보와 실행한 SQL을 남긴다."""

    def __init__(self, exists=False, create_error=None):
        self.exists, self.create_error, self.connected, self.queries = exists, create_error, [], []

    async def connect(self, conninfo, **kwargs):
        self.connected.append((conninfo, kwargs))
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, query, params=None):
        self.queries.append((query, params))
        if 'create database' in repr(query).lower() and self.create_error:
            raise self.create_error
        return self

    async def fetchone(self):
        return (1,) if self.exists else None


def test_missing_checkpoint_database_is_created_from_the_maintenance_database(monkeypatch):
    server = FakeServer()
    monkeypatch.setattr(service.AsyncConnection, 'connect', server.connect)
    asyncio.run(service.ensure_database(URL))
    (conninfo, kwargs), = server.connected
    assert 'dbname=postgres' in conninfo and 'storyfork_ai' not in conninfo and kwargs == {'autocommit': True}
    assert server.queries[0][1] == ('storyfork_ai',)
    assert 'storyfork_ai' in repr(server.queries[1][0]) and 'create database' in repr(server.queries[1][0]).lower()


def test_existing_checkpoint_database_is_left_alone(monkeypatch):
    server = FakeServer(exists=True)
    monkeypatch.setattr(service.AsyncConnection, 'connect', server.connect)
    asyncio.run(service.ensure_database(URL))
    assert len(server.queries) == 1


def test_database_created_meanwhile_by_another_instance_is_fine(monkeypatch):
    server = FakeServer(create_error=service.errors.DuplicateDatabase())
    monkeypatch.setattr(service.AsyncConnection, 'connect', server.connect)
    asyncio.run(service.ensure_database(URL))


def test_missing_create_privilege_fails_with_the_manual_step(monkeypatch):
    server = FakeServer(create_error=service.errors.InsufficientPrivilege())
    monkeypatch.setattr(service.AsyncConnection, 'connect', server.connect)
    with pytest.raises(service.CheckpointDatabaseMissing, match='storyfork_ai'):
        asyncio.run(service.ensure_database(URL))

def test_approval_refreshes_scope_before_later_retrieval(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('writing_editing', 'story_context'))
    writer(monkeypatch)
    pending = write_turn(thread, request='고친 뒤 설명해줘', target=TARGET,
                         scope={'scopeToken': 'old.token'}, inputs={'writing_editing': PATCH})
    assert pending.awaitingApproval == 'writing_editing'

    done = write_turn(thread, resume={'approved': True, 'scope': {'scopeToken': 'fresh.token'}})

    assert done.status == 'completed'
    assert [c[1][0].scopeToken for c in calls if c[0] == 'retrieval'] == ['fresh.token']

def test_failed_first_edit_keeps_existing_history(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='기존 질문', inputs={'story_context': QA})
    def fail_route(*_):
        raise IntentFailure()

    monkeypatch.setattr(service.intent, 'route', fail_route)

    events = stream(request='새 질문', conversation={'threadId': thread, 'scope': ME},
                    fromTurn=0, inputs={'story_context': QA})

    assert events[-1][0] == 'error'
    assert [turn.request for turn in conversation('history', thread, ME).turns] == ['기존 질문']

def test_approval_response_names_the_original_target_episode(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing'))
    result = write_turn(str(uuid4()), request='고쳐줘', target=TARGET, inputs={'writing_editing': PATCH})

    assert result.approvalEpisode == TARGET['episode']

def test_reediting_a_waiting_first_turn_still_replaces_old_history(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='기존 질문', inputs={'story_context': QA})
    waiting = chat(thread, request='입력 대기', fromTurn=0)
    assert waiting.status == 'waiting'

    history = conversation('history', thread, ME)
    assert [turn.request for turn in history.turns] == ['입력 대기']
    chat(thread, request='다시 수정', fromTurn=0, inputs={'story_context': QA})
    assert [turn.request for turn in conversation('history', thread, ME).turns] == ['다시 수정']


# Router가 되물은 뒤 작가가 CLARIFY_MESSAGE의 기능 보기 이름으로 답하면 모델이 다시 분류하지 않고 그 기능으로 확정한다.
# 이번 턴이 실행하는 요청은 되물음을 받은 직전 요청이고, 대화 기록에는 작가가 보낸 글이 남는다.
VAGUE = '5화를 흐름 모드로 시뮬레이션해줘. 등장인물은 길동과 길현이야.'
CLARIFY = plan(status='clarify', message=CLARIFY_MESSAGE)


def test_a_capability_name_answering_the_router_clarify_runs_the_earlier_request_as_that_feature(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, CLARIFY)
    asked = write_turn(thread, request=VAGUE, scope=SCOPE, target=TARGET)
    assert (asked.status, asked.message) == ('clarify', CLARIFY_MESSAGE)
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    writer(monkeypatch)
    answered = write_turn(thread, request='인물 시뮬레이션', scope=SCOPE, target=TARGET)
    assert (answered.status, answered.awaitingApproval) == ('waiting', 'character_simulation')
    assert names(calls) == ['route', 'sim_plan', 'simulation']
    assert calls[0][1] == (VAGUE, 'character_simulation', [], [])  # operation 경로(가드레일만)로 되물음을 받은 요청을 확정
    assert calls[1][1][0] == VAGUE  # 시뮬레이션 계획도 그 요청으로 세운다
    assert calls[2][1][2] == VAGUE
    history = asyncio.run(service.history(thread, 'user:1/work:1'))
    assert [t.request for t in history.turns] == [VAGUE, '인물 시뮬레이션']  # 대화 기록에는 작가가 보낸 글


def test_the_clarified_request_does_not_leak_into_the_next_turn(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, CLARIFY)
    write_turn(thread, request='길드 규칙은?', scope=SCOPE)
    calls = fake_agents(monkeypatch, plan('story_context'))
    result = write_turn(thread, request='작품 질문', scope=SCOPE)
    assert result.status == 'completed' and names(calls) == ['route', 'retrieval', 'story_context']
    assert calls[1][1][1] == '길드 규칙은?' and calls[2][1][0].question == '길드 규칙은?'
    write_turn(thread, request='다른 질문은?', scope=SCOPE)
    assert [c[1][1] for c in calls if c[0] == 'retrieval'] == ['길드 규칙은?', '다른 질문은?']
    assert [c[1][3] for c in calls if c[0] == 'route'][-1] == ['길드 규칙은?', '작품 질문']


def test_a_capability_name_is_ordinary_text_unless_the_router_just_asked(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='카이의 목표는?', inputs={'story_context': QA})
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    chat(thread, request='집필·수정', inputs={'writing_editing': PATCH})
    assert calls[0][1] == ('집필·수정', None, [], ['카이의 목표는?'])


def test_a_simulation_clarify_is_not_a_router_clarify(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'), drafted=SimulationPlan(mode='flow', beats=['성문 대면']))
    assert write_turn(thread, request='장면 시뮬레이션', scope=SCOPE, target=TARGET).status == 'clarify'
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    write_turn(thread, request='집필·수정', target=TARGET, inputs={'writing_editing': PATCH})
    assert calls[0][1] == ('집필·수정', None, [], ['장면 시뮬레이션'])


def test_an_explicit_operation_wins_over_a_clarify_answer(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, CLARIFY)
    chat(thread, request=VAGUE)
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='집필·수정', operation='story_context', inputs={'story_context': QA})
    assert calls[0][1] == ('집필·수정', 'story_context', [], [VAGUE])
