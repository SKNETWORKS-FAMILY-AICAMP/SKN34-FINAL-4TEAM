"""웹소설 평가 원천(ex_webnovel): 장르·제목·인코딩·회차 표지 판별, 운영 크기 회차 만들기, 작품 고르기를 가짜 txt로 확인한다. 실제 웹소설 글은 쓰지 않는다. 호출 없음."""

import json
import re

import pytest

import ex_webnovel

LOW, HIGH = ex_webnovel.LOW, ex_webnovel.HIGH


def line(tag, j):
    return f'{tag}-{j:03d} ' + '가' * 40   # 48자 한 줄(문단)


def heading(style, n):
    return {'hwa': f'{n}화', 'je': f'제{n}화 시작', 'title_hwa': f'가상 연대기 {n}화', 'dash': f'- {n} -', 'hash': f'# {n}', 'num_dot': f'{n}. 새 장',
            'num_title': f'#{n} 새 장', 'ep': f'EP.{n}', 'slash': f'{n:04d} / 0040 ------'}[style]


def novel(style='hwa', count=35, start=1, size=110):
    """머리글 다음에 회차가 count개(한 회차 size줄) 이어지는 txt 글."""
    rows = ['가상 연대기', '시험 작가', '']
    for n in range(start, start + count):
        rows += [heading(style, n), *(line(f'e{n:02d}', j) for j in range(size))]
    return '\n'.join(rows)


def episodes_of(sizes):
    """(번호, 문단들) 목록: 번호는 1부터, i번째 회차는 sizes[i]줄이다."""
    return [(i + 1, [line(f'p{i:02d}', j) for j in range(size)]) for i, size in enumerate(sizes)]


@pytest.mark.parametrize('name, genre', [
    ('검은 무림의 왕 1-100 완.txt', '무협'), ('악녀는 공작가에서 살아남는다 1-50.txt', '로판'), ('대체역사 이순신의 후예 1-30.txt', '대체역사'),
    ('우주 함대의 막내 1-80.txt', 'SF'), ('플레이어는 만렙부터 시작한다 1-80.txt', '겜판'), ('헌터 사무소의 신입 1-20.txt', '현판'),
    ('이세계에서 마법사로 환생했다 1-20.txt', '판타지'), ('느긋한_하루_1_200_연재중@판타지.txt', '판타지'), ('평범한 하루의 기록 1-20.txt', '기타'),
    ('은하수를 건너는 회사원 1-80 현판.txt', '현판'), ('안개 마을의 마왕 1-30 퓨판.txt', '판타지')])   # 파일 이름이 장르를 직접 적었으면 다른 말보다 그것이 먼저다
def test_the_genre_comes_from_the_markers_and_keywords_in_the_file_name_and_unknown_is_other(name, genre):
    assert ex_webnovel.genre_of(name) == genre


@pytest.mark.parametrize('name', ['느긋한 하루 1-200 [완].txt', '느긋한_하루_1_200_연재중@판타지.txt', '느긋한 하루 (완) [작가].txt', '느긋한 하루 1~200화 完.txt', '느긋한 하루 (1).txt', '느긋한 하루 1-8권(완).txt', '느긋한+하루+1-209완.txt'])
def test_the_title_is_the_file_name_without_markers_ranges_and_authors(name):
    assert ex_webnovel.clean_title(name) == '느긋한 하루'


TEXT = '그는 천천히 문을 열고 안으로 들어갔다.\n' * 50


@pytest.mark.parametrize('raw', [TEXT.encode('utf-8'), b'\xef\xbb\xbf' + TEXT.encode('utf-8'), TEXT.encode('cp949'), TEXT.encode('utf-16')], ids=['utf-8', 'utf-8-bom', 'cp949', 'utf-16'])
def test_decode_reads_the_encodings_of_the_files(raw):
    assert ex_webnovel.decode(raw) == TEXT


@pytest.mark.parametrize('raw', [('Hello world. ' * 100).encode(), (TEXT + '\ufffd').encode('utf-8'), b'\xff\xfe\x00', bytes(range(128, 256)) * 50])
def test_decode_skips_what_is_not_readable_korean_text(raw):
    assert ex_webnovel.decode(raw) is None


