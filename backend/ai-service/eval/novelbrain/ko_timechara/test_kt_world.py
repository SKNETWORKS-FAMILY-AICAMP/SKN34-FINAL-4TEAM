"""세계관 단위 테스트: 모델 출력 재검증·카드/관계 조립·인물 시점 필터와의 연결. 합성 입력만 쓴다(소설 원문 없음)."""

from app.novelbrain.service import recall
from kt_world import WChar, WEvent, WorldOut, WRel, build_world, load_world, save_world, validate_world
from timechara import snapshot

TEXT = '철수는 영희에게 칼을 건넸다. 영희는 철수를 믿었다. 민수는 멀리서 지켜보았다.'


def out(**kwargs):
    base = dict(characters=[WChar(name='철수', role='떠돌이 검객', memory='영희에게 칼을 건넸다.'),
                            WChar(name='영희', role='마을 처녀', memory='칼을 받았다.')],
                events=[WEvent(title='칼의 전달', summary='철수가 영희에게 칼을 건넸다.', participants=['철수', '영희'])],
                relations=[WRel(source='철수', target='영희', label='신뢰')])
    return WorldOut(**{**base, **kwargs})


def test_validate_world_drops_unsupported_names_endpoints_and_empty_events():
    messy = out(characters=[WChar(name='철수', role='검객', memory='m'), WChar(name='길동', role='r', memory='m'),
                            WChar(name='나', role='r', memory='m'), WChar(name='철수', role='다시', memory='m')],
                events=[WEvent(title='칼', summary='철수가 칼을 건넸다는 사건.', participants=['철수', '길동']),
                        WEvent(title='빈 사건', summary='참가자가 아무도 없는 사건이다.', participants=['길동'])],
                relations=[WRel(source='철수', target='길동', label='친구'), WRel(source='철수', target='철수', label='나'),
                           WRel(source='철수', target='철수', label='')])
    world, stats = validate_world(TEXT, messy)
    assert list(world['characters']) == ['철수']                       # 본문에 없는 길동·한 글자 이름·중복은 버린다
    assert [e['participants'] for e in world['events']] == [['철수']] and world['relations'] == []
    assert stats['bad_character'] == 3 and stats['bad_event'] == 1


def build(ep_outputs=None):
    first, _ = validate_world(TEXT, out())
    second_text = '철수는 먼 길을 떠났다. 영희는 홀로 남았다.'
    second, _ = validate_world(second_text, WorldOut(
        characters=[WChar(name='철수', role='', memory='길을 떠났다.'), WChar(name='영희', role='', memory='홀로 남았다.')],
        events=[WEvent(title='이별', summary='철수가 먼 길을 떠났다.', participants=['철수'])], relations=[]))
    return build_world('w00', {1: first, 2: second}, {'철수': '철수', '영희': '영희'})


def test_build_world_makes_character_event_and_relation_cards_with_episode_gates():
    world = build()
    cards = {c.title: c for c in world['cards']}
    assert cards['철수'].cardType == 'character' and cards['철수'].text == '떠돌이 검객' and cards['철수'].revealFromEpisode == 1
    assert cards['철수'].episodes == {1: '영희에게 칼을 건넸다.', 2: '길을 떠났다.'}   # 회차 기억은 그 인물 입장에서 회차마다
    assert cards['이별'].cardType == 'event' and cards['이별'].revealFromEpisode == 2 and cards['이별'].text == '철수가 먼 길을 떠났다.'
    by_label = {(r.source, r.target, r.label): world['when'][r.id] for r in world['relations']}
    cid = world['character_id']
    assert by_label[(cid['철수'], cid['영희'], '신뢰')] == 1
    assert by_label[(cid['철수'], next(c.id for c in world['cards'] if c.title == '이별'), '참여')] == 2
    assert world['series'] == 'w00' and set(cid) == {'철수', '영희'}


def test_built_world_hides_later_events_from_the_character_at_stage_3_but_not_before():
    world = build()
    cid = world['character_id']['철수']
    early = recall(snapshot(world, 1), cid, 1, '철수가 떠났다', stage=3, k=20)
    assert all('이별' not in i.text and '떠났다' not in i.text for i in early.items)
    unfiltered = recall(snapshot(world, 2), cid, 1, '철수가 떠났다', stage=2, k=20)
    assert any('먼 길을 떠났다' in i.text for i in unfiltered.items)       # 필터 없이는 미래 사건이 문맥에 들어온다


def test_build_world_merges_names_through_the_canonical_map_and_joins_memories():
    first, _ = validate_world('김철수가 왔다. 철수가 웃었다.', WorldOut(
        characters=[WChar(name='김철수', role='검객', memory='왔다.'), WChar(name='철수', role='', memory='웃었다.')],
        events=[], relations=[]))
    world = build_world('w00', {1: first}, {'김철수': '철수', '철수': '철수'})
    assert [c.title for c in world['cards']] == ['철수'] and world['cards'][0].episodes[1] == '왔다. 웃었다.'


def test_world_survives_a_save_and_load_roundtrip(tmp_path):
    world = build()
    save_world(tmp_path / 'world.json', world)
    again = load_world(tmp_path / 'world.json')
    assert again['cards'] == world['cards'] and again['relations'] == world['relations']
    assert again['when'] == world['when'] and again['character_id'] == world['character_id']
