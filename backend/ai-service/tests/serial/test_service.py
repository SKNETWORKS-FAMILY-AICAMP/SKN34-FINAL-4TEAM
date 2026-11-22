"""#659 자율 연재 실행 흐름: 선택지, 장면 미리보기, 투표·제안 종합 → 기획·원고(최소 분량) → 검수(1회 재작성), 요청 안 모든 모델 호출의 크레딧 누적·상한."""

import pytest

from app import tracing
from app.serial import service
from app.serial.errors import SerialFailure
from app.serial.models import ChoicesRequest, EpisodeRequest, SimulationRequest, SummaryRequest
from app.serial.prompt import (CHOICES_INSTRUCTIONS, EPISODE_SUMMARY_INSTRUCTIONS, REVIEW_INSTRUCTIONS, SIMULATION_INSTRUCTIONS,
                               SUMMARY_INSTRUCTIONS)
from app.writing.prompt import DRAFT_INSTRUCTIONS, PLAN_INSTRUCTIONS

from .stubs import (CHOICE, CHOICES, CONTEXT, DRAFT, EPISODE_SUMMARY, FAIL, PASS, PLAN, REWRITE, SHORT, SUMMARY, answers, choices_request,
                    episode, sent, simulation, story, summaries_request)


def choices(**overrides):
    return service.choices(ChoicesRequest.model_validate(choices_request(**overrides)))


def summarize(**overrides):
    return service.summarize(SummaryRequest.model_validate(summaries_request(**overrides)))


def simulate(**overrides):
    return service.simulate(SimulationRequest.model_validate(simulation(**overrides)))


def run_episode(**overrides):
    return service.episode(EpisodeRequest.model_validate(episode(**overrides)))


def test_choices_asks_for_four_directions_from_the_context_and_direction_and_confirms_credits(monkeypatch):
    asked = []
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt(default))
    calls = answers(monkeypatch, CHOICES)

    result = choices()

    assert result.model_dump() == {'choices': CHOICES[0]['choices'], 'credits': 0.3, 'usage': {'inputTokens': 200, 'outputTokens': 100}}
    assert asked == [('serial.choices_v2', CHOICES_INSTRUCTIONS)]
    instructions, data = sent(calls[0])
    assert instructions == CHOICES_INSTRUCTIONS and data == {'episodeNumber': 2, 'direction': '서윤의 성장 이야기', 'context': CONTEXT}


@pytest.mark.parametrize('picked', [
    ['가', '나', '다'], ['가', '나', '다', '라', '마'], ['가', '나', '다', '라', '라'], ['가', '나', '다', '다'], ['가', '나', '다', '  '],
    ['가', '나', '다', '라' * 301]], ids=['three', 'five', 'five-with-duplicate', 'duplicate', 'blank', 'too-long'])
def test_choices_that_break_the_rules_are_a_fixed_502_not_corrected(monkeypatch, picked):
    answers(monkeypatch, ({'choices': picked}, 10, 5))

    with pytest.raises(SerialFailure) as error:
        choices()

    assert (error.value.status, str(error.value)) == (502, '선택지 모델 응답을 확인할 수 없습니다.')


def test_simulation_writes_a_scene_from_the_public_context_and_confirms_credits(monkeypatch):
    asked = []
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt(default))
    calls = answers(monkeypatch, ('서윤이 입을 열었다.', 1000, 500))

    result = simulate()

    assert result.model_dump() == {'scene': '서윤이 입을 열었다.', 'credits': 1.5, 'usage': {'inputTokens': 1000, 'outputTokens': 500}}
    instructions, data = sent(calls[0])
    # 모델은 전제·비트·공개 문맥만 받는다(작품·예약·상한 정보는 보내지 않는다).
    assert instructions == SIMULATION_INSTRUCTIONS
    assert data == {'episodeNumber': 2, 'premise': '서윤이 비밀을 털어놓는다', 'beats': ['망설임', '고백'], 'context': CONTEXT}
    assert asked == [('serial.simulation_v2', SIMULATION_INSTRUCTIONS)]


