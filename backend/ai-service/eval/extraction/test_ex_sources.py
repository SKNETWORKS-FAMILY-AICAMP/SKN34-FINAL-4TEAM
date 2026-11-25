"""평가 원천(ex_sources): 공개 근대 소설을 회차 크기로 자르고 해리 포터 장 덩어리를 회차 크기 조각으로 고른다. 파일은 임시 폴더의 가짜 원문이고 호출은 없다."""

import json
import re

import ex_sources

PARAGRAPH = '가나다라마바사 ' * 12   # 약 100자 문단


def wikitext(*paragraphs, template='{{PD-old-50}}'):
    return '{{머리말\n|제목 = 시험\n|지은이 = [[글쓴이:누구|누구]]\n}}\n\n<center>🙝🙟</center>\n' + '\n\n🙝🙟\n\n'.join(paragraphs) + f'\n\n{template}\n\n[[분류:중편소설]]\n'


def public_dir(tmp_path, monkeypatch, texts, **options):
    monkeypatch.setattr(ex_sources, 'PUBLIC', tuple((title, '작가' + title) for title in texts))
    monkeypatch.setattr(ex_sources, 'DIED', {'작가' + title: 1900 + n for n, title in enumerate(texts)})
    monkeypatch.setattr(ex_sources, 'EPISODE_CHARS', 500)
    for title, paragraphs in texts.items():
        (tmp_path / f'{title}.txt').write_text(wikitext(*paragraphs, **options), encoding='utf-8')
    return tmp_path


def test_public_episodes_strip_the_wiki_markup_and_cut_each_work_into_episode_sized_parts(tmp_path, monkeypatch):
    texts = {'가': [f'{PARAGRAPH}{n}' for n in range(10)], '나': [f'{PARAGRAPH}{n}' for n in range(4)]}   # 약 1,000자와 400자

    episodes = ex_sources.public_episodes(public_dir(tmp_path, monkeypatch, texts))

    assert [(e['title'], e['number']) for e in episodes] == [('가', 1), ('가', 2), ('나', 1)]   # 500자 안팎으로 묶는다: 회차 번호는 작품마다 1부터
    assert [e['id'] for e in episodes] == ['extraction.extract-01', 'extraction.extract-02', 'extraction.extract-03']
    for e in episodes:
        assert '{{' not in e['body'] and '머리말' not in e['body'] and '🙝' not in e['body'] and '<center>' not in e['body'] and '분류' not in e['body']
        assert set(e) == {'id', 'number', 'title', 'body', 'license', 'source'}
    assert '\n'.join(e['body'] for e in episodes[:2]) == '\n'.join(texts['가'])   # 문단을 하나도 빠뜨리거나 바꾸지 않는다


def test_public_episodes_carry_the_work_author_origin_and_the_license_from_the_page_for_the_dataset_item(tmp_path, monkeypatch):
    [episode] = ex_sources.public_episodes(public_dir(tmp_path, monkeypatch, {'가': [PARAGRAPH, PARAGRAPH]}, template='{{PD-old-70}}'))

    license = '저작권 만료(저자 사망 1900년, 위키문헌 {{PD-old-70}})'   # 사망 연도는 작가 표, 틀은 그 문서가 단 것
    assert episode['license'] == license
    assert episode['source'] == {'work': '가', 'author': '작가가', 'origin': 'https://ko.wikisource.org/wiki/가', 'license': license, 'episode': 1}


def test_a_page_without_a_license_template_still_has_the_death_year_as_the_basis(tmp_path, monkeypatch):
    [episode] = ex_sources.public_episodes(public_dir(tmp_path, monkeypatch, {'가': [PARAGRAPH, PARAGRAPH]}, template=''))

    assert episode['license'] == '저작권 만료(저자 사망 1900년)'


def test_a_long_work_contributes_at_most_max_per_work_episodes_spread_evenly_with_their_own_numbers(tmp_path, monkeypatch):
    monkeypatch.setattr(ex_sources, 'MAX_PER_WORK', 3)
    texts = {'가': [f'{PARAGRAPH}{n:02d}' for n in range(40)], '나': [f'{PARAGRAPH}{n}' for n in range(5)]}   # 약 4,000자 = 8회차, 그리고 500자 = 1회차

    episodes = ex_sources.public_episodes(public_dir(tmp_path, monkeypatch, texts))

    assert [(e['title'], e['number']) for e in episodes] == [('가', 1), ('가', 3), ('가', 6), ('나', 1)]   # 8회차 중 처음·셋째·여섯째(고르게), 회차 번호는 작품 안의 순서 그대로
    assert [e['id'] for e in episodes] == [f'extraction.extract-{n:02d}' for n in range(1, 5)]


def test_the_work_table_has_one_row_per_page_and_only_authors_whose_protection_ended_before_the_2013_extension():
    titles = [title for title, _ in ex_sources.PUBLIC]

    assert len(titles) == len(set(titles)) and len(titles) >= 60
    assert {author for _, author in ex_sources.PUBLIC} <= set(ex_sources.DIED)   # 작가마다 사망 연도가 있다
    assert max(ex_sources.DIED.values()) <= 1962   # 사후 50년이 2012년에 끝난 작가만: 1963년 이후 사망 작가는 70년 연장이 닿는다
    assert [title for title, _ in ex_sources.PUBLIC][:5] == ['운수 좋은 날', '술 권하는 사회', '감자', '봄봄', '레디메이드 인생']   # 회차 id의 순서(먼저 만든 정답표 캐시가 id로 이어진다): 새 작품은 뒤에만 더한다


def test_fetch_public_downloads_only_the_pages_that_are_not_on_disk_yet(tmp_path, monkeypatch):
    monkeypatch.setattr(ex_sources, 'PUBLIC', (('가', '작가'), ('나', '작가')))
    (tmp_path / '가.txt').write_text('이미 있다', encoding='utf-8')
    asked = []
    monkeypatch.setattr(ex_sources.kt_select, 'fetch_classic', lambda title, dest: asked.append((title, dest)))

    ex_sources.fetch_public(tmp_path)

    assert asked == [('나', tmp_path / '나.txt')]   # 위키문헌에는 낮은 속도로만 요청한다(받은 것은 다시 받지 않는다)


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
