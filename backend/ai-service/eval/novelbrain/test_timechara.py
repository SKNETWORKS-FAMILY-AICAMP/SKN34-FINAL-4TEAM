"""TimeChara 연결 단위 테스트: 시점 표 파싱·기준 장 계산·역할 프롬프트·평가용 세계관 구성. 모두 합성 입력이다."""

import pytest

from timechara import (
    build_world,
    chapter_tuple,
    cutoff,
    judge_name,
    ordinal_map,
    parse_tables,
    sample_by_type,
    snapshot,
    system_prompt,
)

UTILS = '''
character_period_harry_potter = {
    "on the 1st of september": ['1-6', '2-5', '3-5', '4-11', '5-10', '6-7', '7-12'],
    "on halloween": ['1-10', '2-8', '3-8', '4-16'],
    "at the end of the scene": ['1-17', '2-18', '3-22', '4-37', '5-38', '6-30', '7-36']
}
character_period_the_lord_of_the_rings = {
    'Frodo Baggins': {"at Bilbo Baggins's Farewell party": '1-1-1', 'end of Volume1': '1-2-10'},
}
character_period_twilight = {'Bella Swan': {'end of book1': '1-24', 'at the Wedding': '4-6'}}
character_period_hunger_games = {'Katniss Everdeen': {'end of book2': '2-27'}}
character_period = {}
'''


@pytest.fixture
def tables():
    return parse_tables(UTILS)


def test_parse_tables_reads_only_the_dict_literals(tables):
    assert tables['harry_potter']['on halloween'][3] == '4-16'
    assert tables['the_lord_of_the_rings']['Frodo Baggins']['end of Volume1'] == '1-2-10'
    assert set(tables) == {'harry_potter', 'the_lord_of_the_rings', 'twilight', 'hunger_games'}


def test_chapter_tuple_reads_every_number():
    assert chapter_tuple('Book5-chapter11') == (5, 11)
    assert chapter_tuple('Volume1-part2-chapter4') == (1, 2, 4)
    assert chapter_tuple('data/transcript/harry_potter/book_1/chapter_12.txt') == (1, 12)
    assert chapter_tuple('data/transcript/the_lord_of_the_rings/volume_2/book_3_chapter_4.txt') == (2, 3, 4)


@pytest.mark.parametrize('series,character,period,expected', [
    ('harry_potter', 'Hermione Granger', '5th-year', (5, 38)),                              # 장면 끝
    ('harry_potter', 'Harry Potter', '4th-year / on the 1st of September', (4, 11)),
    ('harry_potter', 'Harry Potter', '5th-year / on Halloween', (5, 0)),                   # 표에 없으면 그 권의 0장
    ('the_lord_of_the_rings', 'Frodo Baggins', '1', (1, 2, 10)),
    ('the_lord_of_the_rings', 'Frodo Baggins', "1 / at Bilbo Baggins's Farewell party", (1, 1, 1)),
    ('twilight', 'Bella Swan', '1', (1, 24)),
    ('twilight', 'Bella Swan', '4 / at the Wedding', (4, 6)),
    ('hunger_games', 'Katniss Everdeen', '2', (2, 27)),
])
def test_cutoff_follows_the_public_rag_cutoff_rules(tables, series, character, period, expected):
    assert cutoff(series, character, period, tables) == expected


def test_cutoff_fails_loudly_for_an_unknown_moment(tables):
    with pytest.raises(KeyError):
        cutoff('twilight', 'Bella Swan', '3 / at an unknown moment', tables)


def test_ordinal_map_is_dense_one_based_and_keeps_order():
    ordinals = ordinal_map([(5, 11), (4, 0), (4, 1), (5, 11), (1, 2)])
    assert ordinals == {(1, 2): 1, (4, 0): 2, (4, 1): 3, (5, 11): 4}


def test_system_prompt_matches_the_public_role_play_prompts():
    source = "from J.K. Rowling's Harry Potter novel series"
    head = "I want you to act like Hermione Granger {s}. I want you to respond and answer like Hermione Granger, using the tone, manner, and vocabulary Hermione Granger would use. ".format(s=source)
    tail = ' You should not answer the question and mention any fact that is future to the period. If she was not present at the location where the question was raised, she is likely unaware of the information or knowledge related to that question.'
    assert system_prompt('harry_potter', 'Hermione Granger', '5th-year') == (
        head + 'Assume that you are at the end of the scene in Harry Potter and the Order of the Phoenix as a 5th-year student and interviewing with the interviewer.' + tail)
    harry = system_prompt('harry_potter', 'Harry Potter', '7th-year / on the 1st of September')
    assert 'Assume that you are on the 1st of September during his 7th-year in Harry Potter and the Deathly Hallows and interviewing' in harry
    assert 'If he was not present' in harry
    assert 'at the end of the scene in Harry Potter and the Deathly Hallows and interviewing' in system_prompt('harry_potter', 'Harry Potter', '7th-year')
    assert 'as a' not in system_prompt('harry_potter', 'Harry Potter', '7th-year')
    frodo = system_prompt('the_lord_of_the_rings', 'Frodo Baggins', '3 / at the moment when rescued from Mount Doom by the eagles')
    assert 'Assume that you are at the moment when rescued from Mount Doom by the eagles in The Return of the King and interviewing' in frodo
    assert "from J.R.R. Tolkien's The Lord of the Rings novel series" in frodo
    assert 'she is likely unaware' in system_prompt('hunger_games', 'Katniss Everdeen', '1')


