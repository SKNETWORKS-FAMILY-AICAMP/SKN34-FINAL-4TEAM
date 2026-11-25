"""시각화 값 고르기 단위 테스트(matplotlib 없이)."""

import charts


def test_status_grid_marks_run_missing_and_not_applicable_cells():
    results = {('guard', 'G'): {'summary': {'measured': {'n': 9, 'of': 10}}}, ('qa', 'S'): {'summary': {'measured': {'n': 3, 'of': 3}}}}
    grid = charts.status_grid(results, ['guard', 'qa'])
    assert grid['guard'] == {'R': 'missing', 'G': '9/10', 'S': 'n/a'}
    assert grid['qa'] == {'R': 'missing', 'G': 'missing', 'S': '3/3'}


def test_headline_metrics_take_value_and_interval_only_for_rates():
    summary = {'accuracy': {'k': 3, 'n': 4, 'value': 0.75, 'low': 0.3, 'high': 0.95}, 'kept': {'mean': 0.2, 'n': 3}}
    assert charts.headline(summary, ['accuracy', 'kept', 'missing']) == [('accuracy', 0.75, 0.3, 0.95, 4)]
