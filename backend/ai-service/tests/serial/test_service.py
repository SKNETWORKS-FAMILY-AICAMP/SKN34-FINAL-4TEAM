"""#659 자율 연재 실행 흐름: 선택지, 회차 요약, 장면 미리보기, 투표·제안 종합 → 기획 → 인물 시뮬레이션 → 장면을 뼈대로 집필(최소 분량, 모자라면 분량 재작성 1회) → 검수(검수 재작성 1회), 요청 안 모든 모델 호출의 크레딧 누적·상한."""

import asyncio
from types import SimpleNamespace

import pytest

from app import tracing
from app.serial import service
from app.serial.errors import SerialFailure
from app.serial.models import ChoicesRequest, EpisodeRequest, SimulationRequest, SummaryRequest
from app.serial.prompt import (CHOICES_INSTRUCTIONS, DRAFT_INSTRUCTIONS, EPISODE_SUMMARY_INSTRUCTIONS, REVIEW_INSTRUCTIONS, SIMULATION_INSTRUCTIONS,
                               SUMMARY_INSTRUCTIONS)
from app.simulation import service as simulation
from app.simulation.errors import SimulationFailure
from app.simulation.models import PlanDraft
from app.writing.prompt import PLAN_INSTRUCTIONS

from .stubs import (CHOICE, CHOICES, CONTEXT, DRAFT, EPISODE_SUMMARY, FAIL, KAEL, LINA, PASS, PLAN, REWRITE, SCENE, SHORT, SUMMARY, WORLD, answers,
                    choices_request, episode, sent, simulation as simulation_request, staged_engine, story, summaries_request)

ENGINE_CALLS = 13  # 대역 엔진이 한 장면(나레이션 → 카엘 → 리나 → 나레이션)에 부르는 모델 호출: 계획 1·연출 4·나레이션 2·인물 2·검사 4, 호출마다 1,100토큰
SHORT_ISSUE = f'분량이 {len(SHORT[0])}자로 최소 5,000자에 못 미친다. 비트마다 장면을 풀어 5,000자 이상으로 쓴다.'  # 분량 재작성이 받는 지적


def choices(**overrides):
    return service.choices(ChoicesRequest.model_validate(choices_request(**overrides)))


def summarize(**overrides):
    return service.summarize(SummaryRequest.model_validate(summaries_request(**overrides)))


def simulate(**overrides):
    return service.simulate(SimulationRequest.model_validate(simulation_request(**overrides)))


def run_episode(**overrides):
    return asyncio.run(service.episode(EpisodeRequest.model_validate(episode(**overrides))))


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


