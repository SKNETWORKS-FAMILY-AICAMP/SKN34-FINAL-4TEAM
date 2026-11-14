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

from app.retrieval.errors import RetrievalFailure, RetrievalUnavailable
from app.retrieval.models import RetrievalResult
from app.simulation import scene_agent
from app.simulation.errors import SimulationFailure
from app.simulation.models import SimulationPlan

from .stubs import (CLOSING, COVERAGE, DRAFT, FORM, LINE, OPENING, PATCH, QA, SCENE_TEXT, SCOPE, WEB, fake_agents, fake_scene, plan)


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


# 인물 시뮬레이션(#58·#362): 계획 → 장면 에이전트가 턴마다 멈추며 쓴다 → 작가 승인 뒤 초안 반영. 장면은 실제 에이전트가 쓰고 바깥 의존만 대역이다.
REQUEST = '카엘이 북문에서 리나를 막으면?'
CONVERSATION = {'threadId': 'sim-thread', 'scope': 'user:1/work:1'}


def planned(calls):
    """Router·계획 호출 이름. 세계관을 읽을 때 부르는 조회(retrieval)는 요청마다 한 번씩 따로 센다."""
    return [name for name in names(calls) if name != 'retrieval']


def scene_turn(thread, action='next', approved=True, authorization='Bearer user', **fields):
    """장면 대기(또는 승인 대기)에서 작가가 보내는 resume.scene. approved는 함께 보내지만 서버는 장면 처리 뒤 다시 멈춘다."""
    return write_turn(thread, authorization, resume={'approved': approved, 'scene': {'action': action, **fields}})


def start_scene(monkeypatch, steps=('character_simulation',), **fake):
    """계획·장면 대역을 두고 첫 요청을 보낸다. (thread, 결과, Router·계획 호출 기록, 장면 대역 기록, 반영 기록)을 돌려준다."""
    calls = fake_agents(monkeypatch, plan(*steps))
    log = fake_scene(monkeypatch, **fake)
    applied = writer(monkeypatch)
    thread = str(uuid4())
    return thread, write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET), calls, log, applied


def finish_scene(thread):
    """시작한 장면을 끝까지 쓴다(카엘 두 번과 마무리 나레이션). 승인 대기 결과를 돌려준다."""
    for _ in range(3):
        result = scene_turn(thread)
    return result


def test_the_first_request_plans_writes_the_opening_turn_and_waits_for_the_author(monkeypatch):
    thread, result, calls, log, applied = start_scene(monkeypatch)
    assert (result.status, result.awaitingScene, result.awaitingApproval, result.message) == ('waiting', 'character_simulation', None, service.SCENE_MESSAGE)
    assert planned(calls) == ['route', 'sim_plan'] and calls[1][1] == (REQUEST, [], TARGET)
    step = result.steps[0]
    assert (step.status, step.result.status, [t.kind for t in step.result.turns], step.result.turns[0].prose) == ('not_started', 'paused', ['narration'], OPENING)
    assert log.director == [['narration']] and applied == []


def test_each_resume_writes_one_more_turn_and_the_finished_scene_waits_for_approval(monkeypatch):
    thread, _, calls, log, applied = start_scene(monkeypatch)
    second = scene_turn(thread)
    assert [t.characterName for t in second.steps[0].result.turns] == ['나레이션', '카엘'] and second.awaitingScene == 'character_simulation'
    assert len(scene_turn(thread).steps[0].result.turns) == 3
    done = scene_turn(thread)  # 마무리까지 쓰면 장면이 끝나 승인을 묻는다
    assert (done.status, done.awaitingApproval, done.awaitingScene, done.approvalEpisode) == ('waiting', 'character_simulation', None, 3)
    assert '시뮬레이션' in done.message and (done.steps[0].status, done.steps[0].result.status, len(done.steps[0].result.turns)) == ('completed', 'completed', 4)
    assert planned(calls) == ['route', 'sim_plan'] and applied == []  # 승인 전에는 쓰지 않고 라우팅·계획을 다시 하지 않는다
    assert log.director == [['narration'], ['narration', 'monologue', 'speech'], ['narration', 'monologue', 'speech'], ['end']]


