"""메인 에이전트(#473)의 Decision Guard·동적 도구 노출·한도·코드 실행 경계. 모델은 대역이다."""

import asyncio
import json
import threading
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain.agents.middleware.types import ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage
from openai import OpenAIError
from pydantic import ValidationError

from app import tracing
from app.intent.errors import IntentFailure
from app.intent.models import DecisionResult
from app.intent.prompt import CLARIFY_MESSAGE, REJECT_MESSAGES
from app.orchestration import agent, mcp_tools, service, tools
from app.orchestration.prompt import INSTRUCTIONS
from app.orchestration.models import OrchestrationRequest
from app.manuscript_review.models import Finding as ReviewFinding, ReviewResponse
from app.research.errors import ResearchFailure
from app.simulation.models import SimulationPlan
from app.story_qa.errors import StoryQaFailure

from traced import attrs, named, shown

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
    calls = fake_agents(monkeypatch, plan('story_context', 'research'))
    result = run('규칙 알려주고 고증도 확인해줘', inputs={'story_context': QA, 'research': WEB})
    assert names(calls) == ['judge', 'story_context', 'research']
    assert (result.status, result.message) == ('completed', '종합 답변')
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed'), ('research', 'completed')]
    assert len(calls.main) == 3  # 도구 두 번 + 종합 한 번