def test_episode_runs_summary_plan_simulation_draft_and_review_in_that_order_and_the_scene_is_the_skeleton(monkeypatch):
    order = []
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: order.append(name) or tracing.Prompt(default))
    engine = staged_engine(monkeypatch, order=order)
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    result = run_episode()

    assert result.model_dump() == {'summary': SUMMARY[0]['summary'], 'title': '진실의 밤', 'text': DRAFT[0], 'review': {'passed': True, 'issues': []},
                                   'credits': 15.97, 'usage': {'inputTokens': 14300, 'outputTokens': 1670}}  # 시뮬레이션의 모든 모델 호출도 같은 크레딧에 센다
    assert engine.events == ENGINE_CALLS
    assert engine.recalled and {episode for _, episode in engine.recalled} == {1}  # 세계관은 직전 발행 회차(2화 → 1화) 시점으로 연기한다
    assert [name for name in order if not name.startswith('sim.')] == [
        'serial.vote_summary', 'writing_editing.plan', 'serial.episode_draft', 'serial.episode_review_v3']
    last_sim = max(i for i, name in enumerate(order) if name.startswith('sim.'))
    assert order.index('writing_editing.plan') < order.index('sim.plan') and last_sim < order.index('serial.episode_draft')  # 기획 뒤, 집필 앞
    summary, plan, draft, review = (sent(call)[1] for call in calls)
    assert set(summary) == {'episodeNumber', 'choice', 'proposals'}  # 공개되는 종합 문장은 연재 방향·작품 문맥을 보지 못한다
    assert summary['choice'] == CHOICE and [p['likes'] for p in summary['proposals']] == [2, 1] and summary['proposals'][1]['scene'] == '서윤이 입을 열었다.'
    # 1위 선택지는 기획 요청의 맨 앞에 글자 그대로 들어가고, 소유자의 연재 방향, 제안 종합이 뒤따른다.
    request = plan['request']
    assert request.index(CHOICE['text']) < request.index('서윤의 성장 이야기') < request.index(SUMMARY[0]['summary'])
    assert '비트는 6~10개' in request and 'summaries' in request and 'related' in request
    assert plan['single'] is True and plan['context'] == CONTEXT
    # 시뮬레이션 계획 모델은 1위 선택지와 추천 상위 제안 글로 만든 요청 문장과 연결 세계관의 활성 인물(id·이름)만 본다.
    asked = engine.plan[0]
    assert CHOICE['text'] in asked['request'] and '고백 장면' in asked['request'] and '새벽의 대화' in asked['request']
    assert asked['characters'] == [{'id': KAEL, 'name': '카엘'}, {'id': LINA, 'name': '리나'}]
    # 집필은 시뮬레이션 장면(나레이션·독백·대사 문단)을 뼈대로 받고, 계획·중심 전개·분량을 함께 받는다.
    assert draft == {'episodeNumber': 2, 'title': '진실의 밤', 'beats': ['서윤이 망설인다', '진실을 털어놓는다'], 'scene': SCENE, 'minChars': 5000,
                     'centralDevelopment': CHOICE['text'], 'context': CONTEXT}
    assert review == {'episodeNumber': 2, 'title': '진실의 밤', 'scene': SCENE, 'text': DRAFT[0], 'choice': CHOICE['text'], 'context': CONTEXT}
    assert sent(calls[2])[0] == DRAFT_INSTRUCTIONS and sent(calls[3])[0] == REVIEW_INSTRUCTIONS


def test_the_serial_draft_gets_a_larger_output_budget_than_writings_default(monkeypatch):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode()

    plan_init, draft_init = calls[1]['init'], calls[2]['init']
    assert (plan_init['max_tokens'], plan_init['timeout']) == (4000, 50)  # 기획은 Writing 기본 그대로
    assert (draft_init['max_tokens'], draft_init['timeout']) == (12000, 195)  # 5,000자 이상 원고(추론 토큰 포함)가 잘리지 않게


def test_without_a_vote_result_nothing_asks_for_a_central_development(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode(choice=None)

    summary, plan, draft, review = (sent(call)[1] for call in calls)
    assert summary['choice'] is None and review['choice'] is None and draft['centralDevelopment'] is None
    assert '중심 전개' not in plan['request'] and '중심 전개' not in engine.plan[0]['request']


def test_without_a_choice_and_proposals_the_summary_call_is_skipped_and_the_simulation_follows_the_plan(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, PLAN, DRAFT, PASS)

    result = run_episode(choice=None, proposals=[])

    assert len(calls) == 3 and result.summary == service.NO_INPUT
    assert engine.plan[0]['request'] == '진실의 밤\n서윤이 망설인다\n진실을 털어놓는다'  # 독자 입력이 없으면 기획의 제목·비트로 한다


def test_a_simulation_proposal_without_a_body_gives_the_opening_of_its_scene_to_the_plan_request(monkeypatch):
    engine = staged_engine(monkeypatch)
    answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode(proposals=[{'title': '새벽의 대화', 'body': '', 'likes': 1, 'scene': '서윤이 입을 열었다. ' + '가' * 400}])

    request = engine.plan[0]['request']
    assert '독자 제안 「새벽의 대화」: 서윤이 입을 열었다. ' in request and '가' * 300 not in request  # 장면의 앞부분 300자까지


def test_a_choice_alone_is_still_summarized(monkeypatch):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    run_episode(proposals=[])

    assert len(calls) == 4 and sent(calls[0])[1]['proposals'] == []


def test_a_world_without_active_character_cards_fails_with_the_engines_phrase_before_any_model_call(monkeypatch):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch)

    with pytest.raises(SimulationFailure) as error:
        run_episode(world={**WORLD, 'cards': []})

    assert (error.value.status, str(error.value)) == (409, simulation.NO_CHARACTERS) and calls == []