def test_judge_name_follows_the_public_evaluation_rules():
    assert judge_name('harry_potter', 'Hermione Granger', '5th-year') == (
        '5th-year Hermione Granger at the end of the scene in Harry Potter and the Order of the Phoenix')
    assert judge_name('harry_potter', 'Harry Potter', '7th-year') == 'Harry Potter at the end of the scene in Harry Potter and the Deathly Hallows'
    assert judge_name('harry_potter', 'Ronald Weasley', '3rd-year / on Halloween') == '3rd-year Ronald Weasley on Halloween'
    assert judge_name('twilight', 'Bella Swan', '4 / at the Wedding') == 'Bella Swan at the Wedding'
    assert judge_name('twilight', 'Bella Swan', '2') == 'Bella Swan at the end of the scene in New Moon'


def row(series='harry_potter', character='Harry Potter', period='5th-year', qp='Book2-chapter3', summary='Harry met Ron.',
        participants="['Harry Potter', 'Ronald Weasley']", gen='fact-structured', data_type='past-presence'):
    return {'series': series, 'character': character, 'character_period': period, 'question_period': qp, 'event_summary': summary,
            'participants': participants, 'question_generation': gen, 'data_type': data_type}


def test_build_world_makes_events_relations_and_memories_from_fact_rows_only():
    rows = [
        row(),
        row(data_type='future'),                                    # 같은 사건이 다른 유형으로 또 나와도 한 번만
        row(qp='Book2-chapter3', summary='Fake event.', gen='fake-freeform', data_type='past-only'),  # 지어낸 사건은 정본이 아니다
        row(qp='Book1-chapter1', summary='Harry got a letter.', participants="['Harry Potter']"),
    ]
    ordinals = {(1, 1): 1, (2, 3): 2}
    world = build_world(rows, ordinals)
    events = [c for c in world['cards'] if c.cardType == 'event']
    assert sorted(e.text for e in events) == ['Harry got a letter.', 'Harry met Ron.']
    assert {e.revealFromEpisode for e in events} == {1, 2}
    harry = next(c for c in world['cards'] if c.title == 'Harry Potter')
    ron = next(c for c in world['cards'] if c.title == 'Ronald Weasley')
    assert harry.cardType == ron.cardType == 'character' and harry.text == ''
    assert harry.episodes == {1: 'Harry got a letter.', 2: 'Harry met Ron.'} and ron.episodes == {2: 'Harry met Ron.'}
    assert sorted((world['title'][r.source], r.label, r.id in world['when']) for r in world['relations']) == [
        ('Harry Potter', 'participated', True), ('Harry Potter', 'participated', True), ('Ronald Weasley', 'participated', True)]
    assert all(' '.join(e.title.split()).startswith('harry_potter') for e in events)  # 제목이 질문에 그대로 나오지 않게 중립 이름


def test_snapshot_keeps_only_relations_recorded_up_to_the_episode():
    world = build_world([row(), row(qp='Book1-chapter1', summary='Harry got a letter.', participants="['Harry Potter']")], {(1, 1): 1, (2, 3): 2})
    early = snapshot(world, episode=1)
    late = snapshot(world, episode=2)
    assert early.episode == 1 and len(early.relations) == 1 and len(late.relations) == 3
    assert len(early.cards) == len(late.cards)  # 카드는 전부(작가 시점), 관계만 그 회차까지


def test_sample_by_type_takes_equal_counts_deterministically():
    rows = [{'data_type': t, 'i': i} for t in ('future', 'past-only', 'past-absence', 'past-presence') for i in range(30)]
    picked = sample_by_type(rows, per_type=5, seed=58)
    assert len(picked) == 20
    assert {t: sum(r['data_type'] == t for r in picked) for t in ('future', 'past-only', 'past-absence', 'past-presence')} == dict.fromkeys(
        ('future', 'past-only', 'past-absence', 'past-presence'), 5)
    assert picked == sample_by_type(rows, per_type=5, seed=58)