def test_a_rejected_decision_never_calls_the_main_model(monkeypatch):
    calls = fake_agents(monkeypatch, plan(status='rejected', reason='greeting'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message) == ('rejected', REJECT_MESSAGES['greeting'])
    assert names(calls) == ['judge'] and calls.main == []


def test_an_allowed_decision_without_features_runs_the_main_agent_with_only_the_content_tools(monkeypatch):
    # #554: 허용됐지만 기능이 비면 고정 되묻기로 끝내지 않고 메인이 Content 도구만 가지고 실행한다. 도구를 쓰지 않고 답하면 그 답이 확인 질문(clarify)이다.
    calls = fake_agents(monkeypatch, plan(status='clarify'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('clarify', '종합 답변', [])
    assert exposed(calls) == [list(mcp_tools.NAMES)]


def test_world_plot_is_gone_so_no_decision_can_end_as_unsupported():
    # 미구현 기능이 남지 않았다: 판정은 world_plot을 담을 수 없고 메인 에이전트에게도 그 도구가 없다.
    with pytest.raises(ValidationError):
        DecisionResult(allowed=True, capabilities=['story_context', 'world_plot'])


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
    assert exposed(calls)[0] == ['ask_story_qa', 'ask_rating', *mcp_tools.NAMES]


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
    calls = fake_agents(monkeypatch, plan('story_context', 'research', 'rating', 'world'))
    result = run(target=TARGET, inputs={'story_context': QA, 'research': WEB})
    assert [s.feature for s in result.steps] == ['story_context', 'research', 'rating']
    assert 'world_review' not in names(calls)


def test_the_last_allowed_model_call_has_no_tools_so_it_can_only_answer(monkeypatch):
    # 막힌 호출로 모델 호출을 다 쓰게 한다: 한도(8회) 중 마지막은 도구 없이 종합한다.
    calls = fake_agents(monkeypatch, plan(*['story_context'] * 9))
    result = run(inputs={'story_context': QA})
    assert len(calls.main) == agent.MODEL_CALLS == 8
    assert exposed(calls)[:7] == [['ask_story_qa', *mcp_tools.NAMES]] * 7 and exposed(calls)[7] == []
    assert (result.status, result.message) == ('completed', '종합 답변')


def test_tools_are_bound_with_parallel_calls_and_the_model_has_no_retries_or_storage(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run(inputs={'story_context': QA})
    assert calls.main[0]['settings']['parallel_tool_calls'] is True
    init = calls.main.init
    assert (init['model'], init['use_responses_api'], init['store'], init['max_retries']) == ('test-model', True, False, 0)


def test_a_failed_sub_agent_closes_the_tools_and_the_main_agent_only_answers(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'research'), fail={'story_context': StoryQaFailure(502, '답변 실패')})
    result = run(inputs={'story_context': QA, 'research': WEB})
    assert 'research' not in names(calls) and exposed(calls)[-1] == []
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


def test_a_main_model_failure_before_any_step_does_not_point_at_results_below(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    fake_main(monkeypatch, answer=OpenAIError('rate limited'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('failed', agent.MAIN_FAILED_NOTHING_MESSAGE, [])
    assert '아래' not in result.message


def test_a_main_model_failure_with_only_failed_steps_does_not_point_at_results_below(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    fake_main(monkeypatch, ('ask_story_qa', {'request': '가' * 2001}), answer=OpenAIError('down'))
    result = run(inputs={'story_context': QA})
    assert [s.status for s in result.steps] == ['failed']
    assert (result.status, result.message) == ('failed', agent.MAIN_FAILED_NOTHING_MESSAGE)


def traced(monkeypatch) -> list[dict]:
    """메인 모델 추적(main_agent)에 남은 update 값들."""
    updates = []

    @contextmanager
    def observe(name, **fields):
        # 요청 루트(tracing.request)도 이 대역을 거치므로 id를 읽을 수 있어야 한다. 0 id는 추적이 꺼진 span이다.
        yield SimpleNamespace(trace_id='0' * 32, id='0' * 16, update=lambda **kw: name == 'main_agent' and updates.append(kw))

    monkeypatch.setattr(agent.tracing, 'observe', observe)
    return updates


@pytest.mark.parametrize('error, recorded', [
    (OpenAIError('down'), agent.MAIN_FAILED_MESSAGE),  # 제공사 실패는 고정 문구
    (ValueError('원고 일부가 담긴 메시지'), 'ValueError'),  # 그 밖의 예외는 종류만 남기고 메시지(입력이 담길 수 있음)는 남기지 않는다
    (ValidationError.from_exception_data('Model', []), 'ValidationError'),
])
def test_a_main_model_failure_traces_the_failure_kind_without_its_message(monkeypatch, error, recorded):
    updates = traced(monkeypatch)
    fake_agents(monkeypatch, plan('story_context'))
    fake_main(monkeypatch, answer=error)
    assert run(inputs={'story_context': QA}).status == 'failed'
    assert [u['status_message'] for u in updates if u.get('level') == 'ERROR'] == [recorded]


def test_a_tool_call_with_invalid_arguments_fails_its_step_instead_of_clarifying(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    fake_main(monkeypatch, ('ask_story_qa', {'request': '가' * 2001}))
    result = run(inputs={'story_context': QA})
    assert 'story_context' not in names(calls)
    assert [(s.feature, s.status, s.error) for s in result.steps] == [('story_context', 'failed', agent.BAD_ARGUMENTS)]
    assert result.status == 'failed'


def test_a_turn_that_calls_no_tool_is_the_main_agents_clarifying_question(monkeypatch):
    fake_agents(monkeypatch, plan('story_context', capabilities=['story_context'])._replace(calls=[]))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('clarify', '종합 답변', [])


# 도구 계약


def test_the_model_only_sets_the_request_and_enumerated_arguments():
    schemas = {t.name: t.tool_call_schema.model_json_schema() for t in agent.TOOLS.values()}
    assert set(schemas) == {'ask_story_qa', 'ask_manuscript_review', 'ask_world', 'ask_writing', 'ask_research', 'ask_rating', 'ask_character_simulation'}
    for name, schema in schemas.items():
        properties = schema.get('properties', {})
        assert set(properties) <= {'request', 'check', 'task', 'fix'}, name
        if 'request' in properties:
            assert properties['request']['maxLength'] == 2000
    # 고증 조사 web은 작업 지시(request)를 쓰지 않는다. 외부로 나가는 것은 작가가 동의한 질문뿐이다. platform만 request를 찾을 설정 주제로 쓴다.
    assert set(schemas['ask_research']['properties']) == {'task', 'request'} and schemas['ask_research']['properties']['task']['enum'] == ['web', 'platform']
    assert schemas['ask_research']['required'] == ['task']
    assert set(schemas['ask_manuscript_review']['properties']['check']['anyOf'][0]['enum']) == {'mechanical', 'semantic', 'both'}
    assert set(schemas['ask_writing']['properties']['task']['enum']) == {'plan', 'draft', 'patch', 'revise_plan'}
    # World의 작업은 열거형 인자 task로 고르고 반드시 정해야 한다(고르지 않은 호출은 인자 오류로 단계 실패다).
    assert set(schemas['ask_world']['properties']['task']['enum']) == {'check', 'enrich', 'impact'} and 'task' in schemas['ask_world']['required']


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
    calls = fake_agents(monkeypatch, plan(Step('manuscript_review', check='semantic')))
    run(target=TARGET)
    [(_, (request,), _)] = [c for c in calls if c[0] == 'manuscript_review']
    assert (request.workId, request.episode, request.check) == ('w1', 3, 'semantic')


def test_boundary_scope_without_a_target_fails_the_tool_without_a_model_call(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('manuscript_review', check='mechanical')))
    result = run()
    assert 'manuscript_review' not in names(calls)
    assert (result.steps[0].status, result.steps[0].error) == ('failed', tools.NO_REVIEW_TARGET)


def test_boundary_writing_gets_the_allowed_context_and_never_retrieval_or_simulation(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('writing_editing', task='plan')))
    result = run('11화 사건 추천해줘', target=TARGET)
    assert result.steps[0].status == 'completed'
    assert [args[0] for name, args, _ in calls if name == 'mcp'] == ['work_context_read', 'world_studio_list', 'work_inherited_world']
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
    monkeypatch.setattr(tools.manuscript_review, 'review', lambda data: ReviewResponse(
        workId=data.workId, episode=data.episode, revision=4, check=data.check, gaps=[], model='m', providerResponseId='r', usage=None,
        findings=list(findings)))
    monkeypatch.setattr(tools.content_mcp, 'call', lambda tool, args: {'draft': {'title': '3화', 'body': body, 'revision': revision}})


@pytest.mark.parametrize('fix, findings, revision, body, error', [
    (1, [finding('서윤은 웃엇다.'), finding('비가', status='suspected')], 4, BODY, tools.BAD_FIX),  # 확정이 아닌 지적
    (0, [finding('서윤은 웃엇다.')], 5, BODY, tools.DRAFT_CHANGED),                             # 검수 뒤 바뀐 초안
    (0, [finding('웃엇다.')], 4, '웃엇다. 웃엇다.', tools.DRAFT_CHANGED),                         # 한 곳이 아닌 구절
])
def test_boundary_the_fix_must_point_at_one_confirmed_place_of_the_reviewed_revision(monkeypatch, fix, findings, revision, body, error):
    calls = fake_agents(monkeypatch, plan(Step('manuscript_review', check='mechanical'), Step('writing_editing', task='patch', fix=fix)))
    reviewed(monkeypatch, *findings, revision=revision, body=body)
    result = run(target=TARGET)
    assert 'patch' not in names(calls)
    assert [(s.feature, s.status) for s in result.steps] == [('manuscript_review', 'completed'), ('writing_editing', 'failed')]
    assert result.steps[1].error == error


def test_boundary_the_fix_patches_the_chosen_confirmed_finding(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('manuscript_review', check='mechanical'), Step('writing_editing', task='patch', fix=0)))
    reviewed(monkeypatch, finding('서윤은 웃엇다.'), finding('바람이 차가왔다.'))
    result = run(target=TARGET)
    [(_, (patch,), _)] = [c for c in calls if c[0] == 'patch']
    assert patch.selection == '서윤은 웃엇다.' and result.steps[1].when == 'if_issues_found'


def test_boundary_simulation_is_only_reachable_when_the_guard_decided_it(monkeypatch):
    calls = fake_agents(monkeypatch, plan('manuscript_review', 'character_simulation', capabilities=['manuscript_review']))
    run(target=TARGET, inputs={'manuscript_review': REVIEW})
    assert 'sim_plan' not in names(calls) and all('ask_character_simulation' not in t for t in exposed(calls))


def test_boundary_web_research_sends_only_the_consented_question_not_the_request(monkeypatch):
    calls = fake_agents(monkeypatch, plan('research'))
    run('비공개 원고 내용을 같이 검색해줘', inputs={'research': WEB})
    [(_, (sent,), _)] = [c for c in calls if c[0] == 'research']
    assert sent.question == WEB['question'] and sent.context == ''


def test_platform_research_runs_without_waiting_for_consent_and_reads_the_request(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('research', task='platform')))
    result = run('마법 학원 설정을 다른 세계관에서 참고하고 싶어')  # 대화도 동의 입력(inputs.research)도 없다
    assert (result.status, [(s.feature, s.status) for s in result.steps]) == ('completed', [('research', 'completed')])
    assert names(calls) == ['judge', 'platform']
    [(_, (sent,), _)] = [c for c in calls if c[0] == 'platform']
    assert sent == '마법 학원 설정을 다른 세계관에서 참고하고 싶어'
    assert result.steps[0].result.references[0].worldName == '달빛 학원'
    # 메인 에이전트는 출처(세계관·카드·작가)·참고 이유·gaps를 요약으로 받는다.
    assert json.loads(tool_messages(calls)[0].content) == {
        'feature': 'research', 'status': 'completed', 'gaps': ['학원 위치는 못 찾았어요.'],
        'references': [{'world': '달빛 학원', 'card': '교칙', 'author': '별빛', 'note': '교칙 서술을 참고'}]}


def test_platform_research_falls_back_to_the_turn_request_when_the_model_leaves_request_empty(monkeypatch):
    routed = plan(Step('research', task='platform'))
    routed.calls[0][1]['request'] = ''
    calls = fake_agents(monkeypatch, routed)
    result = run('다른 세계관에서 학원 설정 참고할래')
    assert result.steps[0].status == 'completed'
    [(_, (sent,), _)] = [c for c in calls if c[0] == 'platform']
    assert sent == '다른 세계관에서 학원 설정 참고할래'


def test_platform_research_failures_are_reported_as_a_failed_step(monkeypatch):
    fake_agents(monkeypatch, plan(Step('research', task='platform')), fail={'platform': ResearchFailure(502, '플랫폼 조사 모델이 후보에 없는 세계관을 골랐습니다.')})
    result = run('마법 학원 참고')
    assert [(s.status, s.error) for s in result.steps] == [('failed', '플랫폼 조사 모델이 후보에 없는 세계관을 골랐습니다.')]


def test_web_research_still_waits_for_the_consented_question(monkeypatch):
    calls = fake_agents(monkeypatch, plan('research'))
    assert (run().status, 'research' in names(calls)) == ('needs_input', False)


def test_boundary_service_checks_still_reject_results_without_correction(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'story_context': StoryQaFailure(502, '발췌 밖 인용')})
    result = run(inputs={'story_context': QA})
    assert (result.steps[0].status, result.steps[0].error) == ('failed', '발췌 밖 인용')


# 입력 대기(HITL)


def test_a_missing_input_waits_inside_the_tool_and_resume_runs_only_that_tool(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'research'))
    thread = str(uuid4())
    waiting = turn(thread, inputs={'story_context': QA})
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['research'])
    assert [(s.feature, s.status) for s in waiting.steps] == [('story_context', 'completed'), ('research', 'not_started')]
    before = len(calls.main)
    done = resume(thread, approved=True, inputs={'research': WEB})
    assert names(calls) == ['judge', 'story_context', 'research']  # 판정·Q&A를 다시 하지 않는다
    assert len(calls.main) == before + 1  # 이어서는 종합 한 번뿐이다
    assert (done.status, done.message) == ('completed', '종합 답변')


def test_declining_the_input_cancels_the_tool_and_only_the_finished_results_are_answered(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'research'))
    thread = str(uuid4())
    turn(thread, inputs={'story_context': QA})
    done = resume(thread, approved=False)
    assert 'research' not in names(calls) and exposed(calls)[-1] == []
    assert done.status == 'cancelled' and [s.feature for s in done.steps] == ['story_context']


