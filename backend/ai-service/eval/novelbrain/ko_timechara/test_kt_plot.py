"""비용 대비 시공간 점수 그래프의 계산 부분 단위 테스트: 묶음 인자·강도 라벨·run별 점수와 문항당 환산 비용·그릴 점·표 파일(그리기는 시험하지 않는다)."""

import argparse
import json

import pytest

import kt_plot


def rec(idx, config, score, gen_model='gpt-6-luna@high'):
    return {'idx': idx, 'config': config, 'data_type': 'future', 'score': score, 'personality': None, 'future_ctx': False, 'foreign_ctx': False,
            'gen_model': gen_model, 'judge_model': 'gpt-6.2-sol'}


def run_records(s3, zero, gen_model='gpt-6-luna@high'):
    """질문마다 zero·s3 기록 하나씩: s3·zero 점수 목록이 질문 순서다."""
    return [rec(i, c, s, gen_model) for i, (z, t) in enumerate(zip(zero, s3, strict=True)) for c, s in (('zero', z), ('s3', t))]


def gen_cost(total, rows=8):
    return [{'kind': 'gen', 'usd': total / rows}] * rows + [{'kind': 'judge', 'usd': 0.5}] * 20      # gen이 아닌 줄(여기서는 일부러 0이 아닌 금액)은 합계에 들지 않는다


def test_parse_group_splits_the_display_name_from_the_run_names_in_order():
    assert kt_plot.parse_group('gpt-6-luna=luna-low,luna-high') == ('gpt-6-luna', ['luna-low', 'luna-high'])
    assert kt_plot.parse_group('gemini-3.8-flash=gemini-flash-low') == ('gemini-3.8-flash', ['gemini-flash-low'])
    for bad in ('', 'x', 'x=', '=a,b', 'x=,'):
        with pytest.raises(argparse.ArgumentTypeError):
            kt_plot.parse_group(bad)


def test_the_effort_label_is_read_from_the_model_name_after_the_at_sign():
    assert kt_plot.effort_of(run_records([1], [0], 'gpt-6-luna@xhigh')) == 'xhigh'
    assert kt_plot.effort_of(run_records([1], [0], 'gpt-5.6-luna')) == '기본' and kt_plot.effort_of([{'idx': 0, 'config': 's3'}]) == '기본'      # 강도를 보내지 않은 실행
    assert kt_plot.effort_of(run_records([1], [0], 'm@low') + run_records([1], [0], 'm@high')) == 'high/low'                         # 섞이면 숨기지 않고 잇는다


def test_run_stats_reads_both_scores_the_effort_and_the_converted_cost_per_question():
    stats = kt_plot.run_stats('luna-high', run_records(s3=[1, 1, 1, 0], zero=[1, 0, 0, 0]), gen_cost(0.08))
    assert (stats['run'], stats['effort'], stats['gen_model'], stats['judge_model'], stats['questions']) == ('luna-high', 'high', 'gpt-6-luna@high', 'gpt-6.2-sol', 4)
    assert (stats['s3_pct'], stats['zero_pct'], stats['s3_failed'], stats['zero_failed']) == (75.0, 25.0, 0, 0)
    assert stats['gen_usd'] == pytest.approx(0.08) and stats['cost_per_question_usd'] == pytest.approx(0.02)                           # gen 줄 합계 ÷ 질문 수


def test_failed_calls_are_counted_and_missing_values_stay_none_instead_of_a_made_up_number():
    stats = kt_plot.run_stats('x', [rec(0, 's3', None), rec(1, 's3', 1)], gen_cost(0.02, rows=2))
    assert stats['s3_failed'] == 1 and stats['s3_pct'] == 100.0 and stats['zero_pct'] is None and stats['zero_failed'] is None      # 성공한 것만의 가중 평균, zero 기록 없음
    rejudged = kt_plot.run_stats('luna-sol', run_records([1, 0], [0, 0], 'gpt-5.6-luna'), [{'kind': 'judge', 'usd': 0.0}])
    assert rejudged['gen_usd'] == 0 and rejudged['cost_per_question_usd'] is None                                                     # 다시 채점한 run은 응답 비용이 없다


def test_build_table_keeps_groups_and_runs_in_the_order_given_and_points_drops_what_cannot_sit_on_a_log_axis():
    runs = {'a-low': (run_records([1, 0], [0, 0], 'm@low'), gen_cost(0.02)), 'a-high': (run_records([1, 1], [0, 0], 'm@high'), gen_cost(0.10)),
            'free': (run_records([1, 1], [0, 0], 'm'), []), 'nos3': ([rec(0, 'zero', 1)], gen_cost(0.01))}
    table = kt_plot.build_table([('A', ['a-low', 'a-high']), ('B', ['free', 'nos3'])], runs)
    assert [(g['name'], [r['run'] for r in g['runs']]) for g in table] == [('A', ['a-low', 'a-high']), ('B', ['free', 'nos3'])]
    drawable, skipped = kt_plot.points(table[0])
    assert [r['run'] for r in drawable] == ['a-low', 'a-high'] and skipped == []                                                       # 적은 순서 그대로(강도 순으로 적는다)
    drawable, skipped = kt_plot.points(table[1])
    assert drawable == [] and skipped == ['free', 'nos3']                                                                              # 비용 0 · s3 없음


def test_main_writes_the_table_next_to_the_png_before_drawing_and_stops_on_a_missing_run(tmp_path, monkeypatch):
    kt = tmp_path / 'kt'
    (kt / 'runs').mkdir(parents=True)
    (kt / 'runs' / 'rows-a.json').write_text(json.dumps(run_records([1, 0], [0, 0], 'm@low')))
    (kt / 'cost-a.jsonl').write_text('\n'.join(json.dumps(row) for row in gen_cost(0.02)) + '\n')
    drawn = []
    monkeypatch.setattr(kt_plot, 'KT', kt)
    monkeypatch.setattr(kt_plot, 'draw', lambda table, out: drawn.append((table, out)) or (_ for _ in ()).throw(SystemExit('matplotlib이 없다')))
    out = tmp_path / 'plots' / 'cost.png'
    with pytest.raises(SystemExit, match='matplotlib'):
        kt_plot.main(['G=a', f'--out={out}'])
    table = json.loads((tmp_path / 'plots' / 'cost.json').read_text())                                                                 # 그리기가 실패해도 표는 남는다
    assert drawn[0][1] == out and table == drawn[0][0] and table[0]['name'] == 'G' and table[0]['runs'][0]['effort'] == 'low'
    with pytest.raises(SystemExit, match='rows-nope.json'):
        kt_plot.main(['G=nope', f'--out={out}'])
