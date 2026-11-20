"""hp_build: 해리 포터 원문 기반 평가 세계관 world.json(추출·정체 정리·인물 문서·조립)을 모델 대역으로 검사한다. 실제 호출·원문 없음."""

import json
import re
from collections import Counter

import pytest

import hp_build as b
import hp_chapters as hc
import sim_worlds as w
from cost import CostLog

EN = {'해리': 'Harry Potter', '포터': 'Harry Potter', '덤블도어': 'Albus Dumbledore', '론': 'Ron Weasley'}


def person(name, aliases=(), **fields):
    return b.Person(name=name, aliases=list(aliases), **{'looks': '', 'personality': '', 'speech': '', 'situation': '', 'wants': '', 'memory': '', **fields})


def setting(kind, name, aliases=(), description=''):
    return b.Setting(kind=kind, name=name, aliases=list(aliases), description=description)


def event(title, summary, who):
    return b.Event(title=title, summary=summary, participants=list(who))


def link(source, target, category='emotional', label='친구', body='함께 다닌다.'):
    return b.Link(source=source, target=target, category=category, label=label, body=body)


def info(book, chapters, ordinal, people=(), events=(), things=(), relations=()):
    return b.Info(book, tuple(chapters), ordinal, b.Extraction(events=list(events), people=list(people), things=list(things), relations=list(relations)))


def story():
    """3화짜리 손으로 만든 추출 결과: 해리는 1화부터, 론은 2화부터, 3화에 둘의 관계가 바뀐다."""
    return [
        info(1, [1], 1, [person('해리', ['포터', '꼬마'], situation='이모네에 맡겨진 아기', memory='문 앞에 놓였다'), person('덤블도어', situation='교장', memory='아기를 데려왔다')],
             [event('아기가 오다', '아기가 문 앞에 놓였다', ['해리', '덤블도어'])], [setting('location', '프리벳가', [], '평범한 거리')]),
        info(1, [2], 2, [person('해리', ['꼬마', '살아남은 아이'], situation='호그와트 학생', memory='편지를 받았다'), person('론', speech='털털하다', memory='해리를 만났다')],
             [event('기차 칸', '해리가 론을 만났다', ['해리', '론'])], [setting('organization', '그리핀도르', ['사자 기숙사'], '용감한 아이들의 기숙사')],
             [link('해리', '론'), link('해리', '그리핀도르', 'structural', '소속', '기숙사에 배정됐다'), link('해리', '없는이', label='모름')]),
        info(2, [1], 3, [person('해리'), person('론')], [], [setting('ability', '엑스펠리아르무스', [], '무장 해제 주문')], [link('해리', '론', label='단짝', body='늘 붙어 다닌다.')]),
    ]


def world(docs=None, infos=None, **kwargs):
    infos = infos or story()
    people = b.resolve_persons(infos, EN.get)
    return b.build_world(infos, people, b.resolve_settings(infos), docs or {}, {(1, 1): 1, (1, 2): 2, (2, 1): 3}, [], **kwargs), people


def cards_of(data):
    return {c['key']: c for c in data['cards']}


# --- 회차·이름 ---------------------------------------------------------------------------------------------------------------

def test_ordinals_number_every_chapter_in_story_order_across_books_including_merged_chapters():
    splits = {2: hc.Split([hc.Unit((1,), 't')], {}, []), 1: hc.Split([hc.Unit((1,), 't'), hc.Unit((2, 3), 't')], {}, [])}
    assert b.ordinals_of(splits) == {(1, 1): 1, (1, 2): 2, (1, 3): 3, (2, 1): 4}


def test_canonical_english_uses_the_timechara_spelling_and_blank_means_unknown():
    assert b.canonical_en(' ron  weasley ') == 'Ronald Weasley'
    assert b.canonical_en('Severus Snape') == 'Severus Snape'
    assert b.canonical_en('  ') is None and b.canonical_en(None) is None


def test_name_requests_ask_only_names_seen_in_several_chunks_with_hints_and_stay_deterministic():
    infos = story()
    (names, instructions, data), = b.name_requests(infos, ['Harry Potter'])
    assert set(names) == {'해리', '론', '꼬마'}   # 한 덩어리에만 나온 이름(포터·덤블도어)은 묻지 않는다
    body = json.loads(data)
    assert body['hint'] == ['Harry Potter'] and {n['ko'] for n in body['names']} == set(names)
    assert next(n for n in body['names'] if n['ko'] == '해리')['first'] == '1권 1장'
    assert '지어내지' in instructions and '합치지' in instructions
    assert b.name_requests(infos, ['Harry Potter'])[0][2] == data
    assert len(b.name_requests(infos, [], size=2)) == 2


def test_apply_names_touches_only_asked_names_and_unanswered_ones_stay_unknown():
    reply = b.Names(names=[b.NameEntry(ko='론', en='ron weasley'), b.NameEntry(ko='딴사람', en='Someone Else')])
    assert b.apply_names(['론', '해리'], reply) == {'론': 'Ronald Weasley', '해리': None}