def test_a_missing_input_without_a_conversation_ends_as_needs_input(monkeypatch):
    calls = fake_agents(monkeypatch, plan('research'))
    result = run()
    assert (result.status, result.missingInputs) == ('needs_input', ['research'])
    assert 'research' not in names(calls)


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
    calls = fake_agents(monkeypatch, plan('rating', 'story_context', 'research', 'world',
                                          capabilities=['story_context', 'research', 'world']))
    result = run(target=TARGET, inputs={'story_context': QA, 'research': WEB})
    assert [s.feature for s in result.steps] == ['story_context', 'research', 'world']
    assert 'rating' not in names(calls)


def test_repeated_blocked_calls_still_end_within_the_model_call_limit(monkeypatch):
    calls = fake_agents(monkeypatch, plan(*['rating'] * 8, capabilities=['story_context']))
    result = run(target=TARGET, inputs={'story_context': QA})
    assert len(calls.main) == agent.MODEL_CALLS and exposed(calls)[-1] == []
    assert (result.status, result.message, result.steps) == ('clarify', '종합 답변', [])


def applied(monkeypatch):
    done = []
    monkeypatch.setattr(service.content_mcp, 'apply_writing', lambda work, episode, result, *, expected_revision=None: done.append(result) or {'episode': episode, 'revision': 5})
    return done


