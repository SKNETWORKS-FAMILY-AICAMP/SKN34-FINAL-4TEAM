"""작품 고르기 단위 테스트: 장르 분류·후보 선별·장르별 선택·고전 회차 만들기. 합성 입력만 쓴다(소설 원문 없음)."""

import json
import zipfile

import pytest

from kt_select import (QUOTA, _order, choose, classify_genre, find_sources, normalize_title, numbered, pick_new, prepare_classic, quota_for, read_head,
                       save_new_works, screen)

BODY = '이야기가 이어진다. ' * 300


def novel(count, body=BODY):
    return '\n'.join(f'{n}화\n{body}' for n in range(1, count + 1))


def test_classify_genre_prefers_title_words_then_head_words():
    assert classify_genre('무림 최강 사부 1-300 완', '평범한 글') == '무협'
    assert classify_genre('제목 없음', '헌터 협회와 던전 게이트 헌터 스킬 던전') == '현대판타지'
    assert classify_genre('악녀 영애의 공작 저택 완결', '') == '로맨스판타지'
    assert classify_genre('아무 제목', '아무 내용') == '기타'


def test_screen_accepts_a_finished_novel_and_reports_stats():
    row, reason = screen('무림 최강 1-200 완', novel(30))
    assert reason == 'ok' and row['chain'] == 30 and row['genre'] == '무협' and row['completed']
    assert row['median_chars'] > 2500


@pytest.mark.parametrize('name, text, reason', [
    ('소설 1-200 [미완]', novel(30), 'unfinished'),
    ('소설 완', '제목 없는 긴 글\n' + BODY * 40, 'no_chain'),
    ('소설 완', novel(30, '짧다.'), 'no_chain'),
    ('소설 완', novel(30, '문장입니다. ' * 150), 'short_episodes'),
])
def test_screen_rejects_unfinished_unsplittable_and_short_works(name, text, reason):
    assert screen(name, text) == (None, reason)


def test_choose_fills_the_quota_per_genre_deterministically_and_redistributes_missing_genres():
    rows = [{'file': f'{g}-{i}', 'genre': g} for g in QUOTA for i in range(6)]
    picked = choose(rows, seed=58)
    assert [r['genre'] for r in picked].count('무협') == QUOTA['무협']
    assert len(picked) == sum(QUOTA.values()) and picked == choose(rows, seed=58)
    assert picked != choose(rows, seed=59)
    thin = [r for r in rows if r['genre'] != '대체역사']                  # 한 장르가 비면 남은 장르에서 채워 총수를 지킨다
    assert len(choose(thin, seed=58)) == sum(QUOTA.values())


def test_quota_for_keeps_the_base_ratio_and_the_first_picks_when_the_work_count_grows():
    assert quota_for(12) == QUOTA
    grown = quota_for(40)
    assert sum(grown.values()) == 40 and all(grown[g] >= QUOTA[g] for g in QUOTA) and grown['현대판타지'] == 10
    assert all(quota_for(n + 1)[g] >= quota_for(n)[g] for n in range(12, 90) for g in QUOTA)   # 편수를 더 늘려도 이미 고른 작품이 빠지지 않는다
    rows = [{'file': f'{g}-{i}', 'genre': g} for g in QUOTA for i in range(30)]
    assert all(r in choose(rows, 58, grown) for r in choose(rows, 58))                  # 편수를 늘려도 처음 12편은 그대로(id 유지)


def test_prepare_classic_cleans_modernizes_caps_and_groups_into_episodes():
    raw = '{{머리말}}\n' + '\n'.join(f'ᄒᆞᆫ 사람이 {n}번째 길을 갔다.' for n in range(400))
    episodes = prepare_classic(raw, count=10, cap_chars=6000)
    assert [e['number'] for e in episodes] == list(range(1, 11))
    assert sum(len(e['text']) for e in episodes) <= 6100 and '{{' not in episodes[0]['text']
    assert '한 사람이' in episodes[0]['text']