def test_the_same_english_name_is_one_person_and_namesakes_are_never_merged_by_an_alias_edge():
    infos = [info(1, [1], 1, [person('웨즐리 부인', ['몰리']), person('웨즐리 씨', ['웨즐리 부인'])]), info(1, [2], 2, [person('몰리', ['웨즐리 부인'])])]
    en = {'웨즐리 부인': 'Molly Weasley', '몰리': 'Molly Weasley', '웨즐리 씨': 'Arthur Weasley'}
    people = b.resolve_persons(infos, en.get)
    assert people.key_of['웨즐리 부인'] == people.key_of['몰리'] == 'molly-weasley'
    assert people.key_of['웨즐리 씨'] == 'arthur-weasley' and set(people.items) == {'molly-weasley', 'arthur-weasley'}
    assert people.items['molly-weasley'].title == '웨즐리 부인' and people.items['molly-weasley'].en == 'Molly Weasley'


def test_names_without_english_are_joined_by_aliases_get_a_stable_key_and_slug_clashes_stay_apart():
    infos = [info(1, [1], 1, [person('해그리드', ['거인']), person('거인')]), info(1, [2], 2, [person('길동')]), info(1, [3], 3, [person('Harry'), person('harry')])]
    people = b.resolve_persons(infos, {'Harry': 'Harry Potter', 'harry': 'harry potter'}.get)
    assert people.key_of['해그리드'] == people.key_of['거인'] and people.key_of['해그리드'].startswith('p-')
    assert people.key_of['길동'] != people.key_of['해그리드']
    assert people.key_of['Harry'] != people.key_of['harry'] and len(people.items) == 4   # 철자 대소문자만 다른 영어 이름도 key가 겹치지 않는다
    assert b.resolve_persons(infos, {}.get).key_of == b.resolve_persons(infos, {}.get).key_of


def test_settings_are_joined_by_aliases_and_keep_the_kind_of_their_first_mention():
    infos = [info(1, [1], 1, things=[setting('organization', '호그와트', ['호그와트 마법학교'])]), info(1, [2], 2, things=[setting('location', '호그와트 마법학교'), setting('rule', '마법 금지')])]
    settings = b.resolve_settings(infos)
    assert settings.key_of['호그와트'] == settings.key_of['호그와트 마법학교']
    assert settings.items[settings.key_of['호그와트']].kind == 'organization'
    assert settings.items[settings.key_of['마법 금지']].kind == 'rule' and len(settings.items) == 2


def test_match_names_ignores_titles_and_fails_on_ambiguity_or_absence():
    english = {'Severus Snape': 'snape', 'Arthur Weasley': 'arthur', 'Molly Weasley': 'molly', 'Harry Potter': 'harry'}
    found, failed = b.match_names(['Professor Snape', 'Harry Potter', 'Weasley', 'Nobody Known'], english)
    assert found == {'Professor Snape': 'snape', 'Harry Potter': 'harry'} and failed == ['Weasley', 'Nobody Known']


# --- 요청 ------------------------------------------------------------------------------------------------------------------

def test_extract_request_wraps_only_the_text_and_forbids_outside_knowledge_and_quotes():
    instructions, data = b.extract_request('본문 하나')
    assert json.loads(data) == {'text': '본문 하나'} and '이 글에 쓰인 것만' in instructions and '인용' in instructions and 'Harry' not in instructions


def test_docs_request_carries_only_the_first_appearance_and_never_the_english_name():
    infos = story()
    people = b.resolve_persons(infos, EN.get)
    records = b.person_records(infos, people)['harry-potter']
    assert [r.at for r in records] == ['1권 1장', '1권 2장'] and [r.at for r in b.first_records(records)] == ['1권 1장']
    instructions, data = b.docs_request('해리', ['꼬마'], records)
    assert '이모네에 맡겨진 아기' in data and '호그와트 학생' not in data and 'Harry' not in data and 'Potter' not in data
    assert json.loads(data)['aliases'] == ['꼬마'] and '처음 나온' in instructions and '지어내지' in instructions and '이후에' in instructions


def test_first_records_keeps_every_window_of_the_first_chunk_and_can_be_widened():
    records = [b.Record(1, 'a', '', '', '', 's1', '', ''), b.Record(1, 'a', '', '', '', 's2', '', ''), b.Record(2, 'b', '', '', '', 's3', '', '')]
    assert [r.situation for r in b.first_records(records)] == ['s1', 's2'] and len(b.first_records(records, units=2)) == 3


def test_clip_keeps_documents_within_the_server_limit_cutting_at_a_line_break():
    text = '\n'.join(f'- 줄 {i} ' + '가' * 40 for i in range(200))
    clipped = b.clip(text)
    assert len(clipped) <= b.MAX_DOC and clipped.endswith('가') and clipped.count('\n') < text.count('\n') and text.startswith(clipped)
    assert b.clip('  짧다 ') == '짧다' and len(b.clip('가' * 5000)) == b.MAX_DOC


def test_card_aliases_keep_only_first_appearance_names_that_point_at_one_target():
    infos = [info(1, [1], 1, [person('해리', ['포터', '꼬마']), person('제임스', ['포터'])]), info(1, [2], 2, [person('해리', ['살아남은 아이'])])]
    people = b.resolve_persons(infos, {}.get)
    claimed = b._claims(infos, people.key_of, lambda i: i.extraction.people)
    first = b._first_entries(infos, people.key_of, lambda i: i.extraction.people)
    key = people.key_of['해리']
    assert b.card_aliases(first[key][1], '해리', key, claimed) == ['꼬마']   # 포터는 두 사람의 별칭, 살아남은 아이는 나중 대목의 이름