def test_a_later_failure_still_asks_to_approve_the_finished_writing(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing', 'research'), fail={'research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    written, thread = applied(monkeypatch), str(uuid4())
    waiting = turn(thread, target=TARGET, inputs={'writing_editing': PATCH, 'research': WEB})
    assert (waiting.status, waiting.awaitingApproval) == ('waiting', 'writing_editing') and written == []
    done = resume(thread, approved=True)
    assert done.status == 'failed' and done.steps[0].approval == 'approved' and len(written) == 1


def test_a_later_simulation_clarify_still_asks_to_approve_the_finished_writing_first(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing', 'character_simulation'), drafted=SimulationPlan(mode='flow', beats=['성문 대면']))
    written, thread = applied(monkeypatch), str(uuid4())
    waiting = turn(thread, target=TARGET, inputs={'writing_editing': PATCH})
    assert (waiting.status, waiting.awaitingApproval) == ('waiting', 'writing_editing') and written == []
    done = resume(thread, approved=True)
    assert done.status == 'clarify' and '참여 인물' in done.message
    assert done.steps[0].approval == 'approved' and len(written) == 1


def test_a_cancelled_later_input_still_asks_to_approve_the_finished_writing(monkeypatch):
    fake_agents(monkeypatch, plan('writing_editing', 'research'))
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
    calls = fake_agents(monkeypatch, plan(['research', 'story_context']))
    together(monkeypatch, (tools.research, 'research'), (tools.story_qa, 'answer'))
    result = run(inputs={'story_context': QA, 'research': WEB})
    assert [(s.feature, s.status) for s in result.steps] == [('research', 'completed'), ('story_context', 'completed')]
    assert len(calls.main) == 2 and (result.status, result.message) == ('completed', '종합 답변')  # 묶음 한 번 + 종합


@pytest.mark.parametrize('solo', [Step('writing_editing', task='plan'), Step('character_simulation'), Step('world', task='enrich')])
def test_writing_simulation_and_world_enrich_in_a_batch_are_refused_and_run_alone_next(monkeypatch, solo):
    calls = fake_agents(monkeypatch, plan(['rating', solo], solo))
    fake_scene(monkeypatch)
    result = run('요청', target=TARGET)
    refused = sent(calls, tools.TOOL_NAMES[solo.feature])
    assert (refused.status, refused.content.startswith('[순차]')) == ('error', True)
    assert [s.feature for s in result.steps] == ['rating', solo.feature]  # 거부는 기능당 1회를 쓰지 않는다


def test_writing_and_review_wait_for_an_earlier_tool_in_the_same_batch(monkeypatch):
    review = Step('manuscript_review', check='mechanical')
    calls = fake_agents(monkeypatch, plan(['story_context', 'writing_editing', review], 'writing_editing', review))
    result = run(target=TARGET, inputs={'story_context': QA})

    assert result.status == 'completed'
    assert [s.feature for s in result.steps] == ['story_context', 'writing_editing', 'manuscript_review']
    assert names(calls) == ['judge', 'story_context', 'mcp', 'mcp', 'mcp', 'mcp', 'plan_and_draft', 'manuscript_review']


@pytest.mark.parametrize('task, service_call', [('check', (tools.world_review, 'review')), ('impact', (tools.world_review, 'impact'))])
def test_world_check_and_impact_are_lookups_that_run_concurrently_with_the_others(monkeypatch, task, service_call):
    calls = fake_agents(monkeypatch, plan(['rating', Step('world', task=task)]))
    together(monkeypatch, (tools.rating, 'rate'), service_call)
    result = run('요청', target=TARGET)
    assert [(s.feature, s.task, s.status) for s in result.steps] == [('rating', None, 'completed'), ('world', task, 'completed')]
    assert len(calls.main) == 2 and (result.status, result.message) == ('completed', '종합 답변')  # 묶음 한 번 + 종합


def test_the_world_summary_gives_the_main_agent_the_minimum_per_task_and_never_the_proposed_text_or_ids(monkeypatch):
    summaries = {}
    for task in ('check', 'enrich', 'impact'):
        calls = fake_agents(monkeypatch, plan(Step('world', task=task)))
        run(target=TARGET)
        summaries[task] = tool_messages(calls)[0].content
    assert json.loads(summaries['check']) == {'feature': 'world', 'status': 'completed', 'task': 'check',
                                              'findings': [{'kind': 'doc_role', 'message': 'SOUL에 목표가 섞여 있어요.'}]}
    assert json.loads(summaries['enrich']) == {'feature': 'world', 'status': 'completed', 'task': 'enrich', 'note': '카엘의 SOUL을 보강했어요.',
                                               'fixes': [{'card': '카엘', 'target': 'soul', 'episode': None}]}
    assert json.loads(summaries['impact']) == {
        'feature': 'world', 'status': 'completed', 'task': 'impact', 'conflicts': ['3화의 나이와 충돌한다.'], 'gaps': ['5화 계획의 나이를 알 수 없다.'],
        'affected': [{'kind': 'card', 'title': '카엘', 'reason': '나이 설정이 바뀐다.', 'certainty': 'confirmed'}]}
    assert '말이 짧고 낮게' not in summaries['enrich']  # 제안한 글 전체는 승인 카드에 있다


def test_a_dependent_fix_in_the_same_batch_as_its_review_waits_for_the_review(monkeypatch):
    fix = Step('writing_editing', task='patch', fix=0)
    calls = fake_agents(monkeypatch, plan([Step('manuscript_review', check='mechanical'), fix], fix))
    reviewed(monkeypatch, finding('서윤은 웃엇다.'))
    result = run(target=TARGET)
    assert [(s.feature, s.status) for s in result.steps] == [('manuscript_review', 'completed'), ('writing_editing', 'completed')]
    assert names(calls).count('patch') == 1 and len(calls.main) == 3


def test_a_call_missing_author_input_in_a_batch_is_deferred_then_waits_alone(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['story_context', 'research'], 'research'))
    thread = str(uuid4())
    waiting = turn(thread, inputs={'story_context': QA})
    assert sent(calls, 'ask_research').content.startswith('[순차]')
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['research'])
    done = resume(thread, approved=True, inputs={'research': WEB})
    assert [(s.feature, s.status) for s in done.steps] == [('story_context', 'completed'), ('research', 'completed')]
    assert names(calls).count('research') == 1