def test_read_head_reads_txt_in_any_supported_encoding_and_epub_but_skips_other_formats(tmp_path):
    text = '가나다라마바사 ' * 100
    (tmp_path / 'utf.txt').write_bytes(text.encode('utf-8'))
    (tmp_path / 'legacy.txt').write_bytes(text.encode('cp949'))
    assert read_head(tmp_path / 'utf.txt') == text and read_head(tmp_path / 'legacy.txt') == text
    assert read_head(tmp_path / 'utf.txt', limit=46) == text.encode('utf-8')[:44].decode('utf-8')   # 읽다가 잘린 끝 글자(2바이트)는 버린다
    with zipfile.ZipFile(tmp_path / 'book.epub', 'w') as z:
        z.writestr('OEBPS/ch1.xhtml', '<html><body><p>첫째 장입니다.</p></body></html>')
    assert '첫째 장입니다.' in read_head(tmp_path / 'book.epub')
    (tmp_path / 'archive.zip').write_bytes(b'PK')
    (tmp_path / 'broken.epub').write_bytes(b'not a zip')
    assert read_head(tmp_path / 'archive.zip') is None and read_head(tmp_path / 'broken.epub') is None


# ---- add: 기존 선정과 겹치지 않는 새 작품 고르기 ----

def test_normalize_title_gives_every_edition_of_one_work_the_same_key():
    key = normalize_title('가나다 라마바 1-270.txt')
    for name in ('[필명] 가나다_라마바_1_300_完@작가.epub', '가나다 라마바 001-322 (완).txt', '가나다+라마바+1-100화 [완] 외포.txt',
                 '가나다 라마바 텍완.txt', '가나다 라마바 2부 1-80.txt', '[가나다 라마바] 1-100.txt', '[현판](필명) 가나다 라마바 텍완.epub'):
        assert normalize_title(name) == key, name
    assert normalize_title('가나다 라마사 1-270.txt') != key and normalize_title('1-100.txt') == ''


def work_of(seed):
    return {'episodes': [{'number': n, 'text': f'{seed}의 {n}번째 이야기가 이어진다. ' * 20} for n in range(1, 9)]}


def test_find_sources_lists_every_candidate_file_whose_head_holds_the_works_body():
    work = work_of('A')
    head = lambda w: '\n'.join(f"{e['number']}화\n{e['text']}" for e in w['episodes'])
    texts = {'x.txt': head(work), 'x 판본.txt': '머리말\n' + head(work), 'y.txt': head(work_of('B')), 'broken.txt': None}
    rows = [{'file': name} for name in texts]
    found = find_sources({'w01': work, 'w02': work_of('C')}, rows, lambda r: texts[r['file']])
    assert [r['file'] for r in found['w01']] == ['x.txt', 'x 판본.txt'] and found['w02'] == []       # 판본이 여럿이면 모두, 없으면 빈 목록


def test_pick_new_fills_the_quota_without_excluded_titles_duplicate_titles_or_unloadable_files():
    rows = [{'file': f'{g}{i} 1-100.txt', 'genre': g, 'median_chars': 5000} for g in QUOTA for i in range(8)]
    rows += [{'file': '[필명] 무협0 101-200 완.epub', 'genre': '무협', 'median_chars': 5000},        # 같은 작품의 다른 판본·분권
             {'file': '무협9 1-100.txt', 'genre': '무협', 'median_chars': 12_001}]                    # 회차가 너무 길다
    excluded = {normalize_title('무협1 1-100.txt'), normalize_title('판타지2 1-100.txt')}
    quota = quota_for(20)
    first = pick_new(rows, 7, quota, lambda row: ('n_hwa', []), excluded)[0][0]['file']
    tried = []

    def load(row):
        tried.append(row['file'])
        return None if row['file'] == first else ('n_hwa', [])                  # 처음 뽑힐 후보 하나를 못 읽는다고 하면 다음 후보로 바뀐다

    picked, ready, stats = pick_new(rows, 7, quota, load, excluded)
    titles = [normalize_title(r['file']) for r in picked]
    assert {g: sum(r['genre'] == g for r in picked) for g in quota} == quota and len(set(titles)) == 20 and ready.keys() == {r['file'] for r in picked}
    assert not excluded & set(titles) and first in tried and first not in ready and '무협9 1-100.txt' not in tried and stats['replaced'] == 1
    assert stats['pool']['무협'] == 7                                         # 무협 8 + 다른 판본 1 - 제외 1 - 같은 제목 1 (회차가 너무 긴 후보는 처음부터 뺀다)
    assert pick_new(rows, 7, quota, load, excluded)[0] == picked and pick_new(rows, 8, quota, load, excluded)[0] != picked