@pytest.mark.parametrize('style', ['hwa', 'je', 'title_hwa', 'dash', 'hash', 'num_dot', 'num_title', 'ep', 'slash'])
def test_split_cuts_the_episodes_at_whichever_heading_style_counts_up_from_one(style):
    episodes = ex_webnovel.split(novel(style))

    assert [n for n, _ in episodes] == list(range(1, 36))
    assert episodes[0][1] == [line('e01', j) for j in range(110)] and episodes[34][1][-1] == line('e35', 109)   # 머리글과 회차 표지 줄은 글에 없다


def test_split_numbers_a_prologue_zero_as_one_and_tolerates_a_skipped_number():
    zero = ex_webnovel.split(novel(start=0))
    skipped = ex_webnovel.split(novel().replace('\n5화\n', '\n').replace('e05-', 'e04-'))   # 5화 표지가 빠진 글

    assert [n for n, _ in zero][:3] == [1, 2, 3] and len(zero) == 35
    assert len(skipped) == 34 and [n for n, _ in skipped][3:6] == [4, 6, 7]


def test_split_finds_no_episodes_when_the_headings_are_too_few():
    assert ex_webnovel.split(novel('hwa', count=29)) == [] and len(ex_webnovel.split(novel('hwa', count=30))) == 30   # 30개 미만이면 작품으로 쓰지 않는다


def test_a_number_inside_a_sentence_is_not_a_heading():
    sentence = novel('hwa').replace('\n7화\n', '\n그날로부터 7화 만에 모든 것이 끝났다고 사람들은 말했다.\n')

    assert [n for n, _ in ex_webnovel.split(sentence)] == [*range(1, 7), *range(8, 36)]   # 문장은 7화 표지가 아니라 6화의 글이다


def test_a_long_line_is_not_a_heading_even_when_it_starts_with_the_next_number():
    long_line = '7화 ' + '가' * 80
    text = novel('hwa').replace('\n7화\n', f'\n{long_line}\n')

    assert [n for n, _ in ex_webnovel.split(text)] == [*range(1, 7), *range(8, 36)] and long_line in ex_webnovel.split(text)[5][1]   # 70자를 넘는 줄은 6화의 글이다


def test_a_unit_takes_whole_paragraphs_until_the_operating_size_and_goes_on_into_the_next_episode():
    text, after = ex_webnovel.take(episodes_of([60] * 40), 0)

    assert LOW <= len(text) <= HIGH and text.splitlines()[0] == line('p00', 0) and line('p01', 42) in text and line('p01', 43) not in text
    assert after == 2   # 둘째 회차의 남은 글은 쓰지 않고 셋째 회차부터 이어 간다


def test_a_unit_cuts_a_long_episode_at_a_paragraph_and_leaves_the_rest():
    text, after = ex_webnovel.take(episodes_of([200] * 40), 0)

    assert LOW <= len(text) <= HIGH and text.splitlines()[-1] == line('p00', 102) and after == 1


def test_units_are_three_early_episodes_and_one_middle_episode_that_do_not_overlap():
    short = ex_webnovel.units(episodes_of([60] * 40))
    long = ex_webnovel.units(episodes_of([110] * 35))

    assert [n for n, _ in short] == [1, 3, 5, 21] and [n for n, _ in long] == [1, 2, 3, 18]   # 앞 셋은 이어서, 중반은 한가운데 회차부터
    for units in (short, long):
        rows = [row for _, text in units for row in text.splitlines()]
        assert len(rows) == len(set(rows)) and all(LOW <= len(text) <= HIGH for _, text in units)   # 겹치는 글이 없다


@pytest.mark.parametrize('episodes', [episodes_of([5] * 35), [(1, ['가' * 9000]), *episodes_of([110] * 34)[1:]]], ids=['too-little-text', 'one-giant-paragraph'])
def test_a_work_without_enough_text_or_with_a_giant_paragraph_has_no_units(episodes):
    assert ex_webnovel.units(episodes) == []