def test_a_simulation_plan_the_model_returned_in_an_unusable_shape_is_a_502_and_not_corrected(monkeypatch):
    staged_engine(monkeypatch, plan=SimpleNamespace(model_dump=lambda: {'mode': '엉뚱한 모드'}))
    calls = answers(monkeypatch, SUMMARY, PLAN)

    with pytest.raises(SimulationFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (502, simulation.BAD_PLAN) and len(calls) == 2


def test_a_simulation_plan_the_world_does_not_allow_fails_as_the_engine_says_and_is_not_corrected(monkeypatch):
    staged_engine(monkeypatch, plan=PlanDraft(mode='if', premise='만약?', beats=[], characterIds=['낯선 인물']))
    calls = answers(monkeypatch, SUMMARY, PLAN)

    with pytest.raises(SimulationFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (422, simulation.INVALID_PLAN) and len(calls) == 2  # 집필은 시작하지 않는다


def test_a_scene_that_does_not_finish_fails_with_the_engines_reason_and_nothing_is_written(monkeypatch):
    engine = staged_engine(monkeypatch, fail_checks=True)
    calls = answers(monkeypatch, SUMMARY, PLAN)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert error.value.status == 502 and '검사를 통과하지 못해 멈췄어요' in str(error.value)
    assert len(calls) == 2 and engine.events > 0  # 장면 이후(집필·검수)는 시작하지 않는다


def test_a_scene_the_agent_leaves_running_fails_with_a_fixed_phrase_and_nothing_is_written(monkeypatch):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN)

    class Stalled:  # 호출 한도(안전망)가 끊어 이어 갈 장면인 채로 끝난 경우: 장면 그대로 돌려준다
        async def ainvoke(self, seed, *args, **kwargs):
            return seed

    monkeypatch.setattr(service, 'scene_agent', lambda pausing: Stalled())

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (502, service.SCENE_UNFINISHED) and len(calls) == 2


def test_a_scene_that_runs_past_its_time_limit_fails_as_a_timeout(monkeypatch):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN)

    class Endless:
        async def ainvoke(self, *args, **kwargs):
            await asyncio.sleep(30)

    monkeypatch.setattr(service, 'SIMULATION_TIMEOUT', 0.05)
    monkeypatch.setattr(service, 'scene_agent', lambda pausing: Endless())

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (504, '인물 시뮬레이션이 제한 시간 안에 끝나지 않았습니다.') and len(calls) == 2


def test_a_short_first_draft_is_rewritten_once_for_its_length_alone_before_any_model_review(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, SHORT, REWRITE, PASS)

    result = run_episode()

    assert (result.text, result.review.passed) == (REWRITE[0], True) and len(calls) == 5  # 다시 쓸 원고에는 모델 검수를 쓰지 않는다
    rewrite = sent(calls[3])[1]
    assert rewrite['issues'] == [SHORT_ISSUE] and rewrite['scene'] == SCENE
    assert sent(calls[4])[0] == REVIEW_INSTRUCTIONS and sent(calls[4])[1]['text'] == REWRITE[0]
    assert result.credits == 16.57 and result.usage.model_dump() == {'inputTokens': 14700, 'outputTokens': 1870} and engine.events == ENGINE_CALLS


def test_a_short_first_draft_is_lengthened_before_the_review_so_a_failed_review_still_gets_its_own_rewrite(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, SHORT, DRAFT, FAIL, REWRITE, PASS)

    result = run_episode()

    assert (result.text, result.review.passed) == (REWRITE[0], True) and len(calls) == 7  # 집필 3회(첫 원고·분량 재작성·검수 재작성), 모델 검수 2회
    assert [sent(call)[0] for call in calls[2:]] == [DRAFT_INSTRUCTIONS, DRAFT_INSTRUCTIONS, REVIEW_INSTRUCTIONS, DRAFT_INSTRUCTIONS, REVIEW_INSTRUCTIONS]
    assert sent(calls[3])[1]['issues'] == [SHORT_ISSUE]  # 분량 재작성은 분량 지적만 받고
    assert sent(calls[4])[1]['text'] == DRAFT[0]  # 첫 모델 검수는 늘린 원고를 본다
    assert sent(calls[5])[1]['issues'] == FAIL[0]['issues']  # 검수 재작성은 분량 지적이 아니라 검수 지적을 받는다
    assert result.credits == 17.7 and result.usage.model_dump() == {'inputTokens': 15600, 'outputTokens': 2100} and engine.events == ENGINE_CALLS  # 장면은 한 번만 돈다