def test_confirmed_credits_never_exceed_the_reserved_limit_but_usage_is_the_real_tokens(monkeypatch):
    answers(monkeypatch, ('서윤이 입을 열었다.', 1000, 500))  # 1.5크레딧을 썼다

    result = simulate(creditLimit=1)

    assert result.credits == 1 and result.usage.inputTokens + result.usage.outputTokens == 1500


@pytest.mark.parametrize('scene', ['  ', '가' * 1501])
def test_a_scene_outside_the_contract_is_502_and_is_not_trimmed(monkeypatch, scene):
    answers(monkeypatch, (scene, 10, 5))

    with pytest.raises(SerialFailure) as error:
        simulate()

    assert (error.value.status, str(error.value)) == (502, '장면 미리보기 모델 응답을 확인할 수 없습니다.')


def test_episode_chains_summary_plan_draft_and_review_with_the_top_choice_as_the_central_development(monkeypatch):
    asked = []
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt(default))
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    result = run_episode()

    assert result.model_dump() == {'summary': SUMMARY[0]['summary'], 'title': '진실의 밤', 'text': DRAFT[0], 'review': {'passed': True, 'issues': []},
                                   'credits': 1.67, 'usage': {'inputTokens': 1300, 'outputTokens': 370}}
    assert asked == [('serial.vote_summary', SUMMARY_INSTRUCTIONS), ('writing_editing.plan', PLAN_INSTRUCTIONS),
                     ('writing_editing.draft', DRAFT_INSTRUCTIONS), ('serial.episode_review_v2', REVIEW_INSTRUCTIONS)]
    summary, plan, draft, review = (sent(call)[1] for call in calls)
    assert set(summary) == {'episodeNumber', 'choice', 'proposals'}  # 공개되는 종합 문장은 연재 방향·작품 문맥을 보지 못한다
    assert summary['choice'] == CHOICE and [p['likes'] for p in summary['proposals']] == [2, 1] and summary['proposals'][1]['scene'] == '서윤이 입을 열었다.'
    # 1위 선택지는 기획 요청의 맨 앞에 글자 그대로 들어가고, 소유자의 연재 방향, 제안 종합이 뒤따른다.
    request = plan['request']
    assert request.index(CHOICE['text']) < request.index('서윤의 성장 이야기') < request.index(SUMMARY[0]['summary'])
    assert plan['single'] is True and plan['context'] == CONTEXT and draft['context'] == CONTEXT
    # 문맥의 이전 회차 요약(summaries)과 관련 장면(related)은 쓰는 법을 요청 자료로 알린다(Writing 지시는 그대로이므로).
    assert 'summaries' in plan['request'] and 'related' in plan['request'] and 'summaries' in draft['plan'] and 'related' in draft['plan']
    # 집필 요청은 계획에 분량·되풀이 금지·중심 전개 조건을 붙인다(Writing 집필 지시는 plan의 분량 요청을 따른다).
    assert '진실의 밤' in draft['plan'] and '1. 서윤이 망설인다' in draft['plan']
    assert '최소 2,500자' in draft['plan'] and '되풀이하지 않고' in draft['plan'] and CHOICE['text'] in draft['plan']
    assert review == {'episodeNumber': 2, 'title': '진실의 밤', 'text': DRAFT[0], 'choice': CHOICE['text'], 'context': CONTEXT}


