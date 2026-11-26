"""전처리 평가(연결 평가) 단위 테스트: 정답표와 세계관을 코드로 대조하는 사건 짝짓기·겪음/들음·인물 병합·인물 기준 지식 정확도. 합성 입력만 쓴다(소설 원문 없음, 호출 없음)."""

from collections import Counter

import pytest

import kt_linkeval as le
from app.novelbrain.models import Card, Relation
from kt_context import overlaps
from kt_text import squash
from kt_world import save_world


def gold_event(eid, episode, summary, evidence, participants, witnesses=()):
    return {'id': eid, 'episode': episode, 'summary': summary, 'evidence': evidence, 'participants': [{'name': n, 'evidence': 'x'} for n in participants],
            'witnesses': [{'name': n, 'evidence': 'x'} for n in witnesses]}


# ep1: E1.1(철수·영희, 목격 민수)·E1.2(영희), ep2: E2.1(철수), 길동이 2화에 E1.1을 전해 들었다
KNOWLEDGE = [
    {'episode': 1, 'events': [gold_event('E1.1', 1, '철수가 영희에게 칼을 건넸다.', '철수는 영희에게 칼을 건넸다.', ['철수', '영희'], ['민수']),
                              gold_event('E1.2', 1, '영희가 철수를 믿었다.', '영희는 철수를 믿었다.', ['영희'])], 'learned': []},
    {'episode': 2, 'events': [gold_event('E2.1', 2, '철수가 먼 길을 떠났다.', '철수는 먼 길을 떠났다.', ['철수'])],
     'learned': [{'event': 'E1.1', 'learner': '길동', 'episode': 2, 'evidence': '길동은 소문을 들었다.'}]},
]
TEXT = '철수는 영희에게 칼을 건넸다. 영희는 철수를 믿었다. 철수는 먼 길을 떠났다. 길동은 소문을 들었다. 민수는 지켜보았다.'


def world(extra_cards=(), events=None, aliases=None):
    cards = [Card(id=i, cardType='character', title=t, text='') for i, t in (('c001', '철수'), ('c002', '영희'), ('c003', '민수'), ('c004', '길동'))]
    cards += [Card(id=i, cardType='event', title=t, text=t, revealFromEpisode=n) for i, t, n in (('e01-1', '칼의 전달', 1), ('e01-2', '믿음', 1), ('e02-1', '이별', 2))] + list(extra_cards)
    events = events if events is not None else {
        'e01-1': {'episode': 1, 'title': '칼의 전달', 'quote': '철수는 영희에게 칼을 건넸다.', 'experienced': {'c001': 1, 'c002': 1}, 'heard': {'c004': 1}, 'mentioned': []},
        'e01-2': {'episode': 1, 'title': '믿음', 'quote': '영희는 철수를 믿었다.', 'experienced': {'c002': 1, 'c001': 1}, 'heard': {}, 'mentioned': []},
        'e02-1': {'episode': 2, 'title': '이별', 'quote': '철수는 먼 길을 떠났다.', 'experienced': {'c001': 2}, 'heard': {}, 'mentioned': []}}
    return {'series': 'w00', 'cards': cards, 'relations': [], 'when': {}, 'events': events, 'aliases': aliases or {}}


def test_overlap_score_agrees_with_the_kt_context_gate_and_ranks_by_how_much_of_the_evidence_is_shared():
    evidence = squash('철수는 영희에게 칼을 건넸다. 영희는 철수를 믿었다.')
    for quote in ('철수는 영희에게 칼을 건넸다.', '영희는 철수를 믿었다.', '전혀 다른 문장이 여기에 있다 정말로.', '철수는'):
        assert (le.overlap_score(squash(quote), evidence) > 0) == overlaps(squash(quote), evidence)
    assert le.overlap_score(squash('철수는 영희에게 칼을 건넸다. 영희는 철수를 믿었다.'), evidence) > le.overlap_score(squash('철수는 영희에게 칼을 건넸다.'), evidence) > 0
    assert le.overlap_score(squash('칼'), squash('칼')) == 1.0                                 # 근거가 12자보다 짧으면 통째로 들어 있을 때만


