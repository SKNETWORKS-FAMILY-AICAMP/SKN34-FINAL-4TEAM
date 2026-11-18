import asyncio
import json
import time
from uuid import uuid4

import pytest

from app.content_mcp.errors import ContentMcpFailure
from app.intent.errors import IntentFailure
from app.intent.prompt import CLARIFY_MESSAGE
from app.story_qa.errors import StoryQaFailure
from app.orchestration import service, tools
from app.orchestration.models import ChatTurn, OrchestrationRequest
from app.rating.errors import RatingFailure
from app.research.errors import ResearchFailure

from app.retrieval.errors import RetrievalFailure, RetrievalUnavailable
from app.retrieval.models import RetrievalResult
from app.review.models import Finding as ReviewFinding, ReviewResponse
from app.simulation import scene_agent
from app.simulation.errors import SimulationFailure
from app.simulation.models import SimulationPlan
from app.world_review import service as world_review
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import Finding as WorldFinding, WorldReviewResult

from .stubs import (BEAT, CLOSING, CONTEXT, COVERAGE, DRAFT, FORM, LINE, OPENING, PATCH, QA, REVIEW, SCENE_TEXT, SCOPE, WEB,
                    WORLD_REVIEW_REQUEST, Step, fake_agents, fake_scene, plan)

REAL_WORLD_REVIEW = (world_review.linked_request, world_review.review)  # fake_agents가 바꾸기 전의 실제 함수


def run(request='요청', **body):
    return asyncio.run(service.run(OrchestrationRequest(request=request, **body)))


def names(calls):
    return [name for name, *_ in calls]