def test_a_batch_where_nothing_can_run_together_still_runs_its_first_call_alone(monkeypatch):
    # 둘 다 작가 입력이 빠졌다. 모두 미루면 모델이 같은 묶음을 반복해 아무것도 못 한다.
    calls = fake_agents(monkeypatch, plan([Step('manuscript_review'), 'research']))
    waiting = turn(str(uuid4()), target=TARGET)
    assert (waiting.status, waiting.missingInputs) == ('waiting', ['manuscript_review'])
    assert len(calls.main) == 1


def test_a_failure_in_a_batch_keeps_the_finished_sibling_and_closes_the_tools(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['story_context', 'research'], 'rating'), fail={'research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    result = run(target=TARGET, inputs={'story_context': QA, 'research': WEB})
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed'), ('research', 'failed')]
    assert result.status == 'failed' and exposed(calls)[-1] == [] and 'rating' not in names(calls)


def test_each_call_in_a_batch_counts_toward_the_three_calls_per_turn(monkeypatch):
    calls = fake_agents(monkeypatch, plan(['story_context', 'research', 'rating', 'world']))
    result = run(target=TARGET, inputs={'story_context': QA, 'research': WEB})
    assert [s.feature for s in result.steps] == ['story_context', 'research', 'rating']
    assert 'world_review' not in names(calls) and sent(calls, 'ask_world').status == 'error'


def test_the_patch_summary_names_the_changed_passage_so_the_answer_cannot_claim_more(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('manuscript_review', check='mechanical'), Step('writing_editing', task='patch', fix=1)))
    reviewed(monkeypatch, finding('서윤은 웃엇다.'), finding('바람이 차가왔다.'))
    run(target=TARGET)
    summary = json.loads(tool_messages(calls)[1].content)
    assert (summary['kind'], summary['selection']) == ('patch', '그는 웃었다.')