def test_world_events_reads_the_prototype_meta_and_the_old_participation_shape():
    events = le.world_events(world())
    assert [e['id'] for e in events] == ['e01-1', 'e01-2', 'e02-1'] and events[0]['quote'] == '철수는 영희에게 칼을 건넸다.' and events[0]['heard'] == {'c004': 1}
    old = {'series': 'w00', 'cards': world()['cards'], 'when': {'p1': 1, 'p2': 1, 'p3': 2}, 'relations': [
        Relation(id='p1', source='c001', target='e01-1', label='참여'), Relation(id='p2', source='c002', target='e01-1', label='참여'),
        Relation(id='p3', source='c001', target='e02-1', label='참여'), Relation(id='r1', source='c001', target='c002', label='신뢰')]}
    got = {e['id']: e for e in le.world_events(old)}
    assert got['e01-1']['experienced'] == {'c001': 1, 'c002': 1} and got['e02-1']['experienced'] == {'c001': 2} and got['e01-1']['quote'] is None and got['e01-1']['heard'] == {}
    assert got['e01-1']['text'] == '칼의 전달' and got['e01-2']['experienced'] == {}                 # 사건 카드만 사건이고 참여 관계가 없으면 빈 겪음


def keys_of(w):
    return le.person_cards(['철수', '영희', '민수', '길동'], w)


def test_quote_rule_pairs_each_gold_event_with_the_best_overlapping_same_episode_event_once():
    cards, gold_of = keys_of(world())
    gold = [e for r in KNOWLEDGE for e in r['events']]
    matches = le.match_events(gold, le.world_events(world()), 'quote', {g['id']: le.gold_people(g) for g in gold}, gold_of)
    assert {g: w['id'] for g, w in matches.items()} == {'E1.1': 'e01-1', 'E1.2': 'e01-2', 'E2.1': 'e02-1'}
    wrong_episode = world(events={'e01-1': {'episode': 2, 'title': 't', 'quote': '철수는 영희에게 칼을 건넸다.', 'experienced': {}, 'heard': {}, 'mentioned': []}})
    assert le.match_events(gold, le.world_events(wrong_episode), 'quote', {g['id']: le.gold_people(g) for g in gold}, gold_of) == {}          # 같은 회차만
    twin = world(events={'a': {'episode': 1, 'title': 't', 'quote': '철수는 영희에게 칼을 건넸다.', 'experienced': {}, 'heard': {}, 'mentioned': []}})
    one = le.match_events(gold[:1] + [dict(gold[0], id='E1.9')], le.world_events(twin), 'quote', {'E1.1': set(), 'E1.9': set()}, gold_of)
    assert len(one) == 1                                                                              # 한 세계관 사건이 두 정답 사건에 붙지 않는다


def test_text_rule_uses_the_summary_overlap_and_the_participants_when_there_is_no_quote():
    cards, gold_of = keys_of(world())
    plain = world(events={'a': {'episode': 1, 'title': '칼', 'quote': None, 'experienced': {'c001': 1, 'c002': 1}, 'heard': {}, 'mentioned': []},
                          'b': {'episode': 1, 'title': '날씨', 'quote': None, 'experienced': {'c003': 1}, 'heard': {}, 'mentioned': []}})
    plain['cards'] = [c for c in plain['cards'] if c.cardType == 'character'] + [Card(id='a', cardType='event', title='칼', text='철수가 영희에게 칼을 건네 주었다.', revealFromEpisode=1),
                                                                              Card(id='b', cardType='event', title='날씨', text='마을에 비가 많이 내렸다.', revealFromEpisode=1)]
    gold = [e for r in KNOWLEDGE for e in r['events']][:1]
    matches = le.match_events(gold, le.world_events(plain), 'text', {'E1.1': le.gold_people(gold[0])}, gold_of, drop=['철수', '영희', '민수', '길동'])
    assert {g: w['id'] for g, w in matches.items()} == {'E1.1': 'a'}
    long_world = {'a': dict(plain['events']['a'], title='칼'), 'b': plain['events']['b']}
    plain['cards'][-2] = Card(id='a', cardType='event', title='칼', text='마을에 비가 많이 내렸다. 장터는 한산했다. 아이들이 물웅덩이에서 놀았다. 철수가 영희에게 칼을 건네 주었다.', revealFromEpisode=1)
    again = le.match_events(gold, le.world_events(dict(plain, events=long_world)), 'text', {'E1.1': le.gold_people(gold[0])}, gold_of, drop=['철수', '영희', '민수', '길동'])
    assert {g: w['id'] for g, w in again.items()} == {'E1.1': 'a'}                      # 긴 글 속의 한두 문장이 같은 사건이면 글이 길어도 짝지어진다(창 단위 비교)