def test_a_work_whose_paragraphs_are_too_long_to_fill_the_size_has_no_units():
    episodes = [(i + 1, ['가' * 3500] * 3) for i in range(35)]   # 문단 둘이면 HIGH를 넘고 하나로는 모자란다

    assert ex_webnovel.units(episodes) == []


def library(tmp_path, files):
    root = tmp_path / 'novels'
    root.mkdir()
    for name, raw in files.items():
        (root / name).write_bytes(raw)
    return root


FILES = {'검은 무림의 왕 1-35 완.txt': novel().encode(), '검은 무림의 왕 1-35 (완).txt': novel().encode(), '무림 도사 이야기 1-35.txt': novel('dash').encode('cp949'),
         '악녀는 공작가에서 산다 1-35.txt': novel('num_dot').encode('utf-16'), '헌터 사무소 1-35.txt': b'not korean', '평범한 기록 1-35.txt': novel().encode(),
         'AI번역 무림 대협 1-35.txt': novel().encode(), '느긋한 하루_1_35_연재중@판타지.txt': novel('ep').encode(), '메모.zip': b'x'}


def test_select_alternates_the_genres_and_skips_unreadable_duplicate_and_translated_works(tmp_path):
    root = library(tmp_path, FILES)

    works = ex_webnovel.select(root, 4)
    more = ex_webnovel.select(root, 6)

    assert [w['genre'] for w in works] == ['무협', '로판', '판타지', '기타'] and works == more[:4] and works == ex_webnovel.select(root, 4)   # 장르를 번갈아 돌고 같은 입력이면 같은 선택이다
    assert len(more) == 5 and len({w['title'] for w in more}) == 5   # 같은 제목(검은 무림의 왕 두 파일)은 한 번만
    assert not {w['file'] for w in more} & {'AI번역 무림 대협 1-35.txt', '헌터 사무소 1-35.txt', '메모.zip'}   # 번역본·읽을 수 없는 글·txt가 아닌 것은 뺀다
    assert all(w['episodes'][0] == 1 and len(w['episodes']) == 4 for w in works)


def test_episodes_pick_the_works_once_and_keep_them_in_the_manifest(tmp_path):
    root = library(tmp_path, FILES)
    manifest = tmp_path / 'data' / 'webnovel' / 'manifest.json'

    first = ex_webnovel.episodes(root, manifest, count=2)
    (root / '새 작품 1-35.txt').write_bytes(novel().encode())

    assert [w['title'] for w in json.loads(manifest.read_text(encoding='utf-8'))] == [e['source']['work'] for e in first[::4]]
    assert [e['id'] for e in first] == [f'webnovel-{w:02d}-{k}' for w in (1, 2) for k in (1, 2, 3, 4)]
    assert all(LOW <= len(e['body']) <= HIGH and e['number'] >= 1 and e['title'] == e['source']['work'] for e in first)
    assert {e['license'] for e in first} == {e['source']['license'] for e in first} == {ex_webnovel.LICENSE}
    assert ex_webnovel.LICENSE.startswith('저작권 있음') and '로컬' in ex_webnovel.LICENSE and '저장소·Langfuse에 두지 않는다' in ex_webnovel.LICENSE   # 저장소·Langfuse에 두지 않는 표시
    assert ex_webnovel.episodes(root, manifest, count=2) == first   # 선택표가 있으면 새 파일이 생겨도 같은 선택이다


def test_a_file_that_no_longer_matches_the_manifest_fails_loudly(tmp_path):
    root = library(tmp_path, FILES)
    manifest = tmp_path / 'manifest.json'
    ex_webnovel.episodes(root, manifest, count=1)
    work = json.loads(manifest.read_text(encoding='utf-8'))[0]
    (root / work['file']).write_bytes(novel(count=33).encode())   # 회차 수가 달라져 중반 회차가 옮겨 간다

    with pytest.raises(ValueError, match=re.escape(work['file'])):
        ex_webnovel.episodes(root, manifest, count=1)
