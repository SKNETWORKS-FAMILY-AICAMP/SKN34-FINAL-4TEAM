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

from app import agent_runtime, tracing
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

from .stubs import DRAFT, PATCH, QA, REVIEW, WEB, Step, fake_agents, fake_main, fake_scene, plan

TARGET = {'workId': 'w1', 'episode': 3}
# fake_agents가 대역으로 바꾸기 전의 실제 서비스 함수. 서비스가 모델 출력을 검증해 올리는 502를 모델 호출만 대역으로 두고 시험한다.
REAL_ANSWER, REAL_DRAFT = tools.story_qa.answer, tools.writing.draft


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
    calls = fake_agents(monkeypatch, plan(status='rejected', reason='prompt_injection'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message) == ('rejected', REJECT_MESSAGES['prompt_injection'])
    assert names(calls) == ['judge'] and calls.main == []


def test_an_allowed_decision_without_features_runs_the_main_agent_with_only_the_content_tools(monkeypatch):
    # #554: 허용됐지만 기능이 비면 고정 되묻기로 끝내지 않고 메인이 Content 도구만 가지고 실행한다. 도구를 쓰지 않고 답하면 그 답이 확인 질문(clarify)이다.
    calls = fake_agents(monkeypatch, plan(status='clarify'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('clarify', '종합 답변', [])
    assert exposed(calls) == [[*mcp_tools.NAMES, 'ask_author']]


def test_the_main_agent_answers_small_talk_itself():
    # #782: 가드가 인사·잡담을 거절하지 않으므로 메인이 짧게 답하고, 창작과 무관한 작업은 안내만 한다.
    assert '인사·감사·잡담' in INSTRUCTIONS and '창작과 무관한 작업' in INSTRUCTIONS
    # #893: 규칙 6의 고정 문장(UNSUPPORTED_MESSAGE)보다 규칙 8이 우선함을 지시문이 밝힌다.
    rule8 = INSTRUCTIONS.split('\n8. ')[1].split('\n답변:')[0]
    assert '규칙 6의 고정 문장 대신' in rule8


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
    assert exposed(calls)[0] == ['ask_story_qa', 'ask_rating', *mcp_tools.NAMES, 'ask_author']


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
    assert exposed(calls)[:7] == [['ask_story_qa', *mcp_tools.NAMES, 'ask_author']] * 7 and exposed(calls)[7] == []
    assert (result.status, result.message) == ('completed', '종합 답변')


def test_tools_are_bound_with_parallel_calls_and_the_model_has_no_retries_or_storage(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run(inputs={'story_context': QA})
    assert calls.main[0]['settings']['parallel_tool_calls'] is True
    init = calls.main.init
    assert (init['model'], init['use_responses_api'], init['store'], init['max_retries']) == ('test-model', True, False, 0)


def test_the_main_model_reasons_at_high_effort_with_room_for_reasoning_tokens(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run(inputs={'story_context': QA})
    assert (calls.main.init['reasoning_effort'], calls.main.init['max_tokens']) == ('high', 8000)


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


def traced(monkeypatch, name='main_agent') -> list[dict]:
    """추적 span name(기본은 메인 모델 main_agent)에 남은 update 값들."""
    updates = []

    @contextmanager
    def observe(observed, **fields):
        # 요청 루트(tracing.request)도 이 대역을 거치므로 id를 읽을 수 있어야 한다. 0 id는 추적이 꺼진 span이다.
        yield SimpleNamespace(trace_id='0' * 32, id='0' * 16, update=lambda **kw: observed == name and updates.append(kw))

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
        assert set(properties) <= {'request', 'check', 'task', 'fix', 'from_review'}, name
        if 'request' in properties:
            assert properties['request']['maxLength'] == 2000
    # 고증 조사 web은 작업 지시(request)를 쓰지 않는다. 외부로 나가는 것은 작가가 동의한 질문뿐이다. platform만 request를 찾을 설정 주제로 쓴다.
    assert set(schemas['ask_research']['properties']) == {'task', 'request'} and schemas['ask_research']['properties']['task']['enum'] == ['web', 'platform']
    assert schemas['ask_research']['required'] == ['task']
    assert set(schemas['ask_manuscript_review']['properties']['check']['anyOf'][0]['enum']) == {'mechanical', 'semantic', 'both'}
    assert set(schemas['ask_writing']['properties']['task']['enum']) == {'plan', 'draft', 'patch', 'revise_plan'}
    # World의 작업은 열거형 인자 task로 고르고 반드시 정해야 한다(고르지 않은 호출은 인자 오류로 단계 실패다).
    assert set(schemas['ask_world']['properties']['task']['enum']) == {'check', 'enrich', 'impact'} and 'task' in schemas['ask_world']['required']


def test_the_main_agent_is_told_that_editing_chosen_text_needs_no_review_finding():
    """#669: patch가 검수의 확정 지적 전용으로 읽혀 선택 글 수정을 거절했다."""
    rule = next(line for line in INSTRUCTIONS.splitlines() if line.startswith('2.'))
    for told in (rule, agent.TOOLS['writing_editing'].description):
        assert all(words in told for words in ('선택한 글', '구간', 'fix 없이', 'task=patch')), told
        assert '고칠 때만 task=patch' not in told, told


def test_the_main_agent_is_told_how_to_choose_between_the_selection_and_a_finding():
    """#636: 검수를 함께 요청해도 선택 글은 fix 없이 고치고, 지적을 고칠 때는 선택 글이 남아 있어도 fix를 넣는다."""
    rule = next(line for line in INSTRUCTIONS.splitlines() if line.startswith('2.'))
    for told in (rule, agent.TOOLS['writing_editing'].description):
        assert '검수를 함께 요청했어도' in told, told
        assert '선택한 글이 남아 있어도' in told, told


def test_the_main_agent_is_told_not_to_make_numbered_choices_for_a_past_reviews_findings():
    """#873: 지난 턴 검수의 지적도 ask_writing이 받으니 ask_author 번호 선택지로 고르게 하지 않는다."""
    rule = next(line for line in INSTRUCTIONS.splitlines() if line.startswith('2.'))
    assert '이전 턴 검수' in rule and 'from_review=true' in rule and 'ask_author로 번호 선택지를 만들지' in rule


def test_the_main_agent_credits_author_edits_to_the_author():
    """#875 E2E: authorEdited를 받고도 "실행 과정에서 바뀌었다"고 답했다. 작가가 고쳤다고 밝히게 한다."""
    rule = next(line for line in INSTRUCTIONS.splitlines() if line.startswith('6.'))
    assert 'authorEdited' in rule and '작가가 고친 내용으로 저장했다고' in rule and '실행 과정에서 바뀌었다' in rule


def test_the_review_summary_says_the_whole_episode_was_reviewed(monkeypatch):
    """#636 E2E: 선택한 글이 실리면 그 문장만 검수했다고 답했다. 검수는 늘 회차 본문 전체를 본다."""
    calls = fake_agents(monkeypatch, plan(Step('manuscript_review', check='mechanical')))
    run(target=TARGET)
    assert json.loads(tool_messages(calls)[0].content).get('range') == '회차 본문 전체'


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
    sent = calls.main[-1]['messages']
    assert sent[1].text.endswith('질문 0')  # 시스템 지시 뒤 창 밖 턴의 요약 블록(#790, 요약 모델은 대역)
    assert [m.text for m in sent[2:12]] == [t for n in range(1, 6) for t in (f'질문 {n}', '종합 답변')]  # 최근 5턴(질문 1~5)
    assert sent[12].text == '질문 6'


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
    # after를 빼기만 하면 종합 답변이 '수정안 본문이 없다'고 실패처럼 말한다
    assert '결과 카드' in summary.get('proposal', '') and '그는 차갑게 웃었다.' not in tool_messages(calls)[1].content



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
    (plan(status='rejected', reason='prompt_injection'), {'allowed': False, 'reason': 'prompt_injection', 'capabilities': []}),
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


def test_old_web_research_inputs_from_a_checkpoint_are_not_asked_again():
    call = {'name': 'ask_research', 'args': {'task': 'web'}}
    assert not tools.waits(call, {'inputs': {'web_research': WEB}}, {})
    assert tools.inputs({'inputs': {'web_research': WEB}}) == {'research': WEB}


def test_research_inputs_win_over_old_web_research_inputs():
    assert tools.inputs({'inputs': {'web_research': {'question': '옛 질문'}, 'research': WEB}}) == {'research': WEB}


def test_web_and_platform_research_both_run_in_one_turn_and_record_their_task(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('research', task='web'), Step('research', task='platform')))
    result = run('고증도 확인하고 다른 세계관 설정도 찾아 줘', inputs={'research': WEB})
    assert names(calls) == ['judge', 'research', 'platform']
    assert [(s.feature, s.task, s.status) for s in result.steps] == [('research', 'web', 'completed'), ('research', 'platform', 'completed')]


def test_research_runs_at_most_twice_per_turn(monkeypatch):
    calls = fake_agents(monkeypatch, plan(*[Step('research', task='platform')] * 3))
    result = run('마법 학원 참고')
    assert names(calls).count('platform') == 2 and len(result.steps) == 2
    assert tool_messages(calls)[-1].status == 'error'


def test_a_failed_platform_step_is_named_for_the_model_as_a_public_world_reference(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('research', task='platform')), fail={'platform': ResearchFailure(502, '실패')})
    run('마법 학원 참고')
    assert tool_messages(calls)[0].content == '[실패] 공개 세계관 참고: 실패'


def test_a_decision_recorded_as_web_research_still_exposes_ask_research():
    assert {n for n in agent._allowed({'decision': {'capabilities': ['web_research']}}) if n.startswith('ask_')} == {'ask_research', 'ask_author'}  # MCP 도구(#554)는 기능과 무관하게 함께 노출된다


def test_a_pending_ask_web_research_call_from_an_old_checkpoint_runs_as_ask_research():
    request = ToolCallRequest(tool_call={'name': 'ask_web_research', 'args': {}, 'id': 'c1'}, tool=None, runtime=None,
                              state={'decision': {'capabilities': ['web_research']}})
    ran = []

    async def handler(asked):
        ran.append(asked.tool_call)
        return ToolMessage(content='ok', tool_call_id='c1')

    asyncio.run(agent.DynamicToolMiddleware().awrap_tool_call(request, handler))
    assert ran == [{'name': 'ask_research', 'args': {'task': 'web'}, 'id': 'c1'}]


def test_the_main_agent_calls_the_model_chosen_in_its_prompt_version(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: tracing.Prompt('관리된 지시', model='gpt-chosen'))
    run(inputs={'story_context': QA})
    assert calls.main.init['model'] == 'gpt-chosen'


# 작가에게 선택지로 묻기(#794)

OPTIONS = [{'label': '3화', 'message': '3화 결말을 고쳐줘'}, {'label': '4화', 'message': '4화 결말을 고쳐줘'}]


def asking(*before, options=OPTIONS, capabilities=('story_context',)):
    """판정 기능은 그대로 두고 메인이 before 도구들 뒤에 ask_author를 부르는 대본."""
    from .stubs import Planned
    return Planned(DecisionResult(allowed=True, capabilities=list(capabilities)),
                   [*before, ('ask_author', {'question': '어느 회차 결말을 고칠까요?', 'options': options})])


def test_ask_author_ends_the_turn_as_a_clarify_with_the_options_as_choices(monkeypatch):
    calls = fake_agents(monkeypatch, asking())
    result = run('결말 고쳐줘', inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == ('clarify', '어느 회차 결말을 고칠까요?', [])
    assert [(c.label, c.message) for c in result.choices] == [('3화', '3화 결말을 고쳐줘'), ('4화', '4화 결말을 고쳐줘')]
    assert len(calls.main) == 1  # 묻고 나면 모델을 다시 부르지 않는다(종합 없음)


def test_ask_author_is_exposed_with_the_decided_tools_and_does_not_use_up_the_three_calls(monkeypatch):
    calls = fake_agents(monkeypatch, asking())
    run('결말 고쳐줘', inputs={'story_context': QA})
    assert exposed(calls)[0] == ['ask_story_qa', *mcp_tools.NAMES, 'ask_author']
    # 서브 에이전트 세 번으로 턴당 한도를 다 쓴 뒤에도 묻기는 실행된다.
    three = [('ask_story_qa', {}), ('ask_research', {'task': 'web'}), ('ask_rating', {})]
    calls = fake_agents(monkeypatch, asking(*three, capabilities=('story_context', 'research', 'rating')))
    result = run('결말 고쳐줘', target=TARGET, inputs={'story_context': QA, 'research': WEB})
    assert len(result.steps) == 3 and (result.status, len(result.choices)) == ('clarify', 2)


@pytest.mark.parametrize('options', [
    [OPTIONS[0]],                                                     # 2개 미만
    [*OPTIONS, *OPTIONS, OPTIONS[0]],                                 # 4개 초과
    [{'label': '가' * 21, 'message': '보낼 말'}, OPTIONS[0]],          # label 20자 초과
])
def test_ask_author_with_bad_options_is_returned_to_the_model_and_asks_nothing(monkeypatch, options):
    calls = fake_agents(monkeypatch, asking(options=options))
    result = run('결말 고쳐줘', inputs={'story_context': QA})
    assert result.choices == [] and result.message == '종합 답변' and len(calls.main) == 2
    assert tool_messages(calls)[0].status == 'error'


def test_rule_three_asks_with_ask_author_only_when_there_are_candidates():
    rule = next(line for line in INSTRUCTIONS.splitlines() if line.startswith('3.'))
    assert 'ask_author' in rule and '후보가 없으면' in rule


# 실패 원인 분류와 자동 재시도(#908, DEC-61)


def provider_error(kind):
    import httpx
    import openai
    request = httpx.Request('POST', 'http://provider.test')
    if kind == 'connection':
        return openai.APIConnectionError(request=request)
    cls, status = {'rate': (openai.RateLimitError, 429), 'server': (openai.InternalServerError, 500), 'bad': (openai.BadRequestError, 400)}[kind]
    return cls('provider', response=httpx.Response(status, request=request), body=None)


def stream_rows(request='요청', **body):
    """SSE 이벤트를 행으로: 진행 목록은 (activity, 라벨, 상태), 답변은 (answer, delta), 나머지는 (이벤트,)."""
    async def collect():
        return [(e.event, e.data) async for e in service.stream(OrchestrationRequest(request=request, **body))]
    return [(name, data['label'], data['status']) if name == 'activity' else (name, data['delta']) if name == 'answer' else (name,)
            for name, data in asyncio.run(collect())]


@pytest.mark.parametrize('kind', ['connection', 'rate', 'server'])
def test_a_transient_main_model_error_discards_the_partial_answer_and_retries_once_after_a_second(monkeypatch, main_waits, kind):
    fake_agents(monkeypatch, plan(status='clarify'))
    calls = fake_main(monkeypatch, fails=[provider_error(kind)])

    rows = stream_rows()

    assert rows == [('activity', '요청 확인', 'running'), ('activity', '요청 확인', 'done'),
                    ('answer', None),  # 쓰다 만 글을 버린다
                    ('activity', '다시 시도하는 중', 'running'), ('activity', '다시 시도하는 중', 'done'), ('done',)]
    assert main_waits == [1] and len(calls) == 2


def test_a_transient_main_model_error_twice_ends_failed_with_the_fixed_message(monkeypatch, main_waits):
    fake_agents(monkeypatch, plan(status='clarify'))
    calls = fake_main(monkeypatch, fails=[provider_error('rate'), provider_error('connection')])
    result = run()
    assert (result.status, result.message) == ('failed', agent.MAIN_FAILED_NOTHING_MESSAGE)
    assert main_waits == [1] and len(calls) == 2


@pytest.mark.parametrize('error', [provider_error('bad'), OpenAIError('down'), ValueError('response error')])
def test_a_non_transient_main_model_error_is_not_retried(monkeypatch, main_waits, error):
    fake_agents(monkeypatch, plan(status='clarify'))
    calls = fake_main(monkeypatch, fails=[error])
    assert run().status == 'failed' and main_waits == [] and len(calls) == 1


def test_a_main_model_retry_is_traced_with_its_count_and_reason_only(monkeypatch, main_waits):
    updates = traced(monkeypatch)
    fake_agents(monkeypatch, plan(status='clarify'))
    fake_main(monkeypatch, fails=[provider_error('server')])
    assert run().status == 'clarify'
    assert {'retries': 1, 'retryReason': 'transient'} in [u.get('metadata') for u in updates]


# 출력 문제(502)는 그 업무 Agent를 같은 입력으로 한 번 더 부른다(DEC-61, 2026-11-26 E2E 뒤 사용자 결정: 메인 에이전트 재호출은
# 지시문 규칙 5 '같은 턴에 같은 도구를 다시 부르지 마세요'와 부딪쳐 실모델에서 미완료로 끝났다).


def output_failure():
    failure = StoryQaFailure(502, '작품 질문 모델 응답을 확인할 수 없습니다.')
    failure.retry = 'output'
    return failure


def flaky_qa(monkeypatch, *failures):
    """Q&A 업무 Agent가 앞 호출들은 failures를 올리고 이후는 정상 답을 내게 한다. 부른 횟수를 돌려준다."""
    from app.story_qa import service as story_qa
    from app.story_qa.models import AnswerResponse, Claim
    waiting, ok, count = list(failures), AnswerResponse(claims=[Claim(text='밤에 닫는다', kind='confirmed', sourceIds=['a'])], gaps=[]), []

    def answer(*args, **kwargs):
        count.append(1)
        if waiting:
            raise waiting.pop(0)
        return ok

    monkeypatch.setattr(story_qa, 'answer', answer)
    return count


def test_an_output_failure_is_retried_once_with_the_same_input_inside_the_tool(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    count = flaky_qa(monkeypatch, output_failure())
    result = run(inputs={'story_context': QA})
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed')] and len(count) == 2
    assert (result.status, result.message) == ('completed', '종합 답변')
    assert names(calls).count('judge') == 1 and len(calls.main) == 2  # 메인 에이전트는 도구를 한 번만 불렀다
    assert not any(seen['settings'].get('tool_choice') for seen in calls.main)


def test_the_progress_list_shows_the_output_retry_line(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    flaky_qa(monkeypatch, output_failure())
    rows = stream_rows(inputs={'story_context': QA})
    assert ('activity', '다시 시도하는 중', 'running') in rows and ('activity', '다시 시도하는 중', 'done') in rows


def test_an_output_failure_twice_fails_the_step_and_closes_the_tools(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'research'))
    count = flaky_qa(monkeypatch, output_failure(), output_failure())
    result = run(inputs={'story_context': QA, 'research': WEB})
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'failed')] and len(count) == 2
    assert result.status == 'failed' and 'research' not in names(calls) and exposed(calls)[-1] == []


def test_an_output_retry_is_traced_on_the_step_with_its_count_and_reason_only(monkeypatch):
    updates = traced(monkeypatch, 'step.story_context')
    fake_agents(monkeypatch, plan('story_context'))
    flaky_qa(monkeypatch, output_failure())
    assert run(inputs={'story_context': QA}).status == 'completed'
    assert updates == [{'metadata': {'retries': 1, 'retryReason': 'output'}}]


# 서비스가 모델 출력을 검증해 올리는 502도 같은 출력 문제다. 서비스 함수는 실제 것을 쓰고 모델 호출만 대역으로 둔다.


def flaky_draft(monkeypatch, *replies):
    """집필 모델이 replies를 차례로 낸다(빈 글이면 서비스가 502). 실제 writing.draft를 거치고 모델에 보낸 입력 목록을 돌려준다."""
    sent = []

    def model(*args, **kwargs):
        sent.append((args, kwargs))
        return AIMessage(content=replies[len(sent) - 1], response_metadata={'model_name': 'm', 'id': 'r'}), None

    monkeypatch.setattr(tools.writing, 'draft', REAL_DRAFT)
    monkeypatch.setattr(agent_runtime, 'run', model)
    return sent


def test_an_empty_writing_reply_is_retried_once_with_the_same_input(monkeypatch):
    fake_agents(monkeypatch, plan(Step('writing_editing', task='draft')))
    sent = flaky_draft(monkeypatch, ' ', '선장은 항구에 내렸다.')
    result = run(inputs={'writing_editing': DRAFT})
    assert [(s.feature, s.status) for s in result.steps] == [('writing_editing', 'completed')]
    assert len(sent) == 2 and sent[0] == sent[1]


def test_two_empty_writing_replies_fail_the_step_and_close_the_tools(monkeypatch):
    calls = fake_agents(monkeypatch, plan(Step('writing_editing', task='draft'), 'research'))
    sent = flaky_draft(monkeypatch, ' ', '\n')
    result = run(inputs={'writing_editing': DRAFT, 'research': WEB})
    assert [(s.feature, s.status) for s in result.steps] == [('writing_editing', 'failed')] and len(sent) == 2
    assert result.status == 'failed' and 'research' not in names(calls) and exposed(calls)[-1] == []


def test_a_qa_answer_citing_an_excerpt_it_was_not_given_is_retried_once(monkeypatch):
    from app.story_qa.models import AnswerResponse, Claim
    asked = []

    def model(data):  # 첫 답은 전달하지 않은 발췌를 인용하고 다시 부르면 맞게 인용한다. 실제 story_qa.answer의 인용 대조가 502를 올린다
        asked.append(data)
        return AnswerResponse(claims=[Claim(text='밤에 닫는다', kind='confirmed', sourceIds=['other'] if len(asked) == 1 else ['e1'])], gaps=[])

    fake_agents(monkeypatch, plan('story_context'))
    monkeypatch.setattr(tools.story_qa, 'answer', REAL_ANSWER)
    monkeypatch.setattr(tools.story_qa.agent, 'answer', model)
    result = run(inputs={'story_context': QA})
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'completed')]
    assert len(asked) == 2 and asked[0] == asked[1]


@pytest.mark.parametrize('failure', [StoryQaFailure(502, '고정 문구'), StoryQaFailure(422, '입력 오류'), StoryQaFailure(503, '모델 호출 실패')],
                         ids=['plain-502', '4xx', '503'])
def test_a_failure_without_the_retry_mark_is_not_retried_and_closes_every_tool(monkeypatch, failure):
    updates = traced(monkeypatch, 'step.story_context')
    calls = fake_agents(monkeypatch, plan('story_context', 'story_context'))
    count = flaky_qa(monkeypatch, failure)
    result = run(inputs={'story_context': QA})
    assert [(s.feature, s.status) for s in result.steps] == [('story_context', 'failed')] and exposed(calls)[-1] == []
    assert len(count) == 1 and updates == []  # 다시 부르지 않았으니 재시도 표시도 없다