def test_router_receives_request_operation_and_materials(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run('규칙 알려줘', operation='story_context', materials=['자료'], inputs={'story_context': QA})
    assert calls[0][1] == ('규칙 알려줘', 'story_context', ['자료'], [])


def test_missing_input_without_a_conversation_ends_as_needs_input_and_keeps_the_finished_steps(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.missingInputs) == ('needs_input', ['web_research'])
    assert names(calls) == ['judge', 'story_context'] and [s.feature for s in result.steps] == ['story_context']


def test_independent_steps_run_in_plan_order_with_own_inputs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('web_research', 'story_context', 'writing_editing'))
    result = run(inputs={'story_context': QA, 'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'completed'
    assert names(calls) == ['judge', 'web_research', 'story_context', 'draft']
    assert [s.feature for s in result.steps] == ['web_research', 'story_context', 'writing_editing']
    assert result.steps[1].result.claims[0].sourceIds == ['a']
    assert calls[1][1][0].question == WEB['question']


def test_writing_patch_input_runs_patch(monkeypatch):
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    result = run(inputs={'writing_editing': PATCH})
    assert names(calls) == ['judge', 'patch']
    assert result.steps[0].result.after == '그는 차갑게 웃었다.'


def test_failed_step_keeps_earlier_result_and_starts_no_new_step(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research', 'writing_editing'),
                        fail={'web_research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    result = run(inputs={'story_context': QA, 'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'failed'
    assert [(s.status, s.error) for s in result.steps] == [
        ('completed', None), ('failed', '웹 검색에 실패했습니다.')]
    assert names(calls) == ['judge', 'story_context', 'web_research']


def test_router_failure_propagates(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'judge': IntentFailure()})
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
                fail={'story_context': StoryQaFailure(502, 'Q&A 모델 응답을 확인할 수 없습니다.')})
    events = stream(inputs={'story_context': QA, 'web_research': WEB})
    assert [name for name, _ in events] == ['plan', 'started', 'step', 'done']
    assert events[2][1]['error'] == 'Q&A 모델 응답을 확인할 수 없습니다.'
    assert events[-1][1]['status'] == 'failed'


def slow_qa(monkeypatch, seconds=0.3):
    real = tools.story_qa.answer
    monkeypatch.setattr(tools.story_qa, 'answer', lambda data: (time.sleep(seconds), real(data))[1])


def test_stream_of_a_batch_sends_steps_as_they_finish_and_done_in_call_order(monkeypatch):
    fake_agents(monkeypatch, plan(['story_context', 'web_research']))
    slow_qa(monkeypatch)
    events = stream(inputs={'story_context': QA, 'web_research': WEB})
    assert [name for name, _ in events] == ['plan', 'started', 'started', 'step', 'step', 'done']
    assert [data['feature'] for name, data in events if name == 'step'] == ['web_research', 'story_context']  # 먼저 끝난 결과가 먼저
    assert [s['feature'] for s in events[-1][1]['steps']] == ['story_context', 'web_research']  # 모델이 부른 순서


def test_batched_steps_are_overlapping_spans_of_the_same_trace(monkeypatch, spans):
    fake_agents(monkeypatch, plan(['story_context', 'web_research']))
    slow_qa(monkeypatch)
    run(inputs={'story_context': QA, 'web_research': WEB})
    found = {s.name: s for s in spans()}
    qa, web, root = found['step.story_context'], found['step.web_research'], found['writing_ai.orchestration']
    assert qa.parent.span_id == web.parent.span_id == root.context.span_id
    assert web.start_time < qa.end_time and qa.start_time < web.end_time


def test_stream_without_execution_ends_with_done_status(monkeypatch):
    fake_agents(monkeypatch, plan(status='clarify'))
    events = stream()
    assert [name for name, _ in events] == ['done']
    assert events[-1][1]['status'] == 'clarify'


def test_stream_router_failure_is_an_error_event(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'judge': IntentFailure()})
    assert stream() == [('error', {'message': '요청 분류에 실패했습니다.'})]


def chat(thread, scope='user:1/work:1', **body):
    return run(conversation={'threadId': thread, 'scope': scope}, **body)


def test_follow_up_turn_gets_previous_requests_and_qa_history(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='카이의 목표는?', inputs={'story_context': QA})
    chat(thread, request='그 목표가 바뀐 이유는?', inputs={'story_context': QA})
    route, qa = [c for c in calls if c[0] == 'judge'], [c for c in calls if c[0] == 'story_context']
    assert route[0][1][3] == [] and route[1][1][3] == ['카이의 목표는?']
    assert qa[0][1][0].history == []
    assert [(t.question, t.answer) for t in qa[1][1][0].history] == [(QA['question'], '밤에 닫는다')]


def test_each_turn_starts_without_previous_turn_results(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    assert chat(thread).status == 'waiting'
    second = chat(thread, inputs={'story_context': QA})  # 대기 중이어도 새 요청은 새 턴으로 시작한다.
    assert (second.status, second.missingInputs, second.message) == ('completed', [], '종합 답변')


def test_conversation_of_another_scope_is_refused(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, inputs={'story_context': QA})
    with pytest.raises(service.ConversationMismatch):
        chat(thread, scope='user:2/work:1', inputs={'story_context': QA})
    assert len([c for c in calls if c[0] == 'judge']) == 1


def test_requests_without_conversation_share_no_history(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run('첫 질문', inputs={'story_context': QA})
    run('둘째 질문', inputs={'story_context': QA})
    assert [c[1][3] for c in calls if c[0] == 'judge'] == [[], []]


def resume(thread, approved=True, inputs=None, scope='user:1/work:1'):
    return chat(thread, scope=scope, request=None, resume={'approved': approved, 'inputs': inputs or {}})


def test_missing_input_in_conversation_waits_inside_the_tool_after_the_finished_steps(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = chat(str(uuid4()), inputs={'story_context': QA})
    assert (result.status, result.missingInputs) == ('waiting', ['web_research'])
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed'), ('web_research', 'not_started')]
    assert names(calls) == ['judge', 'story_context']


def test_resume_with_inputs_runs_saved_plan_without_routing_again(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    chat(thread, inputs={'story_context': QA})
    result = resume(thread, inputs={'web_research': WEB})
    assert result.status == 'completed' and [s.status for s in result.steps] == ['completed', 'completed']
    assert names(calls) == ['judge', 'story_context', 'web_research']


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
    assert names(calls) == ['judge']
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


def test_run_id_is_the_trace_of_the_decision_main_agent_and_steps(monkeypatch, spans):
    fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = run(inputs={'story_context': QA, 'web_research': WEB})
    found = {s.name: s for s in spans()}
    assert {'writing_ai.orchestration', 'decision_guard', 'main_agent', 'step.story_context', 'step.web_research'} <= set(found)
    root = found['writing_ai.orchestration']
    assert result.runId == format(root.context.trace_id, '032x')
    assert all(found[n].parent.span_id == root.context.span_id
               for n in ('decision_guard', 'main_agent', 'step.story_context', 'step.web_research'))
    assert json.loads(root.attributes['langfuse.observation.input']) == {'request': '요청'}
    assert json.loads(found['decision_guard'].attributes['langfuse.observation.input']) == {'request': '요청'}
    assert len([s for s in spans() if s.name == 'main_agent']) == 3  # 도구 두 번 + 종합


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
    assert result.status == 'completed' and names(calls) == ['judge', 'retrieval', 'story_context']
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
    assert names(calls) == ['judge', 'retrieval']
    qa = result.steps[0].result
    assert (result.status, qa.claims, qa.gaps) == ('completed', [], ['근거를 확인하지 못했어요.'])


def test_retrieval_failure_fails_the_qa_step(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'),
                        fail={'retrieval': RetrievalFailure(409, '공개 원고 범위가 변경됐어요.')})
    result = run(scope=SCOPE, inputs={'web_research': WEB})
    assert [(s.status, s.error) for s in result.steps] == [('failed', '공개 원고 범위가 변경됐어요.')]
    assert names(calls) == ['judge', 'retrieval']


def test_given_excerpts_win_over_scope_and_skip_retrieval(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run(scope=SCOPE, inputs={'story_context': QA})
    assert names(calls) == ['judge', 'story_context']


def test_scope_does_not_satisfy_other_features(monkeypatch):
    fake_agents(monkeypatch, plan('web_research'))
    assert run(scope=SCOPE).missingInputs == ['web_research']


def test_stream_unexpected_failure_still_ends_with_error_event(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'judge': RuntimeError('원고 본문이 담긴 메시지')})
    assert stream(inputs={'story_context': QA}) == [('error', {'message': '작업을 완료할 수 없습니다.'})]


def test_resume_uses_the_fresh_scope_token_from_content(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('web_research', 'story_context'))  # 웹 조사 입력을 기다린 뒤 Q&A가 검색한다
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
        applied.append((work_id, number, result, tools.content_mcp.AUTHORIZATION.get()))
        if fail:
            raise fail
        return {'episode': number, 'revision': 8}

    monkeypatch.setattr(tools.content_mcp, 'apply_writing', apply_writing)
    return applied


def write_turn(thread, authorization='Bearer user', **body):
    data = OrchestrationRequest(conversation={'threadId': thread, 'scope': 'user:1/work:1'}, **body)
    return asyncio.run(service.run(data, authorization))


def test_review_checks_the_target_draft_with_the_chosen_check_and_writes_nothing(monkeypatch):
    calls = fake_agents(monkeypatch, plan('review'))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request='맞춤법 봐줘', target=TARGET, inputs={'review': REVIEW})
    assert result.status == 'completed' and result.awaitingApproval is None
    [(_, (data,), _)] = [c for c in calls if c[0] == 'review']
    assert (data.workId, data.episode, data.check) == ('work', 3, 'mechanical')
    found = result.steps[0].result.findings[0]
    assert (found.quote, found.start, found.end, found.status) == ('웃엇다', 3, 6, 'confirmed')
    assert applied == []  # 검수는 제안이라 승인·반영을 묻지 않는다


def test_review_without_a_target_fails_the_step_without_a_model_call(monkeypatch):
    calls = fake_agents(monkeypatch, plan('review'))
    result = run('검수해줘', inputs={'review': REVIEW})
    assert result.status == 'failed' and result.steps[0].error == tools.NO_REVIEW_TARGET
    assert names(calls) == ['judge']


def test_rating_rates_the_target_draft_without_inputs_or_approval(monkeypatch):
    calls = fake_agents(monkeypatch, plan('rating'))
    applied = writer(monkeypatch)
    # 대화 안이어도 단계 입력을 묻지 않는다. 판별 대상은 Content가 확인한 반영 대상 회차다.
    result = write_turn(str(uuid4()), request='이 회차 19세 이용가인지 봐줘', target=TARGET)
    assert result.status == 'completed' and result.awaitingApproval is None and result.missingInputs == []
    [(_, (data,), _)] = [c for c in calls if c[0] == 'rating']
    assert (data.workId, data.episodes) == ('work', [3])
    assert (result.steps[0].feature, result.steps[0].result.verdict) == ('rating', 'general')
    assert applied == []  # 판정은 제안이라 승인·반영을 묻지 않는다


def test_rating_failure_fails_only_the_step(monkeypatch):
    fake_agents(monkeypatch, plan('rating'), fail={'rating': RatingFailure(503, '심의 판별 모델 호출에 실패했습니다.')})
    result = run('19세 이용가인지 봐줘', target=TARGET)
    assert result.status == 'failed'
    assert (result.steps[0].status, result.steps[0].error) == ('failed', '심의 판별 모델 호출에 실패했습니다.')


def test_rating_without_a_target_fails_the_step_without_a_model_call(monkeypatch):
    calls = fake_agents(monkeypatch, plan('rating'))
    result = run('19세 이용가인지 봐줘')
    assert result.status == 'failed' and result.steps[0].error == tools.NO_RATING_TARGET
    assert names(calls) == ['judge']


def test_review_waits_for_the_check_kind_in_conversation(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('review'))
    waiting = write_turn(thread, request='검수해줘', target=TARGET)
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['review'])
    done = write_turn(thread, resume={'approved': True, 'inputs': {'review': {'check': 'semantic'}}})
    assert done.status == 'completed' and done.steps[0].result.check == 'semantic'
    assert names(calls) == ['judge', 'review']


@pytest.mark.parametrize('check', ['semantic', 'both'])
def test_review_uses_the_check_kind_the_router_found_without_asking(monkeypatch, check):
    calls = fake_agents(monkeypatch, plan(Step('review', check=check)))
    result = write_turn(str(uuid4()), request='설정이랑 맞춤법 다 봐줘', target=TARGET)
    assert result.status == 'completed' and result.missingInputs == []
    [(_, (data,), _)] = [c for c in calls if c[0] == 'review']
    assert data.check == check


def test_author_chosen_check_kind_wins_over_the_router(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('review', check='semantic')))
    write_turn(str(uuid4()), request='검수해줘', target=TARGET, inputs={'review': REVIEW})
    [(_, (data,), _)] = [c for c in calls if c[0] == 'review']
    assert data.check == 'mechanical'


def test_world_review_reads_the_linked_world_of_the_target_work_and_shows_findings_without_approval(monkeypatch):
    calls = fake_agents(monkeypatch, plan('world_review'))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request='설정에 오류 없는지 봐줘', target=TARGET)
    # 단계 입력이 없어 대화에서도 되묻지 않고, 지적은 제안이라 승인·반영 단계도 없다.
    assert (result.status, result.awaitingApproval, result.missingInputs) == ('completed', None, [])
    assert names(calls) == ['judge', 'world_review_read', 'world_review']
    assert calls[1][1] == ('work',) and calls[2][1] == (WORLD_REVIEW_REQUEST,)
    [step] = result.steps
    found = step.result.findings[0]
    assert (step.feature, step.status, found.cardIds, found.kind, found.fix.target) == ('world_review', 'completed', ['k'], 'doc_role', 'soul')
    assert step.result.reviewedCards == 1 and applied == []


def test_world_review_operation_skips_classification_and_runs_without_a_conversation(monkeypatch):
    calls = fake_agents(monkeypatch, plan('world_review'))
    result = run('설정집 검토', operation='world_review', target=TARGET)
    assert calls[0][1] == ('설정집 검토', 'world_review', [], [])  # operation 경로(가드레일만)로 확정한다
    assert (result.status, result.steps[0].status) == ('completed', 'completed')


def test_world_review_step_runs_the_same_service_function_as_the_internal_route(monkeypatch):
    fake_agents(monkeypatch, plan('world_review'))
    monkeypatch.setattr(tools.world_review, 'linked_request', REAL_WORLD_REVIEW[0])
    monkeypatch.setattr(tools.world_review, 'review', REAL_WORLD_REVIEW[1])
    world = {'worldId': 'w', 'name': '달빛 세계', 'description': '', 'relationships': [], 'cards': [
        {'id': 'k', 'title': '카엘', 'body': '북문을 지키는 기사', 'cardType': 'character', 'areaCode': 'society', 'lifecycle': 'active',
         'semanticMetadata': {'characterDocs': {'soul': '말이 짧다', 'goal': '', 'episodes': {}}}}]}
    read, sent = [], []

    def content(tool, arguments):
        read.append((tool, arguments, tools.content_mcp.AUTHORIZATION.get()))
        return [{'worldId': 'w', 'linkedWorkId': 'work'}] if tool == 'world_studio_list' else world

    def model(data):
        sent.append(data)
        found = WorldFinding(cardIds=['k'], kind='other', message='목표 문서가 비어 있어요.', fix=None)
        return WorldReviewResult(findings=[found]), {'model': 'm', 'providerResponseId': 'r', 'usage': None}

    monkeypatch.setattr(tools.content_mcp, 'call', content)
    monkeypatch.setattr(tools.world_review.agent, 'review', model)

    result = write_turn(str(uuid4()), request='설정 검토', target=TARGET)

    assert result.status == 'completed' and result.steps[0].result.findings[0].message == '목표 문서가 비어 있어요.'
    assert [(tool, arguments) for tool, arguments, _ in read] == [('world_studio_list', {}), ('world_studio_read', {'id': 'w'})]
    assert {token for *_, token in read} == {'Bearer user'}  # 작가 권한으로 읽는다
    assert [c.id for c in sent[0].cards] == ['k'] and result.steps[0].result.reviewedCards == 1


def test_world_review_without_a_target_fails_the_step_without_reading_the_world(monkeypatch):
    calls = fake_agents(monkeypatch, plan('world_review'))
    result = run('설정 검토해줘')
    assert result.status == 'failed' and result.steps[0].error == tools.NO_WORLD_REVIEW_TARGET
    assert names(calls) == ['judge']


@pytest.mark.parametrize('where, failure', [
    ('world_review_read', WorldReviewFailure(409, '이 작품에 연결된 세계관이 없어 설정집을 검토할 수 없어요.')),
    ('world_review_read', ContentMcpFailure(404, '세계관을 찾을 수 없어요.')),
    ('world_review', WorldReviewFailure(502, '설정집 검토 모델 응답을 확인할 수 없습니다.')),
])
def test_world_review_failure_fails_the_step_with_its_message_and_starts_no_new_step(monkeypatch, where, failure):
    fake_agents(monkeypatch, plan('world_review', 'web_research'), fail={where: failure})
    result = run(target=TARGET, inputs={'web_research': WEB})
    assert result.status == 'failed'
    assert [(s.status, s.error) for s in result.steps] == [('failed', str(failure))]


def test_world_review_runs_in_plan_order_and_never_asks_for_an_input(monkeypatch):
    calls = fake_agents(monkeypatch, plan('world_review', 'story_context'))
    result = run(target=TARGET, inputs={'story_context': QA})
    assert result.status == 'completed' and names(calls) == ['judge', 'world_review_read', 'world_review', 'story_context']
    calls = fake_agents(monkeypatch, plan('world_review', 'web_research'))
    result = run(target=TARGET)
    assert (result.status, result.missingInputs) == ('needs_input', ['web_research'])
    assert names(calls) == ['judge', 'world_review_read', 'world_review']


def test_stream_reports_the_world_review_step(monkeypatch):
    fake_agents(monkeypatch, plan('world_review'))
    events = stream('설정 검토', target=TARGET)
    assert [(name, data.get('feature')) for name, data in events] == [
        ('plan', None), ('started', 'world_review'), ('step', 'world_review'), ('done', None)]
    assert events[2][1]['result']['findings'][0]['fix']['target'] == 'soul' and events[-1][1]['status'] == 'completed'


BODY = '비가 왔다. 서윤은 웃엇다. 바람이 차가왔다.'


def found(quote, status='confirmed'):
    located = status == 'confirmed'
    return ReviewFinding(category='spelling', quote=quote, reason=f'{quote} 맞춤법', status=status, evidenceRefs=[], suggestion='고친 말',
                         start=0 if located else None, end=len(quote) if located else None)


def conditional(monkeypatch, *findings, revision=4, body=BODY):
    """검수 → 조건부 집필·수정 계획과 검수 결과·초안 읽기 대역. 호출 기록을 돌려준다."""
    calls = fake_agents(monkeypatch, plan('review', ('writing_editing', 'if_issues_found')))
    monkeypatch.setattr(tools.review, 'review', lambda data: ReviewResponse(
        workId=data.workId, episode=data.episode, revision=4, check=data.check, gaps=[], model='m', providerResponseId='r', usage=None,
        findings=list(findings)))
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: {'draft': {'title': '3화', 'body': body, 'revision': revision}})
    return calls