@pytest.mark.parametrize('replies, model_reviews', [([SHORT, SHORT], 0), ([DRAFT, FAIL, SHORT], 1)], ids=['short-after-length-rewrite', 'short-after-review-rewrite'])
def test_a_draft_still_short_after_its_one_rewrite_is_422_and_gets_no_model_review_or_third_write(monkeypatch, replies, model_reviews):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, *replies)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, error.value.code, str(error.value)) == (422, 'SERIAL_REVIEW_FAILED', '검수를 통과하지 못했습니다.')
    instructions = [sent(call)[0] for call in calls[2:]]
    assert instructions.count(DRAFT_INSTRUCTIONS) == 2 and instructions.count(REVIEW_INSTRUCTIONS) == model_reviews


@pytest.mark.parametrize('length, model_calls', [(4999, 5), (5000, 4)])
def test_the_minimum_length_is_5000_characters(monkeypatch, length, model_calls):
    staged_engine(monkeypatch)
    draft = (story('서윤이 말했다.', length), 400, 200)
    calls = answers(monkeypatch, SUMMARY, PLAN, draft, *([REWRITE] if length < 5000 else []), PASS)

    result = run_episode()

    assert len(calls) == model_calls and result.review.passed


def test_a_failed_review_rewrites_once_from_the_same_scene_with_the_issues_then_reviews_the_new_text(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, FAIL, REWRITE, PASS)

    result = run_episode()

    assert (result.title, result.text, result.review.passed) == ('진실의 밤', REWRITE[0], True)
    instructions, rewrite = sent(calls[4])
    assert instructions == DRAFT_INSTRUCTIONS and rewrite['scene'] == SCENE and rewrite['beats'] == ['서윤이 망설인다', '진실을 털어놓는다']
    assert rewrite['issues'] == FAIL[0]['issues'] and rewrite['centralDevelopment'] == CHOICE['text'] and rewrite['context'] == CONTEXT
    assert sent(calls[5])[1]['text'] == REWRITE[0] and sent(calls[5])[1]['scene'] == SCENE
    assert engine.events == ENGINE_CALLS  # 장면은 다시 돌리지 않는다
    assert result.credits == 17.1 and result.usage.model_dump() == {'inputTokens': 15200, 'outputTokens': 1900}  # 집필·검수 여섯 호출과 시뮬레이션을 모두 센다


def test_two_failed_reviews_are_422_review_failed_with_a_fixed_phrase(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, DRAFT, FAIL, REWRITE, FAIL)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, error.value.code, str(error.value)) == (422, 'SERIAL_REVIEW_FAILED', '검수를 통과하지 못했습니다.')
    assert len(calls) == 6 and engine.events == ENGINE_CALLS  # 원고는 한 번만 다시 쓰고 장면은 한 번만 돈다


def test_the_credit_limit_ends_the_run_before_the_simulation_starts_when_the_earlier_calls_used_it_up(monkeypatch):
    engine = staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN)  # 종합 0.15 → 기획 0.4 = 0.55: 상한 0.2를 넘었다

    with pytest.raises(SerialFailure) as error:
        run_episode(creditLimit=0.2)

    assert (error.value.status, error.value.code, str(error.value)) == (402, 'CREDIT_LIMIT_EXCEEDED', '크레딧 상한을 넘었습니다.')
    assert len(calls) == 2 and engine.events == 0


def test_the_credit_limit_stops_the_simulation_right_after_the_call_that_reaches_it(monkeypatch):
    engine = staged_engine(monkeypatch, tokens=(100000, 100))  # 엔진 호출 하나가 100.1크레딧
    calls = answers(monkeypatch, SUMMARY, PLAN)

    with pytest.raises(SerialFailure) as error:
        run_episode(creditLimit=150)

    assert (error.value.status, error.value.code) == (402, 'CREDIT_LIMIT_EXCEEDED')
    assert engine.events == 2 and len(calls) == 2  # 계획 → 연출 첫 호출이 150을 넘기면 그다음 호출은 없고 집필도 시작하지 않는다


