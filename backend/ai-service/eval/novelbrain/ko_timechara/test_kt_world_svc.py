"""서비스 전처리 기준선 변환 단위 테스트: LoadPayload → 세계관 모양(사건 카드는 인물과 관계가 없고 인물의 회차 기억 문장으로 겪음을 읽는다). 합성 입력만 쓴다."""

from app.manuscript_extraction.models import Card, CharacterDocs, LoadPayload, Relation
from app.novelbrain.service import recall
from kt_world import load_world, save_world
from kt_world_svc import event_quotes, svc_world
from timechara import snapshot

SALE = '철수는 영희에게 칼을 건넸다.'
LEAVE = '철수는 먼 길을 떠났다.'


def payload():
    docs = lambda soul, **episodes: CharacterDocs(soul=soul, goal='', episodes=episodes)  # noqa: E731
    cards = [
        Card(key='entity-a', cardType='character', title='철수', aliases=['김철수'], body='[사실] 떠돌이 검객', firstEpisode=1,
             characterDocs=docs('[묘사] 과묵하다', **{'00': '[사실] 어릴 때 고아였다', '01': f'[사건] {SALE}', '02': f'[사건] {LEAVE}'})),
        Card(key='entity-b', cardType='character', title='영희', aliases=[], body='', firstEpisode=1, characterDocs=docs('', **{'01': f'[사건] {SALE}'})),
        Card(key='entity-c', cardType='location', title='마을', aliases=[], body='마을', firstEpisode=1),
        Card(key='event-1', cardType='event', title=f'1화 · {SALE}', aliases=[], body=f'발생: 1화 / 참여: 철수, 영희\n[사건] {SALE}', firstEpisode=1),
        Card(key='event-2', cardType='event', title=f'2화 · {LEAVE}', aliases=[], body=f'발생: 2화 / 참여: 철수\n[사건] {LEAVE}', firstEpisode=2),
    ]
    relations = [Relation(fromKey='entity-a', toKey='entity-b', label='신뢰', fromEpisode=1), Relation(fromKey='entity-a', toKey='entity-b', label='신뢰', fromEpisode=3),
                 Relation(fromKey='entity-b', toKey='entity-c', label='소속', fromEpisode=1, ended=True)]
    return LoadPayload(cards=cards, relations=relations)


def ids_of(world):
    return {c.title: c.id for c in world['cards']}


def test_svc_world_keeps_the_service_shape_cards_without_reveal_episodes_and_numbers_them_by_kind():
    world, stats = svc_world('w00', payload())
    by_title = {c.title: c for c in world['cards']}
    assert sorted(c.id for c in world['cards']) == ['c001', 'c002', 'e001', 'e002', 'x001']                                                         # 인물 c·사건 e·그 밖 x
    chul = by_title['철수']
    assert chul.cardType == 'character' and chul.text == '[사실] 떠돌이 검객' and chul.soul == '[묘사] 과묵하다' and chul.revealFromEpisode is None   # 서비스 자동 적재는 공개 회차를 정하지 않는다
    assert chul.episodes == {0: '[사실] 어릴 때 고아였다', 1: f'[사건] {SALE}', 2: f'[사건] {LEAVE}'}                                           # '00'은 이야기 시작 전 0회
    assert world['character_id'] == {'철수': chul.id, '김철수': chul.id, '영희': by_title['영희'].id} and world['aliases'] == {chul.id: ['김철수']}
    assert stats == {'cards': {'character': 2, 'event': 2, 'location': 1}, 'relations': 1, 'events': 2, 'identity_candidates': 0}


def test_svc_world_has_no_person_to_event_relations_and_skips_end_markers_and_repeated_starts():
    world, _ = svc_world('w00', payload())
    ids = ids_of(world)
    assert [(r.label, r.source, r.target) for r in world['relations']] == [('신뢰', ids['철수'], ids['영희'])] and set(world['when'].values()) == {1}   # 사건과 인물은 이어지지 않는다


def test_svc_world_reads_who_experienced_an_event_from_the_memory_lines_of_the_people():
    world, _ = svc_world('w00', payload())
    ids = ids_of(world)
    assert world['events']['e001'] == {'episode': 1, 'title': f'1화 · {SALE}', 'quote': SALE, 'experienced': {ids['철수']: 1, ids['영희']: 1}, 'heard': {}, 'mentioned': []}
    assert world['events']['e002']['experienced'] == {ids['철수']: 2} and world['events']['e002']['quote'] == LEAVE


def test_event_quotes_reads_whole_event_entries_so_a_longer_sentence_does_not_carry_a_shorter_event():
    memory = '[사건] 철수가 문을 열었다고 영희가 말했다\n[사실] 철수는 검객이다\n[사건] 첫 줄이다\n이어지는 줄이다\n[묘사] 키가 크다'
    assert event_quotes(memory) == {'철수가 문을 열었다고 영희가 말했다', '첫 줄이다\n이어지는 줄이다'}                      # 표지 없이 이어지는 줄은 앞 항목의 인용 안 개행이고 [사건]이 아닌 항목은 뺀다
    assert event_quotes('') == set() and event_quotes('표지 없는 글') == set()


def test_a_person_whose_memory_only_has_a_longer_sentence_is_not_linked_to_the_shorter_event():
    shorter, longer = '철수는 문을 열었다.', '철수는 문을 열었다고 영희가 말했다.'
    cards = [Card(key='entity-a', cardType='character', title='철수', aliases=[], body='', firstEpisode=1, characterDocs=CharacterDocs(soul='', goal='', episodes={'01': f'[사건] {longer}'})),
             Card(key='event-1', cardType='event', title='1화 · 짧은 사건', aliases=[], body=f'발생: 1화 / 참여: 철수\n[사건] {shorter}', firstEpisode=1),
             Card(key='event-2', cardType='event', title='1화 · 긴 사건', aliases=[], body=f'발생: 1화 / 참여: 철수\n[사건] {longer}', firstEpisode=1)]
    world, _ = svc_world('w00', LoadPayload(cards=cards, relations=[]))
    by_quote = {m['quote']: m['experienced'] for m in world['events'].values()}
    assert by_quote[shorter] == {} and list(by_quote[longer].values()) == [1]                                       # 부분 문자열이 아니라 사건 인용 전체로 잇는다


def test_svc_world_hides_an_event_card_from_everyone_because_nothing_links_it_to_a_person():
    world, _ = svc_world('w00', payload())
    chul = ids_of(world)['철수']
    items = recall(snapshot(world, 2), chul, 2, '철수가 영희에게 칼을 건넸다', stage=3, k=20).items
    assert not any(i.ref.startswith('card:e00') for i in items) and any(i.ref == f'card:{chul}#ep01' for i in items)                            # 사건 카드는 못 보고 인물의 회차 기억은 본다


def test_svc_world_survives_a_save_and_load_roundtrip(tmp_path):
    world, _ = svc_world('w00', payload())
    save_world(tmp_path / 'w.json', world)
    again = load_world(tmp_path / 'w.json')
    assert again['cards'] == world['cards'] and again['events'] == world['events'] and again['when'] == world['when']
