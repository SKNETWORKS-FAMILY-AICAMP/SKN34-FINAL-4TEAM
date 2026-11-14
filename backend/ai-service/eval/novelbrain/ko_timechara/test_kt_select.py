"""작품 고르기 단위 테스트: 장르 분류·후보 선별·장르별 선택·고전 회차 만들기. 합성 입력만 쓴다(소설 원문 없음)."""

import pytest

from kt_select import QUOTA, choose, classify_genre, prepare_classic, screen

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


def test_prepare_classic_cleans_modernizes_caps_and_groups_into_episodes():
    raw = '{{머리말}}\n' + '\n'.join(f'ᄒᆞᆫ 사람이 {n}번째 길을 갔다.' for n in range(400))
    episodes = prepare_classic(raw, count=10, cap_chars=6000)
    assert [e['number'] for e in episodes] == list(range(1, 11))
    assert sum(len(e['text']) for e in episodes) <= 6100 and '{{' not in episodes[0]['text']
    assert '한 사람이' in episodes[0]['text']
