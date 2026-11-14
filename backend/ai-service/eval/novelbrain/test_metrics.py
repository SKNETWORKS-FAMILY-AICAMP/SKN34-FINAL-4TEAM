"""평가 지표 계산의 단위 테스트: Recall@k·P@k·RRF 입력 변환·EM/F1·채점 응답 파싱·신뢰구간."""

import pytest

from metrics import (
    answer_f1,
    dedupe,
    exact_match,
    normalize_answer,
    parse_score,
    precision_at_k,
    recall_at_k,
    sign_test,
    spatiotemporal_score,
    wilson_interval,
)


def test_recall_and_precision_use_top_k_only():
    ranked = ['a', 'b', 'c', 'd']
    gold = {'a', 'c', 'x'}
    assert recall_at_k(ranked, gold, 2) == pytest.approx(1 / 3)
    assert recall_at_k(ranked, gold, 3) == pytest.approx(2 / 3)
    assert precision_at_k(ranked, gold, 2) == pytest.approx(1 / 2)
    assert precision_at_k(ranked, gold, 4) == pytest.approx(2 / 4)


def test_precision_divides_by_k_even_when_fewer_results_return():
    # 필터가 항목을 줄여도 빈 칸은 정답이 아닌 칸으로 센다(표준 P@k).
    assert precision_at_k(['a'], {'a'}, 5) == pytest.approx(0.2)
    assert recall_at_k([], {'a'}, 5) == 0.0


def test_duplicate_ids_count_once_at_their_first_rank():
    assert dedupe(['a', 'a', 'b', 'a', 'c']) == ['a', 'b', 'c']
    assert recall_at_k(['a', 'a', 'b'], {'a'}, 2) == 1.0
    assert precision_at_k(['a', 'a', 'b'], {'a'}, 2) == pytest.approx(0.5)


def test_empty_gold_is_an_error_not_a_zero():
    with pytest.raises(ValueError):
        recall_at_k(['a'], set(), 5)
    with pytest.raises(ValueError):
        precision_at_k(['a'], set(), 5)


def test_normalize_answer_follows_squad_rules():
    assert normalize_answer('The Quick,  brown FOX!') == 'quick brown fox'
    assert normalize_answer('  An apple a day ') == 'apple day'


def test_exact_match_uses_best_alias():
    golds = ['Miquette Giraudy', 'Miquette']
    assert exact_match('the miquette giraudy.', golds) == 1.0
    assert exact_match('Miquette', golds) == 1.0
    assert exact_match('Steve Hillage', golds) == 0.0


def test_answer_f1_is_token_overlap_max_over_aliases():
    assert answer_f1('Steve Hillage Smith', ['Steve Hillage']) == pytest.approx(0.8)
    assert answer_f1('Paris', ['London', 'Paris, France']) == pytest.approx(2 / 3)
    assert answer_f1('', ['x']) == 0.0
    assert answer_f1('x', ['']) == 0.0


@pytest.mark.parametrize('content,valid,expected', [
    ('reasoning...\n1\n1', (0, 1), 1),
    ('reasoning...\nScore: 0', (0, 1), 0),
    ('step by step\n\n6\n6\n', range(1, 8), 6),
    ('reasoning\nI give it 3 out of 7', range(1, 8), 7),  # TimeChara 원본처럼 마지막 줄의 마지막 숫자
    ('no digits here', (0, 1), None),
    ('reasoning\n8', range(1, 8), None),  # 범위 밖은 점수가 아니라 파싱 실패
    ('reasoning\n0', range(1, 8), None),
    ('', (0, 1), None),
])
def test_parse_score_reads_last_line_digit_inside_range(content, valid, expected):
    assert parse_score(content, valid) == expected


def test_spatiotemporal_score_combines_by_data_type():
    # 공개 채점 규칙: absence·presence는 공간×시간, future·past-only는 시간만 본다.
    assert spatiotemporal_score('past-absence', temporal=1, spatial=1) == 1
    assert spatiotemporal_score('past-presence', temporal=1, spatial=0) == 0
    assert spatiotemporal_score('past-absence', temporal=0, spatial=1) == 0
    assert spatiotemporal_score('future', temporal=1, spatial=None) == 1
    assert spatiotemporal_score('past-only', temporal=0, spatial=None) == 0
    with pytest.raises(ValueError):
        spatiotemporal_score('past-absence', temporal=1, spatial=None)
    with pytest.raises(ValueError):
        spatiotemporal_score('unknown', temporal=1, spatial=None)


def test_wilson_interval_matches_reference_value():
    lo, hi = wilson_interval(8, 10)
    assert lo == pytest.approx(0.4902, abs=1e-3)
    assert hi == pytest.approx(0.9434, abs=1e-3)
    assert wilson_interval(0, 0) == (0.0, 0.0)
    lo, hi = wilson_interval(10, 10)
    assert hi == pytest.approx(1.0) and lo < 1.0


def test_sign_test_counts_improved_and_worsened_questions_with_exact_p():
    assert sign_test([1, 1, 0, 0], [0, 1, 1, 0]) == {'up': 1, 'down': 1, 'p': 1.0}
    out = sign_test([1.0] * 9, [0.0] * 8 + [1.0])        # 같은 점수(마지막 질문)는 센 뒤 뺀다
    assert (out['up'], out['down']) == (8, 0) and out['p'] == pytest.approx(2 / 2 ** 8)
    assert sign_test([0.5, 0.5], [0.5, 0.5]) == {'up': 0, 'down': 0, 'p': 1.0}
    with pytest.raises(ValueError):
        sign_test([1.0], [1.0, 0.0])