# 메인 에이전트의 지시문은 Langfuse 프롬프트(orchestration.main)다

def test_the_main_agent_uses_the_managed_prompt_and_its_generations_link_that_version(monkeypatch, spans):
    calls = fake_agents(monkeypatch, plan('story_context'))
    asked, version = [], SimpleNamespace(name='orchestration.main', version=6, is_fallback=False)
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt('관리된 지시', version))

    run(inputs={'story_context': QA})

    assert asked == [('orchestration.main', INSTRUCTIONS)]
    assert calls.main[0]['messages'][0].content == '관리된 지시'
    mains = [s for s in spans() if s.name == 'main_agent']
    assert len(mains) == 2 and all(
        (attrs(s)['langfuse.observation.prompt.name'], attrs(s)['langfuse.observation.prompt.version']) == ('orchestration.main', 6) for s in mains)


def test_an_unavailable_main_prompt_is_the_judgment_failure_before_any_model_call(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))

    def unavailable(name, default):
        raise tracing.PromptUnavailable

    monkeypatch.setattr(tracing, 'prompt', unavailable)
    with pytest.raises(IntentFailure):
        run(inputs={'story_context': QA})
    assert calls == [] and calls.main == []


# 파이프라인 관찰(DEC-58): 운영 화면이 노드를 눌러 보는 기록. 판정·메인 모델 출력·돌려보낸 도구 호출이 observation에 남는다


