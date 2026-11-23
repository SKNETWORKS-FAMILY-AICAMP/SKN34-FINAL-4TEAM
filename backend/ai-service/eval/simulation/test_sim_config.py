"""설정 A~E·실행 계획·예상 금액의 순수 로직 단위 테스트. 모델·네트워크 호출이 없다."""

import os

import pytest

import sim_config as c
from cost import usd
from run_timechara import JUDGE_TOKENS
from sim_config import ATTEMPTS, CONFIGS, SWITCHES, applied, estimate_quality, estimate_speed, plan_runs

SIZES = {'act_in': 10_000, 'check_in': 20_000, 'narrate_in': 10_000}


def test_configs_stack_one_switch_at_a_time_on_top_of_the_current_behaviour():
    assert CONFIGS['A'] == {}  # 모두 끔 = 지금 동작
    assert CONFIGS['B'] == {c.EFFORT: 'low'}
    assert CONFIGS['C'] == {**CONFIGS['B'], c.SKIP_DIRECTOR: '1'}
    assert CONFIGS['D'] == {**CONFIGS['C'], c.WORLD_CACHE: '1'}
    assert CONFIGS['E'] == {**CONFIGS['D'], c.SKIP_NARRATION: '1'}
    assert set(SWITCHES) == {'SIMULATION_REASONING_EFFORT', 'SIMULATION_SKIP_FORCED_DIRECTOR', 'SIMULATION_WORLD_CACHE', 'SIMULATION_SKIP_NARRATION_CHECK'}


def test_a_config_sets_exactly_its_switches_and_puts_the_environment_back(monkeypatch):
    monkeypatch.setenv(c.SKIP_DIRECTOR, '1')  # 셸에 남은 값
    monkeypatch.delenv(c.EFFORT, raising=False)
    with applied('A'):
        assert all(name not in os.environ for name in SWITCHES)  # A는 셸에 남은 스위치도 끈다
    assert os.environ[c.SKIP_DIRECTOR] == '1'
    with applied('E'):
        assert {name: os.environ.get(name) for name in SWITCHES} == {c.EFFORT: 'low', c.SKIP_DIRECTOR: '1', c.WORLD_CACHE: '1', c.SKIP_NARRATION: '1'}
    assert c.EFFORT not in os.environ and os.environ[c.SKIP_DIRECTOR] == '1' and c.WORLD_CACHE not in os.environ


def test_the_environment_is_restored_even_when_the_run_fails(monkeypatch):
    monkeypatch.delenv(c.EFFORT, raising=False)
    with pytest.raises(RuntimeError):
        with applied('B'):
            raise RuntimeError
    assert c.EFFORT not in os.environ


def test_configs_that_differ_only_in_a_switch_the_suite_never_reaches_are_run_once():
    every = list('ABCDE')
    # 품질은 인물 턴 경로뿐이라 추론 강도만 닿는다: C·D·E는 B와 같은 실행이다.
    assert plan_runs(every, 'quality') == {'A': 'A', 'B': 'B', 'C': 'B', 'D': 'B', 'E': 'B'}
    # 속도는 세계관을 Content에서 읽지 않아 캐시(D)만 효과가 없다: D는 C와 같은 실행이다.
    assert plan_runs(every, 'speed') == {'A': 'A', 'B': 'B', 'C': 'C', 'D': 'C', 'E': 'E'}
    assert plan_runs(['D', 'E'], 'speed') == {'D': 'D', 'E': 'E'}  # 앞서 고른 설정이 없으면 자기 자신이 실행이다


