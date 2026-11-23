"""백분위·품질/속도 집계·표 출력의 순수 로직 단위 테스트."""

import pytest

from sim_stats import percentile, quality_table, speed_table, summarize_quality, summarize_speed


def test_percentile_interpolates_linearly_between_the_nearest_ranks():
    assert percentile([1, 2, 3, 4], 50) == 2.5
    assert percentile([1, 2, 3, 4], 95) == pytest.approx(3.85)
    assert percentile([4, 1, 3, 2], 0) == 1 and percentile([4, 1, 3, 2], 100) == 4  # 정렬되지 않은 입력
    assert percentile([5], 95) == 5 and percentile([], 50) is None


def step(ms, wall, calls, usd=0.001, failures=0):
    return {'ms': ms, 'wallMs': wall, 'modelCalls': len(calls), 'failures': failures, 'inputTokens': 1000 * len(calls), 'outputTokens': 100 * len(calls),
            'usd': usd, 'calls': calls}


def turn(regenerated=0, kind='character'):
    return {'kind': kind, 'regenerated': regenerated}


SCENES = [
    {'id': 's1', 'status': 'completed', 'stopReason': None, 'turns': [turn(0, 'narration'), turn(1), turn(0)],
     'steps': [step(1000, 1100, ['director', 'narrate', 'check']), step(3000, 3300, ['director', 'act', 'check', 'act', 'check']), step(2000, 2100, ['director', 'act', 'check'])]},
    {'id': 's2', 'status': 'stopped', 'stopReason': 'check_failed', 'turns': [turn(0, 'narration')], 'steps': [step(5000, 5200, ['narrate', 'check'], usd=0.002)]},
    {'id': 's3', 'status': 'failed', 'stopReason': None, 'turns': [], 'steps': [step(100, 120, ['director'], usd=0.0005, failures=1)]},
]


def test_speed_summary_reads_per_turn_time_calls_tokens_cost_and_how_scenes_ended():
    s = summarize_speed(SCENES)
    assert (s['scenes'], s['turns'], s['steps']) == (3, 4, 5)
    assert s['turnMs']['p50'] == 2000 and s['turnMs']['p95'] == pytest.approx(4600) and s['turnWallMs']['p50'] == 2100
    assert s['callsPerTurn'] == pytest.approx((3 + 5 + 3 + 2 + 1) / 5)
    assert s['callsByName'] == {'director': pytest.approx(4 / 5), 'narrate': pytest.approx(2 / 5), 'check': pytest.approx(5 / 5), 'act': pytest.approx(3 / 5)}
    assert s['tokensPerTurn'] == {'in': pytest.approx(14_000 / 5), 'out': pytest.approx(1_400 / 5)}
    assert s['usdPerScene'] == pytest.approx((0.003 + 0.002 + 0.0005) / 3)
    assert s['firstPassRate'] == pytest.approx(3 / 4) and s['meanRegenerations'] == pytest.approx(1 / 4)  # 턴이 있는 장면의 턴만 센다
    assert s['outcomes'] == {'completed': pytest.approx(1 / 3), 'stopped:check_failed': pytest.approx(1 / 3), 'failed': pytest.approx(1 / 3)}


def test_speed_summary_of_nothing_is_empty_not_a_crash():
    s = summarize_speed([])
    assert (s['scenes'], s['turns'], s['turnMs']['p50'], s['firstPassRate'], s['outcomes']) == (0, 0, None, None, {})


def record(idx, kind, first, final=None, attempts=1, flagged=False, leak=False, blocked=False):
    return {'idx': idx, 'data_type': kind, 'attempts': attempts, 'blocked': blocked, 'error': None, 'flagged': flagged, 'leakFlagged': leak,
            'first': {'score': first, 'personality': 5}, 'final': {'score': first if final is None else final, 'personality': 6}}


QUALITY = [
    record(0, 'future', 0, final=1, attempts=2, flagged=True, leak=True),   # 누설을 검사가 걸러 다시 쓰고 통과
    record(1, 'future', 0, flagged=False),                                   # 누설을 검사가 놓쳤다
    record(2, 'future', 1),
    record(3, 'past-only', 1, flagged=True),                                 # 오경보(맞는 답을 걸렀다)
    record(4, 'past-absence', 0, attempts=3, flagged=True, leak=False, blocked=True),
    {'idx': 5, 'data_type': 'past-presence', 'error': 503},
    record(6, 'past-presence', None),                                        # 채점 파싱 실패
]


def test_quality_summary_scores_the_final_answer_and_separately_the_first_one():
    q = summarize_quality(QUALITY)
    assert (q['n'], q['errors']) == (7, 1)
    final, first = q['final']['by_type'], q['first']['by_type']
    assert (final['future']['n'], final['future']['score']) == (3, pytest.approx(2 / 3)) and first['future']['score'] == pytest.approx(1 / 3)
    assert 'past-presence' not in final and final['past-absence']['score'] == 0  # 채점하지 못한 답은 평균에서 뺀다
    assert q['final']['by_type']['future']['ci'][0] < 2 / 3 < q['final']['by_type']['future']['ci'][1]
    assert q['final']['personality'] == 6 and q['final']['personalityN'] == 6
    assert q['failedJudge'] == 1


def test_quality_summary_measures_what_the_check_catches_and_what_it_wrongly_blocks():
    q = summarize_quality(QUALITY)
    assert q['flaggedRate'] == pytest.approx(3 / 6)  # 첫 응답을 위반으로 본 비율(오류·채점 실패는 제외하지 않고 생성된 응답 6개)
    assert q['catch'] == {'n': 3, 'rate': pytest.approx(2 / 3), 'leakRate': pytest.approx(1 / 3)}  # 심판이 누설로 본 첫 응답 3개 중 검사가 걸렀던 것
    assert q['falseAlarm'] == {'n': 2, 'rate': pytest.approx(1 / 2)}  # 심판이 맞다고 본 첫 응답 2개 중 검사가 걸렀던 것
    assert q['blockedRate'] == pytest.approx(1 / 6) and q['meanRegenerations'] == pytest.approx((1 + 0 + 0 + 0 + 2 + 0) / 6)


def test_the_weighted_score_follows_the_public_type_mix_over_the_types_present():
    q = summarize_quality([record(0, 'future', 1), record(1, 'past-only', 0)])
    assert q['final']['weighted'] == pytest.approx(0.5)  # future 1/3·past-only 1/3 만 있으니 같은 비중
    assert summarize_quality([])['final']['weighted'] is None


def test_tables_name_a_reused_config_instead_of_repeating_numbers():
    speed = {'configs': {'C': summarize_speed(SCENES), 'D': None}, 'ranAs': {'C': 'C', 'D': 'C'}}
    lines = speed_table(speed).splitlines()
    assert lines[0].startswith('| 설정') and lines[2].startswith('| C |') and '2000' in lines[2]
    assert lines[3].startswith('| D |') and 'C와 같은 실행' in lines[3]
    quality = {'configs': {'A': summarize_quality(QUALITY)}, 'ranAs': {'A': 'A'}}
    rows = quality_table(quality).splitlines()
    assert rows[0].startswith('| 설정') and rows[2].startswith('| A |') and '0.67' in rows[2] and '0.53' in rows[2]  # 최종·첫 응답의 가중 시공간 점수
