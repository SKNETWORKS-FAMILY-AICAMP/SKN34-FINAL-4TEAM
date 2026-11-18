"""메인 에이전트(#473)의 Decision Guard·동적 도구 노출·한도·코드 실행 경계. 모델은 대역이다."""

import asyncio
import json
import threading
from uuid import uuid4

import pytest
from langchain_core.messages import ToolMessage
from openai import OpenAIError

from app.intent.errors import IntentFailure
from app.intent.prompt import CLARIFY_MESSAGE, REJECT_MESSAGES
from app.orchestration import agent, service, tools
from app.orchestration.models import OrchestrationRequest
from app.review.models import Finding as ReviewFinding, ReviewResponse
from app.research.errors import ResearchFailure
from app.story_qa.errors import StoryQaFailure

from .stubs import PATCH, QA, REVIEW, WEB, Step, fake_agents, fake_main, fake_scene, plan

TARGET = {'workId': 'w1', 'episode': 3}


def run(request='요청', **body):
    return asyncio.run(service.run(OrchestrationRequest(request=request, **body)))


def turn(thread, request='요청', **body):
    conversation = {'threadId': thread, 'scope': 'user:1/work:w1'}
    return asyncio.run(service.run(OrchestrationRequest(request=request, conversation=conversation, **body)))


def resume(thread, **answer):
    conversation = {'threadId': thread, 'scope': 'user:1/work:w1'}
    return asyncio.run(service.run(OrchestrationRequest(conversation=conversation, resume=answer)))


def names(calls):
    return [name for name, *_ in calls]


def exposed(calls):
    """메인 모델 호출마다 노출된 도구 이름."""
    return [seen['tools'] for seen in calls.main]


def tool_messages(calls):
    return [m for m in calls.main[-1]['messages'] if isinstance(m, ToolMessage)]


# Decision Guard


def test_the_decision_guard_runs_once_per_turn_and_the_main_agent_synthesizes_the_answer(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = run('규칙 알려주고 고증도 확인해줘', inputs={'story_context': QA, 'web_research': WEB})
    assert names(calls) == ['judge', 'story_context', 'web_research']
    assert (result.status, result.message) == ('completed', '종합 답변')
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed'), ('web_research', 'completed')]
    assert len(calls.main) == 3  # 도구 두 번 + 종합 한 번


@pytest.mark.parametrize('routed, status, message', [
    (plan(status='rejected', reason='greeting'), 'rejected', REJECT_MESSAGES['greeting']),
    (plan(status='clarify'), 'clarify', CLARIFY_MESSAGE),
    (plan('story_context', capabilities=['story_context', 'world_plot']), 'unsupported', tools.UNSUPPORTED_MESSAGE),
])
def test_rejected_no_feature_or_unsupported_decisions_never_call_the_main_model(monkeypatch, routed, status, message):
    calls = fake_agents(monkeypatch, routed)
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message) == (status, message)
    assert names(calls) == ['judge'] and calls.main == []
    assert result.unsupported == (['world_plot'] if status == 'unsupported' else [])


def test_decision_failure_propagates_without_running_anything(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'), fail={'judge': IntentFailure()})
    with pytest.raises(IntentFailure):
        run(inputs={'story_context': QA})
    assert calls.main == []


def test_the_guard_gets_the_request_operation_materials_and_no_history_on_the_first_turn(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run('규칙 알려줘', operation='story_context', materials=['자료'], inputs={'story_context': QA})
    assert calls[0][1] == ('규칙 알려줘', 'story_context', ['자료'], [])


# 동적 노출·한도


def test_only_the_tools_of_the_decided_features_are_exposed(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'rating'))
    run(target=TARGET, inputs={'story_context': QA})
    assert exposed(calls)[0] == ['ask_story_qa', 'ask_rating']


def test_a_tool_outside_the_decision_is_blocked_before_it_runs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'rating', capabilities=['story_context']))
    result = run(target=TARGET, inputs={'story_context': QA})
    assert 'rating' not in names(calls) and [s.feature for s in result.steps] == ['story_context']
    blocked = tool_messages(calls)[-1]
    assert (blocked.name, blocked.status) == ('ask_rating', 'error') and blocked.content.startswith('[차단]')


def test_the_same_feature_runs_only_once_per_turn(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'story_context'))
    result = run(inputs={'story_context': QA})
    assert names(calls).count('story_context') == 1 and len(result.steps) == 1
    assert tool_messages(calls)[-1].status == 'error'