def test_one_confirmed_finding_becomes_the_patch_and_waits_for_approval(monkeypatch):
    calls = conditional(monkeypatch, found('서윤은 웃엇다.'), found('비가', status='suspected'))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert (result.status, result.awaitingApproval) == ('waiting', 'writing_editing')
    [(_, (patch,), _)] = [c for c in calls if c[0] == 'patch']
    assert (patch.selection, patch.precedingText, patch.followingText) == ('서윤은 웃엇다.', '비가 왔다. ', ' 바람이 차가왔다.')
    assert '서윤은 웃엇다. 맞춤법' in patch.instruction and '고친 말' in patch.instruction
    assert applied == []


@pytest.mark.parametrize('findings, reason', [
    ((), tools.NO_ISSUES),
    ((found('비가', status='suspected'),), tools.ONLY_SUSPECTED),
])
def test_review_without_confirmed_issues_skips_the_edit_with_the_reason(monkeypatch, findings, reason):
    calls = conditional(monkeypatch, *findings)
    result = write_turn(str(uuid4()), request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert result.status == 'completed'
    assert (result.steps[1].status, result.steps[1].error) == ('skipped', reason)
    assert 'patch' not in names(calls)


def test_several_confirmed_findings_wait_for_the_author_to_pick_one(monkeypatch):
    thread = str(uuid4())
    calls = conditional(monkeypatch, found('서윤은 웃엇다.'), found('바람이 차가왔다.'))
    waiting = write_turn(thread, request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['writing_editing'])
    assert waiting.steps[0].result.findings[1].quote == '바람이 차가왔다.'
    done = write_turn(thread, resume={'approved': True, 'inputs': {'writing_editing': {'fix': 1}}})
    assert (done.status, done.awaitingApproval) == ('waiting', 'writing_editing')
    [(_, (patch,), _)] = [c for c in calls if c[0] == 'patch']
    assert patch.selection == '바람이 차가왔다.'


def test_picking_a_finding_that_is_not_confirmed_fails_the_edit(monkeypatch):
    thread = str(uuid4())
    calls = conditional(monkeypatch, found('서윤은 웃엇다.'), found('바람이 차가왔다.'), found('비가', status='suspected'))
    write_turn(thread, request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    done = write_turn(thread, resume={'approved': True, 'inputs': {'writing_editing': {'fix': 2}}})
    assert done.status == 'failed' and done.steps[1].error == tools.BAD_FIX
    assert 'patch' not in names(calls)


def test_several_confirmed_findings_without_a_conversation_skip_with_guidance(monkeypatch):
    conditional(monkeypatch, found('서윤은 웃엇다.'), found('바람이 차가왔다.'))
    result = run('검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert (result.steps[1].status, result.steps[1].error) == ('skipped', tools.PICK_NEEDED)


def test_draft_changed_after_the_review_fails_the_edit_without_a_model_call(monkeypatch):
    calls = conditional(monkeypatch, found('서윤은 웃엇다.'), revision=5)
    result = write_turn(str(uuid4()), request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert result.status == 'failed' and result.steps[1].error == tools.DRAFT_CHANGED
    assert 'patch' not in names(calls)


def test_overlapping_quote_is_not_one_place_and_fails_the_edit(monkeypatch):
    # '하하하'의 '하하'는 겹쳐 두 곳이라 어느 쪽을 고칠지 정할 수 없다(#390).
    calls = conditional(monkeypatch, found('하하'), body='하하하')
    result = write_turn(str(uuid4()), request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert result.status == 'failed' and result.steps[1].error == tools.DRAFT_CHANGED
    assert 'patch' not in names(calls)


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
    assert names(calls) == ['judge', 'patch']  # 승인 뒤 모델을 다시 부르지 않는다.


def test_declined_result_is_kept_but_never_written(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('writing_editing'))
    applied = writer(monkeypatch)
    write_turn(thread, request='써줘', target=TARGET, inputs={'writing_editing': DRAFT})
    done = write_turn(thread, resume={'approved': False})
    assert done.status == 'completed' and done.steps[0].approval == 'declined' and done.steps[0].applied is None
    assert applied == []


def test_failed_write_fails_the_step_and_keeps_its_result_and_the_earlier_steps(monkeypatch):
    from app.content_mcp.errors import ContentMcpFailure
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('writing_editing', 'web_research'))
    writer(monkeypatch, fail=ContentMcpFailure(409, '초안이 최신이 아니에요.'))
    write_turn(thread, request='고치고 조사해줘', target=TARGET, inputs={'writing_editing': PATCH, 'web_research': WEB})
    done = write_turn(thread, resume={'approved': True})
    assert done.status == 'failed' and done.steps[0].error == '초안이 최신이 아니에요.'
    assert done.steps[0].result.after == '그는 차갑게 웃었다.' and done.steps[1].status == 'completed'
    assert names(calls).count('web_research') == 1  # 승인은 메인 에이전트가 끝난 뒤라 앞선 도구를 다시 부르지 않는다


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


def test_a_draft_after_the_base_episode_is_where_the_scene_is_reflected_while_the_world_is_read_at_the_base(monkeypatch):
    fake_agents(monkeypatch, plan('character_simulation'))
    log = fake_scene(monkeypatch)
    applied = writer(monkeypatch)
    thread = str(uuid4())
    write_turn(thread, request=REQUEST, scope=SCOPE, target={**TARGET, 'episode': 5, 'baseEpisode': 3})  # 3화까지 발행, 작가는 5화 초안을 열었다
    asked = finish_scene(thread)
    assert (asked.awaitingApproval, asked.approvalEpisode) == ('character_simulation', 5)  # 승인 질문은 반영 회차(5화)를 보인다
    done = write_turn(thread, 'Bearer fresh', resume={'approved': True})
    assert (done.status, done.steps[0].applied.episode) == ('completed', 5) and [a[1] for a in applied] == [5]
    assert {episode for _, episode in log.read} == {3}  # 세계관 지식 상한은 근거 회차 그대로다


def test_the_first_request_plans_writes_the_opening_turn_and_waits_for_the_author(monkeypatch):
    thread, result, calls, log, applied = start_scene(monkeypatch)
    assert (result.status, result.awaitingScene, result.awaitingApproval, result.message) == ('waiting', 'character_simulation', None, service.SCENE_MESSAGE)
    assert planned(calls) == ['judge', 'sim_plan'] and calls[1][1] == (REQUEST, [], TARGET)
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
    assert planned(calls) == ['judge', 'sim_plan'] and applied == []  # 승인 전에는 쓰지 않고 라우팅·계획을 다시 하지 않는다
    assert log.director == [['narration'], ['monologue', 'speech'], ['narration', 'monologue', 'speech'], ['end']]


def test_scene_approval_writes_all_turns_in_order_joined_by_blank_lines_with_the_resuming_users_token(monkeypatch):
    thread, _, calls, _, applied = start_scene(monkeypatch)
    finish_scene(thread)
    done = write_turn(thread, 'Bearer fresh', resume={'approved': True})
    assert (done.status, done.awaitingApproval) == ('completed', None) and (done.steps[0].approval, done.steps[0].applied.revision) == ('approved', 8)
    assert applied == [('work', 3, {'text': SCENE_TEXT}, 'Bearer fresh')]  # 나레이션도 순서대로 들어간다
    assert planned(calls) == ['judge', 'sim_plan']


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
    assert planned(calls) == ['judge', 'sim_plan']


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
    assert '나레이션' in step.error and len(result.steps) == 1 and applied == [] and 'web_research' not in planned(calls)


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


@pytest.mark.parametrize('failure', [SimulationFailure(409, '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.'),
                                     ContentMcpFailure(409, '이 세계관은 회차별 관계로 옮겨지지 않았어요.')])  # 회차를 지정한 조회가 409여도 같다
def test_world_failure_fails_the_scene_with_the_reason(monkeypatch, failure):
    fake_agents(monkeypatch, plan('character_simulation'))
    fake_scene(monkeypatch, read=failure)
    result = run(REQUEST, target=TARGET)
    assert (result.status, result.steps[0].status, result.steps[0].error) == ('failed', 'failed', str(failure))
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
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'), drafted=drafted)
    result = run(REQUEST, target=TARGET, inputs={'web_research': WEB})
    assert (result.status, result.steps, result.awaitingApproval) == ('clarify', [], None)
    assert all(label in result.message for label in asked) and '\n' not in result.message  # 빠진 것을 한 문장으로
    assert planned(calls) == ['judge', 'sim_plan']  # 다른 단계도 실행하지 않는다(축소 실행 금지)


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
    assert [(s.status, s.error) for s in result.steps] == [('failed', message)]
    assert planned(calls) == ['judge', 'sim_plan']


def test_failed_planning_does_not_wait_for_the_other_steps_inputs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'),
                        fail={'sim_plan': SimulationFailure(409, '연결된 세계관이 없어요.')})
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET)  # 대화 안이고 웹 조사 입력은 없다
    assert (result.status, result.missingInputs) == ('failed', [])
    assert [s.status for s in result.steps] == ['failed'] and planned(calls) == ['judge', 'sim_plan']


def test_simulation_needs_no_step_input_but_an_earlier_tool_still_waits_for_its_own(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('web_research', 'character_simulation'))
    log = fake_scene(monkeypatch)
    writer(monkeypatch)
    waiting = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET)
    assert (waiting.status, waiting.missingInputs, waiting.awaitingScene) == ('waiting', ['web_research'], None)
    assert planned(calls) == ['judge'] and log.director == []  # 입력이 모자라면 계획도 장면도 시작하지 않는다
    resumed = write_turn(thread, resume={'approved': True, 'inputs': {'web_research': WEB}})
    assert (resumed.status, resumed.awaitingScene) == ('waiting', 'character_simulation')
    assert len(resumed.steps[1].result.turns) == 1 and planned(calls) == ['judge', 'web_research', 'sim_plan']
    again = scene_turn(thread)
    assert len(again.steps[1].result.turns) == 2 and planned(calls) == ['judge', 'web_research', 'sim_plan']  # 계획은 다시 만들지 않는다


def test_no_tool_runs_after_the_simulation_plan_because_the_scene_comes_next(monkeypatch):
    calls = fake_agents(monkeypatch, plan('character_simulation', 'web_research'))
    fake_scene(monkeypatch)
    result = write_turn(str(uuid4()), request=REQUEST, scope=SCOPE, target=TARGET, inputs={'web_research': WEB})
    assert result.awaitingScene == 'character_simulation' and 'web_research' not in planned(calls)
    assert [s.feature for s in result.steps] == ['character_simulation']


def test_writing_and_scene_results_are_approved_one_after_the_other_after_the_scene(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('writing_editing', 'character_simulation'))
    fake_scene(monkeypatch)
    applied = writer(monkeypatch)
    first = write_turn(thread, request=REQUEST, scope=SCOPE, target=TARGET, inputs={'writing_editing': PATCH})
    assert first.awaitingScene == 'character_simulation' and applied == []
    assert finish_scene(thread).awaitingApproval == 'writing_editing'
    second = write_turn(thread, resume={'approved': True})
    assert (second.status, second.awaitingApproval) == ('waiting', 'character_simulation')
    done = write_turn(thread, resume={'approved': True})
    assert (done.status, [s.approval for s in done.steps]) == ('completed', ['approved', 'approved'])
    assert [a[2].get('text') or a[2].get('after') for a in applied] == ['그는 차갑게 웃었다.', SCENE_TEXT]


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


def test_a_note_after_the_story_ended_ends_the_scene_without_a_second_narration(monkeypatch):
    thread, _, _, log, _ = start_scene(monkeypatch)
    scene_turn(thread)
    scene_turn(thread)  # 시작 나레이션, 카엘 두 번(이야기가 끝났다고 판정)
    noted = scene_turn(thread, 'next', note='갑자기 정전이 된다')
    assert [t.kind for t in noted.steps[0].result.turns] == ['narration', 'character', 'character', 'narration']
    done = scene_turn(thread)  # 직전이 나레이션이라 마무리 나레이션 없이 끝나고 승인을 묻는다
    assert (done.awaitingApproval, done.steps[0].result.status) == ('character_simulation', 'completed')
    assert [t.kind for t in done.steps[0].result.turns] == ['narration', 'character', 'character', 'narration'] and len(log.narrate) == 2


def test_a_finished_scene_can_be_continued_from_the_approval_question_and_approved_later(monkeypatch):
    thread, _, _, log, applied = start_scene(monkeypatch)
    finish_scene(thread)
    more = scene_turn(thread, 'next', note='이야기가 이어진다')  # 승인 대기 중의 장면 조작은 장면으로 돌아가 이어 간다
    assert (more.status, more.awaitingScene, more.awaitingApproval) == ('waiting', 'character_simulation', None)
    assert [t.kind for t in more.steps[0].result.turns] == ['narration', 'character', 'character', 'narration', 'narration']  # 마무리 줄은 그대로, 메모 나레이션이 뒤에 붙었다
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
    fake_agents(monkeypatch, plan('web_research', 'character_simulation'))
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
    assert planned(calls) == ['judge'] and calls[0][1] == ('흐름 모드 시뮬레이션: 장면 계획 2개', 'character_simulation', [], [])
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
    assert planned(calls) == ['judge'] and log.director == []


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
    assert [c[1][3] for c in calls if c[0] == 'judge'] == [['하나']]  # 지운 턴은 Router 기록에도 없다.
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

def test_tools_run_before_the_approval_so_retrieval_uses_the_token_of_the_turn(monkeypatch):
    thread = str(uuid4())
    calls = fake_agents(monkeypatch, plan('writing_editing', 'story_context'))
    writer(monkeypatch)
    pending = write_turn(thread, request='고친 뒤 설명해줘', target=TARGET,
                         scope={'scopeToken': 'old.token'}, inputs={'writing_editing': PATCH})
    assert pending.awaitingApproval == 'writing_editing'

    done = write_turn(thread, resume={'approved': True, 'scope': {'scopeToken': 'fresh.token'}})

    assert done.status == 'completed'
    assert [c[1][0].scopeToken for c in calls if c[0] == 'retrieval'] == ['old.token']

def test_failed_first_edit_keeps_existing_history(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='기존 질문', inputs={'story_context': QA})
    def fail_route(*_):
        raise IntentFailure()

    monkeypatch.setattr(service.intent, 'judge', fail_route)

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
CLARIFY = plan(status='clarify')


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
    assert names(calls) == ['judge', 'sim_plan', 'retrieval']
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
    assert result.status == 'completed' and names(calls) == ['judge', 'retrieval', 'story_context']
    assert calls[1][1][1] == '길드 규칙은?' and calls[2][1][0].question == '길드 규칙은?'
    write_turn(thread, request='다른 질문은?', scope=SCOPE)
    assert [c[1][1] for c in calls if c[0] == 'retrieval'] == ['길드 규칙은?', '다른 질문은?']
    assert [c[1][3] for c in calls if c[0] == 'judge'][-1] == ['길드 규칙은?', '작품 질문']


def test_a_capability_name_is_ordinary_text_unless_the_router_just_asked(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='카이의 목표는?', inputs={'story_context': QA})
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    chat(thread, request='기획·집필·수정', inputs={'writing_editing': PATCH})
    assert calls[0][1] == ('기획·집필·수정', None, [], ['카이의 목표는?'])


def test_a_simulation_clarify_is_not_a_router_clarify(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan('character_simulation'), drafted=SimulationPlan(mode='flow', beats=['성문 대면']))
    assert write_turn(thread, request='장면 시뮬레이션', scope=SCOPE, target=TARGET).status == 'clarify'
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    write_turn(thread, request='기획·집필·수정', target=TARGET, inputs={'writing_editing': PATCH})
    assert calls[0][1] == ('기획·집필·수정', None, [], ['장면 시뮬레이션'])


def test_an_explicit_operation_wins_over_a_clarify_answer(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, CLARIFY)
    chat(thread, request=VAGUE)
    calls = fake_agents(monkeypatch, plan('story_context'))
    chat(thread, request='기획·집필·수정', operation='story_context', inputs={'story_context': QA})
    assert calls[0][1] == ('기획·집필·수정', 'story_context', [], [VAGUE])


def test_cancelling_the_finding_pick_runs_no_edit(monkeypatch):
    thread = str(uuid4())
    calls = conditional(monkeypatch, found('서윤은 웃엇다.'), found('바람이 차가왔다.'))
    write_turn(thread, request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    done = write_turn(thread, resume={'approved': False})
    assert done.status == 'cancelled' and 'patch' not in names(calls)


def test_malformed_draft_read_fails_the_edit_step_instead_of_the_run(monkeypatch):
    conditional(monkeypatch, found('서윤은 웃엇다.'))
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: {})
    result = write_turn(str(uuid4()), request='검수하고 틀리면 고쳐줘', target=TARGET, inputs={'review': REVIEW})
    assert result.status == 'failed' and result.steps[1].error == tools.BAD_DRAFT


def test_finding_pick_without_a_review_fails_the_edit_without_a_model_call(monkeypatch):
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    result = run('고쳐줘', inputs={'writing_editing': {'fix': 0}})
    assert result.status == 'failed' and result.steps[0].error == tools.BAD_FIX
    assert names(calls) == ['judge']



def writing_step(task):
    return Step('writing_editing', task=task)


def test_plan_only_returns_beat_plans_with_allowed_context_and_never_asks_to_write(monkeypatch):
    calls = fake_agents(monkeypatch, plan(writing_step('plan')))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request='11화 전개만 짜줘', target={**TARGET, 'episode': 5, 'baseEpisode': 3})
    assert result.status == 'completed' and result.awaitingApproval is None
    assert result.steps[0].result.plans[0].title == BEAT.title
    assert names(calls) == ['judge', 'mcp', 'writing_plan'] and applied == []
    # 허용 문맥은 Content가 근거 회차(지식 상한)까지 확인한 것이다. 반영 회차 5화를 기획한다.
    assert calls[1][1] == ('work_context_read', {'id': 'work', 'episode': 3, 'query': '11화 전개만 짜줘'})
    sent = calls[2][1][0]
    assert (sent.episodeNumber, sent.request) == (5, '11화 전개만 짜줘') and json.loads(sent.context) == CONTEXT