# --- 조립 ------------------------------------------------------------------------------------------------------------------

def test_person_cards_use_the_docs_and_fall_back_without_inventing_when_a_doc_is_missing():
    data, _ = world({'harry-potter': b.Docs(identity='해리의 정체', soul='## 말투\n- 조용하다', goal='- 집을 찾는다')})
    cards = cards_of(data)
    harry, dumbledore = cards['harry-potter'], cards['albus-dumbledore']
    assert (harry['cardType'], harry['areaCode'], harry['classification'], harry['revealFromEpisode'], harry['visibility']) == ('character', 'basic', '인물', 1, 'private')
    assert harry['body'] == '해리의 정체' and harry['characterDocs']['soul'] == '## 말투\n- 조용하다' and harry['characterDocs']['goal'] == '- 집을 찾는다'
    assert dumbledore['body'] == '교장' and dumbledore['characterDocs']['soul'] == b.UNKNOWN_SOUL and dumbledore['characterDocs']['goal'] == ''
    assert cards['ronald-weasley']['revealFromEpisode'] == 2 and harry['english'] == 'Harry Potter'


def test_episode_memory_lists_what_the_person_did_per_chapter_and_falls_back_to_attended_events():
    data, _ = world()
    cards = cards_of(data)
    assert cards['harry-potter']['characterDocs']['episodes'] == {'1': '## 1화(1권 1장)\n- 문 앞에 놓였다', '2': '## 2화(1권 2장)\n- 편지를 받았다'}
    assert cards['ronald-weasley']['characterDocs']['episodes']['2'] == '## 2화(1권 2장)\n- 해리를 만났다' and '3' not in cards['ronald-weasley']['characterDocs']['episodes']
    quiet = [info(1, [1], 1, [person('해리')], [event('길', '해리가 길을 걸었다', ['해리'])])]
    assert cards_of(world(infos=quiet)[0])['harry-potter']['characterDocs']['episodes'] == {'1': '## 1화(1권 1장)\n- 해리가 길을 걸었다'}


def test_aliases_on_cards_come_from_the_first_appearance_only():
    data, _ = world()
    assert cards_of(data)['harry-potter']['aliases'] == ['포터', '꼬마']   # 살아남은 아이는 2화에서 생긴 이름이라 카드가 아니라 기억·관계에 둔다


def test_settings_and_events_become_typed_cards_revealed_at_their_chapter():
    data, _ = world()
    cards = cards_of(data)
    settings = {c['title']: c for c in data['cards'] if c['cardType'] not in ('character', 'event')}
    assert [(c['cardType'], c['areaCode'], c['classification'], c['revealFromEpisode']) for c in (settings['프리벳가'], settings['그리핀도르'], settings['엑스펠리아르무스'])] == [
        ('location', 'space', '장소', 1), ('organization', 'society', '조직', 2), ('ability', 'special', '능력', 3)]
    assert settings['그리핀도르']['body'] == '용감한 아이들의 기숙사' and settings['그리핀도르']['aliases'] == ['사자 기숙사']
    assert (cards['ev-002-00']['cardType'], cards['ev-002-00']['areaCode'], cards['ev-002-00']['title'], cards['ev-002-00']['body'], cards['ev-002-00']['revealFromEpisode']) == (
        'event', 'history', '기차 칸', '해리가 론을 만났다', 2)


def test_people_are_linked_to_their_events_and_to_each_other_from_the_chapter_they_meet():
    data, _ = world()
    rel = {(r['key'], r['from']): r for r in data['relationships']}
    assert rel[('harry-potter~ev-002-00', 2)]['label'] == '참여' and rel[('ronald-weasley~ev-002-00', 2)]['target'] == 'ev-002-00'
    pair = rel[('harry-potter>ronald-weasley>knows', 2)]   # 한 쌍에 방향 하나(한쪽이 끝점이면 둘이 서로 안다), 키 순서로 정한다
    assert pair['label'] == '알고 있음' and pair['source'] == 'harry-potter' and pair['body'] == '해리와(과) 론은(는) 서로 안다.' and ('ronald-weasley>harry-potter>knows', 2) not in rel
    assert ('albus-dumbledore>harry-potter>knows', 1) in rel
    crowd = [info(1, [1], 1, [person(f'사람{i}') for i in range(10)], [event('모임', '모였다', [f'사람{i}' for i in range(10)])])]
    links = [r for r in world(infos=crowd)[0]['relationships']]
    assert sum(r['label'] == '참여' for r in links) == b.MAX_ATTEND and sum(r['label'] == '알고 있음' for r in links) == b.MAX_PAIR * (b.MAX_PAIR - 1) // 2   # 참여는 앞 3명, 알고 있음은 앞 8명끼리 쌍마다 하나