def test_the_serial_draft_gets_a_larger_output_budget_than_writings_default(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode()

    plan_init, draft_init = calls[1]['init'], calls[2]['init']
    assert (plan_init['max_tokens'], plan_init['timeout']) == (4000, 50)  # 기획은 Writing 기본 그대로
    assert (draft_init['max_tokens'], draft_init['timeout']) == (8000, 180)  # 직전 회차 분량의 원고가 잘리지 않게


def test_without_a_vote_result_nothing_asks_for_a_central_development(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode(choice=None)

    summary, plan, draft, review = (sent(call)[1] for call in calls)
    assert summary['choice'] is None and review['choice'] is None
    assert '중심 전개' not in plan['request'] and '중심 전개' not in draft['plan']


def test_without_a_choice_and_proposals_the_summary_call_is_skipped(monkeypatch):
    calls = answers(monkeypatch, PLAN, DRAFT, PASS)

    result = run_episode(choice=None, proposals=[])

    assert len(calls) == 3 and result.summary == service.NO_INPUT


def test_a_choice_alone_is_still_summarized(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode(proposals=[])

    assert len(calls) == 4 and sent(calls[0])[1]['proposals'] == []


def test_a_short_draft_fails_the_review_without_a_model_review_and_is_rewritten_once_with_its_length_in_the_issues(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, SHORT, REWRITE, PASS)

    result = run_episode()

    assert (result.text, result.review.passed) == (REWRITE[0], True) and len(calls) == 5  # 다시 쓸 원고에는 모델 검수를 쓰지 않는다
    assert f'분량이 {len(SHORT[0])}자로 최소 2,500자에 못 미친다' in sent(calls[3])[1]['plan']
    assert sent(calls[4])[0] == REVIEW_INSTRUCTIONS and sent(calls[4])[1]['text'] == REWRITE[0]
    assert result.credits == 2.27 and result.usage.model_dump() == {'inputTokens': 1700, 'outputTokens': 570}


def test_two_short_drafts_are_422_review_failed(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, SHORT, SHORT)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, error.value.code) == (422, 'SERIAL_REVIEW_FAILED') and len(calls) == 4


@pytest.mark.parametrize('length, model_calls', [(2499, 5), (2500, 4)])
def test_the_minimum_length_is_2500_characters(monkeypatch, length, model_calls):
    draft = (story('서윤이 말했다.', length), 400, 200)
    calls = answers(monkeypatch, SUMMARY, PLAN, draft, *([REWRITE] if length < 2500 else []), PASS)

    result = run_episode()

    assert len(calls) == model_calls and result.review.passed


def test_a_failed_review_rewrites_once_from_the_same_plan_with_the_issues_then_reviews_the_new_text(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, FAIL, REWRITE, PASS)

    result = run_episode()

    assert (result.title, result.text, result.review.passed) == ('진실의 밤', REWRITE[0], True)
    instructions, rewrite = sent(calls[4])
    assert instructions == DRAFT_INSTRUCTIONS and '진실의 밤' in rewrite['plan'] and '1. 서윤이 망설인다' in rewrite['plan']
    assert '검수에서 지적된 문제를 고쳐 다시 쓴다' in rewrite['plan'] and FAIL[0]['issues'][0] in rewrite['plan']
    assert CHOICE['text'] in rewrite['plan'] and rewrite['context'] == CONTEXT
    assert sent(calls[5])[1]['text'] == REWRITE[0]
    assert result.credits == 2.8 and result.usage.model_dump() == {'inputTokens': 2200, 'outputTokens': 600}  # 여섯 호출 모두 센다


def test_two_failed_reviews_are_422_review_failed_with_a_fixed_phrase(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, FAIL, REWRITE, FAIL)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, error.value.code, str(error.value)) == (422, 'SERIAL_REVIEW_FAILED', '검수를 통과하지 못했습니다.')
    assert len(calls) == 6  # 원고는 한 번만 다시 쓴다


def test_the_credit_limit_ends_the_run_with_402_before_the_next_model_call(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN)  # 종합 0.15 → 기획 0.4 = 0.55: 상한 0.2를 넘어 집필 호출은 없다

    with pytest.raises(SerialFailure) as error:
        run_episode(creditLimit=0.2)

    assert (error.value.status, error.value.code, str(error.value)) == (402, 'CREDIT_LIMIT_EXCEEDED', '크레딧 상한을 넘었습니다.')
    assert len(calls) == 2


@pytest.mark.parametrize('replies, message', [
    ([({'summary': '  '}, 10, 5)], '투표·제안 종합 모델 응답을 확인할 수 없습니다.'),
    ([({'summary': '가' * 1001}, 10, 5)], '투표·제안 종합 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, ({'plans': [{'title': '가' * 121, 'beats': ['장면']}], 'notes': []}, 10, 5)], '기획 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, ({'plans': [{'title': '  ', 'beats': ['장면']}], 'notes': []}, 10, 5)], '기획 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, PLAN, DRAFT, ({'passed': False, 'issues': []}, 10, 5)], '검수 모델 응답을 확인할 수 없습니다.'),
], ids=['empty-summary', 'long-summary', 'long-title', 'blank-title', 'failed-review-without-issues'])
def test_a_result_that_breaks_the_rules_is_a_fixed_502_not_a_corrected_one(monkeypatch, replies, message):
    answers(monkeypatch, *replies)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (502, message)


def test_the_longest_direction_choice_summary_plan_and_issues_still_fit_the_writing_request_limits(monkeypatch):
    long_summary = ({'summary': '라' * 1000}, 100, 50)
    long_plan = ({'plans': [{'title': '진실의 밤', 'beats': ['가' * 300] * 12}], 'notes': []}, 300, 100)
    long_issues = ({'passed': False, 'issues': ['나' * 300] * 8}, 500, 30)
    calls = answers(monkeypatch, long_summary, long_plan, DRAFT, long_issues, REWRITE, PASS)

    run_episode(direction='다' * 2000, choice={'text': '마' * 300, 'votes': 1})

    request = sent(calls[1])[1]['request']
    assert len(request) <= 2000 and '마' * 300 in request  # 기획 요청 한도: 중심 전개(선택지)는 잘리지 않는다
    rewrite_plan = sent(calls[4])[1]['plan']
    assert len(rewrite_plan) <= 4000  # 집필 계획 한도
    assert rewrite_plan.count('나' * 200) == 5 and '나' * 201 not in rewrite_plan  # 지적은 앞 5개·각 200자


def test_summarize_writes_a_short_plot_summary_of_a_published_episode_and_confirms_credits(monkeypatch):
    asked = []
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt(default))
    calls = answers(monkeypatch, EPISODE_SUMMARY)

    result = summarize()

    assert result.model_dump() == {'summary': EPISODE_SUMMARY[0]['summary'], 'credits': 0.18, 'usage': {'inputTokens': 120, 'outputTokens': 60}}
    assert asked == [('serial.episode_summary', EPISODE_SUMMARY_INSTRUCTIONS)]
    instructions, data = sent(calls[0])
    assert instructions == EPISODE_SUMMARY_INSTRUCTIONS and data == {'episodeNumber': 3, 'title': '3화', 'body': '서윤이 편지를 발견했다.'}