def test_work_counts_scores_the_experienced_and_heard_links_and_the_knowledge_of_the_main_people():
    counts = le.work_counts(KNOWLEDGE, world(), ['철수', '영희'], 'quote')
    assert (counts['gold_events'], counts['matched']) == (3, 3)
    assert (counts['exp_linked'], counts['exp_correct'], counts['exp_gold'], counts['exp_found']) == (5, 4, 5, 4)             # 겪음 정확도 4/5·재현율 4/5
    assert (counts['learned_gold'], counts['heard_found'], counts['heard_found_ep']) == (1, 1, 0)                           # 길동이 들은 것을 이었고 회차는 1화라 2화와 다르다
    assert (counts['heard_linked'], counts['heard_correct'], counts['heard_known']) == (1, 1, 1)
    assert (counts['tp'], counts['fp'], counts['fn'], counts['tn']) == (7, 2, 0, 1)                                         # 철수가 E1.2를 아는 것으로 잘못 이었다(2회차)
    assert (counts['persons'], counts['persons_found'], counts['persons_split'], counts['cards_mixed']) == (4, 4, 0, 0)


def test_a_link_recorded_after_the_reference_episode_does_not_make_the_person_know_the_event_yet():
    late = world(events={'e01-1': dict(world()['events']['e01-1'], experienced={'c001': 2}, heard={})})                         # 철수와 사건의 연결이 2화에 기록됐다(1화 사건)
    counts = le.work_counts(KNOWLEDGE, late, ['철수'], 'quote')
    assert (counts['tp'], counts['fp'], counts['fn'], counts['tn']) == (1, 0, 2, 2)                                           # 1화 시점엔 모른다(놓침), 2화부터 안다(맞힘), 짝 못 지은 E2.1은 놓침


def test_a_gold_event_the_world_missed_costs_recall_everywhere_and_is_never_guessed():
    only_first = world(events={'e01-1': world()['events']['e01-1']})
    counts = le.work_counts(KNOWLEDGE, only_first, ['철수'], 'quote')
    assert (counts['gold_events'], counts['matched']) == (3, 1) and counts['exp_gold'] == 3                                  # 못 이은 사건의 참여자는 세지 않는다(짝지은 사건만)
    assert (counts['tp'], counts['fp'], counts['fn'], counts['tn']) == (2, 0, 1, 2)                                            # 철수가 E2.1을 안다는 것(정답)은 세계관에 그 사건이 없어 놓침


def test_person_cards_maps_name_variants_counts_split_persons_and_a_card_that_mixes_two_gold_people():
    extra = [Card(id='c005', cardType='character', title='김철수', text=''), Card(id='c006', cardType='character', title='다온', text='')]
    split = world(extra_cards=extra)
    cards, gold_of = le.person_cards(['철수', '영희', '민수', '길동'], split)
    assert sorted(cards['철수']) == ['c001', 'c005'] and gold_of['c005'] == {'철수'} and gold_of['c006'] == set()            # 성을 뗀 이름은 같은 인물로 읽는다
    counts = le.work_counts(KNOWLEDGE, split, ['철수'], 'quote')
    assert counts['persons_split'] == 1 and counts['person_cards'] == 5 and counts['cards_unmapped'] == 1                  # 철수는 카드 둘로 쪼개졌고 다온는 정답표 인물이 아니다
    mixed = world(aliases={'c001': ['영희']})                                                                               # 한 카드의 이름이 정답표의 다른 두 인물에 걸린다
    cards, gold_of = le.person_cards(['철수', '영희', '민수', '길동'], mixed)
    assert gold_of['c001'] == {'철수', '영희'}
    assert le.work_counts(KNOWLEDGE, mixed, ['철수'], 'quote')['cards_mixed'] == 1