def test_extracted_relations_reach_persons_and_settings_change_over_chapters_and_drop_unknown_ends():
    data, _ = world()
    friends = sorted((r['from'], r['label'], r['body']) for r in data['relationships'] if r['key'] == 'harry-potter>ronald-weasley>emotional')
    assert friends == [(2, '친구', '함께 다닌다.'), (3, '단짝', '늘 붙어 다닌다.')]
    house = next(r for r in data['relationships'] if r['label'] == '소속')
    assert (house['predicate'], house['target'], house['from']) == ('custom_relation_directed', next(c['key'] for c in data['cards'] if c['title'] == '그리핀도르'), 2)
    assert not any(r['label'] == '모름' for r in data['relationships'])
    assert next(r for r in data['relationships'] if r['label'] == '친구')['predicate'] == 'custom_emotion'


def test_an_unchanged_relation_is_recorded_once_and_the_last_value_of_a_chapter_wins():
    links = [{'key': 'k', 'from': 1, 'label': 'a', 'body': 'x'}, {'key': 'k', 'from': 2, 'label': 'a', 'body': 'x'}, {'key': 'k', 'from': 3, 'label': 'a', 'body': 'y'}, {'key': 'k', 'from': 3, 'label': 'b', 'body': 'z'}]
    assert [(r['from'], r['label']) for r in b._timeline(links)] == [(1, 'a'), (3, 'b')]


def test_relations_are_kept_in_order_of_importance_within_the_server_limit():
    # 해리·론·헤르미온느가 두 사건에 함께 나오고 네빌은 한 사건에만 나온다: 한도가 모자라면 적게 함께한 쌍부터 뺀다
    crowd = ['해리', '론', '헤르미온느']
    infos = [info(1, [1], 1, [person(n) for n in crowd + ['네빌']], [event('모임', '모였다', crowd), event('수업', '수업했다', crowd + ['네빌'])], relations=[link('해리', '론')]),
             info(1, [2], 2, [person(n) for n in crowd], [event('모험', '모험했다', crowd)])]

    def kinds(limit):
        data = world(infos=infos, max_relations=limit)[0]
        return data, {label: {r['key'] for r in data['relationships'] if r['label'] == label} for label in ('참여', '알고 있음', '친구')}

    full, got = kinds(100)
    assert len(got['친구']) == 1 and len(got['참여']) == 3 * b.MAX_ATTEND and len(got['알고 있음']) == 6   # 쌍 6개(해리·론·헤르미온느 3쌍 + 네빌과 앞 셋은 3쌍)
    tight, got = kinds(1 + 9 + 1)   # 추출 1 + 참여 9 + 알고 있음 한 쌍
    assert len(got['친구']) == 1 and len(got['참여']) == 9 and len({r['key'] for r in tight['relationships']}) == 11 and len(got['알고 있음']) == 1
    assert all('네빌' not in r['body'] for r in tight['relationships'] if r['label'] == '알고 있음')   # 한 번만 함께한 네빌의 쌍은 빠졌다
    starved, got = kinds(4)   # 추출을 지키고 남는 자리만큼 참여를 최근 것부터 담고 알고 있음은 자리가 없다
    assert len(got['친구']) == 1 and len(got['참여']) == 3 and got['알고 있음'] == set()


def person_links(data, key):
    """인물 하나가 끝점인 관계 key(마지막 회차 시점)."""
    return {r['key'] for r in data['relationships'] if key in (r['source'], r['target'])}


def crowded():
    """해리가 론·헤르미온느·네빌과 함께 세 사건에 나오고 추출 관계는 해리-론·해리-호그와트·론-네빌이다."""
    crowd = ['해리', '론', '헤르미온느', '네빌']
    return [info(1, [n], n, [person(x) for x in crowd], [event(f'사건{n}', f'{n}번 사건', crowd)], [setting('location', '호그와트')],
                 [link('해리', '론'), link('해리', '호그와트', 'structural', '재학'), link('론', '네빌', label='동기')] if n == 1 else []) for n in (1, 2, 3)]


def test_no_person_has_more_relations_than_the_cap_and_the_extracted_ones_are_kept_first():
    cap = 3
    data = world(infos=crowded(), person_cap=cap)[0]
    for key in ('harry-potter', 'ronald-weasley'):
        assert len(person_links(data, key)) <= cap
    harry = {r['label'] for r in data['relationships'] if 'harry-potter' in (r['source'], r['target'])}
    assert {'친구', '재학'} <= harry   # 추출 관계(해리-론·해리-호그와트)가 먼저 자리를 얻고 남는 한 자리가 참여·알고 있음에 간다
    assert len(world(infos=crowded(), person_cap=1)[0]['relationships']) >= 1 and all(len(person_links(world(infos=crowded(), person_cap=1)[0], k)) <= 1 for k in ('harry-potter', 'ronald-weasley'))