def test_numbered_follows_genre_then_file_order_and_save_new_works_never_overwrites_a_different_work(tmp_path):
    picked = [{'file': 'b.txt', 'genre': '판타지'}, {'file': 'a.txt', 'genre': '판타지'}, {'file': 'z.txt', 'genre': '무협'}]
    assert [(i, r['file']) for i, r in numbered(picked, 'n').items()] == [('n01', 'z.txt'), ('n02', 'a.txt'), ('n03', 'b.txt')]   # 가나다 순: 무협 < 판타지
    assert save_new_works(tmp_path, {'n01': {'id': 'n01', 'episodes': [1]}}) == 1
    assert save_new_works(tmp_path, {'n01': {'id': 'n01', 'episodes': [1]}, 'n02': {'id': 'n02', 'episodes': [2]}}) == 1      # 같으면 건너뛰고 새것만
    with pytest.raises(SystemExit):
        save_new_works(tmp_path, {'n01': {'id': 'n01', 'episodes': [9]}, 'n03': {'id': 'n03', 'episodes': [3]}})
    assert json.loads((tmp_path / 'n01' / 'work.json').read_text()) == {'id': 'n01', 'episodes': [1]} and not (tmp_path / 'n03').exists()   # 하나라도 다르면 아무것도 안 쓴다


# ---- PR #945 리뷰 후속(#948): 새로 고른 작품끼리의 본문 중복 ----

def test_pick_new_never_keeps_two_works_with_the_same_body_under_different_titles_and_refills_the_quota():
    rows = [{'file': f'{title} 1-100.txt', 'genre': '무협', 'median_chars': 5000} for title in ('가나', '가나 개정판본', '다라', '마바', '사아', '자차')]   # 앞의 둘은 제목 열쇠가 다른 같은 본문
    body = {'가나 1-100.txt': 'A', '가나 개정판본 1-100.txt': 'A', '다라 1-100.txt': 'D', '마바 1-100.txt': 'M', '사아 1-100.txt': 'S', '자차 1-100.txt': 'J'}
    for seed in range(12):
        picked, ready, stats = pick_new(rows, seed, {'무협': 4}, lambda row: ('n_hwa', work_of(body[row['file']])['episodes']))
        bodies = [body[r['file']] for r in picked]
        assert len(picked) == 4 and len(set(bodies)) == 4 and ready.keys() == {r['file'] for r in picked}, (seed, bodies)       # 같은 본문은 한 편만, 정원은 다시 채운다


def test_pick_new_checks_each_candidate_against_the_current_selection_so_an_excluded_work_never_blocks_the_next_one():
    rows = [{'file': f'무협{i} 1-100.txt', 'genre': '무협', 'median_chars': 5000} for i in range(3)]
    first, second, third = sorted(rows, key=lambda r: _order(r, 7))
    a, c = work_of('A')['episodes'], work_of('C')['episodes']
    episodes = {first['file']: a, second['file']: a + [dict(e, number=e['number'] + 8) for e in c], third['file']: c}   # 둘째는 첫째를 담은 합본, 셋째는 그 합본의 뒷부분만(첫째와는 겹치지 않는다)
    picked, ready, stats = pick_new(rows, 7, {'무협': 2}, lambda row: ('n_hwa', episodes[row['file']]))
    assert [r['file'] for r in picked] == [first['file'], third['file']] and stats['replaced'] == 1                       # 합본은 빠지고, 빠진 합본이 셋째를 막지 않는다