def test_gold_name_matching_reads_a_title_prefixed_or_surname_dropped_card_name_as_the_gold_person_only_when_it_is_unambiguous():
    assert le.gold_matches('서울 판관 김지수', ['지수', '하준']) == {'지수'} and le.gold_matches('김지수', ['지수']) == {'지수'} and le.gold_matches('지수', ['김지수']) == {'김지수'}
    assert le.gold_matches('치삼이', ['치삼']) == {'치삼'}                                  # 호칭 변형(_base)
    assert le.gold_matches('영수', ['김영수', '박영수']) == set()                          # 정답표 인물이 둘 이상이면 어느 쪽인지 몰라 잇지 않는다
    assert le.gold_matches('철', ['철수']) == set() and le.gold_matches('하준', ['하준수']) == set()   # 한 글자나 낱말 일부는 잇지 않는다


def test_a_full_name_card_goes_to_the_gold_person_that_has_no_exact_card_of_its_own():
    assert le.gold_matches('로빈 하트', ['로빈', '하트']) == set()                                               # 둘에 걸려 모호하다
    assert le.gold_matches('로빈 하트', ['로빈', '하트'], claimed={'하트'}) == {'로빈'}                         # 하트는 이름이 같은 카드가 따로 있어 그쪽 몫이다
    assert le.gold_matches('로빈 하트', ['로빈', '하트'], claimed={'로빈', '하트'}) == set()                   # 둘 다 따로 있으면 여전히 모호
    assert le.gold_matches('하트', ['로빈', '하트'], claimed={'하트'}) == {'하트'}                                # 이름이 같은 카드는 늘 그 인물
    cards = [Card(id='c1', cardType='character', title='로빈 하트', text=''), Card(id='c2', cardType='character', title='하트', text='')]
    by_gold, gold_of = le.person_cards(['로빈', '하트'], {'series': 'w00', 'cards': cards, 'relations': [], 'when': {}})
    assert by_gold == {'로빈': ['c1'], '하트': ['c2']} and gold_of == {'c1': {'로빈'}, 'c2': {'하트'}}


def test_character_ids_pick_the_card_with_the_most_episode_memory_for_a_split_person_and_skip_a_person_without_a_card():
    cards = [Card(id='c010', cardType='character', title='지수', text='', revealFromEpisode=1, episodes={1: 'a'}),
             Card(id='c011', cardType='character', title='김지수', text='', revealFromEpisode=2, episodes={2: 'a', 3: 'b', 4: 'c'}),
             Card(id='c012', cardType='character', title='서울 판관 김지수', text='', revealFromEpisode=1, episodes={3: 'x', 4: 'y', 5: 'z'}),
             Card(id='c013', cardType='character', title='다온', text='')]
    split = {'series': 'w00', 'cards': cards, 'relations': [], 'when': {}}
    assert le.character_ids(split, ['지수', '길동']) == {'지수': 'c012'}                      # 셋이 모두 지수이고 기억이 같은 수(3개)면 먼저 공개된 카드, 그 다음 id 순
    assert le.character_ids(split, ['다온']) == {'다온': 'c013'}


def test_gold_classes_read_name_variants_as_one_person_unless_they_appear_in_one_event_as_two():
    rep = le.gold_classes(['치삼', '치삼이', '지수', '김지수', '민수', '민수야', '길동'], [])
    assert rep['치삼이'] == rep['치삼'] == '치삼' and rep['김지수'] == rep['지수'] == '지수' and rep['민수야'] == rep['민수'] == '민수' and rep['길동'] == '길동'
    assert le.gold_classes(['철수', '김철수'], [('철수', '김철수')]) == {'철수': '철수', '김철수': '김철수'}               # 같은 사건에 다른 사람으로 오른 쌍은 합치지 않는다