def test_scene_approval_writes_all_turns_in_order_joined_by_blank_lines_with_the_resuming_users_token(monkeypatch):
    thread, _, calls, _, applied = start_scene(monkeypatch)
    finish_scene(thread)
    done = write_turn(thread, 'Bearer fresh', resume={'approved': True})
    assert (done.status, done.awaitingApproval) == ('completed', None) and (done.steps[0].approval, done.steps[0].applied.revision) == ('approved', 8)
    assert applied == [('work', 3, {'text': SCENE_TEXT}, 'Bearer fresh')]  # 나레이션도 순서대로 들어간다
    assert planned(calls) == ['route', 'sim_plan']


def test_each_request_reads_the_excerpts_once_and_a_resume_brings_the_fresh_retrieval_token(monkeypatch):
    thread, _, calls, _, _ = start_scene(monkeypatch)
    scene_turn(thread)
    write_turn(thread, resume={'approved': True, 'scene': {'action': 'next'}, 'scope': {'scopeToken': 'fresh.token'}})
    tokens = [(c[1][0].scopeToken, c[1][1]) for c in calls if c[0] == 'retrieval']
    assert tokens == [('signed.token', REQUEST), ('signed.token', REQUEST), ('fresh.token', REQUEST)]


def test_declined_scene_is_kept_but_never_written(monkeypatch):
    thread, _, _, _, applied = start_scene(monkeypatch)
    finish_scene(thread)
    done = write_turn(thread, resume={'approved': False})
    assert (done.status, done.steps[0].approval, done.steps[0].applied) == ('completed', 'declined', None)
    assert len(done.steps[0].result.turns) == 4 and applied == []


def test_failed_scene_write_fails_the_step_and_keeps_the_scene(monkeypatch):
    from app.content_mcp.errors import ContentMcpFailure
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    writer(monkeypatch, fail=ContentMcpFailure(409, '초안이 최신이 아니에요.'))
    thread = str(uuid4())
    write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    finish_scene(thread)
    done = write_turn(thread, resume={'approved': True})
    assert (done.status, done.steps[0].error, len(done.steps[0].result.turns)) == ('failed', '초안이 최신이 아니에요.', 4)
    assert planned(calls) == ['route', 'sim_plan']


def test_stop_ends_the_scene_as_it_is_and_asks_for_approval_of_what_exists(monkeypatch):
    thread, _, _, log, applied = start_scene(monkeypatch)
    scene_turn(thread)
    asked = scene_turn(thread, 'stop')
    assert (asked.status, asked.awaitingApproval, asked.steps[0].result.status, len(asked.steps[0].result.turns)) == ('waiting', 'character_simulation', 'completed', 2)
    assert len(log.narrate) == 1  # 마무리 나레이션은 쓰지 않는다
    write_turn(thread, resume={'approved': True})
    assert applied[0][2] == {'text': f'{OPENING}\n\n{LINE}'}


def test_a_turn_that_cannot_pass_the_checks_stops_the_scene_but_it_waits_for_the_author_to_continue_or_end_it(monkeypatch):
    thread, _, _, log, applied = start_scene(monkeypatch, fail='speech')
    stopped = scene_turn(thread)  # 카엘의 대사가 검사를 세 번 모두 통과하지 못한다
    assert (stopped.status, stopped.awaitingScene, stopped.awaitingApproval) == ('waiting', 'character_simulation', None)
    step = stopped.steps[0]
    assert (step.status, step.result.status, step.result.stopReason, len(step.result.turns)) == ('failed', 'stopped', 'check_failed', 1)
    assert '검사를 통과하지 못해' in step.error and len(log.act) == 3
    asked = scene_turn(thread, 'stop')  # 멈춘 장면도 작가가 끝내면 지금까지를 승인할 수 있다
    assert (asked.awaitingApproval, asked.steps[0].result.status) == ('character_simulation', 'completed') and applied == []


