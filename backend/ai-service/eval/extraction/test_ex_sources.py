"""평가 원천(ex_sources): 공개 근대 소설을 회차 크기로 자르고 해리 포터 장 덩어리를 회차 크기 조각으로 고른다. 파일은 임시 폴더의 가짜 원문이고 호출은 없다."""

import json
import re

import ex_sources

PARAGRAPH = '가나다라마바사 ' * 12   # 약 100자 문단


def wikitext(*paragraphs):
    return '{{머리말\n|제목 = 시험\n|지은이 = [[글쓴이:누구|누구]]\n}}\n\n<center>🙝🙟</center>\n' + '\n\n🙝🙟\n\n'.join(paragraphs) + '\n'


def public_dir(tmp_path, monkeypatch, texts):
    monkeypatch.setattr(ex_sources, 'PUBLIC', tuple((title, '작가' + title, f'저작권 만료({title})') for title in texts))
    monkeypatch.setattr(ex_sources, 'EPISODE_CHARS', 500)
    for title, paragraphs in texts.items():
        (tmp_path / f'{title}.txt').write_text(wikitext(*paragraphs), encoding='utf-8')
    return tmp_path


def test_public_episodes_strip_the_wiki_markup_and_cut_each_work_into_episode_sized_parts(tmp_path, monkeypatch):
    texts = {'가': [f'{PARAGRAPH}{n}' for n in range(10)], '나': [f'{PARAGRAPH}{n}' for n in range(4)]}   # 약 1,000자와 400자

    episodes = ex_sources.public_episodes(public_dir(tmp_path, monkeypatch, texts))

    assert [(e['title'], e['number']) for e in episodes] == [('가', 1), ('가', 2), ('나', 1)]   # 500자 안팎으로 묶는다: 회차 번호는 작품마다 1부터
    assert [e['id'] for e in episodes] == ['extraction.extract-01', 'extraction.extract-02', 'extraction.extract-03']
    for e in episodes:
        assert '{{' not in e['body'] and '머리말' not in e['body'] and '🙝' not in e['body'] and '<center>' not in e['body']
        assert set(e) == {'id', 'number', 'title', 'body', 'license', 'source'}
    assert '\n'.join(e['body'] for e in episodes[:2]) == '\n'.join(texts['가'])   # 문단을 하나도 빠뜨리거나 바꾸지 않는다


def test_public_episodes_carry_the_work_author_origin_and_license_for_the_dataset_item(tmp_path, monkeypatch):
    [episode] = ex_sources.public_episodes(public_dir(tmp_path, monkeypatch, {'가': [PARAGRAPH, PARAGRAPH]}))

    assert episode['license'] == '저작권 만료(가)'
    assert episode['source'] == {'work': '가', 'author': '작가가', 'origin': 'https://ko.wikisource.org/wiki/가', 'license': '저작권 만료(가)', 'episode': 1}


def test_every_listed_public_work_is_expired_copyright():
    assert len(ex_sources.PUBLIC) == 5
    for title, author, license in ex_sources.PUBLIC:
        assert title and author and license.startswith('저작권 만료')   # 게이트 세트는 저작권 만료 작품만 쓴다


def hp_dir(tmp_path):
    chapters = tmp_path / 'chapters'
    chapters.mkdir()
    lines = lambda tag, n: '\n'.join(f'{tag}{i} ' + '가' * 90 for i in range(n))   # 줄마다 약 95자  # noqa: E731
    files = {'b1-01': lines('a', 12), 'b1-02-03': lines('b', 6), 'b2-01': lines('c', 4)}
    for name, text in files.items():
        (chapters / f'{name}.txt').write_text(text, encoding='utf-8')
    index = {'1': {'units': [{'chapters': [1], 'chars': 1}, {'chapters': [2, 3], 'chars': 1}]}, '2': {'units': [{'chapters': [1], 'chars': 1}]}}
    (chapters / 'index.json').write_text(json.dumps(index), encoding='utf-8')
    return tmp_path


def test_hp_episodes_cut_the_chapter_units_into_episode_sized_pieces_and_pick_evenly_per_book(tmp_path):
    episodes = ex_sources.hp_episodes(hp_dir(tmp_path), per_book=2, size=400)

    assert [(e['id'], e['title'], e['number']) for e in episodes] == [('hp-b1-01-1', '해리 포터 1권', 1), ('hp-b1-01-3', '해리 포터 1권', 2), ('hp-b2-01-1', '해리 포터 2권', 1)]   # 1권은 조각 넷 중 처음·셋째, 2권은 하나뿐
    assert all(len(e['body']) <= 400 for e in episodes)   # 줄 경계로 size 안에서 자른다
    assert all(e['license'].startswith('저작권 있음') and '로컬' in e['license'] for e in episodes)   # 저장소·Langfuse에 두지 않는 표시


def test_hp_episodes_skip_the_short_tail_of_a_unit(tmp_path):
    folder = hp_dir(tmp_path)

    names = [e['id'] for e in ex_sources.hp_episodes(folder, per_book=10, size=400)]

    assert names == ['hp-b1-01-1', 'hp-b1-01-2', 'hp-b1-01-3', 'hp-b1-02-03-1', 'hp-b2-01-1']   # 1권 첫 덩어리 12줄 = 400자씩 3조각, 꼬리가 절반 미만인 조각은 뺀다
    assert not any(re.search(r'b1-02-03-2', name) for name in names)