VARIANT = [{'episode': 1, 'events': [gold_event('E1.1', 1, '치삼이 영희에게 칼을 건넸다.', '치삼은 영희에게 칼을 건넸다.', ['치삼', '영희']),
                                     gold_event('E1.2', 1, '치삼이가 영희를 믿었다.', '치삼이는 영희를 믿었다.', ['치삼이'])], 'learned': []}]


def test_a_card_that_covers_two_gold_spellings_of_one_person_is_one_person_not_a_mix():
    cards = [Card(id='c1', cardType='character', title='치삼', text=''), Card(id='c2', cardType='character', title='영희', text=''),
             Card(id='e1', cardType='event', title='a', text='a', revealFromEpisode=1), Card(id='e2', cardType='event', title='b', text='b', revealFromEpisode=1)]
    events = {'e1': {'episode': 1, 'title': 'a', 'quote': '치삼은 영희에게 칼을 건넸다.', 'experienced': {'c1': 1, 'c2': 1}, 'heard': {}, 'mentioned': []},
              'e2': {'episode': 1, 'title': 'b', 'quote': '치삼이는 영희를 믿었다.', 'experienced': {'c1': 1}, 'heard': {}, 'mentioned': []}}
    counts = le.work_counts(VARIANT, {'series': 'w00', 'cards': cards, 'relations': [], 'when': {}, 'events': events}, ['치삼', '치삼이'], 'quote')
    assert (counts['persons'], counts['persons_found'], counts['persons_split'], counts['cards_mixed']) == (2, 2, 0, 0)              # 정답표의 치삼·치삼이는 한 인물
    assert (counts['exp_linked'], counts['exp_correct'], counts['exp_gold'], counts['exp_found']) == (3, 3, 3, 3)
    assert counts['main_persons'] == 1 and counts['tp'] == 2 and counts['fp'] == 0 and counts['fn'] == 0                       # 주요 인물도 한 인물로 세고 어느 철자의 사건이든 안다


def test_a_card_mixing_two_gold_people_is_flagged_as_evidently_distinct_only_when_they_appear_in_one_event_as_two():
    mixed = world(aliases={'c001': ['영희', '길동']})                                      # 철수·영희는 E1.1에 함께 나온 다른 사람, 길동은 어느 사건에도 함께 나오지 않는다
    counts = le.work_counts(KNOWLEDGE, mixed, ['철수'], 'quote')
    assert counts['cards_mixed'] == 1 and counts['cards_mixed_apart'] == 1
    alias = world(aliases={'c004': ['민수']})                                              # 길동·민수는 함께 나온 적이 없다: 같은 인물의 다른 이름일 수 있어 섞임으로만 센다(분명한 오병합이 아니다)
    counts = le.work_counts(KNOWLEDGE, alias, ['철수'], 'quote')
    assert counts['cards_mixed'] == 1 and counts['cards_mixed_apart'] == 0


def test_ratio_and_aggregate_sum_counts_and_give_wilson_intervals_by_work_kind():
    assert le.ratio(0, 0) == {'k': 0, 'n': 0, 'rate': None, 'ci': None}
    r = le.ratio(8, 10)
    assert r['rate'] == 0.8 and r['ci'][0] < 0.8 < r['ci'][1]
    a, b = Counter(gold_events=10, matched=8, exp_linked=4, exp_correct=3), Counter(gold_events=10, matched=2)
    total = le.aggregate({'w01': ('web', a), 'c01': ('classic', b)})
    assert total['all']['event_recall']['k'] == 10 and total['all']['event_recall']['n'] == 20
    assert total['by_kind']['web']['event_recall']['rate'] == 0.8 and total['by_kind']['classic']['event_recall']['rate'] == 0.2
    assert total['by_work']['w01']['experienced_precision']['rate'] == 0.75