def test_a_scene_that_fails_before_any_turn_ends_the_run_failed_with_the_partial_result_and_runs_nothing_else(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'))
    fake_scene(monkeypatch, fail='narration')
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET, inputs={'web_research': WEB})
    assert (result.status, result.awaitingScene, result.awaitingApproval) == ('failed', None, None)
    step = result.steps[0]
    assert (step.status, step.result.status, step.result.turns, step.result.stopReason) == ('failed', 'stopped', [], 'check_failed')
    assert '나레이션' in step.error and result.steps[1].status == 'not_started' and applied == [] and 'web_research' not in planned(calls)


@pytest.fixture
def small_call_limit(monkeypatch):
    """호출 한도 안전망을 3으로 줄인다. 에이전트는 만들 때 한도를 읽고 캐시되므로 앞뒤로 캐시를 비운다."""
    monkeypatch.setattr(scene_agent, 'LOOP_LIMIT', 3)
    scene_agent.scene_agent.cache_clear()
    yield
    scene_agent.scene_agent.cache_clear()


def test_a_scene_cut_by_the_call_limit_keeps_its_turns_and_says_why(monkeypatch, small_call_limit):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    result = run(REQUEST, target=TARGET)  # 한도 안에서 끝나지 못한다(마무리 전 네 번째 모델 호출에서 한도에 닿는다)
    step = result.steps[0]
    assert (result.status, step.status, step.error) == ('failed', 'failed', service.LIMIT_MESSAGE)  # 실패를 숨기지 않는다
    assert (step.result.status, step.result.stopReason, [t.kind for t in step.result.turns]) == ('stopped', 'call_limit', ['narration', 'character', 'character'])


def test_a_conversation_scene_cut_by_the_call_limit_keeps_the_turns_of_the_earlier_requests(monkeypatch, small_call_limit):
    thread, *_ = start_scene(monkeypatch)
    scene_turn(thread)
    scene_turn(thread)  # 나레이션·카엘·카엘 세 턴
    cut = scene_turn(thread)  # 이어 쓰려는 네 번째 모델 호출에서 한도에 닿는다
    step = cut.steps[0]
    assert (cut.status, cut.awaitingScene, cut.awaitingApproval, step.status, step.error) == ('failed', None, None, 'failed', service.LIMIT_MESSAGE)
    assert (step.result.status, step.result.stopReason, len(step.result.turns)) == ('stopped', 'call_limit', 3)


def test_declining_in_the_middle_of_a_scene_cancels_the_run_and_keeps_the_turns_without_a_limit_reason(monkeypatch):
    thread, *_ = start_scene(monkeypatch)
    scene_turn(thread)
    done = write_turn(thread, resume={'approved': False})  # 이어 쓰던 장면을 반영하지 않기로 한다
    step = done.steps[0]
    assert (done.status, done.message) == ('cancelled', service.CANCELLED_MESSAGE)
    assert (step.result.status, step.result.stopReason, len(step.result.turns)) == ('paused', None, 2) and step.error is None  # 호출 한도가 끊은 것이 아니다


def test_a_scene_goes_on_when_the_content_service_says_the_manuscript_search_is_unavailable_and_the_response_says_so(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation'), fail={'retrieval': RetrievalUnavailable(503, '원고 Q&A를 사용할 수 없어요.')})
    fake_scene(monkeypatch)
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET)
    step = result.steps[0]
    assert (result.status, result.awaitingScene, step.error) == ('waiting', 'character_simulation', None)  # 실패가 아니라 이어 간다
    assert (step.result.notice, [t.kind for t in step.result.turns]) == ('원고 발췌 검색을 쓸 수 없어 세계관 설정만으로 진행했어요.', ['narration'])
    assert names(calls).count('retrieval') == 1