def test_the_cap_drops_the_knows_links_first_then_attendance_and_prefers_frequent_and_recent_ones():
    infos = crowded()
    data = world(infos=infos, person_cap=4)[0]
    labels = Counter(r['label'] for r in data['relationships'] if 'harry-potter' in (r['source'], r['target']))
    assert labels['친구'] == 1 and labels['재학'] == 1 and labels['참여'] == 2 and labels['알고 있음'] == 0   # 추출 2 + 참여(최근 사건부터) 2, 알고 있음은 마지막
    attended = sorted(r['target'] for r in data['relationships'] if r['label'] == '참여' and r['source'] == 'harry-potter')
    assert attended == ['ev-002-00', 'ev-003-00']   # 오래된 사건(1화)이 빠졌다
    wide = world(infos=infos, person_cap=b.PERSON_CAP)[0]
    assert sum(r['label'] == '알고 있음' for r in wide['relationships']) == 6 and sum(r['label'] == '참여' for r in wide['relationships']) == 3 * b.MAX_ATTEND   # 상한 안이면 그대로


def test_relations_to_settings_and_events_do_not_use_up_their_own_cap_and_the_cap_holds_at_every_episode():
    data = world(infos=crowded(), person_cap=2)[0]
    place = next(c['key'] for c in data['cards'] if c['title'] == '호그와트')
    assert any(r['target'] == place for r in data['relationships'])   # 장소는 인물이 아니라 상한이 없다
    seed = w.seed_module()
    for episode in (1, 2, 3):
        for key in ('harry-potter', 'ronald-weasley', 'hermione-granger'):
            scope = seed.scope_of(data)
            ids = {p['id'] for p in seed.relations_at(data, episode) if seed.card_id(key, scope) in (p['sourceCardId'], p['targetCardId'])}
            assert len(ids) <= 2


def test_fewer_attendance_links_per_event_can_be_asked_for_to_shrink_the_prompts():
    crowd = ['해리', '론', '헤르미온느', '네빌']
    infos = [info(1, [1], 1, [person(n) for n in crowd], [event('모임', '모였다', crowd)])]
    attend = lambda limit: [r for r in world(infos=infos, max_attend=limit)[0]['relationships'] if r['label'] == '참여']  # noqa: E731
    assert len(attend(1)) == 1 and len(attend(2)) == 2 and len(attend(b.MAX_ATTEND)) == b.MAX_ATTEND


def test_relation_labels_and_bodies_stay_within_the_server_limits():
    infos = [info(1, [1], 1, [person('해리'), person('론')], relations=[link('해리', '론', label='가' * 500, body='나' * 5000)])]
    data = world(infos=infos)[0]
    tie = next(r for r in data['relationships'] if r['key'].endswith('>emotional'))
    assert len(tie['label']) == 200 and len(tie['body']) == b.MAX_DOC


def test_the_world_has_the_demo_shape_and_the_mapping_from_chapters_to_episodes():
    data, _ = world()
    assert set(data) == {'world', 'work', 'cards', 'relationships', 'secrets', 'ordinals', 'english', 'unsplit', 'heldBack'} and data['heldBack'] == {}
    assert data['world']['genre'] == 'genre-01' and data['work']['title'] == '해리 포터(평가용·로컬 전용)' and data['secrets'] == []
    assert data['ordinals'] == {'1-1': 1, '1-2': 2, '2-1': 3} and data['english']['Harry Potter'] == 'harry-potter'
    assert len({c['key'] for c in data['cards']}) == len(data['cards'])


def test_every_document_stays_within_the_server_limit():
    long = b.Docs(identity='가' * 5000, soul='나' * 4000, goal='다' * 4000)
    data, _ = world({'harry-potter': long})
    harry = cards_of(data)['harry-potter']
    assert max(len(harry['body']), len(harry['characterDocs']['soul']), len(harry['characterDocs']['goal'])) <= b.MAX_DOC


def test_the_world_loads_through_the_demo_seed_functions_with_changing_relations_per_episode():
    seed = w.seed_module()
    data, _ = world({'harry-potter': b.Docs(identity='해리', soul='## 말투\n- 조용하다', goal='')})
    scope, keys = seed.scope_of(data), {c['key'] for c in data['cards']}
    payloads = [seed.card_payload(c, scope, keys) for c in data['cards']]
    assert {p['cardType'] for p in payloads} == {'character', 'location', 'organization', 'ability', 'event'}
    assert all(r['predicate'] in seed.PREDICATES and r['source'] in keys and r['target'] in keys for r in data['relationships'])
    assert seed.episodes(data) == [1, 2, 3]
    labels = lambda episode: sorted(p['label'] for p in seed.relations_at(data, episode))  # noqa: E731
    assert '친구' in labels(2) and '단짝' not in labels(2) and '단짝' in labels(3) and '친구' not in labels(3)
    assert len(seed.relations_at(data, 1)) < len(seed.relations_at(data, 2))


def test_estimate_counts_calls_from_chunk_sizes_and_grows_with_the_text():
    small, big = b.estimate_build([28_000, 56_001]), b.estimate_build([28_000, 56_001, 28_000])
    assert small['calls'] == {'extract': 4, 'names': 1, 'docs': 12, 'traits': 12} and big['calls'] == {'extract': 5, 'names': 1, 'docs': 18, 'traits': 18}   # 인물은 덩어리마다 6명으로 어림
    assert 0 < small['usd'] < big['usd']


