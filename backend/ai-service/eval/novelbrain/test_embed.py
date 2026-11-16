"""벡터 kNN·발췌 창 단위 테스트(E5 모델 없이 순수 계산만). numpy는 manuscript 추가 패키지라 없으면 kNN 테스트만 건너뛴다."""

import pytest

from embed import best_window, knn


def test_knn_returns_best_indices_by_cosine_with_stable_ties():
    np = pytest.importorskip('numpy')
    matrix = np.array([[1.0, 0.0], [0.6, 0.8], [0.0, 1.0], [0.6, 0.8]])
    assert knn(matrix, np.array([0.0, 1.0]), 3) == [2, 1, 3]  # 같은 점수(1, 3)는 앞 인덱스 먼저
    assert knn(matrix, np.array([1.0, 0.0]), 10) == [0, 1, 3, 2]  # k가 많으면 있는 만큼


def test_cached_embeddings_reuse_only_a_cache_made_from_the_same_texts_order_and_kind(tmp_path, monkeypatch):
    np = pytest.importorskip('numpy')
    import embed
    calls = []

    def fake(texts, kind, batch_size=16):
        calls.append((kind, list(texts)))
        return np.array([[float(len(t)), float(i)] for i, t in enumerate(texts)], dtype=np.float32)

    monkeypatch.setattr(embed, 'embed_texts', fake)
    path = tmp_path / 'vectors.npy'
    first = embed.cached_embeddings(path, ['가나', '다라마'], 'passage')
    assert embed.cached_embeddings(path, ['가나', '다라마'], 'passage').tolist() == first.tolist() and len(calls) == 1   # 같으면 캐시를 읽는다
    swapped = embed.cached_embeddings(path, ['다라마', '가나'], 'passage')                  # 개수가 같아도 순서가 바뀌면 다시 계산한다
    assert len(calls) == 2 and swapped[0][0] == 3.0
    embed.cached_embeddings(path, ['다라마', '가나'], 'query')                              # 접두어 종류가 다르면 다시 계산한다
    assert len(calls) == 3
    np.save(tmp_path / 'legacy.npy', first)                                                  # 지문 없이 행 수만 맞는 옛 캐시는 믿지 않는다
    embed.cached_embeddings(tmp_path / 'legacy.npy', ['가나', '다라마'], 'passage')
    assert len(calls) == 4


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