@pytest.mark.parametrize('replies, message', [
    ([({'summary': '  '}, 10, 5)], '투표·제안 종합 모델 응답을 확인할 수 없습니다.'),
    ([({'summary': '가' * 1001}, 10, 5)], '투표·제안 종합 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, ({'plans': [{'title': '가' * 121, 'beats': ['장면']}], 'notes': []}, 10, 5)], '기획 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, ({'plans': [{'title': '  ', 'beats': ['장면']}], 'notes': []}, 10, 5)], '기획 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, PLAN, ('  ', 400, 200)], '집필 모델 응답을 확인할 수 없습니다.'),
    ([SUMMARY, PLAN, DRAFT, ({'passed': False, 'issues': []}, 10, 5)], '검수 모델 응답을 확인할 수 없습니다.'),
], ids=['empty-summary', 'long-summary', 'long-title', 'blank-title', 'blank-draft', 'failed-review-without-issues'])
def test_a_result_that_breaks_the_rules_is_a_fixed_502_not_a_corrected_one(monkeypatch, replies, message):
    staged_engine(monkeypatch)
    answers(monkeypatch, *replies)

    with pytest.raises(SerialFailure) as error:
        run_episode()

    assert (error.value.status, str(error.value)) == (502, message)


def test_the_longest_direction_choice_summary_plan_and_issues_still_fit_the_request_limits(monkeypatch):
    staged_engine(monkeypatch)
    long_summary = ({'summary': '라' * 1000}, 100, 50)
    long_plan = ({'plans': [{'title': '진실의 밤', 'beats': ['가' * 300] * 12}], 'notes': []}, 300, 100)
    long_issues = ({'passed': False, 'issues': ['나' * 300] * 8}, 500, 30)
    calls = answers(monkeypatch, long_summary, long_plan, DRAFT, long_issues, REWRITE, PASS)

    run_episode(direction='다' * 2000, choice={'text': '마' * 300, 'votes': 1})

    request = sent(calls[1])[1]['request']
    assert len(request) <= 2000 and '마' * 300 in request  # 기획 요청 한도: 중심 전개(선택지)는 잘리지 않는다
    assert sent(calls[4])[1]['issues'] == ['나' * 200] * 5  # 지적은 앞 5개·각 200자


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


@pytest.mark.parametrize('instructions', [CHOICES_INSTRUCTIONS, SIMULATION_INSTRUCTIONS, DRAFT_INSTRUCTIONS, REVIEW_INSTRUCTIONS],
                         ids=['choices', 'simulation', 'draft', 'review'])
def test_the_prompts_that_read_the_context_say_how_to_use_summaries_and_related(instructions):
    assert 'summaries' in instructions and 'related' in instructions and '그대로 베끼지 않는다' in instructions


@pytest.mark.parametrize('instructions', [DRAFT_INSTRUCTIONS, REVIEW_INSTRUCTIONS], ids=['draft', 'review'])
def test_the_draft_and_review_prompts_are_about_the_simulated_scene(instructions):
    assert 'scene' in instructions and '시뮬레이션' in instructions


def test_the_worst_case_total_of_model_timeouts_fits_the_content_read_limit(monkeypatch):
    # 가장 긴 경로(종합 → 기획 → 시뮬레이션 계획·장면 → 집필 → 분량 재작성 → 검수 실패 → 검수 재작성 → 재검수): 호출마다 정한 timeout과 장면의 시간 상한을 더한 합이
    # Content 읽기 한도 35분(2,100초)에서 4분 여유를 둔 안에 든다. 시뮬레이션 계획 호출(app/simulation/agent.plan)의 timeout은 40초다.
    staged_engine(monkeypatch)
    calls = answers(monkeypatch, SUMMARY, PLAN, SHORT, DRAFT, FAIL, REWRITE, PASS)

    run_episode()

    total = sum(call['init']['timeout'] for call in calls) + 40 + service.SIMULATION_TIMEOUT
    assert len(calls) == 7 and total <= 35 * 60 - 240