def test_prototype_stats_give_the_quote_pass_rate_and_dropped_total():
    stats = {'counts': {'event_quote_checked': 10, 'event_quote_ok': 9, 'relation_quote_checked': 5, 'relation_quote_ok': 4, 'speech_quote_checked': 5, 'speech_quote_ok': 5},
             'dropped': {'event_quote': 1, 'mention_name': 3}}
    assert le.prototype_stats([stats, stats]) == {'quote_checked': 40, 'quote_ok': 36, 'quote_pass': 0.9, 'dropped': 8, 'dropped_by_code': {'event_quote': 2, 'mention_name': 6}}
    assert le.prototype_stats([]) == {}


def test_service_stats_give_the_item_pass_rate_skipped_codes_and_failed_episodes():
    stats = {'extraction': {'kept': 10, 'dropped': 5, 'skipped': {'INVALID_OR_AMBIGUOUS_QUOTE': 3, 'UNKNOWN_ENTITY': 2}}, 'failures': [[3, 'NO_VERIFIED_MENTION']], 'calls': 13}
    assert le.service_stats([stats, stats]) == {'kept': 20, 'dropped': 10, 'item_pass': 20 / 30, 'skipped': {'INVALID_OR_AMBIGUOUS_QUOTE': 6, 'UNKNOWN_ENTITY': 4}, 'failed_episodes': 2, 'calls': 26}
    assert le.service_stats([]) == {}


def with_heard(episode):
    """e01-1의 들음 기록 회차만 바꾼 세계관(길동이 사건을 전해 들은 것으로 기록된 회차)."""
    events = {**world()['events'], 'e01-1': dict(world()['events']['e01-1'], heard={'c004': episode})}
    return world(events=events)


def test_heard_links_are_counted_apart_for_hearing_in_the_event_episode_and_in_a_later_episode():
    same = le.work_counts(KNOWLEDGE, with_heard(1), ['길동'], 'quote')                                        # 사건과 같은 1화에 들은 것으로 기록
    assert (same['heard_same_linked'], same['heard_same_known'], same['heard_later_linked'], same['heard_found_later']) == (1, 1, 0, 0)
    later = le.work_counts(KNOWLEDGE, with_heard(2), ['길동'], 'quote')                                       # 뒤 2화에 들은 것으로 기록(정답표 learned와 같은 회차)
    assert (later['heard_same_linked'], later['heard_later_linked'], later['heard_later_correct'], later['heard_later_known']) == (0, 1, 1, 1)
    assert (later['heard_found'], later['heard_found_later'], later['heard_found_ep']) == (1, 1, 1)
    assert (later['heard_linked'], later['heard_correct'], later['heard_known']) == (1, 1, 1)                  # 기존 합계 칸은 둘의 합으로 그대로


def test_a_heard_link_on_a_person_who_was_present_is_known_but_never_a_correct_learner():
    events = {**world()['events'], 'e01-1': dict(world()['events']['e01-1'], heard={'c002': 2, 'c003': 1})}  # 영희(참여)·민수(목격)는 전해 들은 인물이 아니다
    c = le.work_counts(KNOWLEDGE, world(events=events), ['길동'], 'quote')
    assert (c['heard_linked'], c['heard_correct'], c['heard_known']) == (2, 0, 2)
    assert (c['heard_same_linked'], c['heard_same_known'], c['heard_later_linked'], c['heard_later_correct'], c['heard_later_known']) == (1, 1, 1, 0, 1)
    assert c['heard_found_later'] == 0                                                                        # 길동은 이어지지 않았다


def memory_world(memory):
    """길동(c004) 카드에 회차 기억을 달고 사건 연결을 모두 지운 세계관: 엄격 판정은 아무것도 찾지 못한다."""
    w = world(events={k: dict(v, experienced={}, heard={}) for k, v in world()['events'].items()})
    w['cards'] = [c.model_copy(update={'episodes': memory}) if c.id == 'c004' else c for c in w['cards']]
    return w