@pytest.mark.parametrize('routed, judged', [
    (plan('story_context', 'research'), {'allowed': True, 'reason': None, 'capabilities': ['story_context', 'research']}),
    (plan(status='rejected', reason='greeting'), {'allowed': False, 'reason': 'greeting', 'capabilities': []}),
], ids=['allowed', 'rejected'])
def test_the_decision_guard_span_output_is_the_judgment_result(monkeypatch, spans, routed, judged):
    fake_agents(monkeypatch, routed)
    run(inputs={'story_context': QA, 'research': WEB})
    [guard] = named(spans, 'decision_guard')
    assert shown(guard, 'output') == judged


def test_a_main_generation_records_its_text_and_each_tool_call_with_its_arguments(monkeypatch, spans):
    fake_agents(monkeypatch, plan(['research', 'story_context']))
    run(inputs={'story_context': QA, 'research': WEB})
    called, answered = named(spans, 'main_agent')
    assert shown(called, 'output') == {'text': '', 'toolCalls': [
        {'name': 'ask_research', 'args': {'task': 'web'}}, {'name': 'ask_story_qa', 'args': {'request': '요청'}}]}
    assert shown(answered, 'output') == {'text': '종합 답변', 'toolCalls': []}
    assert named(spans, 'main_agent.blocked') == []  # 돌려보낸 호출이 없으면 남기지 않는다


