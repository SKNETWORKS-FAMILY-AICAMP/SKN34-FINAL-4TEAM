"""데이터 준비의 순수 로직 단위 테스트: 청크 분할·구텐베르크 정리·정답 근거 추정·층화 표본."""

import pytest

from prepare import chunk_words, clean_gutenberg, gold_chunks, stratified_sample


def words(text):
    return text.split()


def test_chunks_keep_every_word_in_order_and_respect_the_limit():
    paragraphs = [' '.join(f'w{p}_{i}' for i in range(n)) for p, n in enumerate([30, 5, 80, 400, 12, 60, 70])]
    text = '\n\n'.join(paragraphs)
    chunks = chunk_words(text, target=100, max_words=140)
    assert [w for c in chunks for w in words(c)] == words(text)
    assert all(0 < len(words(c)) <= 140 for c in chunks)
    assert len(chunks) >= 4


def test_long_paragraph_splits_at_sentence_boundaries():
    sentence = 'The old miller walked slowly home through the rain. '
    text = sentence * 60  # 한 문단 600어
    chunks = chunk_words(text, target=100, max_words=140)
    assert all(c.rstrip().endswith('.') for c in chunks)
    assert [w for c in chunks for w in words(c)] == words(text)


def test_single_run_on_sentence_is_cut_by_words():
    text = ' '.join(f'x{i}' for i in range(500))  # 마침표 없는 한 문장
    chunks = chunk_words(text, target=100, max_words=140)
    assert all(len(words(c)) <= 140 for c in chunks)
    assert [w for c in chunks for w in words(c)] == words(text)


def test_empty_text_has_no_chunks():
    assert chunk_words('  \n\n  ', target=100, max_words=140) == []


def test_clean_gutenberg_cuts_header_line_and_footer():
    raw = 'license text\nProduced by Nick Hodson\n\nBody one.\n\nBody two.\n\nEnd of the Project new eBooks .\nlicense tail'
    assert clean_gutenberg(raw, 'Produced by Nick', 'new eBooks .') == 'Body one.\n\nBody two.'
    with pytest.raises(ValueError):
        clean_gutenberg(raw, 'no such marker', 'new eBooks .')


def test_clean_gutenberg_prefers_current_gutenberg_markers():
    # 지금의 구텐베르크 파일은 2015년판의 '제작자' 표식 대신 *** START/END *** 표식을 쓴다.
    raw = ('The Project Gutenberg eBook\n*** START OF THE PROJECT GUTENBERG EBOOK THE TALE ***\n\n'
           'Body one.\n\nBody two.\n\n*** END OF THE PROJECT GUTENBERG EBOOK THE TALE ***\nlicense tail')
    assert clean_gutenberg(raw, 'Produced by Gone', 'new eBooks .') == 'Body one.\n\nBody two.'


def test_gold_chunks_match_whole_tokens_after_normalisation():
    chunks = {'c1': 'He sold the Cart to Mr. Jones.', 'c2': 'A carton of eggs.', 'c3': 'Nothing here.'}
    assert gold_chunks(chunks, ['cart!']) == {'c1'}  # 'carton'에는 맞지 않는다
    assert gold_chunks(chunks, ['no match', 'Mr Jones']) == {'c1'}  # 별칭 중 하나만 맞아도 된다


def test_gold_chunks_rejects_empty_ambiguous_and_tiny_answers():
    chunks = {f'c{i}': 'the Count met the Count again' for i in range(12)}
    assert gold_chunks(chunks, ['elsewhere']) is None  # 일치 없음
    assert gold_chunks(chunks, ['the count'], max_hits=10) is None  # 너무 흔해 근거를 특정할 수 없음
    assert gold_chunks({'c': 'yes it is'}, ['it']) is None  # 너무 짧은 답


def test_stratified_sample_is_proportional_and_deterministic():
    rows = [{'id': f'a{i}', 'hop': 2} for i in range(60)] + [{'id': f'b{i}', 'hop': 3} for i in range(30)] \
        + [{'id': f'c{i}', 'hop': 4} for i in range(10)]
    picked = stratified_sample(rows, key=lambda r: r['hop'], n=20, seed=58)
    assert len(picked) == 20
    counts = {h: sum(r['hop'] == h for r in picked) for h in (2, 3, 4)}
    assert counts == {2: 12, 3: 6, 4: 2}
    assert picked == stratified_sample(rows, key=lambda r: r['hop'], n=20, seed=58)
    assert picked != stratified_sample(rows, key=lambda r: r['hop'], n=20, seed=59)