def test_the_preview_shows_documents_episode_examples_events_and_relations_for_the_asked_people():
    data, _ = world({'harry-potter': b.Docs(identity='해리의 정체' * 100, soul='## 말투\n- 조용하다', goal='- 집을 찾는다')})
    text = b.preview(data, ['Harry Potter', 'Nobody Here'], limit=40)
    assert '## Harry Potter — 해리(첫 등장 1화)' in text and '**IDENTITY** ' + '해리의 정체' * 100 not in text and '**SOUL** ## 말투 - 조용하다' in text and '**GOAL** - 집을 찾는다' in text
    assert '- ## 1화(1권 1장) - 문 앞에 놓였다' in text and '(카드 없음)' in text and '아기가 오다 (1화)' in text
    assert re.search(r'해리 → 론: 친구 — 함께 다닌다\. \(2화부터\)', text)


# --- 실행 ------------------------------------------------------------------------------------------------------------------

class FakeLlm:
    def __init__(self, cost):
        self.cost, self.asks = cost, []

    def ask(self, kind, instructions, input, *, schema=None, max_output_tokens=4000):
        self.asks.append((kind, input))
        data = json.loads(input)
        if kind == 'hp_extract':
            marks = re.findall(r'MARK\d\d', data['text'])
            if not marks:
                return b.Extraction(events=[], people=[], things=[], relations=[])
            first = marks[0]
            people = [person('해리', ['포터'], situation=f'상황 {m}', memory=f'{m} 일', personality=f'성격 {m}', wants=f'바람 {m}') for m in marks]
            if first != 'MARK11':
                people.append(person('론', speech=f'말투 {first}', memory=f'{first} 론'))
            return b.Extraction(events=[event(f'사건 {m}', f'{m} 사건', ['해리'] + ([] if first == 'MARK11' else ['론'])) for m in marks], people=people,
                                things=[setting('location', '호그와트', [], f'{m} 학교') for m in marks], relations=[link('해리', '호그와트', 'structural', '재학', f'{first} 재학')])
        if kind == 'hp_names':
            return b.Names(names=[b.NameEntry(ko=n['ko'], en=EN.get(n['ko'])) for n in data['names']])
        if kind in ('hp_traits', 'hp_traits_retry'):
            return self.traits(data)
        return b.Docs(identity=f'{data["name"]}의 문서', soul='## 말투\n- 처음 나온 대목의 말투', goal='- 처음 나온 대목의 바람')

    def traits(self, data):
        return b.hp_traits.Traits(soul=f'## 말투\n- {data["name"]}의 한결같은 말투\n\n## 사고방식\n- 한결같은 성격', goal='- 한결같은 바람')


@pytest.fixture
def small(tmp_path, monkeypatch):
    monkeypatch.setattr(hc, 'BOOKS', {1: ('가', 3), 2: ('나', 2)})
    raw = tmp_path / 'raw'
    for book, name, total in ((1, '가', 3), (2, '나', 2)):
        (raw / name).mkdir(parents=True)
        (raw / name / '1.txt').write_text('\n'.join(f'제{n}장\n해리가 걷는다 MARK{book}{n} ' + '가' * 400 for n in range(1, total + 1)), encoding='utf-8')
    rows = [{'series': 'harry_potter', 'character': 'Harry Potter', 'participants': "['Harry Potter', 'Ronald Weasley']"}, {'series': 'other', 'character': 'X', 'participants': '[]'}]
    return type('Small', (), {'raw': raw, 'out': tmp_path / 'hp', 'rows': rows, 'cost': CostLog(tmp_path / 'cost.jsonl')})


def run_build(small, llm=None, **kwargs):
    llm = llm or FakeLlm(small.cost)
    stats = b.build(llm, small.raw, small.out, small.rows, limit_usd=kwargs.pop('limit_usd', 10), workers=2, **kwargs, log=lambda *_: None)
    return llm, stats


def test_a_build_writes_the_chapters_and_one_world_json_with_cards_and_numbers_only_in_the_stats(small):
    llm, stats = run_build(small)
    data = json.loads((small.out / 'world.json').read_text(encoding='utf-8'))
    assert (small.out / 'chapters' / 'index.json').exists() and data['ordinals'] == {'1-1': 1, '1-2': 2, '1-3': 3, '2-1': 4, '2-2': 5}
    assert (stats['units'], stats['chapters'], stats['unsplit'], stats['nameFailures'], stats['nameMatched']) == (5, 5, [], [], 2)
    assert stats['cards'] == {'character': 2, 'location': 1, 'event': 5} and stats['relations'] == len(data['relationships']) and stats['usd'] == 0
    cards = cards_of(data)
    assert cards['harry-potter']['revealFromEpisode'] == 1 and cards['ronald-weasley']['revealFromEpisode'] == 2 and data['english'] == {'Harry Potter': 'harry-potter', 'Ronald Weasley': 'ronald-weasley'}
    assert cards['harry-potter']['body'] == '해리의 문서' and sorted(cards['harry-potter']['characterDocs']['episodes'], key=int) == ['1', '2', '3', '4', '5']
    assert {r['label'] for r in data['relationships']} >= {'참여', '알고 있음', '재학'}
    assert all(c['body'] and len(c['body']) <= b.MAX_DOC for c in data['cards'])
    assert not any(kind == 'hp_docs' and 'Potter' in text for kind, text in llm.asks)