def test_a_main_generation_keeps_the_text_written_in_the_same_response_as_its_tool_call(spans):
    message = AIMessage(content='규칙부터 찾아볼게요.', tool_calls=[{'name': 'ask_story_qa', 'args': {'request': '길드 규칙은?'}, 'id': 'c1'}],
                        response_metadata={'status': 'completed', 'model_name': 'm'},
                        usage_metadata={'input_tokens': 3, 'output_tokens': 2, 'total_tokens': 5})

    async def handler(request):
        return ModelResponse(result=[message])

    asyncio.run(agent.MainModelMiddleware().awrap_model_call(SimpleNamespace(model=SimpleNamespace(model_name='m'), state={}), handler))
    [generation] = named(spans, 'main_agent')
    assert shown(generation, 'output') == {'text': '규칙부터 찾아볼게요.',
                                           'toolCalls': [{'name': 'ask_story_qa', 'args': {'request': '길드 규칙은?'}}]}


@pytest.mark.parametrize('routed, tool, tag', [
    (plan('story_context', 'rating', capabilities=['story_context']), 'ask_rating', '[차단]'),                                 # 노출 밖
    (plan(['rating', Step('writing_editing', task='plan')], Step('writing_editing', task='plan')), 'ask_writing', '[순차]'),  # 병렬 불가·승인 필요(보강)도 같은 [순차]
], ids=['not-exposed', 'not-parallel'])
def test_a_call_the_main_agent_sent_back_is_traced_as_a_blocked_span_with_its_name_and_reason(monkeypatch, spans, routed, tool, tag):
    calls = fake_agents(monkeypatch, routed)
    run('요청', target=TARGET, inputs={'story_context': QA})
    refused = sent(calls, tool)
    [blocked] = named(spans, 'main_agent.blocked')
    assert refused.content.startswith(tag)
    assert (shown(blocked, 'input'), shown(blocked, 'output')) == ({'name': tool}, {'reason': refused.content})  # 모델이 받은 그 문구가 이유다
    [root] = named(spans, 'orchestration')
    assert blocked.parent.span_id == root.context.span_id


# 고증 조사 도구(#545): ask_research(task=web). 옛 ask_web_research 체크포인트는 계속 이어진다.


def test_ask_research_waits_for_the_consented_input_only_for_the_web_task():
    schema = agent.TOOLS['research'].tool_call_schema.model_json_schema()
    assert set(schema['properties']) == {'task', 'request'} and schema['required'] == ['task']
    wait = lambda inputs, task: tools.WAITS['ask_research']({}, inputs, None, {'task': task})
    assert wait({}, 'web') and not wait({'research': WEB}, 'web') and not wait({}, 'platform')


def test_a_decision_recorded_as_web_research_still_exposes_ask_research():
    assert {n for n in agent._allowed({'decision': {'capabilities': ['web_research']}}) if n.startswith('ask_')} == {'ask_research'}  # MCP 도구(#554)는 기능과 무관하게 함께 노출된다


def test_a_pending_ask_web_research_call_from_an_old_checkpoint_runs_as_ask_research():
    request = ToolCallRequest(tool_call={'name': 'ask_web_research', 'args': {}, 'id': 'c1'}, tool=None, runtime=None,
                              state={'decision': {'capabilities': ['web_research']}})
    ran = []

    async def handler(asked):
        ran.append(asked.tool_call)
        return ToolMessage(content='ok', tool_call_id='c1')

    asyncio.run(agent.DynamicToolMiddleware().awrap_tool_call(request, handler))
    assert ran == [{'name': 'ask_research', 'args': {'task': 'web'}, 'id': 'c1'}]
