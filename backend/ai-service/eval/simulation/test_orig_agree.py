"""두 채점 모델의 일치(orig_agree): 문항별 상관·일치, 후보 순위 변화, 짝 비교 방향 일치. 순수 함수다."""

import pytest

import orig_agree as ag


def rec(i, **grade):
    return {'id': f'x-{i}', 'error': None, 'skipped': None, 'generated': 'g', 'grade': {'leaked': [], **grade}, 'usage': []}


def test_item_agreement_is_the_pearson_r_the_exact_match_rate_and_the_bias_on_shared_items():
    a = {'x1': 1, 'x2': 2, 'x3': 3, 'x4': 4, 'only-a': 5}
    b = {'x1': 2, 'x2': 3, 'x3': 4, 'x4': 5, 'only-b': 1}
    got = ag.item_agreement(a, b)
    assert got['n'] == 4 and got['r'] == pytest.approx(1.0) and got['exact'] == 0 and got['meanA'] == 2.5 and got['meanB'] == 3.5 and got['bias'] == pytest.approx(1.0)
    assert ag.item_agreement({'x1': 3, 'x2': 3}, {'x1': 4, 'x2': 5})['r'] is None   # 한쪽이 상수면 상관이 없다
    assert ag.item_agreement({}, {})['n'] == 0 and ag.item_agreement({'x1': None}, {'x1': 2})['n'] == 0   # 값이 없는 문항은 뺀다


def test_ranking_gives_ranks_spearman_and_the_pairs_whose_order_flips():
    got = ag.ranking({'base': 2.5, 'P1': 2.7, 'E1': 2.6, 'N': 2.0}, {'base': 2.5, 'P1': 2.6, 'E1': 2.9, 'N': 2.0})
    assert got['rankA'] == {'P1': 1, 'E1': 2, 'base': 3, 'N': 4} and got['rankB'] == {'E1': 1, 'P1': 2, 'base': 3, 'N': 4}
    assert got['flips'] == [['P1', 'E1']] and got['spearman'] == pytest.approx(0.8)
    same = ag.ranking({'a': 1, 'b': 2, 'c': 3}, {'a': 10, 'b': 20, 'c': 30})
    assert same['flips'] == [] and same['spearman'] == pytest.approx(1.0) and ag.ranking({'a': 1}, {'a': 2})['spearman'] is None


def test_an_item_graded_by_only_one_grader_is_left_out_of_both_so_the_samples_match():
    failed = {'id': 'x-2', 'error': None, 'skipped': None, 'generated': 'g', 'grade': None, 'usage': []}   # 한 채점에서만 채점이 실패한 문항
    base = [rec(1, voice=4), rec(2, voice=4)]
    got = ag.report('1', {'base': base, 'P1': [rec(1, voice=5), rec(2, voice=1)]}, {'base': base, 'P1': [rec(1, voice=5), failed]}, 'base')
    voice = got['pairs']['P1']['voice']
    assert voice['a']['n'] == 1 and voice['b']['n'] == 1 and voice['sameDirection'] is True   # 공통 문항 x-1만으로 견준다(표본이 달라 방향이 뒤집혀 보이지 않는다)
    assert got['ranking']['voice']['flips'] == [] and got['items']['voice']['n'] == 3


def test_the_report_pairs_the_same_items_across_graders_and_compares_each_candidates_direction_against_the_base():
    base_a = [rec(i, voice=3, intent=2) for i in range(1, 9)]
    cand_a = [rec(i, voice=4 if i <= 6 else 3, intent=2) for i in range(1, 9)]      # 후보가 말투 +0.75, 의도는 같다
    base_b = [rec(i, voice=3, intent=3) for i in range(1, 9)]
    cand_b = [rec(i, voice=3 if i <= 4 else 4, intent=3) for i in range(1, 9)]      # 다른 채점: 말투 +0.5(같은 방향)
    got = ag.report('1', {'base': base_a, 'P1': cand_a}, {'base': base_b, 'P1': cand_b}, 'base')
    assert got['items']['voice']['n'] == 16 and got['items']['voice']['r'] == pytest.approx(0.5 / (3.75 * 3.0) ** 0.5) and set(got['items']) == {'voice', 'intent', 'clean'}
    voice = got['pairs']['P1']['voice']
    assert voice['a']['meanDiff'] == pytest.approx(0.75) and voice['b']['meanDiff'] == pytest.approx(0.5) and voice['sameDirection'] is True
    assert got['pairs']['P1']['intent']['sameDirection'] is None and set(got['ranking']['voice']['rankA']) == {'base', 'P1'}   # 평균 차이가 0이면 방향이 없다
    assert got['byRun']['P1']['voice']['n'] == 8