def test_statements_drop_the_event_entries_and_keep_the_other_memory_lines():
    memory = '[정체] 마을 대장장이다.\n[사건] 철수가 영희에게\n칼을 건넸다.\n[겪은 일] 이별: 철수가 떠났다.\n[들은 일] 소문: 길동이 들었다.\n[계획] 내일 떠난다.'
    assert le.statements(memory) == ['마을 대장장이다.', '내일 떠난다.']                                         # 줄이 이어지는 사건 항목(서비스 인용의 개행)은 통째로 뺀다
    assert le.statements('길동은 철수가 칼을 건네는 것을 보았다.') == ['길동은 철수가 칼을 건네는 것을 보았다.']      # 표지 없는 기억(기존 세계관)은 통째로 서술이다
    assert le.statements('') == []


def test_wide_knowledge_counts_a_non_event_memory_line_that_matches_a_gold_event_by_the_text_rule():
    c = le.work_counts(KNOWLEDGE, memory_world({1: '[묘사] 철수가 영희에게 칼을 건네 주었다.'}), ['길동'], 'text')
    assert (c['tp'], c['fp'], c['fn'], c['tn']) == (0, 0, 1, 4)                                                # 엄격: 연결이 없어 2화에 전해 들은 것(정답)을 놓친다
    assert (c['wtp'], c['wfp'], c['wfn'], c['wtn']) == (1, 1, 0, 3)                                            # 넓힘: 1화 서술이 E1.1과 맞아 1화부터 안다(1화는 아직 틀림, 2화는 맞힘)


def test_wide_knowledge_ignores_event_entries_other_episodes_and_gives_a_line_to_its_best_gold_event_only():
    for memory in ({1: '[사건] 철수가 영희에게 칼을 건네 주었다.'}, {1: '[겪은 일] 칼의 전달: 철수가 영희에게 칼을 건네 주었다.'},
                   {1: '[사건] 철수가 영희에게\n칼을 건네 주었다.'}, {2: '[묘사] 철수가 영희에게 칼을 건네 주었다.'}):
        c = le.work_counts(KNOWLEDGE, memory_world(memory), ['길동'], 'text')
        assert (c['wtp'], c['wfp'], c['wfn'], c['wtn']) == (c['tp'], c['fp'], c['fn'], c['tn']), memory        # 사건 항목은 엄격 판정이 보고, 다른 회차의 사건과는 짝짓지 않는다
    c = le.work_counts(KNOWLEDGE, memory_world({1: '철수가 영희에게 칼을 건네 주었다.'}), ['길동'], 'text')
    assert (c['wtp'], c['wfp'], c['wfn'], c['wtn']) == (1, 1, 0, 3)                                            # 한 줄이 E1.2('믿었다')와도 '었다'로 겹치지만 가장 잘 맞는 E1.1에만 속한다


def test_knowledge_f1_is_the_harmonic_mean_of_precision_and_recall_and_none_without_counts():
    d = le.derive(Counter(tp=6, fp=2, fn=2, wtp=8, wfp=2, wfn=0))
    assert d['knowledge_f1'] == pytest.approx(0.75) and d['knowledge_f1_wide'] == pytest.approx(16 / 18)
    assert (d['knowledge_precision_wide']['k'], d['knowledge_precision_wide']['n'], d['knowledge_recall_wide']['n']) == (8, 10, 8)
    assert le.derive(Counter())['knowledge_f1'] is None and le.derive(Counter())['knowledge_f1_wide'] is None


def test_derive_gives_the_heard_split_metrics():
    d = le.derive(Counter(heard_same_linked=4, heard_same_known=3, heard_later_linked=5, heard_later_correct=2, heard_later_known=4, learned_gold=10, heard_found_later=6))
    assert (d['heard_same_known']['k'], d['heard_same_known']['n']) == (3, 4)
    assert (d['heard_later_precision']['k'], d['heard_later_precision']['n'], d['heard_later_known']['k']) == (2, 5, 4)
    assert (d['heard_later_recall']['k'], d['heard_later_recall']['n']) == (6, 10)


@pytest.mark.parametrize('world_name', ['world', 'world2', 'world_svc', 'sv-noise', 'sv-h1_events'])
def test_world_file_name_must_be_a_known_world(world_name):
    assert le.check_worlds([world_name]) == (world_name,)


