"""채점기 점검(KUDGE) 단위 테스트(모델 호출 없음)."""

import judge_check


def test_kappa_is_one_for_perfect_agreement_and_zero_for_chance_level():
    assert judge_check.kappa(['a', 'b', 'a'], ['a', 'b', 'a']) == 1.0
    assert judge_check.kappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b']) == 0.0
    assert judge_check.kappa([], []) is None
    assert judge_check.kappa(['a', 'a'], ['a', 'a']) == 1.0   # 한 범주만 있으면 우연 일치가 1이라 정의상 일치로 둔다


def test_pointwise_agreement_counts_exact_and_within_one_point():
    rows = [{'human': 5, 'judge': 5}, {'human': 2, 'judge': 3}, {'human': 1, 'judge': 4}]
    out = judge_check.pointwise(rows)
    assert out['exact']['k'] == 1 and out['within_one']['k'] == 2 and out['exact']['n'] == 3


def test_pairwise_accuracy_ignores_ties_in_the_human_preference():
    rows = [{'human': 'A', 'judge': 'A'}, {'human': 'B', 'judge': 'A'}, {'human': 'tie', 'judge': 'A'}]
    assert judge_check.pairwise(rows)['accuracy'] == {'k': 1, 'n': 2, 'value': 0.5, 'low': judge_check.common.rate(1, 2)['low'],
                                                       'high': judge_check.common.rate(1, 2)['high']}


def test_score_is_read_from_the_last_bracketed_rating_in_free_text():
    assert judge_check.parse_score('이유... [[4]] 최종 점수: [[3]]') == 3
    assert judge_check.parse_score('점수 없음') is None
    assert judge_check.parse_choice('[[A]]') == 'A' and judge_check.parse_choice('[[B]]가 낫다') == 'B' and judge_check.parse_choice('?') is None
