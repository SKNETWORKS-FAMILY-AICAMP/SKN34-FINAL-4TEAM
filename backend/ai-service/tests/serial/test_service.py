"""#659 자율 연재 실행 흐름: 장면 미리보기, 의견 종합 → 기획·원고 → 검수(1회 재작성), 요청 안 모든 모델 호출의 크레딧 누적·상한."""

import pytest

from app import tracing
from app.serial import service
from app.serial.errors import SerialFailure
from app.serial.models import EpisodeRequest, SimulationRequest
from app.serial.prompt import REVIEW_INSTRUCTIONS, SIMULATION_INSTRUCTIONS, SUMMARY_INSTRUCTIONS
from app.writing.prompt import DRAFT_INSTRUCTIONS, PLAN_INSTRUCTIONS

from .stubs import CONTEXT, DRAFT, FAIL, PASS, PLAN, REWRITE, SUMMARY, answers, episode, sent, simulation


def simulate(**overrides):
    return service.simulate(SimulationRequest.model_validate(simulation(**overrides)))


def run_episode(**overrides):
    return service.episode(EpisodeRequest.model_validate(episode(**overrides)))


def test_simulation_writes_a_scene_from_the_public_context_and_confirms_credits(monkeypatch):
    calls = answers(monkeypatch, ('서윤이 입을 열었다.', 1000, 500))

    result = simulate()

    assert result.model_dump() == {'scene': '서윤이 입을 열었다.', 'credits': 1.5, 'usage': {'inputTokens': 1000, 'outputTokens': 500}}
    instructions, data = sent(calls[0])
    # 모델은 전제·비트·공개 문맥만 받는다(작품·예약·상한 정보는 보내지 않는다).
    assert instructions == SIMULATION_INSTRUCTIONS
    assert data == {'episodeNumber': 2, 'premise': '서윤이 비밀을 털어놓는다', 'beats': ['망설임', '고백'], 'context': CONTEXT}


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


def test_episode_chains_summary_plan_draft_and_review_and_confirms_credits_over_all_of_them(monkeypatch):
    asked = []
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt(default))
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    result = run_episode()

    assert result.model_dump() == {'summary': SUMMARY[0]['summary'], 'title': '진실의 밤', 'text': DRAFT[0], 'review': {'passed': True, 'issues': []},
                                   'credits': 1.67, 'usage': {'inputTokens': 1300, 'outputTokens': 370}}
    assert asked == [('serial.summary', SUMMARY_INSTRUCTIONS), ('writing_editing.plan', PLAN_INSTRUCTIONS),
                     ('writing_editing.draft', DRAFT_INSTRUCTIONS), ('serial.review', REVIEW_INSTRUCTIONS)]
    summary, plan, draft, review = (sent(call)[1] for call in calls)
    assert set(summary) == {'episodeNumber', 'opinions'}  # 공개되는 종합 문장은 연재 방향·작품 문맥을 보지 못한다
    assert [o['votes'] for o in summary['opinions']] == [3, 1] and summary['opinions'][1]['scene'] == '서윤이 입을 열었다.'
    assert SUMMARY[0]['summary'] in plan['request'] and '서윤의 성장 이야기' in plan['request'] and plan['single'] is True
    assert plan['context'] == CONTEXT and draft['context'] == CONTEXT
    assert '진실의 밤' in draft['plan'] and '1. 서윤이 망설인다' in draft['plan']
    assert review == {'episodeNumber': 2, 'title': '진실의 밤', 'text': DRAFT[0], 'context': CONTEXT}


def test_without_opinions_the_summary_call_is_skipped(monkeypatch):
    calls = answers(monkeypatch, PLAN, DRAFT, PASS)

    result = run_episode(opinions=[])

    assert len(calls) == 3 and result.summary == service.NO_OPINIONS


def test_a_failed_review_rewrites_once_from_the_same_plan_with_the_issues_then_reviews_the_new_text(monkeypatch):
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, FAIL, REWRITE, PASS)

    result = run_episode()

    assert (result.title, result.text, result.review.passed) == ('진실의 밤', REWRITE[0], True)
    instructions, rewrite = sent(calls[4])
    assert instructions == DRAFT_INSTRUCTIONS and '진실의 밤' in rewrite['plan'] and '1. 서윤이 망설인다' in rewrite['plan']
    assert FAIL[0]['issues'][0] in rewrite['plan'] and rewrite['context'] == CONTEXT
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
    ([({'summary': '  '}, 10, 5)], '의견 종합 모델 응답을 확인할 수 없습니다.'),
    ([({'summary': '가' * 1001}, 10, 5)], '의견 종합 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, ({'plans': [{'title': '가' * 121, 'beats': ['장면']}], 'notes': []}, 10, 5)], '기획 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, ({'plans': [{'title': '  ', 'beats': ['장면']}], 'notes': []}, 10, 5)], '기획 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, PLAN, DRAFT, ({'passed': False, 'issues': []}, 10, 5)], '검수 모델 응답을 확인할 수 없습니다.'),
], ids=['empty-summary', 'long-summary', 'long-title', 'blank-title', 'failed-review-without-issues'])
def test_a_result_that_breaks_the_rules_is_a_fixed_502_not_a_corrected_one(monkeypatch, replies, message):
    answers(monkeypatch, *replies)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (502, message)


def test_the_longest_direction_and_plan_and_issues_still_fit_the_writing_request_limits(monkeypatch):
    long_plan = ({'plans': [{'title': '진실의 밤', 'beats': ['가' * 300] * 12}], 'notes': []}, 300, 100)
    long_issues = ({'passed': False, 'issues': ['나' * 300] * 8}, 500, 30)
    calls = answers(monkeypatch, SUMMARY, long_plan, DRAFT, long_issues, REWRITE, PASS)

    run_episode(direction='다' * 2000)

    assert len(sent(calls[1])[1]['request']) <= 2000  # 기획 요청 한도
    rewrite_plan = sent(calls[4])[1]['plan']
    assert len(rewrite_plan) <= 4000  # 집필 계획 한도
    assert rewrite_plan.count('\n- ') == 5 and '나' * 200 in rewrite_plan and '나' * 201 not in rewrite_plan  # 지적은 앞 5개·각 200자