def test_a_summary_of_exactly_400_characters_is_accepted(monkeypatch):
    answers(monkeypatch, ({'summary': '가' * 400}, 10, 5))

    assert summarize().summary == '가' * 400


@pytest.mark.parametrize('summary', ['  ', '가' * 401])
def test_a_summary_outside_the_rules_is_a_fixed_502_and_is_not_trimmed(monkeypatch, summary):
    answers(monkeypatch, ({'summary': summary}, 10, 5))

    with pytest.raises(SerialFailure) as error:
        summarize()

    assert (error.value.status, str(error.value)) == (502, '회차 요약 모델 응답을 확인할 수 없습니다.')


def test_the_summary_credit_is_capped_at_the_reserved_limit(monkeypatch):
    answers(monkeypatch, ({'summary': '줄거리 요약'}, 4000, 500))  # 회차 원문 하나가 기본 상한 3크레딧을 넘는다

    result = summarize(creditLimit=3)

    assert result.credits == 3 and result.usage.inputTokens == 4000


@pytest.mark.parametrize('instructions', [CHOICES_INSTRUCTIONS, SIMULATION_INSTRUCTIONS, REVIEW_INSTRUCTIONS], ids=['choices', 'simulation', 'review'])
def test_the_prompts_that_read_the_context_say_how_to_use_summaries_and_related(instructions):
    assert 'summaries' in instructions and 'related' in instructions and '그대로 베끼지 않는다' in instructions