def test_draft_without_a_plan_plans_and_writes_in_one_step_then_waits_for_approval(monkeypatch):
    calls = fake_agents(monkeypatch, plan(writing_step('draft'), 'review'))
    applied = writer(monkeypatch)
    result = write_turn(str(uuid4()), request='11화를 기획하고 써서 검수해줘', target=TARGET, inputs={'review': REVIEW})
    assert (result.status, result.awaitingApproval) == ('waiting', 'writing_editing')
    assert [(s.feature, s.status) for s in result.steps] == [('writing_editing', 'completed'), ('review', 'completed')]
    assert result.steps[0].result.plan == BEAT and names(calls) == ['judge', 'mcp', 'plan_and_draft', 'review'] and applied == []


def test_author_plan_still_wins_and_gets_the_allowed_context(monkeypatch):
    calls = fake_agents(monkeypatch, plan(writing_step('draft')))
    run('써줘', target=TARGET, inputs={'writing_editing': DRAFT})
    assert names(calls) == ['judge', 'mcp', 'draft'] and json.loads(calls[2][1][0].context) == CONTEXT


def test_planning_without_a_target_fails_the_step(monkeypatch):
    calls = fake_agents(monkeypatch, plan(writing_step('plan')))
    result = run('전개 짜줘')
    assert result.status == 'failed' and result.steps[0].error == tools.NO_WRITING_TARGET
    assert names(calls) == ['judge']