@pytest.mark.parametrize('bad', ['nope', 'work', 'knowledge', 'sv-', 'sv', 'world2_stats', 'sv-x_stats', '../world', 'sv-a/b'])
def test_other_file_names_are_not_world_files(bad):
    with pytest.raises(SystemExit):
        le.check_worlds([bad])


# ---- PR #945 리뷰 후속(#948) ----

def test_gold_classes_never_join_two_apart_names_through_a_longer_name_that_contains_both():
    rep = le.gold_classes(['로빈', '로빈 하트', '하트', '치삼', '치삼이'], [('로빈', '하트')])                 # 로빈·하트는 같은 사건에 다른 사람으로 올랐다
    assert rep['로빈'] != rep['하트']                                                                   # 긴 이름 '로빈 하트'를 거쳐 한 대표가 되지 않는다
    assert rep['로빈 하트'] == rep['로빈'] and rep['치삼이'] == rep['치삼']                                   # 긴 이름은 먼저 합친 쪽(가나다 순)에 붙고 충돌 없는 호칭 변형은 그대로 합친다


def test_evaluate_scores_every_world_on_the_works_they_all_have_and_lists_the_works_each_one_misses(tmp_path, monkeypatch):
    for wid, names in (('A', ('world2', 'world_svc')), ('B', ('world2',))):                              # B는 서비스 전처리 세계관이 없다
        (tmp_path / wid).mkdir()
        for name in names:
            save_world(tmp_path / wid / f'{name}.json', world())
    monkeypatch.setattr(le, 'load_inputs', lambda wid: {'knowledge': KNOWLEDGE, 'kind': 'web', 'mains': ['철수', '영희'], 'folder': tmp_path / wid})
    out = le.evaluate(['A', 'B'], ('world2', 'world_svc'))
    assert out['common'] == ['A'] and out['worlds']['world2']['works'] == ['A'] and out['worlds']['world_svc']['works'] == ['A']
    assert out['worlds']['world2']['missing'] == [] and out['worlds']['world_svc']['missing'] == ['B']
    assert out['worlds']['world2']['rules']['quote']['all']['event_recall']['n'] == 3                    # B의 사건 3개는 시제품 점수에도 들지 않는다(작품 구성 차이가 성능 차이로 읽히지 않게)


def test_a_person_heard_under_two_gold_spellings_keeps_the_earliest_episode_of_hearing():
    gold = gold_event('E1.1', 1, '치삼이 영희에게 칼을 건넸다.', '치삼은 영희에게 칼을 건넸다.', ['영희'])
    learn = lambda name, episode: {'event': 'E1.1', 'learner': name, 'episode': episode, 'evidence': 'x'}  # noqa: E731
    knowledge = [{'episode': 1, 'events': [gold], 'learned': []}, {'episode': 2, 'events': [], 'learned': [learn('치삼', 2)]}, {'episode': 4, 'events': [], 'learned': [learn('치삼이', 4)]}]
    cards = [Card(id='c1', cardType='character', title='치삼', text=''), Card(id='c2', cardType='character', title='영희', text=''), Card(id='e1', cardType='event', title='a', text='a', revealFromEpisode=1)]
    events = {'e1': {'episode': 1, 'title': 'a', 'quote': '치삼은 영희에게 칼을 건넸다.', 'experienced': {'c2': 1}, 'heard': {'c1': 2}, 'mentioned': []}}
    counts = le.work_counts(knowledge, {'series': 'w00', 'cards': cards, 'relations': [], 'when': {}, 'events': events}, ['치삼'], 'quote')
    assert (counts['learned_gold'], counts['heard_found'], counts['heard_found_ep']) == (1, 1, 1)         # 2화 들음을 2화로 이었다: 4화 기록이 2화를 덮어 오답으로 세지 않는다


def test_a_work_without_any_gold_event_counts_nothing_instead_of_stopping_the_run():
    for knowledge in ([], [{'episode': 1, 'events': [], 'learned': []}]):                                # 추출기는 빈 정답표도 그대로 파일로 쓴다
        counts = le.work_counts(knowledge, world(), [], 'text')
        assert (counts['gold_events'], counts['matched'], counts['tp'], counts['persons']) == (0, 0, 0, 0)