def test_quality_estimate_counts_every_question_and_prices_the_calls():
    inputs = [{'type': 'future', 'act_in': 10_000, 'check_in': 20_000, 'judge_in': 2_000},
              {'type': 'past-absence', 'act_in': 10_000, 'check_in': 20_000, 'judge_in': 2_000}]
    one, two = estimate_quality(inputs[:1]), estimate_quality(inputs)
    assert set(one['calls']) == {'act', 'check', 'judge'} and one['usd'] > 0
    assert two['calls']['act'] == pytest.approx(2 * one['calls']['act']) and two['usd'] > one['usd']
    assert two['calls']['judge'] > 2 * one['calls']['judge']  # 공간 판정이 먼저인 유형(past-absence)은 판정 호출이 더 든다
    assert estimate_quality([]) == {'calls': {'act': 0, 'check': 0, 'judge': 0}, 'usd': 0.0}


def test_speed_estimate_drops_exactly_what_each_switch_skips():
    scenes = [SIZES] * 10
    run = {name: estimate_speed(scenes, name) for name in 'ABCDE'}
    assert run['A']['calls'] == run['B']['calls']  # 추론 강도는 호출 수를 바꾸지 않는다
    assert run['C']['calls']['director'] < run['B']['calls']['director'] and run['C']['calls']['check'] == run['B']['calls']['check']
    assert run['D'] == run['C']  # 세계관 캐시는 이 경로에서 효과가 없다
    assert run['E']['calls']['narrate_check'] == 0 < run['D']['calls']['narrate_check'] and run['E']['calls']['check'] == run['D']['calls']['check'] and run['E']['calls']['director'] == run['D']['calls']['director']
    assert run['A']['usd'] > run['C']['usd'] > run['E']['usd'] > 0


def test_the_omniscient_narration_check_is_priced_by_its_own_much_larger_input_and_E_skips_it():
    """해리 포터 원문 세계관에서 나레이션 검사 입력은 평균 30만 토큰이었다(미래 전체가 금지 목록으로 들어간다). 인물 검사 입력으로만 세면 속도 예상이 3배 낮았다."""
    plain = [{**SIZES} for _ in range(10)]
    heavy = [{**SIZES, 'narrate_check_in': 300_000} for _ in range(10)]
    assert estimate_speed(heavy, 'A')['usd'] > 3 * estimate_speed(plain, 'A')['usd']   # 나레이션 검사 입력을 알면 예상이 크게 오른다
    assert estimate_speed(heavy, 'A')['calls']['narrate_check'] == 10 * 2 * ATTEMPTS and estimate_speed(heavy, 'E')['calls']['narrate_check'] == 0
    assert estimate_speed(heavy, 'E')['usd'] == estimate_speed(plain, 'E')['usd']   # E는 나레이션 검사를 하지 않아 그 입력 크기와 무관하다
    assert estimate_speed(plain, 'A') == estimate_speed([{k: v for k, v in s.items()} for s in plain], 'A')   # narrate_check_in이 없으면 인물 검사와 같은 크기로 센다


def test_a_reused_config_costs_nothing_in_the_estimate():
    rows = c.estimate('speed', list('ABCDE'), [SIZES] * 10)
    assert rows['D']['reusedFrom'] == 'C' and rows['D']['usd'] == 0 and rows['D']['calls'] == {}
    assert rows['C']['reusedFrom'] is None and rows['C']['usd'] > 0


def test_the_most_a_question_can_cost_covers_every_attempt_and_every_grading():
    q = {'type': 'past-absence', 'act_in': 10_000, 'check_in': 20_000, 'judge_in': 2_000}
    worst = c.question_max_usd(q)
    # 인물 턴·검사를 세 번(처음 + 재생성 둘), 첫·최종 응답을 각각 시공간 2번 + 성격 1번 채점하고 출력은 호출당 상한까지 쓰는 경우
    assert worst == pytest.approx(3 * (usd(10_000, c.OUT_TOKENS) + usd(20_000, c.OUT_TOKENS)) + 6 * usd(2_000, c.JUDGE_MAX_OUT))
    assert worst > estimate_quality([q])['usd']  # 기대 금액보다 크다
    assert c.JUDGE_MAX_OUT == JUDGE_TOKENS  # 채점 호출의 max_output_tokens와 같다
