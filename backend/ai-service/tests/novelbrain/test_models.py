import pytest
from pydantic import ValidationError

from app.novelbrain.models import Card, RecallItem, RecallResult, Relation, WorldSnapshot, world_snapshot


def card(id, title, body='본문', card_type='character', meta=None, lifecycle='active'):
    """`world_studio_read`의 카드 한 장(CardPayload JSON)."""
    return {'id': id, 'title': title, 'body': body, 'cardType': card_type, 'areaCode': 'basic', 'classification': '',
            'aliases': [], 'tags': [], 'semanticMetadata': meta if meta is not None else {}, 'visibility': 'private',
            'lifecycle': lifecycle}


def relation(id, source, target, label='남매', direction='symmetric', lifecycle='active'):
    """`world_studio_read`의 관계 한 줄(RelationshipPayload JSON)."""
    return {'id': id, 'sourceCardId': source, 'targetCardId': target, 'category': 'structural', 'body': '설명',
            'label': label, 'direction': direction, 'polarity': 'asserted', 'semanticMetadata': {}, 'lifecycle': lifecycle}


def read(cards, relationships=()):
    return {'worldId': 'w1', 'draftRevision': 3, 'currentRevisionId': None, 'baseWorldRevisionId': None,
            'name': '달빛 세계', 'description': '', 'cards': cards, 'relationships': list(relationships),
            'relationshipVersion': 1, 'relationshipStatus': 'current', 'visibility': 'private'}


DOCS = {'soul': '말투는 건조하다.', 'memory': '리라의 오빠다.', 'episodes': {'1': '1화 기억', '12': '12화 기억'}}


def test_world_snapshot_maps_cards_character_docs_and_relations():
    snapshot = world_snapshot(read(
        [card('kael', '카엘', '성문 수비대장', meta={'studio': {'item': {}}, 'revealFromEpisode': 2, 'characterDocs': DOCS}),
         card('gate', '성문', '북쪽 성문', 'location')],
        [relation('r1', 'kael', 'gate', '근무지', 'directed')]), 4)

    assert snapshot == WorldSnapshot(
        worldId='w1', episode=4,
        cards=[Card(id='kael', cardType='character', title='카엘', text='성문 수비대장', soul='말투는 건조하다.', memory='리라의 오빠다.',
                    episodes={1: '1화 기억', 12: '12화 기억'}, revealFromEpisode=2),
               Card(id='gate', cardType='location', title='성문', text='북쪽 성문')],
        relations=[Relation(id='r1', source='kael', target='gate', label='근무지', direction='directed')])


@pytest.mark.parametrize('docs', [
    {'soul': 5, 'memory': 'm', 'episodes': {}},
    {'soul': 's', 'episodes': {}},
    {'soul': 's', 'memory': 'm', 'episodes': []},
    {'soul': 's', 'memory': 'm', 'episodes': {'-1': 'x'}},
    {'soul': 's', 'memory': 'm', 'episodes': {'1.5': 'x'}},
    {'soul': 's', 'memory': 'm', 'episodes': {'03': 'x'}},
    {'soul': 's', 'memory': 'm', 'episodes': {'x': 'x'}},
    {'soul': 's', 'memory': 'm', 'episodes': {'1': 7}},
    {'soul': 's', 'memory': 'm', 'episodes': {'1': 'ok', 'bad': 'x'}},
    ['soul'], 'soul', 3, None,
])
def test_world_snapshot_drops_malformed_character_docs_without_failing_the_conversion(docs):
    snapshot = world_snapshot(read([card('kael', '카엘', '본문', meta={'characterDocs': docs}), card('lira', '리라', '리라 본문')]), 1)

    kael, lira = snapshot.cards
    assert (kael.title, kael.text, kael.soul, kael.memory, kael.episodes) == ('카엘', '본문', '', '', {})
    assert lira.text == '리라 본문'


def test_world_snapshot_accepts_episode_zero_and_ignores_docs_of_non_character_cards():
    snapshot = world_snapshot(read([
        card('kael', '카엘', meta={'characterDocs': {'soul': '', 'memory': '', 'episodes': {'0': '프롤로그'}}}),
        card('gate', '성문', card_type='location', meta={'characterDocs': DOCS})]), 1)

    assert snapshot.cards[0].episodes == {0: '프롤로그'}
    assert (snapshot.cards[1].soul, snapshot.cards[1].memory, snapshot.cards[1].episodes) == ('', '', {})


@pytest.mark.parametrize('value,expected', [(1, 1), (3, 3), (3.0, 3), (2**31 - 1, 2**31 - 1),
                                            (0, None), (-2, None), (1.5, None), ('3', None), (True, None), (None, None),
                                            (2**31, None), (float('inf'), None), (float('nan'), None)])
def test_world_snapshot_reads_reveal_episode_with_the_server_rule(value, expected):
    snapshot = world_snapshot(read([card('gate', '성문', card_type='location', meta={'revealFromEpisode': value})]), 1)

    assert snapshot.cards[0].revealFromEpisode == expected


def test_world_snapshot_omits_removed_cards_and_relations_and_unusable_relations():
    snapshot = world_snapshot(read(
        [card('kael', '카엘'), card('lira', '리라'), card('gone', '삭제됨', lifecycle='removed')],
        [relation('keep', 'kael', 'lira'),
         relation('removed', 'kael', 'lira', lifecycle='removed'),
         relation('to-removed-card', 'kael', 'gone'),
         relation('no-target', 'kael', None),
         relation('no-source', None, 'lira')]), 1)

    assert [c.id for c in snapshot.cards] == ['kael', 'lira']
    assert [r.id for r in snapshot.relations] == ['keep']


def test_world_snapshot_relation_direction_outside_the_vocabulary_is_unknown_not_an_error():
    snapshot = world_snapshot(read([card('kael', '카엘'), card('lira', '리라')],
                                   [relation('r1', 'kael', 'lira', direction=None), relation('r2', 'kael', 'lira', direction='both')]), 1)

    assert [r.direction for r in snapshot.relations] == [None, None]


@pytest.mark.parametrize('bad', [
    {},
    {'worldId': 'w1'},
    {'worldId': 'w1', 'cards': 'x'},
    {'worldId': 'w1', 'cards': [{'id': 'c1', 'title': 5, 'body': 'SECRET-BODY', 'cardType': 'character'}]},
    {'worldId': 'w1', 'cards': [{'id': 'c1', 'title': 't', 'cardType': 'character'}]},
    {'worldId': 'w1', 'cards': [], 'relationships': [{'sourceCardId': 'a', 'targetCardId': 'b'}]},
])
def test_world_snapshot_rejects_a_response_it_cannot_read_without_echoing_the_input(bad):
    with pytest.raises(ValueError) as error:
        world_snapshot(bad, 1)

    assert 'SECRET-BODY' not in str(error.value)
    assert error.value.__suppress_context__  # 원래 예외(입력 값을 담을 수 있다)를 트레이스백에 잇지 않는다.


@pytest.mark.parametrize('build', [
    lambda: RecallItem(ref='card:c', source='web', text='t', rank=1, score=0.1),
    lambda: RecallResult(items=[], gaps=[], stage=4),
    lambda: RecallResult(items=[], gaps=[], stage=-1),
])
def test_recall_models_only_accept_the_contract_vocabulary(build):
    with pytest.raises(ValidationError):
        build()