def test_any_other_retrieval_error_still_fails_the_scene_run(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'), fail={'retrieval': RetrievalFailure(409, '공개 원고 범위가 변경됐어요.')})
    fake_scene(monkeypatch)
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET)
    assert (result.status, result.steps[0].status, result.steps[0].error, result.steps[0].result.notice) == ('failed', 'failed', '공개 원고 범위가 변경됐어요.', None)


def test_world_failure_fails_the_scene_with_the_reason(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch, read=SimulationFailure(409, '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.'))
    result = run(REQUEST, target=TARGET)
    assert (result.status, result.steps[0].status, result.steps[0].error) == ('failed', 'failed', '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.')
    assert (result.steps[0].result.status, result.steps[0].result.turns) == ('failed', [])


def test_simulation_without_a_conversation_writes_the_whole_scene_at_once_without_approval(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    applied = writer(monkeypatch)
    result = run(REQUEST, target=TARGET)  # 대화가 없으면 턴 사이에 멈출 수 없다
    assert (result.status, result.awaitingScene, result.awaitingApproval, result.steps[0].result.status) == ('completed', None, None, 'completed')
    assert [t.kind for t in result.steps[0].result.turns] == ['narration', 'character', 'character', 'narration'] and applied == []


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
    assert planned(calls) == ['route', 'sim_plan']  # 다른 단계도 실행하지 않는다(축소 실행 금지)


def test_the_author_answers_a_clarify_in_the_next_chat_message(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'), drafted=SimulationPlan(mode='flow', beats=['성문 대면']))
    asked = write_turn(thread, request='장면 시뮬레이션', scope=SCOPE, target=TARGET)
    assert asked.status == 'clarify'
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    answered = write_turn(thread, request='카엘과 리나로 해 줘', scope=SCOPE, target=TARGET)
    assert answered.status == 'waiting' and answered.awaitingScene == 'character_simulation'
    assert [c[1][:2] for c in calls if c[0] == 'sim_plan'] == [('카엘과 리나로 해 줘', ['장면 시뮬레이션'])]  # 앞 요청이 history로 간다


def test_planning_failure_fails_the_step_without_running_anything(monkeypatch):
    message = '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.'
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'), fail={'sim_plan': SimulationFailure(409, message)})
    result = run(REQUEST, target=TARGET, inputs={'web_research': WEB})
    assert result.status == 'failed'
    assert [(s.status, s.error) for s in result.steps] == [('failed', message), ('not_started', None)]
    assert planned(calls) == ['route', 'sim_plan']


def test_failed_planning_does_not_wait_for_the_other_steps_inputs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'),
                        fail={'sim_plan': SimulationFailure(409, '연결된 세계관이 없어요.')})
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET)  # 대화 안이고 웹 조사 입력은 없다
    assert (result.status, result.missingInputs) == ('failed', [])
    assert [s.status for s in result.steps] == ['failed', 'not_started'] and planned(calls) == ['route', 'sim_plan']