def test_at_most_three_sub_agents_run_per_turn(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research', 'rating', 'world_review'))
    result = run(target=TARGET, inputs={'story_context': QA, 'web_research': WEB})
    assert [s.feature for s in result.steps] == ['story_context', 'web_research', 'rating']
    assert 'world_review' not in names(calls)


def test_the_last_allowed_model_call_has_no_tools_so_it_can_only_answer(monkeypatch):
    # 막힌 호출로 모델 호출을 다 쓰게 한다: 한도(5회) 중 마지막은 도구 없이 종합한다.
    calls = fake_agents(monkeypatch, plan(*['story_context'] * 6))
    result = run(inputs={'story_context': QA})
    assert len(calls.main) == agent.MODEL_CALLS == 5
    assert exposed(calls)[:4] == [['ask_story_qa']] * 4 and exposed(calls)[4] == []
    assert (result.status, result.message) == ('completed', '종합 답변')


def test_tools_are_bound_with_parallel_calls_and_the_model_has_no_retries_or_storage(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run(inputs={'story_context': QA})
    assert calls.main[0]['settings']['parallel_tool_calls'] is True
    init = calls.main.init
    assert (init['model'], init['use_responses_api'], init['store'], init['max_retries']) == ('test-model', True, False, 0)


def test_a_failed_sub_agent_closes_the_tools_and_the_main_agent_only_answers(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'), fail={'story_context': StoryQaFailure(502, '답변 실패')})
    result = run(inputs={'story_context': QA, 'web_research': WEB})
    assert 'web_research' not in names(calls) and exposed(calls)[-1] == []
    assert [(s.feature, s.status, s.error) for s in result.steps] == [('story_context', 'failed', '답변 실패')]
    assert result.status == 'failed' and result.message == '종합 답변'
    failed = tool_messages(calls)[0]
    assert (failed.status, failed.content) == ('error', '[실패] 작품 질문: 답변 실패')


def test_a_main_model_failure_keeps_the_finished_steps_with_a_fixed_message(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    fake_main(monkeypatch, ('ask_story_qa', {}), answer=OpenAIError('down'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message) == ('failed', agent.MAIN_FAILED_MESSAGE)
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed')]


def test_a_turn_that_calls_no_tool_is_the_main_agents_clarifying_question(monkeypatch):
    fake_agents(monkeypatch, plan('story_context', capabilities=['story_context'])._replace(calls=[]))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('clarify', '종합 답변', [])


# 도구 계약


def test_the_model_only_sets_the_request_and_enumerated_arguments():
    schemas = {t.name: t.tool_call_schema.model_json_schema() for t in agent.TOOLS.values()}
    assert set(schemas) == {'ask_story_qa', 'ask_review', 'ask_world_review', 'ask_writing', 'ask_web_research', 'ask_rating',
                            'ask_character_simulation'}
    for name, schema in schemas.items():
        properties = schema.get('properties', {})
        assert set(properties) <= {'request', 'check', 'task', 'fix'}, name
        if 'request' in properties:
            assert properties['request']['maxLength'] == 2000
    assert schemas['ask_web_research'].get('properties', {}) == {}
    assert set(schemas['ask_review']['properties']['check']['anyOf'][0]['enum']) == {'mechanical', 'semantic', 'both'}
    assert set(schemas['ask_writing']['properties']['task']['enum']) == {'plan', 'draft', 'patch'}


def test_a_tool_returns_a_summary_for_the_main_agent_and_the_raw_result_as_its_artifact(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    result = run(inputs={'story_context': QA})
    message = tool_messages(calls)[0]
    summary = json.loads(message.content)
    assert summary == {'feature': 'story_context', 'status': 'completed',
                       'claims': [{'text': '밤에 닫는다', 'kind': 'confirmed', 'sourceIds': ['a']}], 'gaps': []}
    assert message.artifact == result.steps[0].result.model_dump(mode='json')


# 코드가 지키는 실행 경계


def test_boundary_scope_review_reads_only_the_content_checked_target(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('review', check='semantic')))
    run(target=TARGET)
    [(_, (request,), _)] = [c for c in calls if c[0] == 'review']
    assert (request.workId, request.episode, request.check) == ('w1', 3, 'semantic')


def test_boundary_scope_without_a_target_fails_the_tool_without_a_model_call(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('review', check='mechanical')))
    result = run()
    assert 'review' not in names(calls)
    assert (result.steps[0].status, result.steps[0].error) == ('failed', tools.NO_REVIEW_TARGET)


def test_boundary_writing_gets_the_allowed_context_and_never_retrieval_or_simulation(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('writing_editing', task='plan')))
    result = run('11화 사건 추천해줘', target=TARGET)
    assert result.steps[0].status == 'completed'
    assert [args[0] for name, args, _ in calls if name == 'mcp'] == ['work_context_read']
    assert not {'retrieval', 'sim_plan'} & set(names(calls))


def test_boundary_a_fix_needs_this_turns_review(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('writing_editing', task='patch', fix=0)))
    result = run(target=TARGET)
    assert 'patch' not in names(calls)
    assert (result.steps[0].status, result.steps[0].error, result.steps[0].when) == ('failed', tools.BAD_FIX, 'if_issues_found')


BODY = '비가 왔다. 서윤은 웃엇다. 바람이 차가왔다.'


def finding(quote, status='confirmed'):
    located = status == 'confirmed'
    return ReviewFinding(category='spelling', quote=quote, reason='맞춤법', status=status, evidenceRefs=[], suggestion='고친 말',
                         start=0 if located else None, end=len(quote) if located else None)


def reviewed(monkeypatch, *findings, revision=4, body=BODY):
    monkeypatch.setattr(tools.review, 'review', lambda data: ReviewResponse(
        workId=data.workId, episode=data.episode, revision=4, check=data.check, gaps=[], model='m', providerResponseId='r', usage=None,
        findings=list(findings)))
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: {'draft': {'title': '3화', 'body': body, 'revision': revision}})


@pytest.mark.parametrize('fix, findings, revision, body, error', [
    (1, [finding('서윤은 웃엇다.'), finding('비가', status='suspected')], 4, BODY, tools.BAD_FIX),  # 확정이 아닌 지적
    (0, [finding('서윤은 웃엇다.')], 5, BODY, tools.DRAFT_CHANGED),                             # 검수 뒤 바뀐 초안
    (0, [finding('웃엇다.')], 4, '웃엇다. 웃엇다.', tools.DRAFT_CHANGED),                         # 한 곳이 아닌 구절
])
def test_boundary_the_fix_must_point_at_one_confirmed_place_of_the_reviewed_revision(monkeypatch, fix, findings, revision, body, error):
    calls = fake_agents(monkeypatch, plan(Step('review', check='mechanical'), Step('writing_editing', task='patch', fix=fix)))
    reviewed(monkeypatch, *findings, revision=revision, body=body)
    result = run(target=TARGET)
    assert 'patch' not in names(calls)
    assert [(s.feature, s.status) for s in result.steps] == [('review', 'completed'), ('writing_editing', 'failed')]
    assert result.steps[1].error == error


def test_boundary_the_fix_patches_the_chosen_confirmed_finding(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('review', check='mechanical'), Step('writing_editing', task='patch', fix=0)))
    reviewed(monkeypatch, finding('서윤은 웃엇다.'), finding('바람이 차가왔다.'))
    result = run(target=TARGET)
    [(_, (patch,), _)] = [c for c in calls if c[0] == 'patch']
    assert patch.selection == '서윤은 웃엇다.' and result.steps[1].when == 'if_issues_found'


