"""V4 비교 집계 단위 테스트: 장면 기록·채점 → 장면별 값, 조건별 요약, 조건 사이 비교(정확 검정·순열 검정)."""

import math

import pytest

import v4_report as r


def record(sid, status='completed', stop=None, kinds=('narration', 'character', 'character', 'narration'), regen=(0, 0, 1, 0), texts=None, serial=6, calls=None, elapsed=20000, first=3000):
    texts = texts or ['지문', '"우리 같이 가자, 지금 바로 가야 해."라고 말했다.', '"우리 같이 가자, 지금 바로 가야 해."라고 말했다.', '끝']
    return {'id': sid, 'engine': 'turn', 'mode': 'if', 'status': status, 'stopReason': stop, 'error': None,
            'turns': [{'kind': k, 'pov': 'omniscient', 'regenerated': g} for k, g in zip(kinds, regen, strict=True)],
            'calls': calls or [{'name': 'director', 'ms': 100, 'failed': False, 'inputTokens': 1000, 'outputTokens': 10},
                               {'name': 'act', 'ms': 2000, 'failed': False, 'inputTokens': 7000, 'outputTokens': 100}],
            'serialSteps': serial, 'elapsedMs': elapsed, 'firstTurnMs': first,
            'transcript': {'beats': [], 'turns': [{'kind': k, 'by': '해리' if k == 'character' else '나레이션', 'text': t} for k, t in zip(kinds, texts, strict=True)]}}


def grade(overall=4, plan=3, voices=(None, 4, 2, None), leaked=((), (), ('t2f0',), ())):
    return {'overall': overall, 'plan': plan, 'turns': [{'index': i, 'voice': v, 'follows': True, 'leaked': list(lk)} for i, (v, lk) in enumerate(zip(voices, leaked, strict=True))]}


def test_a_scene_row_collects_status_cost_shape_and_the_grade_metrics():
    row = r.scene_row(record('hp-1-if#2'), grade())
    assert (row['scene'], row['completed'], row['turns'], row['charTurns'], row['retryTurns']) == ('hp-1-if', True, 4, 2, 1)
    assert (row['calls'], row['serialSteps'], row['tokensIn'], row['tokensOut'], row['elapsedMs'], row['firstTurnMs']) == (2, 6, 8000, 110, 20000, 3000)
    assert row['repeat'] == 0.5          # 두 번째 대사가 같은 인물의 앞선 대사와 같다(대사 둘 중 하나)
    assert (row['overall'], row['plan'], row['voice'], row['leakTurns'], row['follows']) == (4, 3, 3.0, 1, 1.0)
    assert r.scene_row(record('hp-1-if', status='stopped', stop='turn_limit'), None)['completed'] is False
    assert r.scene_row(record('hp-1-if'), None)['overall'] is None and r.scene_row(record('hp-1-if'), None)['leakTurns'] is None


def test_the_exact_test_and_the_permutation_test_behave_on_small_known_cases():
    assert r.fisher_exact(23, 1, 20, 4) == pytest.approx(0.348, abs=0.001)
    assert r.fisher_exact(5, 5, 5, 5) == pytest.approx(1.0)
    assert r.permutation_p([1, 1, 1, 1], [5, 5, 5, 5], seed=1, perms=2000) < 0.05 and r.permutation_p([1, 5, 1, 5], [1, 5, 1, 5], seed=1, perms=2000) == pytest.approx(1.0)
    assert r.pctl([1, 2, 3, 4, 5], 0.5) == 3 and r.pctl([], 0.5) is None


def rows(n, **overrides):
    return [{**r.scene_row(record(f'hp-1-if#{i}', **overrides), grade(overall=3 + i % 2)), 'status': 'completed'} for i in range(n)]


def test_a_condition_summary_reports_completion_means_rates_and_the_serial_path():
    data = rows(4) + [r.scene_row(record('hp-3-flow#9', status='stopped', stop='turn_limit'), grade())]
    got = r.summarize(data)
    assert got['n'] == 5 and got['completed']['k'] == 4 and got['completed']['rate'] == pytest.approx(0.8) and got['stops'] == {'turn_limit': 1}
    assert got['mean']['overall']['mean'] == pytest.approx((3 + 4 + 3 + 4 + 4) / 5) and got['mean']['overall']['n'] == 5
    assert got['leakTurnRate'] == pytest.approx(5 / 20) and got['retryRate'] == pytest.approx(5 / 20) and got['repeatRate'] == pytest.approx(0.5)
    assert got['calls']['mean'] == 2 and got['serialSteps']['p50'] == 6 and got['elapsedMs']['p50'] == 20000 and got['firstTurnMs']['p95'] == 3000
    assert got['tokensIn']['mean'] == 8000 and math.isfinite(got['mean']['overall']['ci'])
    assert r.summarize([r.scene_row(record('a'), None)])['mean']['overall'] == {'mean': None, 'n': 0, 'ci': None}   # 채점이 없으면 평균을 꾸미지 않는다


def test_a_comparison_has_the_completion_test_and_the_difference_of_each_metric_with_its_p():
    a = [{**r.scene_row(record(f'x#{i}'), grade(overall=3)), 'completed': True} for i in range(10)]
    b = [{**r.scene_row(record(f'x#{i}', serial=3), grade(overall=5)), 'completed': i < 6} for i in range(10)]
    got = r.compare(a, b, seed=1, perms=4000)
    assert got['completed'] == {'a': 10, 'na': 10, 'b': 6, 'nb': 10, 'p': pytest.approx(r.fisher_exact(10, 0, 6, 4))}
    assert got['metrics']['overall']['diff'] == pytest.approx(2.0) and got['metrics']['overall']['p'] < 0.01
    assert got['metrics']['serialSteps']['diff'] == pytest.approx(-3.0)



def test_the_summary_pairs_each_record_with_its_grade_and_compares_the_named_conditions():
    records = {'base': [record('a#1'), record('a#2')], 'v4': [record('a#1', serial=3), record('a#2', serial=3)]}
    grades = {'base': {'a#1': grade(overall=2), 'a#2': None}, 'v4': {'a#1': grade(overall=5), 'a#2': grade(overall=5)}}
    got = r.build_summary(records, grades, perms=500)
    assert set(got['conditions']) == {'base', 'v4'} and got['conditions']['base']['graded'] == 1 and got['conditions']['v4']['graded'] == 2
    assert list(got['comparisons']) == ['v4 vs base'] and got['comparisons']['v4 vs base']['metrics']['serialSteps']['diff'] == pytest.approx(-3.0)
    assert got['comparisons']['v4 vs base']['metrics']['overall']['diff'] == pytest.approx(3.0)