def test_patch_task_without_selection_still_waits_for_input(monkeypatch):
    fake_agents(monkeypatch, plan(writing_step('patch')))
    result = chat(str(uuid4()), target=TARGET)
    assert (result.status, result.missingInputs) == ('waiting', ['writing_editing'])


def test_a_reply_recorded_before_story_development_was_merged_still_loads():
    # #387 전 대화의 응답에는 story_development 단계가 남아 있다. 이력을 다시 읽을 때 형식 오류가 되면 안 된다.
    old = {'status': 'unsupported', 'message': tools.UNSUPPORTED_MESSAGE, 'unsupported': ['story_development'],
           'steps': [{'feature': 'story_development', 'when': 'always', 'status': 'not_started'}]}
    assert ChatTurn(request='11화 사건을 추천해줘', reply=old).reply.unsupported == ['story_development']


def test_allowed_context_over_the_limit_fails_the_step_instead_of_breaking_the_run(monkeypatch):
    calls = fake_agents(monkeypatch, plan(writing_step('plan')))
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: {'draft': '가' * 60001})
    result = write_turn(str(uuid4()), request='전개 짜줘', target=TARGET)
    assert result.status == 'failed' and result.steps[0].error == tools.CONTEXT_TOO_LONG
    assert 'writing_plan' not in names(calls)