def test_boundary_simulation_is_only_reachable_when_the_guard_decided_it(monkeypatch):
    calls = fake_agents(monkeypatch, plan('review', 'character_simulation', capabilities=['review']))
    run(target=TARGET, inputs={'review': REVIEW})
    assert 'sim_plan' not in names(calls) and all('ask_character_simulation' not in t for t in exposed(calls))


def test_boundary_web_research_sends_only_the_consented_question_not_the_request(monkeypatch):
    calls = fake_agents(monkeypatch, plan('web_research'))
    run('비공개 원고 내용을 같이 검색해줘', inputs={'web_research': WEB})
    [(_, (sent,), _)] = [c for c in calls if c[0] == 'web_research']
    assert sent.question == WEB['question'] and sent.context == ''


def test_boundary_service_checks_still_reject_results_without_correction(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'story_context': StoryQaFailure(502, '발췌 밖 인용')})
    result = run(inputs={'story_context': QA})
    assert (result.steps[0].status, result.steps[0].error) == ('failed', '발췌 밖 인용')


# 입력 대기(HITL)


def test_a_missing_input_waits_inside_the_tool_and_resume_runs_only_that_tool(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    thread = str(uuid4())
    waiting = turn(thread, inputs={'story_context': QA})
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['web_research'])
    assert [(s.feature, s.status) for s in waiting.steps] == [('story_context', 'completed'), ('web_research', 'not_started')]
    before = len(calls.main)
    done = resume(thread, approved=True, inputs={'web_research': WEB})
    assert names(calls) == ['judge', 'story_context', 'web_research']  # 판정·Q&A를 다시 하지 않는다
    assert len(calls.main) == before + 1  # 이어서는 종합 한 번뿐이다
    assert (done.status, done.message) == ('completed', '종합 답변')