def test_simulation_needs_no_step_input_but_other_steps_still_wait_for_theirs(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'))
    log = fake_scene(monkeypatch)
    writer(monkeypatch)
    waiting = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    assert (waiting.status, waiting.missingInputs, waiting.awaitingScene) == ('waiting', ['web_research'], None)
    assert planned(calls) == ['route', 'sim_plan'] and log.director == []  # 입력이 모자라면 장면도 시작하지 않는다
    resumed = write_turn(thread, resume={'approved': True, 'inputs': {'web_research': WEB}})
    assert (resumed.status, resumed.awaitingScene, len(resumed.steps[0].result.turns)) == ('waiting', 'character_simulation', 1)
    assert planned(calls) == ['route', 'sim_plan']  # 계획은 다시 만들지 않고 저장된 것으로 실행한다


def test_scene_and_writing_results_are_approved_one_after_the_other(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation', 'writing_editing'))
    fake_scene(monkeypatch)
    applied = writer(monkeypatch)
    first = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET, inputs={'writing_editing': PATCH})
    assert first.awaitingScene == 'character_simulation'
    assert finish_scene(thread).awaitingApproval == 'character_simulation'
    second = write_turn(thread, resume={'approved': True})
    assert (second.status, second.awaitingApproval) == ('waiting', 'writing_editing')
    done = write_turn(thread, resume={'approved': True})
    assert (done.status, [s.approval for s in done.steps]) == ('completed', ['approved', 'approved'])
    assert [a[2].get('text') or a[2].get('after') for a in applied] == [SCENE_TEXT, '그는 차갑게 웃었다.']


def test_edit_changes_a_line_without_calling_any_model_and_the_approval_writes_the_authors_text(monkeypatch):
    thread, _, _, log, applied = start_scene(monkeypatch)
    scene_turn(thread)
    seen = (len(log.act), len(log.narrate), len(log.director))
    edited = scene_turn(thread, 'edit', turn=1, text='AUTHOR-LINE "비켜."')
    turn = edited.steps[0].result.turns[1]
    assert edited.awaitingScene == 'character_simulation' and (turn.prose, turn.editedByAuthor, turn.checks) == ('AUTHOR-LINE "비켜."', True, [])
    assert (len(log.act), len(log.narrate), len(log.director)) == seen
    scene_turn(thread)  # 카엘의 두 번째 대사로 이야기가 끝난다
    asked = scene_turn(thread)  # 마무리 나레이션 뒤 승인을 묻는다
    assert asked.awaitingApproval == 'character_simulation' and asked.steps[0].result.turns[1].prose == 'AUTHOR-LINE "비켜."'
    write_turn(thread, resume={'approved': True})
    assert applied[0][2]['text'].split('\n\n')[1] == 'AUTHOR-LINE "비켜."'


def test_redo_writes_that_turn_again_and_everything_after_it_is_dropped(monkeypatch):
    thread, _, _, log, _ = start_scene(monkeypatch)
    scene_turn(thread)
    scene_turn(thread)
    again = scene_turn(thread, 'redo', turn=1, note='더 퉁명스럽게')
    assert [t.characterName for t in again.steps[0].result.turns] == ['나레이션', '카엘'] and again.awaitingScene == 'character_simulation'
    assert log.act[-1]['authorNote'] == '더 퉁명스럽게' and [n.text for n in again.steps[0].result.notes] == ['더 퉁명스럽게']


def test_a_note_makes_the_next_turn_a_narration(monkeypatch):
    thread, _, _, log, _ = start_scene(monkeypatch)
    scene_turn(thread)
    noted = scene_turn(thread, 'next', note='갑자기 정전이 된다')
    assert [t.kind for t in noted.steps[0].result.turns] == ['narration', 'character', 'narration']
    assert log.narrate[-1]['purpose'] == 'note' and log.narrate[-1]['notes'] == [{'afterTurn': 1, 'text': '갑자기 정전이 된다'}]


def test_a_finished_scene_can_be_continued_from_the_approval_question_and_approved_later(monkeypatch):
    thread, _, _, log, applied = start_scene(monkeypatch)
    finish_scene(thread)
    more = scene_turn(thread, 'next', note='이야기가 이어진다')  # 승인 대기 중의 장면 조작은 장면으로 돌아가 이어 간다
    assert (more.status, more.awaitingScene, more.awaitingApproval) == ('waiting', 'character_simulation', None)
    assert [t.kind for t in more.steps[0].result.turns] == ['narration', 'character', 'character', 'narration']  # 마무리가 빠지고 메모 나레이션이 붙었다
    assert (more.steps[0].status, more.steps[0].result.status) == ('not_started', 'paused') and log.narrate[-1]['purpose'] == 'note'
    assert applied == []
    asked = scene_turn(thread, 'stop')
    assert asked.awaitingApproval == 'character_simulation'
    write_turn(thread, resume={'approved': True})
    assert applied[0][2]['text'].split('\n\n')[-1] == OPENING  # 메모 나레이션(대역은 시작 문장을 쓴다)까지 반영된다


def test_editing_at_the_approval_question_returns_to_the_same_question_with_the_edited_text(monkeypatch):
    thread, _, _, log, applied = start_scene(monkeypatch)
    finish_scene(thread)
    seen = (len(log.act), len(log.narrate), len(log.director))
    asked = scene_turn(thread, 'edit', turn=2, text='AUTHOR-LINE')
    assert (asked.status, asked.awaitingApproval, asked.steps[0].result.status) == ('waiting', 'character_simulation', 'completed')
    assert asked.steps[0].result.turns[2].prose == 'AUTHOR-LINE' and (len(log.act), len(log.narrate), len(log.director)) == seen
    write_turn(thread, resume={'approved': True})
    assert applied[0][2]['text'] == '\n\n'.join([OPENING, LINE, 'AUTHOR-LINE', CLOSING])


def test_a_refusal_during_the_scene_ends_it_cancelled_and_writes_nothing(monkeypatch):
    thread, _, _, _, applied = start_scene(monkeypatch)
    scene_turn(thread)
    cancelled = write_turn(thread, resume={'approved': False})
    assert (cancelled.status, cancelled.message, cancelled.awaitingScene) == ('cancelled', service.CANCELLED_MESSAGE, None) and applied == []
    with pytest.raises(service.NothingToResume):
        scene_turn(thread)


def test_scene_actions_the_stage_cannot_take_are_refused_before_anything_runs(monkeypatch):
    thread, _, _, log, _ = start_scene(monkeypatch)
    seen = (len(log.act), len(log.narrate), len(log.director))
    with pytest.raises(service.SceneRejected, match='끝난 뒤에'):
        write_turn(thread, resume={'approved': True})  # 장면이 끝나기 전의 승인
    for bad in (dict(action='edit', turn=9, text='x'), dict(action='redo', turn=1)):
        with pytest.raises(service.SceneRejected, match='번호의 턴'):
            scene_turn(thread, **bad)
    assert (len(log.act), len(log.narrate), len(log.director)) == seen
    assert scene_turn(thread).awaitingScene == 'character_simulation'  # 멈춘 상태는 그대로라 올바른 조작은 이어진다
    finish = scene_turn(thread), scene_turn(thread)
    assert finish[-1].awaitingApproval == 'character_simulation'
    with pytest.raises(service.SceneRejected, match='번호의 턴'):
        scene_turn(thread, 'edit', turn=4, text='x')


def test_scene_actions_are_refused_while_waiting_for_something_else(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation', 'web_research'))
    fake_scene(monkeypatch)
    write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)  # 웹 조사 입력을 기다린다
    with pytest.raises(service.SceneRejected, match='조작할 수 없어요'):
        scene_turn(thread)
    events = stream(request=None, conversation={'threadId': thread, 'scope': 'user:1/work:1'}, resume={'approved': True, 'scene': {'action': 'next'}})
    assert events == [('error', {'message': '지금은 장면을 조작할 수 없어요.'})]


def test_the_waiting_scene_comes_back_with_the_conversation_history(monkeypatch):
    thread, _, _, _, _ = start_scene(monkeypatch)
    scene_turn(thread)
    history = conversation('history', thread, 'user:1/work:1')
    reply = history.turns[-1].reply
    assert (reply.status, reply.awaitingScene, reply.awaitingApproval) == ('waiting', 'character_simulation', None)
    assert [t.characterName for t in reply.steps[0].result.turns] == ['나레이션', '카엘'] and reply.steps[0].result.status == 'paused'


def test_a_new_request_starts_a_new_scene_instead_of_continuing_the_waiting_one(monkeypatch):
    thread, _, _, _, _ = start_scene(monkeypatch)
    scene_turn(thread)
    fresh = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    assert fresh.awaitingScene == 'character_simulation' and len(fresh.steps[0].result.turns) == 1


def test_a_new_request_after_a_finished_scene_starts_a_new_scene_instead_of_reusing_the_finished_one(monkeypatch):
    thread, _, _, _, applied = start_scene(monkeypatch)
    finish_scene(thread)
    write_turn(thread, resume={'approved': True})
    fresh = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    assert (fresh.status, fresh.awaitingScene, len(fresh.steps[0].result.turns)) == ('waiting', 'character_simulation', 1)
    assert len(applied) == 1


def test_the_button_form_is_the_plan_without_asking_a_model(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    writer(monkeypatch)
    result = write_turn(str(uuid4()), request='흐름 모드 시뮬레이션: 장면 계획 2개', operation='character_simulation', simulation=FORM,
                        scope=SCOPE, target=TARGET)
    assert planned(calls) == ['route'] and calls[0][1] == ('흐름 모드 시뮬레이션: 장면 계획 2개', 'character_simulation', [], [])
    shown = result.steps[0].result
    assert (result.awaitingScene, shown.mode, shown.premise, [b.text for b in shown.beats]) == ('character_simulation', 'flow', None, FORM['beats'])


@pytest.mark.parametrize('form, said', [
    ({**FORM, 'characterIds': ['not-in-the-world']}, '세계관에 없는 인물'),
    ({'mode': 'if', 'characterIds': ['k']}, 'IF 전제'),
    ({'mode': 'flow', 'beats': [], 'characterIds': ['k']}, '장면 비트'),
])
def test_a_button_form_the_world_or_the_mode_does_not_allow_ends_failed_with_the_reason_instead_of_asking(monkeypatch, form, said):
    calls = fake_agents(monkeypatch, plan('character_simulation'))
    log = fake_scene(monkeypatch)
    result = write_turn(str(uuid4()), request='시뮬레이션', operation='character_simulation', simulation=form, scope=SCOPE, target=TARGET)
    assert (result.status, result.awaitingScene, result.steps[0].status) == ('failed', None, 'failed') and said in result.steps[0].error
    assert planned(calls) == ['route'] and log.director == []


def stream_scene(thread, **body):
    return stream(conversation={'threadId': thread, 'scope': 'user:1/work:1'}, **body)


def test_stream_sends_each_finished_turn_as_a_cumulative_step_then_waits(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    writer(monkeypatch)
    thread = str(uuid4())
    first = stream_scene(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    assert [name for name, _ in first] == ['plan', 'started', 'step', 'waiting', 'done']
    running = first[2][1]
    assert (running['feature'], running['status'], running['result']['status'], len(running['result']['turns'])) == ('character_simulation', 'not_started', 'paused', 1)
    assert first[3][1]['awaitingScene'] == 'character_simulation' and first[-1][1]['status'] == 'waiting'
    second = stream_scene(thread, request=None, resume={'approved': True, 'scene': {'action': 'next'}})
    assert [name for name, _ in second] == ['step', 'waiting', 'done']
    assert len(second[0][1]['result']['turns']) == 2 and second[1][1]['steps'][0]['result']['turns'][1]['characterName'] == '카엘'


def test_stream_tells_an_edit_that_called_no_model_from_the_waiting_payload(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    writer(monkeypatch)
    thread = str(uuid4())
    stream_scene(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    stream_scene(thread, request=None, resume={'approved': True, 'scene': {'action': 'next'}})
    edited = stream_scene(thread, request=None, resume={'approved': True, 'scene': {'action': 'edit', 'turn': 1, 'text': 'AUTHOR-LINE'}})
    assert [name for name, _ in edited] == ['step', 'waiting', 'done']
    assert edited[0][1]['result']['turns'][1]['prose'] == 'AUTHOR-LINE' and edited[1][1]['awaitingScene'] == 'character_simulation'


def test_stream_reports_the_closing_turn_the_final_step_and_the_approval_wait_then_the_applied_step(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    writer(monkeypatch)
    thread = str(uuid4())
    for body in (dict(request=REQUEST, scope=SCOPE, target=TARGET), *[dict(request=None, resume={'approved': True, 'scene': {'action': 'next'}})] * 2):
        stream_scene(thread, **body)
    last = stream_scene(thread, request=None, resume={'approved': True, 'scene': {'action': 'next'}})
    assert [name for name, _ in last] == ['step', 'step', 'waiting', 'done']  # 마무리 턴, 노드가 끝난 단계, 승인 대기
    assert (last[0][1]['result']['status'], last[0][1]['status']) == ('completed', 'completed') and last[2][1]['awaitingApproval'] == 'character_simulation'
    approved = stream_scene(thread, request=None, resume={'approved': True})
    assert [name for name, _ in approved] == ['step', 'done']
    assert (approved[0][1]['feature'], approved[0][1]['applied']) == ('character_simulation', {'episode': 3, 'revision': 8})
    assert approved[-1][1]['status'] == 'completed'


def test_stream_continuing_from_the_approval_question_starts_the_scene_again(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch)
    writer(monkeypatch)
    thread = str(uuid4())
    stream_scene(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    for _ in range(3):
        stream_scene(thread, request=None, resume={'approved': True, 'scene': {'action': 'next'}})
    more = stream_scene(thread, request=None, resume={'approved': True, 'scene': {'action': 'next', 'note': '이어진다'}})
    assert [name for name, _ in more] == ['started', 'step', 'waiting', 'done'] and more[1][1]['result']['status'] == 'paused'
    assert more[2][1]['awaitingScene'] == 'character_simulation'


def test_stream_clarify_and_planning_failure_end_with_done(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'), drafted=SimulationPlan())
    asked = stream(request=REQUEST, target=TARGET)
    assert [name for name, _ in asked] == ['plan', 'done'] and asked[-1][1]['status'] == 'clarify'
    fake_agents(monkeypatch, plan('character_simulation'), fail={'sim_plan': SimulationFailure(409, '연결된 세계관이 없어요.')})
    failed = stream(request=REQUEST, target=TARGET)
    assert [name for name, _ in failed] == ['plan', 'step', 'done']
    assert (failed[1][1]['status'], failed[1][1]['error'], failed[-1][1]['status']) == ('failed', '연결된 세계관이 없어요.', 'failed')


def test_simulation_planning_turns_and_apply_join_the_trace_of_the_turn(monkeypatch, spans):
    thread, waiting, _, _, _ = start_scene(monkeypatch)
    finish_scene(thread)
    done = write_turn(thread, resume={'approved': True})
    found = {s.name: s for s in spans()}
    assert {'step.character_simulation.plan', 'step.character_simulation', 'step.character_simulation.apply'} <= set(found)
    assert done.runId == waiting.runId == format(found['step.character_simulation'].context.trace_id, '032x')
    turns = [s for s in spans() if s.name == 'simulation.turn']
    assert len(turns) == 4 and all(format(s.context.trace_id, '032x') == waiting.runId for s in turns)  # 턴마다 사용량 장부가 같은 trace에 붙는다
    assert not any(s.attributes.get('langfuse.observation.level') == 'ERROR' for s in spans() if s.name == 'step.character_simulation')  # 턴 사이 대기는 실패가 아니다


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
    fake_scene(monkeypatch)
    writer(monkeypatch)
    answered = write_turn(thread, request='인물 시뮬레이션', scope=SCOPE, target=TARGET)
    assert (answered.status, answered.awaitingScene) == ('waiting', 'character_simulation')
    assert names(calls) == ['route', 'sim_plan', 'retrieval']
    assert calls[0][1] == (VAGUE, 'character_simulation', [], [])  # operation 경로(가드레일만)로 되물음을 받은 요청을 확정
    assert calls[1][1][0] == VAGUE  # 시뮬레이션 계획도 그 요청으로 세운다
    assert calls[2][1][1] == VAGUE  # 장면이 읽는 원고 발췌의 검색어도 그 요청이다
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
