"""시각화 값 고르기 단위 테스트(matplotlib 없이)."""

import charts


def test_status_grid_marks_run_missing_and_not_applicable_cells():
    results = {('guard', 'G'): {'summary': {'measured': {'n': 9, 'of': 10}}}, ('qa', 'S'): {'summary': {'measured': {'n': 3, 'of': 3}}}}
    grid = charts.status_grid(results, ['guard', 'qa'])
    assert grid['guard'] == {'R': 'missing', 'G': '9/10', 'S': 'n/a'}
    assert grid['qa'] == {'R': 'missing', 'G': 'missing', 'S': '3/3'}


def test_headline_takes_rates_with_intervals_and_0_to_1_means_and_scores_without():
    summary = {'accuracy': {'k': 3, 'n': 4, 'value': 0.75, 'low': 0.3, 'high': 0.95}, 'kept': {'mean': 0.2, 'n': 3},
               'quality': {'mean': 3.9, 'n': 5}, 'f1': 0.5, 'none': {'k': 0, 'n': 0, 'value': None, 'low': 0, 'high': 0}}
    assert charts.headline(summary, ['accuracy', 'kept', 'quality', 'f1', 'none', 'missing']) == [
        ('accuracy', 0.75, 0.3, 0.95, 4), ('kept', 0.2, 0.2, 0.2, 3), ('f1', 0.5, 0.5, 0.5, None)]   # 1을 넘는 평균(5점 척도)은 뺀다