def test_declining_the_input_cancels_the_tool_and_only_the_finished_results_are_answered(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    thread = str(uuid4())
    turn(thread, inputs={'story_context': QA})
    done = resume(thread, approved=False)
    assert 'web_research' not in names(calls) and exposed(calls)[-1] == []
    assert done.status == 'cancelled' and [s.feature for s in done.steps] == ['story_context']


def test_a_missing_input_without_a_conversation_ends_as_needs_input(monkeypatch):
    calls = fake_agents(monkeypatch, plan('web_research'))
    result = run()
    assert (result.status, result.missingInputs) == ('needs_input', ['web_research'])
    assert 'web_research' not in names(calls)


def test_each_turn_counts_its_own_tool_calls(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    thread = str(uuid4())
    first = turn(thread, inputs={'story_context': QA})
    second = turn(thread, inputs={'story_context': QA})
    assert [s.status for s in first.steps] == [s.status for s in second.steps] == ['completed']


def test_the_main_agent_gets_the_last_five_turns_of_requests_and_answers(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    thread = str(uuid4())
    for n in range(6):
        turn(thread, f'질문 {n}', inputs={'story_context': QA})
    for n in range(6, 7):
        turn(thread, f'질문 {n}', inputs={'story_context': QA})
    history = [m.text for m in calls.main[-1]['messages'][1:11]]  # 시스템 지시 뒤 최근 5턴(질문 1~5)
    assert history == [t for n in range(1, 6) for t in (f'질문 {n}', '종합 답변')]
    assert calls.main[-1]['messages'][11].text == '질문 6'


# 리뷰 반영(#473)


def test_a_blocked_tool_outside_the_decision_does_not_use_up_the_three_calls(monkeypatch):
    calls = fake_agents(monkeypatch, plan('rating', 'story_context', 'web_research', 'world_review',
                                          capabilities=['story_context', 'web_research', 'world_review']))
    result = run(target=TARGET, inputs={'story_context': QA, 'web_research': WEB})
    assert [s.feature for s in result.steps] == ['story_context', 'web_research', 'world_review']
    assert 'rating' not in names(calls)


def test_repeated_blocked_calls_still_end_within_the_model_call_limit(monkeypatch):
    calls = fake_agents(monkeypatch, plan(*['rating'] * 8, capabilities=['story_context']))
    result = run(target=TARGET, inputs={'story_context': QA})
    assert len(calls.main) == agent.MODEL_CALLS and exposed(calls)[-1] == []
    assert (result.status, result.message, result.steps) == ('clarify', '종합 답변', [])


def applied(monkeypatch):
    done = []
    monkeypatch.setattr(service.content_mcp, 'apply_writing', lambda work, episode, result: done.append(result) or {'episode': episode, 'revision': 5})
    return done


def test_a_later_failure_still_asks_to_approve_the_finished_writing(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing', 'web_research'), fail={'web_research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    written, thread = applied(monkeypatch), str(uuid4())
    waiting = turn(thread, target=TARGET, inputs={'writing_editing': PATCH, 'web_research': WEB})
    assert (waiting.status, waiting.awaitingApproval) == ('waiting', 'writing_editing') and written == []
    done = resume(thread, approved=True)
    assert done.status == 'failed' and done.steps[0].approval == 'approved' and len(written) == 1


def test_a_cancelled_later_input_still_asks_to_approve_the_finished_writing(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing', 'web_research'))
    written, thread = applied(monkeypatch), str(uuid4())
    turn(thread, target=TARGET, inputs={'writing_editing': PATCH})
    asked = resume(thread, approved=False)
    assert (asked.status, asked.awaitingApproval) == ('waiting', 'writing_editing')
    done = resume(thread, approved=True)
    assert done.status == 'cancelled' and done.steps[0].approval == 'approved' and len(written) == 1


def test_a_missing_api_key_is_a_decision_failure(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    monkeypatch.delenv('OPENAI_API_KEY')
    with pytest.raises(IntentFailure):
        run(inputs={'story_context': QA})
    assert calls.main == []


def test_a_missing_model_setting_fails_the_turn_without_running_anything(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    monkeypatch.delenv('OPENAI_MODEL')
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('failed', service.MODEL_UNSET_MESSAGE, [])
    assert names(calls) == [] and calls.main == []


# 병렬 호출(#474)


def sent(calls, name):
    """마지막 메인 모델 호출이 받은 그 도구의 첫 ToolMessage."""
    return next(m for m in tool_messages(calls) if m.name == name)


def together(monkeypatch, *names):
    """names의 업무 서비스가 서로 기다려야 끝나게 한다. 순차로 돌면 Barrier가 시간 초과로 깨진다."""
    barrier = threading.Barrier(len(names), timeout=5)
    for owner, attr in names:
        real = getattr(owner, attr)
        monkeypatch.setattr(owner, attr, lambda *args, real=real: (barrier.wait(), real(*args))[1])


def test_independent_lookups_in_one_model_turn_run_concurrently_in_call_order(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['web_research', 'story_context']))
    together(monkeypatch, (tools.research, 'research'), (tools.story_qa, 'answer'))
    result = run(inputs={'story_context': QA, 'web_research': WEB})
    assert [(s.feature, s.status) for s in result.steps] == [('web_research', 'completed'), ('story_context', 'completed')]
    assert len(calls.main) == 2 and (result.status, result.message) == ('completed', '종합 답변')  # 묶음 한 번 + 종합


@pytest.mark.parametrize('solo', [Step('writing_editing', task='plan'), Step('character_simulation')])
def test_writing_and_simulation_in_a_batch_are_refused_and_run_alone_next(monkeypatch, solo):
    calls = fake_agents(monkeypatch, plan(['rating', solo], solo))
    fake_scene(monkeypatch)
    result = run('요청', target=TARGET)
    refused = sent(calls, tools.TOOL_NAMES[solo.feature])
    assert (refused.status, refused.content.startswith('[순차]')) == ('error', True)
    assert [s.feature for s in result.steps] == ['rating', solo.feature]  # 거부는 기능당 1회를 쓰지 않는다


def test_a_dependent_fix_in_the_same_batch_as_its_review_waits_for_the_review(monkeypatch):
    fix = Step('writing_editing', task='patch', fix=0)
    calls = fake_agents(monkeypatch, plan([Step('review', check='mechanical'), fix], fix))
    reviewed(monkeypatch, finding('서윤은 웃엇다.'))
    result = run(target=TARGET)
    assert [(s.feature, s.status) for s in result.steps] == [('review', 'completed'), ('writing_editing', 'completed')]
    assert names(calls).count('patch') == 1 and len(calls.main) == 3


def test_a_call_missing_author_input_in_a_batch_is_deferred_then_waits_alone(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['story_context', 'web_research'], 'web_research'))
    thread = str(uuid4())
    waiting = turn(thread, inputs={'story_context': QA})
    assert sent(calls, 'ask_web_research').content.startswith('[순차]')
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['web_research'])
    done = resume(thread, approved=True, inputs={'web_research': WEB})
    assert [(s.feature, s.status) for s in done.steps] == [('story_context', 'completed'), ('web_research', 'completed')]
    assert names(calls).count('web_research') == 1


def test_a_batch_where_nothing_can_run_together_still_runs_its_first_call_alone(monkeypatch):
    # 둘 다 작가 입력이 빠졌다. 모두 미루면 모델이 같은 묶음을 반복해 아무것도 못 한다.
    calls = fake_agents(monkeypatch, plan([Step('review'), 'web_research']))
    waiting = turn(str(uuid4()), target=TARGET)
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['review'])
    assert len(calls.main) == 1


def test_a_failure_in_a_batch_keeps_the_finished_sibling_and_closes_the_tools(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['story_context', 'web_research'], 'rating'), fail={'web_research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    result = run(target=TARGET, inputs={'story_context': QA, 'web_research': WEB})
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed'), ('web_research', 'failed')]
    assert result.status == 'failed' and exposed(calls)[-1] == [] and 'rating' not in names(calls)


def test_each_call_in_a_batch_counts_toward_the_three_calls_per_turn(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['story_context', 'web_research', 'rating', 'world_review']))
    result = run(target=TARGET, inputs={'story_context': QA, 'web_research': WEB})
    assert [s.feature for s in result.steps] == ['story_context', 'web_research', 'rating']
    assert 'world_review' not in names(calls) and sent(calls, 'ask_world_review').status == 'error'


def test_the_patch_summary_names_the_changed_passage_so_the_answer_cannot_claim_more(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('review', check='mechanical'), Step('writing_editing', task='patch', fix=1)))
    reviewed(monkeypatch, finding('서윤은 웃엇다.'), finding('바람이 차가왔다.'))
    run(target=TARGET)
    summary = json.loads(tool_messages(calls)[1].content)
    assert (summary['kind'], summary['selection']) == ('patch', '그는 웃었다.')
