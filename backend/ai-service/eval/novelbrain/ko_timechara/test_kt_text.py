"""KoTimeChara 텍스트 처리 단위 테스트: 인코딩·회차 나누기·근거 대조·고전 위키텍스트 정리. 합성 입력만 쓴다(소설 원문 없음)."""

import zipfile

import pytest

from kt_text import (
    canonical_names,
    clean_wikitext,
    decode_bytes,
    epub_text,
    evidence_ok,
    group_paragraphs,
    modernize_hangul,
    normalize,
    split_episodes,
)

BODY = '이야기가 이어진다. ' * 80


def novel(headings):
    return '\n'.join(f'{h}\n{BODY}' for h in headings)


def test_decode_bytes_reads_bom_utf16_utf8_and_cp949():
    text = '안녕하세요 소설입니다'
    assert decode_bytes(text.encode('utf-8-sig')) == text
    assert decode_bytes(text.encode('utf-8')) == text
    assert decode_bytes(text.encode('utf-16')) == text
    assert decode_bytes(text.encode('cp949')) == text
    with pytest.raises(ValueError):
        decode_bytes(b'\x81\x20\xfe\xfe')                                     # utf-8도 cp949도 아님


def test_split_episodes_finds_numbered_headings_and_returns_bodies():
    pattern, episodes = split_episodes(novel([f'{n}화' for n in range(1, 31)]))
    assert pattern and [e['number'] for e in episodes] == list(range(1, 31))
    assert all(BODY.strip() in e['text'] for e in episodes)
    assert not episodes[0]['text'].startswith('1화')                       # 제목 줄은 본문에 넣지 않는다


def test_split_episodes_handles_je_jang_and_numbered_titles():
    _, episodes = split_episodes(novel([f'제{n}장 새로운 시작' for n in range(1, 25)]))
    assert len(episodes) == 24
    _, episodes = split_episodes(novel([f'{n:03d}. 제목이 있는 회차' for n in range(1, 25)]))
    assert len(episodes) == 24
    assert episodes[3]['title'] == '제목이 있는 회차'


def test_split_episodes_ignores_stray_numbers_between_headings():
    # 본문 속 '5화'·가짜 번호가 사슬을 깨지 않는다: 1부터 1씩 이어지는 제목만 쓴다
    text = novel([f'{n}화' for n in range(1, 31)]).replace('이야기가 이어진다. ', '이야기가 이어진다.\n99화\n7화\n', 1)
    _, episodes = split_episodes(text)
    assert [e['number'] for e in episodes] == list(range(1, 31))


def test_split_episodes_picks_the_longest_chain_and_rejects_short_ones():
    with pytest.raises(ValueError):
        split_episodes(novel([f'{n}화' for n in range(1, 6)]), min_episodes=20)
    with pytest.raises(ValueError):
        split_episodes('제목 없는 긴 글\n' + BODY * 40)


def test_split_episodes_rejects_episodes_that_are_too_short():
    short = '\n'.join(f'{n}화\n짧다.' for n in range(1, 31))
    with pytest.raises(ValueError):
        split_episodes(short)


def test_normalize_and_evidence_ok_match_literally_after_folding_whitespace_and_quotes():
    text = '그는 “가자.”라고 말했다.\n   문이 열렸다.'
    assert normalize('“가자.” 라고') == normalize('"가자." 라고')
    assert evidence_ok(text, '문이 열렸다.')
    assert evidence_ok(text, '그는 "가자."라고 말했다.')          # 따옴표 모양은 맞춘다
    assert not evidence_ok(text, '문이 닫혔다.')
    assert not evidence_ok(text, '')
    assert not evidence_ok(text, '문')                                 # 너무 짧은 근거는 거른다


def test_group_paragraphs_makes_equal_sized_episodes_in_order():
    paragraphs = [f'문단{i} ' + '가' * 50 for i in range(60)]
    episodes = group_paragraphs('\n\n'.join(paragraphs), 12)
    assert len(episodes) == 12 and [e['number'] for e in episodes] == list(range(1, 13))
    assert ''.join(e['text'].replace('\n', '') for e in episodes).replace(' ', '') == ''.join(paragraphs).replace(' ', '')


def test_clean_wikitext_strips_templates_links_and_markup():
    raw = '{{머리말|제목=가}}\n{{옛한글/시작}}\n== 상권 ==\n[[글쓴이:김|김만중]]이 [[쓴]] 이야기 <br/> 입니다.\n<div>안녕</div>\n{{옛한글/끝}}'
    cleaned = clean_wikitext(raw)
    assert '{{' not in cleaned and '[[' not in cleaned and '<' not in cleaned
    assert '김만중이 쓴 이야기' in cleaned and '안녕' in cleaned


def test_modernize_hangul_composes_arae_a_syllables():
    assert modernize_hangul('ᄒᆞᆫ') == '한'
    assert modernize_hangul('가나다') == '가나다'                      # 현대 한글은 그대로


def test_epub_text_reads_xhtml_in_order_without_tags(tmp_path):
    path = tmp_path / 'book.epub'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('OEBPS/ch2.xhtml', '<html><body><p>둘째 장입니다.</p></body></html>')
        z.writestr('OEBPS/ch1.xhtml', '<html><body><h1>1화</h1><p>첫째 장입니다.</p><script>x()</script></body></html>')
        z.writestr('OEBPS/style.css', 'p {}')
    text = epub_text(path)
    assert text.index('첫째 장') < text.index('둘째 장') and '<' not in text and 'x()' not in text


def test_canonical_names_merge_suffix_and_first_word_forms_only_when_unambiguous():
    text = '김철수가 왔다. 철수는 웃었다. 철수야. 박민수와 한민수가 싸웠다. 민수가 말했다. 엘리자베스 폰 하인이 왔다. 엘리자베스가 웃었다.'
    names = ['김철수', '철수', '박민수', '한민수', '민수', '엘리자베스 폰 하인', '엘리자베스', '영']
    canon = canonical_names(names, text)
    assert canon['김철수'] == canon['철수'] == '철수'                       # 짧은 형태가 대표(긴 이름의 글에도 부분 일치한다)
    assert canon['민수'] == '민수' and canon['박민수'] == '박민수' and canon['한민수'] == '한민수'   # 긴 이름이 둘이면 묶지 않는다
    assert canon['엘리자베스 폰 하인'] == canon['엘리자베스'] == '엘리자베스'
    assert canon['영'] == '영'