def test_person_documents_are_written_from_the_first_appearance_only_so_later_chapters_never_reach_the_model(small):
    llm, _ = run_build(small)
    docs = {json.loads(text)['name']: text for kind, text in llm.asks if kind == 'hp_docs'}
    assert set(docs) == {'해리', '론'}
    assert 'MARK11' in docs['해리'] and not re.search(r'MARK(1[23]|2\d)', docs['해리'])   # 해리는 1권 1장에 처음 나온다
    assert 'MARK12' in docs['론'] and not re.search(r'MARK(11|13|2\d)', docs['론'])        # 론은 1권 2장에 처음 나온다


def test_the_requests_are_the_same_on_every_run_so_the_ledgered_clients_cache_key_repeats(small, tmp_path):
    first, _ = run_build(small)
    again = type('Small', (), {**vars(small), 'out': tmp_path / 'again'})
    second, _ = run_build(again)
    assert sorted(first.asks) == sorted(second.asks) and {k for k, _ in first.asks} == {'hp_extract', 'hp_names', 'hp_docs', 'hp_traits'}


def test_a_build_whose_estimate_exceeds_the_remaining_limit_stops_before_any_call(small):
    small.cost.record('prior', 9_999_999_999, 0)
    llm = FakeLlm(small.cost)
    with pytest.raises(b.LimitReached, match='상한'):
        run_build(small, llm, limit_usd=10)
    assert llm.asks == []


def test_hitting_the_cost_cap_mid_run_is_a_limit_reached_so_the_cli_can_continue_elsewhere(small):
    from llm import CallCapExceeded

    class Capped(FakeLlm):
        def ask(self, kind, *args, **kwargs):
            if kind == 'hp_docs':
                raise CallCapExceeded('cap')
            return super().ask(kind, *args, **kwargs)

    with pytest.raises(b.LimitReached, match='상한'):
        run_build(small, Capped(small.cost))
    assert issubclass(b.LimitReached, SystemExit)


def test_a_provider_failure_stops_with_the_step_name_and_never_the_text(small):
    from llm import LlmFailure

    class Failing(FakeLlm):
        def ask(self, kind, *args, **kwargs):
            if kind == 'hp_extract':
                raise LlmFailure('transient')
            return super().ask(kind, *args, **kwargs)

    with pytest.raises(SystemExit) as stop:
        run_build(small, Failing(small.cost))
    assert 'hp_extract' in str(stop.value) and 'transient' in str(stop.value) and 'MARK' not in str(stop.value)


def test_a_window_the_model_cannot_finish_is_read_again_in_halves_before_the_build_gives_up(small):
    from llm import LlmFailure

    small.raw.joinpath('가', '1.txt').write_text('제1장\n해리가 걷는다 MARK11\n' + '\n'.join('가' * 100 for _ in range(60)) + '\n해리가 웃는다 MARK12\n제2장\nMARK13 ' + '나' * 400 + '\n제3장\nMARK14 ' + '다' * 400, encoding='utf-8')

    class Truncating(FakeLlm):
        def ask(self, kind, instructions, input, **kwargs):
            if kind == 'hp_extract' and len(json.loads(input)['text']) > 3000:
                raise LlmFailure('incomplete')   # 출력이 잘렸다
            return super().ask(kind, instructions, input, **kwargs)

    llm, stats = run_build(small, Truncating(small.cost))
    assert stats['units'] == 5 and any(kind == 'hp_extract' and len(json.loads(text)['text']) <= 3100 for kind, text in llm.asks)


def test_events_of_chapters_whose_heading_was_not_found_are_dated_at_the_last_chapter_of_their_group(small):
    small.raw.joinpath('가', '1.txt').write_text('제1장\n해리가 걷는다 MARK11 ' + '가' * 400 + '\n해리가 웃는다 MARK12 ' + '나' * 400 + '\n제3장\n해리가 걷는다 MARK13 ' + '다' * 400, encoding='utf-8')   # 2장 머리가 없다
    _, stats = run_build(small)
    data = json.loads((small.out / 'world.json').read_text(encoding='utf-8'))
    events = {c['body'].split()[0]: c['revealFromEpisode'] for c in data['cards'] if c['cardType'] == 'event'}
    assert stats['unsplit'] == [[1, [1, 2]]] and data['unsplit'] == [[1, [1, 2]]] and stats['units'] == 4
    assert events['MARK11'] == events['MARK12'] == 2 and events['MARK13'] == 3   # 묶인 1~2장의 사건은 2화(마지막 장)다: 앞 장으로 미래 정보가 새지 않는다


def run_traits_build(small, make):
    """FakeLlm의 SOUL·GOAL 응답을 make(data)로 바꿔 build를 돌린다."""
    class Scripted(FakeLlm):
        def traits(self, data):
            return make(data) or super().traits(data)

    llm, stats = run_build(small, Scripted(small.cost))
    return llm, stats, json.loads((small.out / 'world.json').read_text(encoding='utf-8'))