def test_waiting_patch_step_carries_its_task_so_the_screen_does_not_ask_for_a_plan(monkeypatch):
    fake_agents(monkeypatch, plan(writing_step('patch')))
    result = chat(str(uuid4()), target=TARGET)
    assert [(s.feature, s.task) for s in result.steps] == [('writing_editing', 'patch')]


def test_a_follow_up_writing_turn_gets_the_latest_plan_alternatives_of_the_conversation(monkeypatch):
    thread = str(uuid4())
    fake_agents(monkeypatch, plan(writing_step('plan')))
    write_turn(thread, request='다음 화 전개를 두 가지 안으로 짜줘', target=TARGET)
    fake_agents(monkeypatch, plan('story_context'))
    write_turn(thread, request='길드 규칙은?', inputs={'story_context': QA})  # 사이에 다른 작업이 있어도 가장 최근 기획을 쓴다
    calls = fake_agents(monkeypatch, plan(writing_step('draft')))
    write_turn(thread, request='그 중 첫 번째 안으로 바로 써줘', target=TARGET)
    sent = next(args[0] for name, args, _ in calls if name == 'plan_and_draft')
    assert sent.previousPlans == [BEAT]


def test_the_first_planning_turn_has_no_previous_plans(monkeypatch):
    calls = fake_agents(monkeypatch, plan(writing_step('plan')))
    write_turn(str(uuid4()), request='전개 짜줘', target=TARGET)
    assert next(args[0] for name, args, _ in calls if name == 'writing_plan').previousPlans == []
