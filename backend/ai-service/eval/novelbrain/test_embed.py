"""벡터 kNN·발췌 창 단위 테스트(E5 모델 없이 순수 계산만). numpy는 manuscript 추가 패키지라 없으면 kNN 테스트만 건너뛴다."""

import pytest

from embed import best_window, knn


def test_knn_returns_best_indices_by_cosine_with_stable_ties():
    np = pytest.importorskip('numpy')
    matrix = np.array([[1.0, 0.0], [0.6, 0.8], [0.0, 1.0], [0.6, 0.8]])
    assert knn(matrix, np.array([0.0, 1.0]), 3) == [2, 1, 3]  # 같은 점수(1, 3)는 앞 인덱스 먼저
    assert knn(matrix, np.array([1.0, 0.0]), 10) == [0, 1, 3, 2]  # k가 많으면 있는 만큼


def test_best_window_returns_short_text_whole():
    assert best_window('Short   text here.', 'text', size=256) == 'Short text here.'


def test_best_window_picks_the_sentences_that_hit_the_query():
    text = ('The weather was calm that morning. ' * 8 + 'Aubrey met Ianthe near the old temple. '
            + 'Nobody spoke of it afterwards. ' * 8)
    window = best_window(text, 'Who did Aubrey meet near the temple?', size=120)
    assert 'Ianthe' in window and len(window) <= 120


def test_best_window_never_exceeds_size_even_for_one_long_sentence():
    text = 'word ' * 200
    window = best_window(text, 'word', size=100)
    assert 0 < len(window) <= 100


def test_best_window_is_deterministic_and_earliest_on_ties():
    text = 'Alpha one. Beta two. Gamma three. Delta four. ' * 10
    assert best_window(text, 'zzz unrelated', size=60) == best_window(text, 'zzz unrelated', size=60)
    assert best_window(text, 'zzz unrelated', size=60).startswith('Alpha one.')