def test_soul_and_goal_are_rewritten_from_the_whole_text_while_identity_stays_the_first_appearance_one(small):
    llm, stats, data = run_traits_build(small, lambda data: None)
    harry, ron = cards_of(data)['harry-potter'], cards_of(data)['ronald-weasley']
    assert harry['body'] == '해리의 문서' and harry['characterDocs']['soul'] == '## 말투\n- 해리의 한결같은 말투\n\n## 사고방식\n- 한결같은 성격' and harry['characterDocs']['goal'] == '- 한결같은 바람'
    assert ron['body'] == '론의 문서' and ron['characterDocs']['soul'].startswith('## 말투\n- 론의')
    asked = {json.loads(text)['name']: text for kind, text in llm.asks if kind == 'hp_traits'}
    assert set(asked) == {'해리', '론'} and all(f'MARK{m}' in asked['해리'] for m in ('11', '12', '13', '21', '22'))   # 해리의 성격·바람은 원문 전체(다섯 덩어리)에서 모은다
    assert '상황 MARK' not in asked['해리'] and ' 일' not in asked['해리'] and 'Harry' not in asked['해리']   # 처지·그 장에서 겪은 일은 주지 않고 영어 이름도 싣지 않는다
    assert stats['heldBack'] == 0 and data['heldBack'] == {} and not any(kind == 'hp_traits_retry' for kind, _ in llm.asks)


def test_a_document_with_a_forbidden_word_is_rewritten_once_with_the_word_named_and_the_second_one_is_used(small):
    def make(data):
        if data['name'] == '해리' and 'avoid' not in data:
            return b.hp_traits.Traits(soul='## 말투\n- 호크룩스였다는 사실을 모른다\n\n## 사고방식\n- 용감하다', goal='- 바람')
    llm, stats, data = run_traits_build(small, make)
    retry = [json.loads(text) for kind, text in llm.asks if kind == 'hp_traits_retry']
    assert [r['name'] for r in retry] == ['해리'] and retry[0]['avoid'] == ['호크룩스']   # 걸린 낱말만 알려 준다
    assert cards_of(data)['harry-potter']['characterDocs']['soul'] == '## 말투\n- 해리의 한결같은 말투\n\n## 사고방식\n- 한결같은 성격'   # 두 번째 문서
    assert stats['heldBack'] == 0 and data['heldBack'] == {}


def test_a_document_that_is_caught_again_keeps_the_previous_value_and_is_listed_without_hiding_it(small):
    def make(data):
        if data['name'] == '해리':
            return b.hp_traits.Traits(soul='## 말투\n- 호크룩스 이야기를 피한다\n\n## 사고방식\n- 용감하다', goal='- 바람')
    llm, stats, data = run_traits_build(small, make)
    harry = cards_of(data)['harry-potter']
    assert harry['characterDocs']['soul'] == '## 말투\n- 처음 나온 대목의 말투' and harry['characterDocs']['goal'] == '- 처음 나온 대목의 바람'   # 이전(첫 등장) 문서
    assert data['heldBack'] == {'harry-potter': ['호크룩스']} and stats['heldBack'] == 1
    assert cards_of(data)['ronald-weasley']['characterDocs']['soul'].startswith('## 말투\n- 론의')   # 걸리지 않은 인물은 새 문서


def test_people_without_any_trait_record_are_not_asked_and_keep_their_document(small):
    class Plain(FakeLlm):
        def ask(self, kind, instructions, input, **kwargs):
            reply = super().ask(kind, instructions, input, **kwargs)
            if kind == 'hp_extract':
                for p in reply.people:
                    p.personality = p.speech = p.wants = ''
            return reply

    llm, stats = run_build(small, Plain(small.cost))
    data = json.loads((small.out / 'world.json').read_text(encoding='utf-8'))
    assert not any(kind.startswith('hp_traits') for kind, _ in llm.asks) and stats['heldBack'] == 0
    assert cards_of(data)['harry-potter']['characterDocs']['soul'] == '## 말투\n- 처음 나온 대목의 말투'


def test_the_person_cap_reaches_the_build_and_the_world_shrinks_with_it(small):
    _, wide = run_build(small)
    again = type('Small', (), {**vars(small), 'out': small.out.parent / 'capped'})
    _, tight = run_build(again, person_cap=1)
    capped = json.loads((again.out / 'world.json').read_text(encoding='utf-8'))
    assert tight['relations'] < wide['relations'] and all(len(person_links(capped, key)) <= 1 for key in ('harry-potter', 'ronald-weasley'))


def test_the_preview_prints_soul_and_goal_in_full_for_the_asked_people_and_counts_held_back_documents():
    docs = b.Docs(identity='해리의 정체', soul='## 말투\n- ' + '조용하다 ' * 80, goal='- 집을 찾는다')
    data, _ = world({'harry-potter': docs})
    data['heldBack'] = {'a': ['x'], 'b': ['y']}
    text = b.preview(data, ['Harry Potter'], limit=40, full=['Harry Potter'])
    assert '조용하다 ' * 80 in text.replace('\n', ' ') or ('조용하다 ' * 79) in text and '- 집을 찾는다' in text
    assert '금지 낱말 검사에 두 번 걸려 이전 문서로 둔 인물: 2명' in text and '**SOUL**\n\n## 말투' in text
    short = b.preview(data, ['Harry Potter'], limit=40)
    assert ('조용하다 ' * 80) not in short and '**SOUL** ## 말투' in short
