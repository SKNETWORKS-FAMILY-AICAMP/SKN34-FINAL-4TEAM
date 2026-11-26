"""세계관 시제품(v2) 단위 테스트: 모델 출력 재검증·인물 합치기·세계관 조립·인물 시점 필터와의 연결·회차별 라운드. 합성 입력만 쓴다(소설 원문 없음, 모델 호출 없음)."""

import json
from types import SimpleNamespace

import pytest

import kt_world2 as w2
from app.novelbrain.service import recall
from batch import SyncExecutor, run_rounds
from kt_world import load_world
from llm import Ledger, Llm
from timechara import snapshot

TEXT = '철수는 영희에게 칼을 건넸다. 영희는 철수를 믿었다. 민수는 이 일을 아무것도 몰랐다. 마을 장터에는 소문이 돌았다.'
QUOTE = '철수는 영희에게 칼을 건넸다.'
PEOPLE = {'철수': '검객', '영희': '처녀'}


def who(name, intro=''):
    return w2.Person(name=name, intro=intro)


def mention(name, kind='character', role='experienced'):
    return w2.Mention(name=name, kind=kind, role=role if kind == 'character' else 'none')


def event(title='칼의 전달', detail='@철수는 @영희에게 @칼을 건넸다.', quote=QUOTE, mentions=None):
    return w2.Event(title=title, detail=detail, quote=quote, mentions=mentions if mentions is not None else [mention('철수'), mention('영희')])


# ---- 인물·인물 문서 ----

def test_name_key_reads_old_spellings_as_modern_ones_and_leaves_modern_names_alone():
    assert w2._base('츈희') == w2._base('춘희') and w2._base('샹궁') == w2._base('상궁') and w2._base('냥우') == w2._base('양우')      # 옛 표기(ㅅㅈㅊ 뒤 ㅑㅕㅛㅠ, 낱말 첫 ㄴ+ㅑㅕㅛㅠㅣ)
    assert w2._base('쇼담') == w2._base('소담') and w2._base('졍쇼셔') == w2._base('정소서')
    assert w2._base('철수는') == '철수' and w2._base('김 영희') == w2._base('김 영희') and w2._base('도서') != w2._base('도사')            # 현대 이름과 호칭 변형 규칙은 그대로


def test_two_spellings_of_one_name_in_different_episodes_share_one_card():
    people = {'1:1': (1, 1, '춘희'), '2:1': (2, 1, '츈희'), '2:2': (2, 2, '영희')}
    group, _, _ = w2.resolve_groups(people, [])
    assert group['1:1'] == group['2:1'] != group['2:2']


def test_verify_people_keeps_only_names_found_in_the_text_once():
    out = w2.Persons(characters=[who('철수', '검객'), who('길동', '없는 사람'), who('나', '한 글자'), who(' 철수 ', '중복'), who('영희', '  마을   처녀 ')])
    people, stats = w2.verify_people(TEXT, out)
    assert people == {'철수': '검객', '영희': '마을 처녀'}                                   # 본문에 없는 이름·한 글자 이름·중복은 버린다
    assert stats['character_name'] == 2 and stats['character_dup'] == 1 and stats['characters_proposed'] == 5 and stats['characters_kept'] == 2


def test_verify_doc_drops_only_the_speech_quote_that_is_not_in_the_text_and_empties_a_doc_without_evidence():
    text = '철수는 칼을 쥐고 말했다. "이 칼을 받아라." 영희는 대답하지 않았다.'
    good = w2.CharDoc(identity='떠돌이 검객', personality='과묵하다', speech='명령조', speech_quote='"이 칼을 받아라."', goal='', activity='')
    doc, stats = w2.verify_doc(text, good)
    assert doc == {'identity': '떠돌이 검객', 'personality': '과묵하다', 'speech': '명령조', 'speech_quote': '"이 칼을 받아라."', 'goal': '', 'activity': ''}
    assert stats['speech_quote_checked'] == 1 and stats['speech_quote_ok'] == 1
    bad, stats = w2.verify_doc(text, good.model_copy(update={'speech_quote': '"이 칼은 내 것이다."'}))
    assert bad['speech_quote'] == '' and bad['speech'] == '명령조' and stats['speech_quote'] == 1       # 그 줄만 버린다
    empty, stats = w2.verify_doc(text, w2.CharDoc(identity='', personality=' ', speech='', speech_quote='', goal='', activity=''))
    assert empty == {} and stats['docs_empty'] == 1


def test_verify_doc_removes_sentences_that_only_say_something_is_not_revealed():
    text = '철수는 칼을 쥐고 말했다.'
    doc = w2.CharDoc(identity='떠돌이 검객이다. 그 밖의 신분·내력은 밝혀지지 않는다.', personality='직접 행동이나 대사가 나오지 않아 성격은 확인할 수 없다.', speech='명령조로 말한다. 감정을 겉으로 드러내지 않는다.',
                     speech_quote='', goal='', activity='')
    out, stats = w2.verify_doc(text, doc)
    assert out['identity'] == '떠돌이 검객이다.' and out['personality'] == '' and out['speech'] == '명령조로 말한다. 감정을 겉으로 드러내지 않는다.'       # '드러내지'(성격 서술)는 군더더기가 아니다
    assert stats['doc_negation'] == 2 and stats['docs_kept'] == 1
    only, stats = w2.verify_doc(text, w2.CharDoc(identity='이름만 언급되며 신분은 드러나지 않는다.', personality='', speech='', speech_quote='', goal='단정하기는 어렵다.', activity=''))
    assert only == {} and stats['docs_empty'] == 1 and stats['doc_negation'] == 2                                                     # 전부 군더더기면 빈 문서


def test_verify_doc_keeps_an_activity_only_doc_and_drops_the_not_revealed_sentences_of_the_activity():
    text = '철수는 칼을 쥐고 말했다.'
    doc = w2.CharDoc(identity='', personality='', speech='', speech_quote='', goal='', activity='철수는 영희에게 칼을 건넸다. 그 뒤의 행적은 밝혀지지 않는다.')
    out, stats = w2.verify_doc(text, doc)
    assert out['activity'] == '철수는 영희에게 칼을 건넸다.' and stats['doc_negation'] == 1 and stats['docs_kept'] == 1       # 행적만 있어도 문서다


def test_doc_lines_puts_the_activity_after_the_goal_and_still_reads_docs_made_before_the_activity_existed():
    full = {'identity': '떠돌이 검객', 'personality': '', 'speech': '명령조', 'speech_quote': '"받아라."', 'goal': '복수', 'activity': '칼을 건네고 떠났다.'}
    assert w2.doc_lines(full) == ['[정체] 떠돌이 검객', '[말투] 명령조 (예: "받아라.")', '[목표] 복수', '[행적] 칼을 건네고 떠났다.']
    assert w2.doc_lines({'identity': '떠돌이 검객', 'personality': '', 'speech': '', 'speech_quote': '', 'goal': ''}) == ['[정체] 떠돌이 검객']        # 옛 기록(행적 칸 없음)


# ---- 사건 ----

def test_verify_events_keeps_roles_for_people_and_none_for_other_kinds():
    out = w2.Events(events=[event(mentions=[mention('철수'), mention('영희', role='heard'), mention('민수', role='mentioned'), mention('장터', 'location')])])
    events, stats = w2.verify_events(TEXT, out, {**PEOPLE, '민수': '이웃'})
    assert events == [{'title': '칼의 전달', 'detail': '@철수는 @영희에게 @칼을 건넸다.', 'quote': QUOTE, 'mentions': [
        {'name': '철수', 'kind': 'character', 'role': 'experienced'}, {'name': '영희', 'kind': 'character', 'role': 'heard'},
        {'name': '민수', 'kind': 'character', 'role': 'mentioned'}, {'name': '장터', 'kind': 'location', 'role': 'none'}]}]
    assert stats['events_kept'] == 1 and stats['event_quote_checked'] == 1 and stats['event_quote_ok'] == 1


def test_verify_events_keeps_one_of_two_events_with_the_same_title_and_quote():
    events, stats = w2.verify_events(TEXT, w2.Events(events=[event(), event(detail='@철수가 @영희에게 @칼을 주었다. 다시 적은 설명이다.')]), PEOPLE)
    assert len(events) == 1 and stats['event_dup'] == 1 and stats['events_kept'] == 1


def test_verify_events_drops_an_event_whose_quote_is_not_in_the_text_and_counts_it():
    out = w2.Events(events=[event(quote='영희는 칼을 던져 버렸다.'), event(title='다른 사건', quote='영희는 철수를 믿었다.')])
    events, stats = w2.verify_events(TEXT, out, PEOPLE)
    assert [e['title'] for e in events] == ['다른 사건']
    assert stats['event_quote'] == 1 and stats['event_quote_checked'] == 2 and stats['event_quote_ok'] == 1


def test_verify_events_drops_a_mention_not_in_the_text_a_person_without_a_role_and_keeps_the_strongest_role_of_a_duplicate():
    bad_role = w2.Mention(name='영희', kind='character', role='none')
    out = w2.Events(events=[event(mentions=[mention('길동', 'location'), bad_role, mention('철수', role='mentioned'), mention('철수', role='experienced'),
                                            mention('장터', 'location'), mention('장터', 'location')])])
    events, stats = w2.verify_events(TEXT, out, PEOPLE)
    assert events[0]['mentions'] == [{'name': '철수', 'kind': 'character', 'role': 'experienced'}, {'name': '장터', 'kind': 'location', 'role': 'none'}]
    assert stats['mention_name'] == 1 and stats['mention_role'] == 1 and stats['mention_dup'] == 2


def test_verify_events_drops_a_person_mention_that_is_not_in_the_step_1_list_but_keeps_other_kinds():
    out = w2.Events(events=[event(mentions=[mention('철수'), mention('민수', role='mentioned'), mention('장터', 'location')])])
    events, stats = w2.verify_events(TEXT, out, PEOPLE)                                          # 민수는 본문에 있지만 1단계 인물 목록에 없다(직함·무리가 인물로 새는 것을 막는다)
    assert [m['name'] for m in events[0]['mentions']] == ['철수', '장터'] and stats['mention_unlisted'] == 1


def test_verify_events_maps_a_name_variant_to_the_listed_person():
    text = '치삼이가 문을 열었다. 치삼은 웃었다.'
    out = w2.Events(events=[event(title='문 열기', quote='치삼이가 문을 열었다.', mentions=[mention('치삼이')])])
    events, stats = w2.verify_events(text, out, {'치삼': '머슴'})
    assert events[0]['mentions'] == [{'name': '치삼', 'kind': 'character', 'role': 'experienced'}] and stats['character_variant'] == 1


# ---- 사건의 자리(그 자리에 있던 인물) ----

def test_verify_presence_keeps_listed_people_for_valid_event_numbers_and_the_stronger_role_of_a_repeat():
    people = {'철수': '검객', '영희': '처녀', '민수': '이웃', '치삼': '머슴'}
    out = w2.Presences(events=[w2.Presence(event=1, present=['철수', '영희'], heard=['영희', '민수']),                  # 영희는 둘 다에 올라와도 그 자리에 있던 쪽이 이긴다
                               w2.Presence(event=2, present=['길동', '치삼이'], heard=[]),                              # 길동은 목록에 없고 치삼이는 호칭 변형이다
                               w2.Presence(event=5, present=['철수'], heard=[]),                                       # 사건 번호 밖
                               w2.Presence(event=1, present=['민수'], heard=[])])                                      # 같은 사건이 다시 와서 민수가 들음에서 그 자리에 있던 쪽으로 올라간다
    links, stats = w2.verify_presence(out, people, 2)
    assert links == [(0, '민수', 'experienced'), (0, '영희', 'experienced'), (0, '철수', 'experienced'), (1, '치삼', 'experienced')]
    assert (stats['presence_proposed'], stats['presence_event'], stats['presence_name'], stats['character_variant']) == (4, 1, 1, 1)
    assert (stats['presence_names_proposed'], stats['presence_names_kept']) == (7, 4)                                  # 번호 밖 사건의 이름은 세지 않는다


def test_verify_presence_keeps_a_heard_person_who_is_not_listed_as_present():
    links, stats = w2.verify_presence(w2.Presences(events=[w2.Presence(event=1, present=['철수'], heard=['영희'])]), {'철수': '', '영희': ''}, 1)
    assert links == [(0, '영희', 'heard'), (0, '철수', 'experienced')] and stats['presence_names_kept'] == 2


def test_apply_presence_adds_a_missing_person_and_raises_a_weaker_role_but_never_lowers_one():
    events = [{'title': 'a', 'detail': 'd', 'quote': 'q', 'mentions': [{'name': '철수', 'kind': 'character', 'role': 'experienced'}, {'name': '민수', 'kind': 'character', 'role': 'mentioned'},
                                                                      {'name': '장터', 'kind': 'location', 'role': 'none'}]}]
    new, stats = w2.apply_presence(events, [(0, '영희', 'heard'), (0, '민수', 'experienced'), (0, '철수', 'heard')])
    assert [(m['name'], m['role']) for m in new[0]['mentions']] == [('철수', 'experienced'), ('민수', 'experienced'), ('장터', 'none'), ('영희', 'heard')]
    assert dict(stats) == {'presence_added': 1, 'presence_upgraded': 1}
    assert events[0]['mentions'][1]['role'] == 'mentioned' and len(events[0]['mentions']) == 3                           # 입력은 바뀌지 않는다


def test_apply_presence_drops_a_present_person_whose_name_is_far_from_the_event_quote_and_counts_it():
    text = '철수는 영희에게 칼을 건넸다.' + '그날은 바람이 불었다.' * 30 + '길동이 문을 열었다. 영희가 웃었다.'
    events = [{'title': 'a', 'detail': 'd', 'quote': '철수는 영희에게 칼을 건넸다.', 'mentions': []}]
    new, stats = w2.apply_presence(events, [(0, '영희', 'experienced'), (0, '길동', 'experienced'), (0, '민수', 'heard')], text, window=100)
    assert [(m['name'], m['role']) for m in new[0]['mentions']] == [('영희', 'experienced'), ('민수', 'heard')]
    assert dict(stats) == {'presence_added': 2, 'presence_far': 1}                                                         # 길동은 인용에서 멀고, 들음은 거리를 묻지 않는다
    kept, stats = w2.apply_presence(events, [(0, '길동', 'experienced')], text, window=None)
    assert [m['name'] for m in kept[0]['mentions']] == ['길동'] and 'presence_far' not in stats                          # 창이 없으면 거르지 않는다


def test_near_measures_from_the_quote_edges_in_whitespace_free_characters_and_takes_the_closest_mention():
    text = '가가가 철수 나나나나나나나나나나 철수는 다다다다다다다다다다 인용 문장이 여기에 있다 라라라라라라라라라라 마마마마마마마마마마 철수'
    quote = '인용 문장이 여기에 있다'
    assert w2.near(text, quote, '철수', 12) and w2.near(text, quote, '철수', 30)                                         # 인용 앞쪽 가까운 철수가 이긴다(맨 앞과 맨 뒤의 철수는 더 멀다)
    assert not w2.near(text, quote, '철수', 2) and not w2.near(text, quote, '길동', 1000)                                # 너무 멀거나 본문에 없다
    assert w2.near(text, quote, '인용', 0) and not w2.near(text, '없는 인용이다 정말로', '철수', 1000)                       # 인용 안은 거리 0, 인용이 본문에 없으면 판단하지 않는다


def test_presence_input_numbers_the_events_from_one_with_their_plain_text():
    text = w2.presence_input({'철수': '검객', '영희': ''}, [{'title': '칼의 전달', 'detail': '@철수는 @영희에게 @칼을 건넸다.'}, {'title': '이별', 'detail': '@철수가 떠났다.'}], '본문 글')
    assert text == '[이 회차의 인물]\n- 철수: 검객\n- 영희\n\n[이 회차의 사건]\n1. 칼의 전달: 철수는 영희에게 칼을 건넸다.\n2. 이별: 철수가 떠났다.\n\n[본문]\n본문 글'


# ---- 뒤 회차에 전해 들음 ----

def test_earlier_events_are_numbered_like_the_world_cards_and_list_who_already_knew_them():
    records = [rec(1, {}, [ev('칼의 전달', '@철수는 @영희에게 @칼을 건넸다.', 'q', ('철수', 'character', 'experienced'), ('영희', 'character', 'heard'), ('민수', 'character', 'mentioned'), ('칼', 'object', 'none'))]),
               rec(3, {}, [ev('이별', '@철수가 떠났다.', 'q', ('철수', 'character', 'experienced')), ev('다툼', '@치삼이가 싸웠다.', 'q', ('치삼이', 'character', 'experienced'))])]
    got = w2.earlier_events(records)
    assert [(e['id'], e['episode'], e['title']) for e in got] == [('e01-1', 1, '칼의 전달'), ('e03-1', 3, '이별'), ('e03-2', 3, '다툼')]
    assert got[0]['detail'] == '철수는 영희에게 칼을 건넸다.' and got[0]['known'] == {'철수', '영희'}                 # 이름만 나온 민수와 인물이 아닌 칼은 아는 사람이 아니다
    assert got[2]['known'] == {'치삼'}                                                                              # 호칭 변형은 기본 이름(_base)으로


def test_learn_input_lists_earlier_events_with_ids_then_the_people_and_the_text():
    earlier = [{'id': 'e01-1', 'episode': 1, 'title': '칼의 전달', 'detail': '철수는 영희에게 칼을 건넸다.', 'known': set()}]
    assert w2.learn_input(earlier, {'철수': '검객', '민수': ''}, '본문') == '[앞 회차의 사건]\ne01-1 (1화) 칼의 전달: 철수는 영희에게 칼을 건넸다.\n\n[이 회차의 인물]\n- 철수: 검객\n- 민수\n\n[본문]\n본문'


def test_verify_learned_keeps_a_new_listener_of_an_earlier_event_with_a_quote_from_this_episode():
    earlier = [{'id': 'e01-1', 'episode': 1, 'title': 't', 'detail': 'd', 'known': {'철수', '영희'}}]
    people = {'철수': '', '영희': '', '민수': '', '순이': '', '치삼': ''}
    text = '민수는 장터에서 철수가 영희에게 칼을 건넸다는 소문을 들었다. 철수는 웃었다. 치삼이도 그 소문을 들었다.'
    said = '민수는 장터에서 철수가 영희에게 칼을 건넸다는 소문을 들었다.'
    out = w2.Learned(learned=[w2.Learn(event='e01-1', learner='민수', quote=said), w2.Learn(event='e01-1', learner='민수', quote=said),                      # 같은 항목은 한 번
                              w2.Learn(event='e01-1', learner='철수', quote='철수는 웃었다.'),                                                                   # 이미 아는 사람
                              w2.Learn(event='e09-9', learner='민수', quote=said), w2.Learn(event='e01-1', learner='길동', quote=said),                         # 없는 사건·목록에 없는 인물
                              w2.Learn(event='e01-1', learner='순이', quote='원문에 없는 문장이다 정말로.'),                                                       # 근거 없음
                              w2.Learn(event='e01-1', learner='치삼이', quote='치삼이도 그 소문을 들었다.')])                                                       # 호칭 변형은 목록의 이름으로
    kept, stats = w2.verify_learned(text, out, earlier, people, 3)
    assert kept == [{'episode': 3, 'event': 'e01-1', 'learner': '민수', 'quote': said}, {'episode': 3, 'event': 'e01-1', 'learner': '치삼', 'quote': '치삼이도 그 소문을 들었다.'}]
    assert (stats['learned_proposed'], stats['learned_kept'], stats['learn_dup'], stats['learn_known'], stats['learn_event'], stats['learn_name'], stats['learn_quote']) == (7, 2, 1, 1, 1, 1, 1)
    assert (stats['learn_quote_checked'], stats['learn_quote_ok']) == (4, 3)


# ---- 인물 사이 관계 ----

def test_verify_relations_needs_listed_endpoints_a_short_label_and_a_quote_from_the_text():
    rels = [w2.Rel(source='철수', target='영희', label='신뢰', quote='영희는 철수를 믿었다.'), w2.Rel(source='철수', target='영희', label='신뢰', quote='영희는 철수를 믿었다.'),
            w2.Rel(source='철수', target='민수', label='동료', quote='철수는 영희에게 칼을 건넸다.'), w2.Rel(source='철수', target='철수', label='나', quote=QUOTE),
            w2.Rel(source='철수', target='영희', label='아주아주아주아주 긴 관계 이름', quote=QUOTE), w2.Rel(source='철수', target='영희', label='적', quote='없는 문장이다 정말로.')]
    kept, stats = w2.verify_relations(TEXT, w2.Rels(relations=rels), PEOPLE)
    assert kept == [{'source': '철수', 'target': '영희', 'label': '신뢰', 'quote': '영희는 철수를 믿었다.'}]
    assert (stats['relation_dup'], stats['relation_endpoint'], stats['relation_self'], stats['relation_label'], stats['relation_quote']) == (1, 1, 1, 1, 1)


# ---- 인물 문서·기억 ----

def test_memory_text_lists_the_doc_then_what_the_person_lived_and_heard_without_repeating_lines():
    doc = {'identity': '떠돌이 검객', 'personality': '', 'speech': '명령조', 'speech_quote': '"받아라."', 'goal': '복수'}
    assert w2.doc_lines(doc) == ['[정체] 떠돌이 검객', '[말투] 명령조 (예: "받아라.")', '[목표] 복수']
    lived = [{'title': '칼의 전달', 'detail': '@철수는 @영희에게 칼을 건넸다.'}]
    heard = [{'title': '이별', 'detail': '@철수가 떠났다.'}]
    assert w2.memory_text([doc, doc], lived, heard) == '\n'.join(['[정체] 떠돌이 검객', '[말투] 명령조 (예: "받아라.")', '[목표] 복수',
                                                                '[겪은 일] 칼의 전달: 철수는 영희에게 칼을 건넸다.', '[들은 일] 이별: 철수가 떠났다.'])


# ---- 세계관 조립 ----

def rec(n, characters, events=(), relations=()):
    return {'work': 'w00', 'episode': n, 'characters': characters, 'events': list(events), 'relations': list(relations)}


def person(intro, **doc):
    return {'intro': intro, 'doc': {'identity': '', 'personality': '', 'speech': '', 'speech_quote': '', 'goal': '', **doc}}


def ev(title, detail, quote, *mentions):
    return {'title': title, 'detail': detail, 'quote': quote, 'mentions': [{'name': n, 'kind': k, 'role': r} for n, k, r in mentions]}


RECORDS = [
    rec(1, {'철수': person('떠돌이', identity='떠돌이 검객', personality='과묵하다'), '영희': person('처녀', identity='마을 처녀'), '민수': person('')},
        [ev('칼의 전달', '@철수는 @영희에게 @칼을 건넸다.', '철수는 영희에게 칼을 건넸다.', ('철수', 'character', 'experienced'), ('영희', 'character', 'experienced'),
            ('민수', 'character', 'mentioned'), ('장터', 'location', 'none'), ('칼', 'object', 'none'))],
        [{'source': '철수', 'target': '영희', 'label': '신뢰', 'quote': '영희는 철수를 믿었다.'}]),
    rec(2, {'철수': person('왕자', identity='사실은 왕자', goal='복수'), '영희': person('처녀'), '민수': person('', identity='사실은 첩자')},
        [ev('이별', '@철수가 떠났다.', '철수는 떠났다.', ('철수', 'character', 'experienced'), ('영희', 'character', 'heard'), ('민수', 'character', 'mentioned'),
            ('장터', 'location', 'none'))]),
]
FULL = '철수는 영희에게 칼을 건넸다. 철수는 떠났다. 영희 민수 장터 칼'


def world(records=RECORDS, links=()):
    return w2.build_world2('w00', records, list(links), FULL)


def test_build_world2_makes_character_event_and_place_cards_with_episode_gates():
    built, stats = world()
    cards = {c.title: c for c in built['cards']}
    assert cards['철수'].cardType == 'character' and cards['철수'].revealFromEpisode == 1 and cards['철수'].text == '떠돌이 검객'     # IDENTITY = 첫 등장 회차의 정체 글
    assert cards['민수'].text == '' and cards['민수'].episodes[2] == '[정체] 사실은 첩자'                                          # 첫 등장 회차에 정체 글도 소개도 없으면 비어 있다(뒤 회차에서 밝혀진 신분을 끌어오지 않는다)
    assert cards['영희'].text == '마을 처녀' and cards['칼의 전달'].cardType == 'event' and cards['칼의 전달'].revealFromEpisode == 1
    assert cards['칼의 전달'].text == '철수는 영희에게 칼을 건넸다.' and cards['이별'].revealFromEpisode == 2                         # 사건 본문의 @는 이름만 남긴다
    assert cards['장터'].cardType == 'location' and cards['장터'].revealFromEpisode == 1 and cards['칼'].cardType == 'object'
    assert stats['cards'] == {'character': 3, 'event': 2, 'location': 1, 'object': 1}


def test_build_world2_keeps_every_episode_in_its_own_memory_slot_and_never_lends_a_later_identity_to_the_first_card():
    built, _ = world()
    chul = next(c for c in built['cards'] if c.title == '철수')
    assert chul.text == '떠돌이 검객' and '왕자' not in chul.text and chul.soul == '' and chul.goal == ''                       # SOUL·GOAL을 회차 없이 따로 두지 않는다
    assert chul.episodes[1].splitlines() == ['[정체] 떠돌이 검객', '[성격] 과묵하다', '[겪은 일] 칼의 전달: 철수는 영희에게 칼을 건넸다.']
    assert chul.episodes[2].splitlines() == ['[정체] 사실은 왕자', '[목표] 복수', '[겪은 일] 이별: 철수가 떠났다.']


def test_build_world2_links_people_to_events_by_how_they_know_and_never_for_a_mention_only():
    built, stats = world()
    by_title = {c.title: c.id for c in built['cards']}
    links = {(r.source, r.target, r.label): built['when'][r.id] for r in built['relations']}
    chul, young, min_, sale, fair, knife = (by_title[t] for t in ('철수', '영희', '민수', '칼의 전달', '이별', '장터'))
    assert links[(chul, sale, '겪음')] == 1 and links[(young, sale, '겪음')] == 1 and links[(chul, fair, '겪음')] == 2
    assert links[(young, fair, '들음')] == 2                                                                                    # 전해 들음은 따로 잇는다
    assert links[(by_title['장터'], sale, '관련')] == 1 and links[(by_title['칼'], sale, '관련')] == 1 and links[(by_title['장터'], fair, '관련')] == 2   # 인물이 아닌 대상 → 사건
    assert links[(chul, young, '신뢰')] == 1                                                                                    # 인물 사이 관계는 기록 회차
    assert not any(r.source == min_ for r in built['relations'])                                                                # 이름만 나온 인물은 사건과 이어지지 않는다
    assert stats['relations'] == {'겪음': 3, '들음': 1, '관련': 3, '인물 관계': 1}
    young_card = next(c for c in built['cards'] if c.title == '영희')
    assert '[들은 일] 이별: 철수가 떠났다.' in young_card.episodes[2] and '이별' not in next(c for c in built['cards'] if c.title == '민수').episodes.get(2, '')
    meta = built['events']['e02-1']
    assert meta['episode'] == 2 and meta['quote'] == '철수는 떠났다.' and meta['experienced'] == {chul: 2} and meta['heard'] == {young: 2} and meta['mentioned'] == [min_]


def test_built_world_hides_later_events_and_unlinked_events_from_the_character_at_stage_3():
    built, _ = world()
    ids = built['character_id']
    snap1 = snapshot(built, 1)
    young = recall(snap1, ids['영희'], 1, '철수가 영희에게 칼을 건넸다', stage=3, k=20)
    assert any('칼을 건넸다' in i.text for i in young.items) and all('떠났다' not in i.text for i in young.items)                 # 겪은 사건은 보이고 뒤 회차 사건은 안 보인다
    mine = recall(snap1, ids['민수'], 1, '철수가 영희에게 칼을 건넸다', stage=3, k=20)
    assert all('칼을 건넸다' not in i.text for i in mine.items)                                                                   # 이름만 나온 인물에게는 그 사건이 연결되지 않아 보이지 않는다


def test_build_world2_survives_a_save_and_load_roundtrip_with_its_extra_keys(tmp_path):
    built, _ = world()
    from kt_world import save_world

    save_world(tmp_path / 'w.json', built)
    again = load_world(tmp_path / 'w.json')
    assert again['cards'] == built['cards'] and again['relations'] == built['relations'] and again['when'] == built['when']
    assert again['events'] == built['events'] and again['character_id'] == built['character_id']


# ---- 같은 카드·동일 인물 ----

def names_rec(n, *names, events=()):
    return rec(n, {name: person('') for name in names}, events)


def test_names_that_differ_only_by_a_particle_or_suffix_share_one_card_and_a_place_by_kind_and_name():
    records = [names_rec(1, '치삼', '순이', events=[ev('만남', '@치삼이 @마을에 들렀다.', '치삼이 마을에 들렀다.', ('치삼', 'character', 'experienced'), ('마을', 'location', 'none'))]),
               names_rec(2, '치삼이', '순이', events=[ev('다시', '@치삼이 @마을을 떠났다.', '치삼이 마을을 떠났다.', ('치삼이', 'character', 'experienced'), ('마을을', 'location', 'none'))])]
    built, stats = w2.build_world2('w00', records, [], '치삼이 순이 치삼 마을')
    assert sorted(c.title for c in built['cards'] if c.cardType == 'character') == ['순이', '치삼']
    assert [c.title for c in built['cards'] if c.cardType == 'location'] == ['마을'] and built['character_id']['치삼이'] == built['character_id']['치삼']
    chi = next(c for c in built['cards'] if c.title == '치삼')
    assert sorted(built['aliases'][chi.id]) == ['치삼이'] and set(chi.episodes) == {1, 2}      # 두 표기의 기억이 한 카드의 회차 칸에 각각 들어간다


def test_resolve_groups_merges_a_plain_alias_but_keeps_a_hidden_identity_as_two_cards_with_an_identity_relation_from_the_reveal():
    records = [names_rec(1, '김철수'), names_rec(2, '철수', '복면인'), names_rec(4, '도윤')]
    plain = {'left': '1:1', 'right': '2:1', 'verdict': 'same', 'hidden': False, 'episode': 2, 'quote': 'q'}
    mask = {'left': '4:1', 'right': '2:2', 'verdict': 'same', 'hidden': True, 'episode': 4, 'quote': 'q'}
    built, stats = w2.build_world2('w00', records, [plain, mask], '김철수 철수 복면인 도윤')
    titles = sorted(c.title for c in built['cards'])
    assert len(titles) == 3 and '복면인' in titles and '도윤' in titles                                                           # 호칭 차이는 합치고, 숨긴 정체는 카드를 따로 둔다
    by_title = {c.title: c.id for c in built['cards']}
    (link,) = [r for r in built['relations'] if r.label == '동일 인물']
    assert (link.source, link.target, link.category) == (by_title['복면인'], by_title['도윤'], 'identity') and built['when'][link.id] == 4
    assert stats['merge']['same_merged'] == 1 and stats['merge']['same_hidden'] == 1 and stats['relations']['동일 인물'] == 1


def test_a_hidden_identity_link_between_two_names_that_already_share_a_card_makes_no_relation_to_itself():
    people = {'1:1': (1, 1, '철수'), '2:1': (2, 1, '철수가')}
    mask = {'left': '1:1', 'right': '2:1', 'verdict': 'same', 'hidden': True, 'episode': 2, 'quote': 'q'}
    group, identity, stats = w2.resolve_groups(people, [mask])
    assert group['1:1'] == group['2:1'] and identity == [] and stats['merge_same_group'] == 1


def test_identity_links_follow_the_dec_53_storage_rules_one_body_per_mask_and_no_card_that_is_both_or_a_cycle():
    people = {'1:1': (1, 1, '검은사내'), '2:1': (2, 1, '복면인'), '3:1': (3, 1, '도윤'), '4:1': (4, 1, '태오')}

    def hidden(body, mask, episode):
        return {'left': body, 'right': mask, 'verdict': 'same', 'hidden': True, 'episode': episode, 'quote': 'q'}

    links = [hidden('3:1', '1:1', 4), hidden('4:1', '1:1', 5), hidden('4:1', '3:1', 6), hidden('3:1', '2:1', 7), hidden('1:1', '3:1', 8)]
    group, identity, stats = w2.resolve_groups(people, links)
    assert [(l['alias'], l['main'], l['episode']) for l in identity] == [(group['1:1'], group['3:1'], 4), (group['2:1'], group['3:1'], 7)]       # 본체 하나에 가면 여럿은 된다
    assert stats['merge_identity_rule'] == 3 and stats['same_hidden'] == 2                                         # 가면의 본체가 둘·본체가 가면(사슬)·가면이 본체(순환)는 먼저 온 링크만 남긴다


def test_apart_pairs_are_names_that_share_an_event_or_a_relation_and_never_two_forms_of_one_name():
    records = [rec(1, {'고운댁': person(''), '새별': person(''), '치삼': person(''), '치삼이': person('')},
                   [ev('안음', '@고운댁이 @새별을 안았다.', 'q', ('고운댁', 'character', 'experienced'), ('새별', 'character', 'mentioned'), ('장터', 'location', 'none'),
                       ('치삼', 'character', 'experienced'), ('치삼이', 'character', 'experienced'))],
                   [{'source': '고운댁', 'target': '치삼', 'label': '주인', 'quote': 'q'}])]
    assert w2.apart_pairs(records) == {frozenset({'1:1', '1:2'}), frozenset({'1:1', '1:3'}), frozenset({'1:1', '1:4'}), frozenset({'1:2', '1:3'}), frozenset({'1:2', '1:4'})}
    # 같은 사건의 인물 넷에서 치삼·치삼이(같은 이름의 변형)만 서로 갈리지 않고, 장소는 인물이 아니다


def test_resolve_groups_never_merges_clusters_that_hold_a_pair_known_to_be_apart():
    people = {'1:1': (1, 1, '고운댁'), '1:2': (1, 2, '새별 한솔'), '2:1': (2, 1, '고운댁 박 씨'), '3:1': (3, 1, '새별')}

    def same(left, right, episode):
        return {'left': left, 'right': right, 'verdict': 'same', 'hidden': False, 'episode': episode, 'quote': 'q'}

    links = [same('1:1', '2:1', 2), same('1:2', '3:1', 3), same('2:1', '1:2', 3)]                    # 앞의 둘은 한 인물의 호칭 변형, 셋째는 두 인물을 잇는 잘못된 같음
    group, _, stats = w2.resolve_groups(people, links, {frozenset({'1:1', '1:2'})})                   # 고운댁과 새별 한솔은 한 사건에 함께 나온 다른 인물
    assert group['1:1'] == group['2:1'] and group['1:2'] == group['3:1'] and group['1:1'] != group['1:2'] and stats['merge_conflict'] == 1
    group, _, stats = w2.resolve_groups(people, links)
    assert len(set(group.values())) == 1 and 'merge_conflict' not in stats                            # 근거가 없으면 모델의 같음을 그대로 따른다


def test_build_world2_keeps_two_people_apart_that_the_events_show_together_even_if_the_merge_call_said_same():
    records = [rec(1, {'고운댁': person(''), '새별': person('')}, [ev('안음', '@고운댁이 @새별을 안았다.', 'q', ('고운댁', 'character', 'experienced'), ('새별', 'character', 'experienced'))])]
    wrong = {'left': '1:1', 'right': '1:2', 'verdict': 'same', 'hidden': False, 'episode': 1, 'quote': 'q'}
    built, stats = w2.build_world2('w00', records, [wrong], '고운댁 새별')
    assert sorted(c.title for c in built['cards'] if c.cardType == 'character') == ['고운댁', '새별'] and stats['merge']['merge_conflict'] == 1


def test_resolve_groups_splits_namesakes_and_never_guesses_when_more_than_one_earlier_card_has_the_name():
    records = [names_rec(1, '민수'), names_rec(3, '민수'), names_rec(5, '민수')]
    apart = {'left': '1:1', 'right': '3:1', 'verdict': 'distinct', 'hidden': False, 'episode': 3, 'quote': 'q'}
    group, identity, stats = w2.resolve_groups({'1:1': (1, 1, '민수'), '3:1': (3, 1, '민수'), '5:1': (5, 1, '민수')}, [apart])
    assert group['1:1'] != group['3:1'] and len({group['1:1'], group['3:1'], group['5:1']}) == 3 and identity == []                # 앞 카드가 둘이라 5화는 어느 쪽인지 몰라 따로 둔다
    built, _ = w2.build_world2('w00', records, [apart], '민수')
    assert len(built['cards']) == 3


def test_a_plain_alias_link_does_not_undo_a_distinct_verdict_and_an_uncertain_one_changes_nothing():
    people = {'1:1': (1, 1, '철수'), '2:1': (2, 1, '김철수'), '3:1': (3, 1, '민수')}
    keep_apart = {'left': '1:1', 'right': '2:1', 'verdict': 'distinct', 'hidden': False, 'episode': 2, 'quote': 'q'}
    plain = {'left': '1:1', 'right': '2:1', 'verdict': 'same', 'hidden': False, 'episode': 2, 'quote': 'q'}
    unsure = {'left': '1:1', 'right': '3:1', 'verdict': 'uncertain', 'hidden': False, 'episode': None, 'quote': ''}
    group, _, stats = w2.resolve_groups(people, [keep_apart, plain, unsure])
    assert group['1:1'] != group['2:1'] and group['1:1'] != group['3:1'] and stats['merge_conflict'] == 1 and stats['uncertain'] == 1


# ---- 합치기 입력·근거 확인 ----

def test_merge_input_numbers_the_people_per_episode_summarizes_name_groups_and_collects_only_verified_quotes():
    records = [rec(1, {'철수': person('검객'), '영희': person('')}, [ev('가', '@철수가 왔다.', '철수는 영희에게 칼을 건넸다.')], [{'source': '철수', 'target': '영희', 'label': '신뢰', 'quote': '영희는 철수를 믿었다.'}]),
               rec(3, {'철수': person('왕자'), '철수가': person('')})]
    people, data, quotes = w2.merge_input(records)
    assert people == {'1:1': (1, 1, '철수'), '1:2': (1, 2, '영희'), '3:1': (3, 1, '철수'), '3:2': (3, 2, '철수가')}
    assert data['episodes'][0] == {'number': 1, 'mentions': [{'ref': '1:1', 'name': '철수', 'intro': '검객'}, {'ref': '1:2', 'name': '영희', 'intro': ''}],
                                   'quotes': ['영희는 철수를 믿었다.', '철수는 영희에게 칼을 건넸다.']} and data['episodes'][1]['quotes'] == []
    assert data['overview'] == [{'ref': '1:1', 'names': ['철수', '철수가'], 'episodes': [1, 3], 'intro': '검객'}, {'ref': '1:2', 'names': ['영희'], 'episodes': [1], 'intro': ''}]   # 기본 묶음마다 한 줄
    assert quotes == {'영희는철수를믿었다.': [1], '철수는영희에게칼을건넸다.': [1]}


def test_merge_candidates_pair_groups_whose_names_contain_each_other_or_whose_intro_names_the_other_with_evidence_sentences():
    records = [rec(1, {'도율': person('의사'), '한도율': person('외과의'), '태오': person('세아의 친구'), '세아': person('주인공'), '철수': person('')}),
               rec(2, {'한도율': person(''), '세아': person('')})]
    texts = {1: '한도율이 수술실에 들어섰다. 세아은 태오을 불렀다. 철수는 떠났다.', 2: '도율이 웃었다. 세아이 한도율에게 인사했다.'}
    got = {(c['left'], c['right']): c for c in w2.merge_candidates(records, texts)}
    assert set(got) == {('1:1', '1:2'), ('1:3', '1:4')}                                                            # 도율 ⊂ 한도율, 태오의 소개에 세아
    contained = got[('1:1', '1:2')]
    assert contained['names'] == [['도율'], ['한도율']] and contained['together'] == 1                              # 두 이름이 같은 회차 인물 목록에 함께 나온 회차 수(1화만)
    assert contained['evidence'] == ['한도율이 수술실에 들어섰다.', '세아이 한도율에게 인사했다.']                       # 두 이름이 모두 든 문장(긴 이름 안에 짧은 이름이 들어 있다)
    assert got[('1:3', '1:4')]['evidence'] == ['세아은 태오을 불렀다.']


def test_merge_candidates_skip_one_character_names_and_cap_the_list():
    records = [rec(1, {'가': person(''), '가나다': person(''), '철수': person(''), '철수야': person('')})]
    assert w2.merge_candidates(records, {1: '가나다가 왔다.'}) == []                                                 # 한 글자 이름은 포함 관계로 잇지 않고, 호칭 변형(철수/철수야)은 이미 한 묶음이라 후보가 아니다
    many = [rec(1, {f'김{c}수': person('') for c in '가나다라마바사아자차'} | {f'{c}수': person('') for c in '가나다라마바사아자차'})]
    assert len(w2.merge_candidates(many, {1: ''}, cap=7)) == 7


def test_merge_input_adds_candidates_and_their_evidence_sentences_as_citable_quotes_only_when_texts_are_given():
    records = [rec(1, {'도율': person(''), '한도율': person('')}), rec(2, {'도율': person('')})]
    texts = {1: '한도율이 수술실에 들어섰다.', 2: '도율이 웃었다.'}
    _, plain_data, plain_quotes = w2.merge_input(records)
    assert 'candidates' not in plain_data and plain_quotes == {}
    _, data, quotes = w2.merge_input(records, texts)
    assert [(c['left'], c['right']) for c in data['candidates']] == [('1:1', '1:2')] and quotes == {'한도율이수술실에들어섰다.': [1]}


def link(**kwargs):
    return w2.Link(**{'left': '1:1', 'right': '3:1', 'verdict': 'same', 'hidden': True, 'quote': '가면을 벗자 도윤이 복면인이었음이 드러났다.', **kwargs})


PEOPLE_M = {'1:1': (1, 1, '복면인'), '2:1': (2, 1, '도윤'), '3:1': (3, 1, '도윤'), '4:1': (4, 1, '철수')}
QUOTES_M = {'가면을벗자도윤이복면인이었음이드러났다.': [3], '도윤이웃었다.': [3]}


def test_verify_links_keeps_a_link_only_when_its_quote_is_one_of_the_input_quotes_with_both_names_and_not_before_either_name_appears():
    links = w2.Links(links=[link(), link(right='2:1', quote='입력에 없는 문장이다 정말로.'), link(left='2:1', right='9:9'), link(right='4:1', quote='도윤이 웃었다.'), link(left='3:1', right='1:1')])
    kept, stats = w2.verify_links(links, PEOPLE_M, QUOTES_M)
    assert [(k['left'], k['right'], k['episode']) for k in kept] == [('1:1', '3:1', 3)]                                              # 근거 회차 = 인용이 든 회차
    assert (stats['merge_quote'], stats['merge_ref'], stats['merge_names'], stats['merge_dup'], stats['merge_links_proposed']) == (1, 1, 1, 1, 5)
    early, stats = w2.verify_links(w2.Links(links=[link(left='3:1', right='1:1')]), PEOPLE_M, {'가면을벗자도윤이복면인이었음이드러났다.': [1]})
    assert early == [] and stats['merge_early'] == 1                                                                               # 두 이름이 모두 나오기 전 회차의 근거는 쓰지 않는다


def test_an_alias_with_an_unrelated_name_needs_both_names_in_the_quote_even_when_it_is_not_hidden():
    people = {'2:1': (2, 1, '도윤'), '4:1': (4, 1, '철수')}
    only_one = {'도윤이웃었다.': [3]}
    kept, stats = w2.verify_links(w2.Links(links=[link(hidden=False, left='2:1', right='4:1', quote='도윤이 웃었다.')]), people, only_one)
    assert kept == [] and stats['merge_names'] == 1                                                                   # 이름이 겹치지 않는 별칭은 한쪽 이름만 든 인용으로 같은 인물이라 할 수 없다
    both = {'도윤이철수를불렀다.': [3]}
    kept, _ = w2.verify_links(w2.Links(links=[link(hidden=False, left='2:1', right='4:1', quote='도윤이 철수를 불렀다.')]), people, both)
    assert len(kept) == 1


def test_a_plain_alias_link_needs_only_one_of_the_names_in_an_input_quote_and_no_reveal_order_while_a_hidden_identity_needs_both_and_the_order():
    one_name = {'도윤이웃었다.': [3]}
    people = {'2:1': (2, 1, '도윤'), '4:1': (4, 1, '김도윤')}
    kept, stats = w2.verify_links(w2.Links(links=[link(hidden=False, left='2:1', right='4:1', quote='도윤이 웃었다.')]), people, one_name)
    assert [(k['left'], k['right'], k['hidden']) for k in kept] == [('2:1', '4:1', False)] and stats['merge_names'] == 0       # 성을 뗀 이름은 한쪽 이름만 있는 인용으로도 합친다
    hidden, stats = w2.verify_links(w2.Links(links=[link(hidden=True, left='2:1', right='4:1', quote='도윤이 웃었다.')]), people, one_name)
    assert hidden == [] and stats['merge_names'] == 1                                                                 # 숨겨진 정체는 두 이름이 모두 든 인용이어야 한다
    early, stats = w2.verify_links(w2.Links(links=[link(hidden=False, left='2:1', right='4:1', quote='도윤이 웃었다.')]), people, {'도윤이웃었다.': [1]})
    assert len(early) == 1 and early[0]['episode'] == 1 and not stats['merge_early']                                  # 단순 호칭 차이는 근거 회차가 이름이 처음 나온 회차보다 앞서도 된다


def test_a_plain_same_link_between_a_name_and_a_longer_name_that_contains_it_needs_no_valid_quote_but_every_other_unproven_link_is_still_dropped():
    people = {'2:1': (2, 1, '도윤'), '4:1': (4, 1, '김도윤'), '5:1': (5, 1, '철수')}
    known = {'도윤이웃었다.': [3]}
    kept, stats = w2.verify_links(w2.Links(links=[link(hidden=False, left='2:1', right='4:1', quote='도윤.')]), people, known)
    assert [(k['left'], k['right'], k['verdict'], k['episode']) for k in kept] == [('2:1', '4:1', 'same', 4)]                     # 근거 회차 = 두 이름이 모두 나온 뒤(뒤 이름이 처음 나온 회차)
    assert stats['merge_quote_waived'] == 1 and not stats['merge_quote'] and not stats['merge_names']                                  # 이름 포함은 프로그램이 확인했으니 같은 인물 판정은 받는다
    for dropped in (link(hidden=True, left='2:1', right='4:1', quote='도윤.'),                       # 숨겨진 정체
                    link(hidden=False, left='2:1', right='5:1', quote='도윤.'),                       # 이름이 겹치지 않는 별칭
                    link(hidden=False, verdict='distinct', left='2:1', right='4:1', quote='도윤.')):  # 갈림 판정
        none, stats = w2.verify_links(w2.Links(links=[dropped]), people, known)
        assert none == [] and stats['merge_quote'] == 1 and not stats['merge_quote_waived']
    right, stats = w2.verify_links(w2.Links(links=[link(hidden=False, left='2:1', right='4:1', quote='도윤이 웃었다.')]), people, known)
    assert right[0]['episode'] == 3 and not stats['merge_quote_waived']                                                                  # 인용이 맞으면 그 인용의 회차 그대로


def test_verify_links_counts_an_uncertain_pair_without_asking_for_evidence():
    kept, stats = w2.verify_links(w2.Links(links=[link(verdict='uncertain', quote='')]), PEOPLE_M, QUOTES_M)
    assert kept == [{'left': '1:1', 'right': '3:1', 'verdict': 'uncertain', 'hidden': True, 'episode': None, 'quote': ''}] and stats['merge_links_proposed'] == 1


# ---- 회차별 라운드(대역 클라이언트) ----

class Fake:
    """Responses.parse 대역: 스키마 이름별로 준비한 답을 돌려주고 부른 스키마를 순서대로 모은다."""

    def __init__(self):
        self.calls = []
        self.responses = SimpleNamespace(parse=self._parse)

    def _parse(self, **options):
        schema, text = options['text_format'], options['input']
        self.calls.append(schema.__name__)
        answers = {
            'Persons': w2.Persons(characters=[who('철수', '검객'), who('영희', '처녀'), who('민수', '이웃')]),
            'CharDoc': w2.CharDoc(identity='검객' if '인물: 철수' in text else '처녀', personality='', speech='', speech_quote='', goal='', activity=''),
            'Events': w2.Events(events=[event(mentions=[mention('철수')])]),
            'Presences': w2.Presences(events=[w2.Presence(event=1, present=['철수', '영희'], heard=[])]),
            'Rels': w2.Rels(relations=[w2.Rel(source='철수', target='영희', label='신뢰', quote='영희는 철수를 믿었다.')]),
            'Links': w2.Links(links=[w2.Link(left='1:1', right='2:1', verdict='uncertain', hidden=False, quote='')]),
        }
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=None)
        return SimpleNamespace(status='completed', usage=usage, model='m', output_parsed=answers[schema.__name__])


def test_extractor_runs_characters_then_events_then_relations_and_presence_then_a_doc_for_every_listed_person_and_a_second_run_calls_nothing(tmp_path):
    fake = Fake()
    llm = Llm(Ledger(tmp_path / 'calls.jsonl'), tmp_path / 'cache', model='m', client=fake)
    works = {'w00': {'id': 'w00', 'episodes': [{'number': 1, 'title': '', 'text': TEXT}]}}
    (record,) = run_rounds([('w00', 1)], w2.extractor(works), llm, SyncExecutor(llm))
    assert fake.calls[0] == 'Persons' and sorted(fake.calls[1:5]) == ['CharDoc', 'CharDoc', 'CharDoc', 'Events'] and sorted(fake.calls[5:]) == ['Presences', 'Rels']      # 인물 → (사건·문서: 서로 독립이라 같은 라운드, 문서는 인물 목록의 모두) → (자리·관계)
    assert set(record['characters']) == {'철수', '영희', '민수'} and record['characters']['철수']['doc']['identity'] == '검객' and record['characters']['민수']['doc']['identity'] == '처녀'   # 사건·자리에서 이어지지 않은 인물도 문서를 부른다(그 회차에 한 일이 있으면 행적에 남는다)
    assert record['events'][0]['title'] == '칼의 전달' and record['relations'][0]['label'] == '신뢰'
    assert record['calls'] == {'chars': 1, 'doc': 3, 'events': 1, 'presence': 1, 'rels': 1} and record['failed'] == {'chars': False, 'doc': 0, 'events': False, 'presence': False, 'rels': False}
    assert 'doc_skipped' not in record['stats']
    assert record['stats']['events_kept'] == 1 and record['stats']['relations_kept'] == 1
    assert record['events'][0]['mentions'] == [{'name': '철수', 'kind': 'character', 'role': 'experienced'}, {'name': '영희', 'kind': 'character', 'role': 'experienced'}]   # 사건이 놓친 영희를 자리 단계가 더한다
    assert record['stats']['presence_added'] == 1 and record['stats']['presence_names_kept'] == 2 and 'presence_upgraded' not in record['stats']
    again = run_rounds([('w00', 1)], w2.extractor(works), llm, SyncExecutor(llm))
    assert again == [record] and len(fake.calls) == 7                                                                          # 캐시: 다시 돌려도 호출 없음


def test_merger_asks_once_per_work_and_does_not_ask_for_a_work_with_fewer_than_two_people(tmp_path):
    fake = Fake()
    llm = Llm(Ledger(tmp_path / 'calls.jsonl'), tmp_path / 'cache', model='m', client=fake)
    (done,) = run_rounds(['w00'], w2.merger({'w00': RECORDS}), llm, SyncExecutor(llm))
    assert fake.calls == ['Links'] and done['called'] and not done['failed']
    assert done['links'] == [{'left': '1:1', 'right': '2:1', 'verdict': 'uncertain', 'hidden': False, 'episode': None, 'quote': ''}] and done['raw']['links'][0]['verdict'] == 'uncertain'
    (alone,) = run_rounds(['w01'], w2.merger({'w01': [rec(1, {'철수': person('')})]}), llm, SyncExecutor(llm))
    assert not alone['called'] and alone['links'] == [] and fake.calls == ['Links']                                  # 인물이 하나뿐이면 부르지 않는다


def test_learner_asks_once_per_later_episode_and_never_for_the_first_episode(tmp_path):
    class Answer(Fake):
        def _parse(self, **options):
            if options['text_format'].__name__ == 'Learned':
                self.calls.append('Learned')
                usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=None)
                said = '철수는 영희에게 칼을 건넸다.'
                return SimpleNamespace(status='completed', usage=usage, model='m', output_parsed=w2.Learned(learned=[w2.Learn(event='e01-1', learner='민수', quote=said)]))
            return super()._parse(**options)

    fake = Answer()
    llm = Llm(Ledger(tmp_path / 'calls.jsonl'), tmp_path / 'cache', model='m', client=fake)
    works = {'w00': {'id': 'w00', 'episodes': [{'number': 1, 'text': TEXT}, {'number': 2, 'text': TEXT}]}}
    results = run_rounds([('w00', 1), ('w00', 2)], w2.learner(works, {'w00': RECORDS}), llm, SyncExecutor(llm))
    assert fake.calls == ['Learned'] and results[0]['called'] is False and results[0]['learned'] == []                  # 1화는 앞 회차가 없다
    assert results[1]['called'] and [(l['event'], l['learner'], l['episode']) for l in results[1]['learned']] == [('e01-1', '민수', 2)]
    assert results[1]['stats']['learned_kept'] == 1 and not results[1]['failed']


def test_build_world2_links_a_later_listener_to_the_earlier_event_in_the_episode_of_hearing_and_skips_impossible_ones():
    said = {'episode': 2, 'event': 'e01-1', 'learner': '민수', 'quote': 'q'}
    knew = {'episode': 2, 'event': 'e01-1', 'learner': '철수', 'quote': 'q'}                                           # 이미 겪은 인물
    nowhere = [{'episode': 2, 'event': 'e07-1', 'learner': '민수', 'quote': 'q'}, {'episode': 2, 'event': 'e01-1', 'learner': '길동', 'quote': 'q'}]   # 없는 사건·카드가 없는 인물
    built, stats = w2.build_world2('w00', RECORDS, [], FULL, [said, knew, said, *nowhere])
    by_title = {c.title: c.id for c in built['cards']}
    links = {(r.source, r.target, r.label): built['when'][r.id] for r in built['relations']}
    assert links[(by_title['민수'], by_title['칼의 전달'], '들음')] == 2 and (by_title['철수'], by_title['칼의 전달'], '들음') not in links
    assert built['events']['e01-1']['heard'] == {by_title['민수']: 2} and stats['relations']['들음'] == 2              # 같은 회차 들음 하나(영희, 2화 이별)와 뒤 회차 들음 하나
    memory = next(c for c in built['cards'] if c.title == '민수').episodes[2]
    assert '[들은 일] 칼의 전달: 철수는 영희에게 칼을 건넸다.' in memory                                                   # 듣는 회차의 기억에 앞 사건이 들어간다
    base, _ = w2.build_world2('w00', RECORDS, [], FULL)
    assert base['events']['e01-1']['heard'] == {}                                                                      # 들음 항목이 없으면 그대로


def test_merger_sends_candidates_with_evidence_when_it_has_the_texts(tmp_path):
    seen = []

    class Spy(Fake):
        def _parse(self, **options):
            seen.append(options['input'])
            return super()._parse(**options)

    fake = Spy()
    llm = Llm(Ledger(tmp_path / 'calls.jsonl'), tmp_path / 'cache', model='m', client=fake)
    records = [rec(1, {'도율': person(''), '한도율': person('')}), rec(2, {'도율': person('')})]
    (done,) = run_rounds(['w00'], w2.merger({'w00': records}, {'w00': {1: '한도율이 수술실에 들어섰다.', 2: '도율이 웃었다.'}}), llm, SyncExecutor(llm))
    payload = json.loads(seen[0])
    assert [(c['left'], c['right'], c['evidence']) for c in payload['candidates']] == [('1:1', '1:2', ['한도율이 수술실에 들어섰다.'])] and 'at' not in payload['candidates'][0]


def test_finish_writes_the_episode_files_the_merge_the_world_and_the_stats_of_each_work_and_their_total(tmp_path):
    works = {'w00': {'episodes': [{'number': 1, 'text': FULL}, {'number': 2, 'text': FULL}]}}
    steps = dict(stats={'events_kept': 1, 'event_quote': 1}, calls={'chars': 1, 'doc': 3, 'events': 1, 'rels': 1}, failed={'chars': False, 'doc': 1, 'events': False, 'rels': False})
    records = [dict(r, work='w00', **steps) for r in RECORDS]
    merged = {'w00': {'links': [], 'stats': {'merge_quote': 2}, 'failed': False, 'called': True, 'raw': {'links': []}}}
    per_work = w2.finish(works, records, merged, 'world2', tmp_path / 'works', tmp_path / 'world2_stats.json')
    folder = tmp_path / 'works' / 'w00'
    assert sorted(p.name for p in (folder / 'world2' / 'episodes').iterdir()) == ['01.json', '02.json'] and json.loads((folder / 'world2' / 'merge.json').read_text())['called'] is True
    assert load_world(folder / 'world2.json')['series'] == 'w00' and json.loads((folder / 'world2_stats.json').read_text()) == per_work['w00']
    assert per_work['w00']['calls_total'] == 12 and per_work['w00']['failed']['doc'] == 2 and per_work['w00']['dropped'] == {'event_quote': 2} and per_work['w00']['merge_dropped'] == {'merge_quote': 2}
    learn = {'w00': {'items': [{'episode': 2, 'event': 'e01-1', 'learner': '민수', 'quote': 'q'}], 'calls': 1, 'failed': 0, 'stats': {'learn_dup': 1, 'learned_kept': 1}}}
    again = w2.finish(works, records, merged, 'world2l', tmp_path / 'works', tmp_path / 'world2l_stats.json', learn)
    assert json.loads((folder / 'world2l' / 'learned.json').read_text()) == learn['w00'] and again['w00']['learn'] == {'calls': 1, 'failed': 0, 'kept': 1}
    assert again['w00']['learn_dropped'] == {'learn_dup': 1} and again['w00']['calls_all'] == again['w00']['calls_total'] + 1 + 1       # 회차별 호출 + 합치기 1 + 들음 1
    assert again['w00']['relations']['들음'] == per_work['w00']['relations']['들음'] + 1
    total = json.loads((tmp_path / 'world2_stats.json').read_text())
    assert set(total) == {'works', 'total'} and total['total']['works'] == 1 and total['total']['episodes'] == 2 and total['total']['cards'] == per_work['w00']['cards']
    assert w2.total_stats({'a': per_work['w00'], 'b': per_work['w00']})['calls_total'] == 24 and w2.total_stats({})['works'] == 0         # 작품별 통계를 칸마다 더한다


def test_total_stats_keeps_a_key_that_only_some_works_have():
    one = {'episodes': 1, 'cards': {'event': 1, 'ability': 2}, 'merge': {'called': 1}}
    two = {'episodes': 2, 'cards': {'event': 3, 'rule': 1}, 'merge': {'called': 1}}
    assert w2.total_stats({'a': one, 'b': two}) == {'works': 2, 'episodes': 3, 'cards': {'event': 4, 'ability': 2, 'rule': 1}, 'merge': {'called': 2}}
    assert w2.total_stats({'b': two, 'a': one}) == w2.total_stats({'a': one, 'b': two})                      # 작품 순서와 무관하다


def test_summarize_adds_up_stats_calls_and_failures_per_work():
    one = {'stats': {'events_kept': 2, 'event_quote': 1, 'presence_added': 4}, 'calls': {'chars': 1, 'doc': 3, 'events': 1, 'presence': 1, 'rels': 1},
           'failed': {'chars': False, 'doc': 1, 'events': False, 'presence': True, 'rels': True}}
    two = {'stats': {'events_kept': 1}, 'calls': {'chars': 1, 'doc': 2, 'events': 1, 'rels': 1}, 'failed': {'chars': False, 'doc': 0, 'events': True, 'rels': False}}   # 옛 기록(자리 단계 이전)도 더한다
    total = w2.summarize([one, two])
    assert total == {'episodes': 2, 'calls': {'chars': 2, 'doc': 5, 'events': 2, 'presence': 1, 'rels': 2}, 'calls_total': 12, 'failed': {'chars': 0, 'doc': 1, 'events': 1, 'presence': 1, 'rels': 1},
                     'dropped': {'event_quote': 1}, 'counts': {'events_kept': 3, 'presence_added': 4}}


def test_parse_routes_reads_kind_model_and_optional_effort_and_refuses_unknown_kinds_models_or_efforts():
    assert w2.parse_routes(['learn=gpt-6.2-sol@high', 'merge=gpt-6.1-terra', 'events=gpt-6-luna@medium']) == {'learn': ('gpt-6.2-sol', 'high'), 'merge': ('gpt-6.1-terra', None), 'events': ('gpt-6-luna', 'medium')}
    assert w2.parse_routes([]) == {}
    for bad in ('learner=gpt-6-luna', 'learn=', 'learn', 'learn=gpt-6-luna@extreme', '=gpt-6-luna'):
        with pytest.raises(SystemExit):
            w2.parse_routes([bad])


def test_limit_scales_the_output_token_budget_with_the_reasoning_effort_and_leaves_low_untouched():
    try:
        w2.FACTORS.clear()
        assert w2.limit('learn', 3_000) == 3_000                                                                  # 기본(low)은 그대로라 캐시 열쇠가 같다
        w2.FACTORS.update({'learn': w2.FACTOR['high'], 'events': w2.FACTOR['medium']})
        assert (w2.limit('learn', 3_000), w2.limit('events', 9_000), w2.limit('doc', 2_500)) == (9_000, 18_000, 2_500)
    finally:
        w2.FACTORS.clear()


def test_route_sends_only_the_named_kinds_to_their_own_llm():
    base, other = SimpleNamespace(), SimpleNamespace()
    base.for_kind = lambda kind: base
    w2.route(base, {'learn': other})
    assert base.for_kind('learn') is other and base.for_kind('doc') is base and base.for_kind('merge') is base


@pytest.mark.parametrize('name', ['world', 'world_svc', 'knowledge', 'a b', ''])
def test_check_name_refuses_names_that_would_overwrite_other_work_files(name):
    with pytest.raises(SystemExit):
        w2.check_name(name)


def test_dedup_sections_drops_a_line_equal_to_an_earlier_episodes_line_for_the_fixed_fields_only():
    sections = {1: '[정체] 약장수\n[성격] 수다스럽다\n[행적] 마을에 들렀다', 2: '[정체] 약장수\n[성격] 과묵해졌다\n[행적] 마을에 들렀다\n[겪은 일] 만남: 인사했다', 3: '[정체] 약장수'}
    got, removed = w2.dedup_sections(sections)
    assert got == {1: sections[1], 2: '[성격] 과묵해졌다\n[행적] 마을에 들렀다\n[겪은 일] 만남: 인사했다'} and removed == 2      # [행적]·사건 줄은 같아도 둔다, 비게 된 회차 칸은 없앤다
    assert 3 not in got and w2.dedup_sections({2: '[정체] A', 1: '[정체] A'}) == ({1: '[정체] A'}, 1)                 # 앞 회차 기준(회차 순서)


def test_long_sections_are_the_episode_slots_longer_than_the_limit_in_order():
    assert w2.long_sections({3: 'x' * 1201, 1: 'x' * 1200, 2: 'x' * 1300}) == [2, 3] and w2.long_sections({1: 'x' * 11}, limit=10) == [1]


ORIGINAL = ('[정체] 떠돌이 약장수이며 약을 판다. 떠돌이 약장수라서 약을 판다.\n[성격] 수다스럽다\n[행적] 마을에 들러 약을 팔고 순이에게 인사했다.\n'
            '[겪은 일] 약 팔기: 치삼이 마을에서 약을 팔았다.\n[들은 일] 소문: 순이가 떠났다는 소문이 돌았다.')


def test_verify_section_keeps_grounded_labelled_lines_and_restores_event_lines_whose_title_the_model_dropped():
    out = w2.Tightened(text='[정체] 떠돌이 약장수이며 약을 판다.\n[성격] 수다스럽다\n설명 없는 줄이다\n[행적] 우주를 정복하고 별을 다스렸다.\n[겪은 일] 약 팔기: 치삼이 약을 팔았다.')
    got, stats = w2.verify_section(ORIGINAL, out)
    assert got.splitlines() == ['[정체] 떠돌이 약장수이며 약을 판다.', '[성격] 수다스럽다', '[겪은 일] 약 팔기: 치삼이 약을 팔았다.', '[들은 일] 소문: 순이가 떠났다는 소문이 돌았다.']
    assert stats['label'] == 1 and stats['grounded'] == 1 and stats['restored'] == 1                                  # 항목 표지가 없는 줄·원문에 없는 내용의 줄은 버리고 지워진 사건 제목의 줄은 원래 줄로 되살린다


def test_verify_section_refuses_a_text_that_is_not_shorter_than_the_original():
    got, stats = w2.verify_section(ORIGINAL, w2.Tightened(text=ORIGINAL + '\n[성격] 수다스럽다 수다스럽다'))
    assert got is None and stats['longer'] == 1
    assert w2.verify_section(ORIGINAL, w2.Tightened(text=''))[0] is None


CHI = [rec(1, {'치삼': person('나그네', identity='떠돌이 약장수', personality='수다스럽다', speech='느긋하다', speech_quote='"약 사시오."'), '치삼이': person('약장수', identity='약을 파는 사람'), '순이': person('마을 처녀')},
           [ev('약 팔기', '@치삼이 @마을에서 약을 팔았다.', '치삼이 마을에서 약을 팔았다.', ('치삼이', 'character', 'experienced'), ('마을', 'location', 'none')),
            ev('인사', '@치삼은 @순이에게 인사했다.', '치삼은 순이에게 인사했다.', ('치삼', 'character', 'experienced'), ('순이', 'character', 'experienced')),
            ev('소문', '@순이가 @치삼의 소문을 들었다.', '순이가 소문을 들었다.', ('순이', 'character', 'heard'), ('치삼', 'character', 'mentioned'))],
           [{'source': '치삼', 'target': '순이', 'label': '이웃', 'quote': '치삼과 순이는 이웃이다.'}]),
       rec(2, {'치삼': person('', identity='뒤에 밝혀진 신분')}, [ev('뒷일', '@치삼이 떠났다.', '치삼이 떠났다.', ('치삼', 'character', 'experienced'))])]
CHI_TEXT = '치삼 치삼이 치삼 순이 마을'


def test_identity_materials_cover_only_merged_cards_with_two_names_in_their_first_episode_and_nothing_later():
    built, _ = w2.build_world2('w00', CHI, [], CHI_TEXT)
    got = w2.identity_materials(built, CHI)
    card = next(c for c in built['cards'] if c.title == '치삼')
    assert list(got) == [card.id]                                                                                       # 순이(합쳐지지 않음)는 대상이 아니다
    m = got[card.id]
    assert m['first'] == 1 and [e['name'] for e in m['entries']] == ['치삼', '치삼이'] and m['entries'][0]['doc']['identity'] == '떠돌이 약장수'
    assert [e['title'] for e in m['events']] == ['약 팔기', '인사'] and m['relations'] == [{'source': '치삼', 'target': '순이', 'label': '이웃', 'quote': '치삼과 순이는 이웃이다.'}]   # 이름만 나온 사건은 뺀다
    assert set(m['quotes']) == {'치삼이 마을에서 약을 팔았다.', '치삼은 순이에게 인사했다.', '치삼과 순이는 이웃이다.', '"약 사시오."'}      # 2화 자료는 없다
    text = w2.identity_input(card, m)
    assert text.startswith('[이름] ') and '치삼이' in text and '뒤에 밝혀진 신분' not in text and '[관계] 치삼 → 순이 「이웃」' in text


def test_verify_identity_keeps_the_sentences_whose_quote_is_one_of_the_input_quotes():
    m = {'quotes': ['치삼이 마을에서 약을 팔았다.', '치삼은 순이에게 인사했다.']}
    out = w2.Introduced(sentences=[said('치삼(치삼이)은 약장수다.', '마을에서 약을 팔았다'), said('치삼은 왕이 된다.', '입력에 없는 문장이 맞다.'), said('근거가 밝혀지지 않았다.', '치삼은 순이에게 인사했다.')])
    text, stats = w2.verify_identity(out, m)
    assert text == '치삼(치삼이)은 약장수다.' and stats['proposed'] == 3 and stats['kept'] == 1 and stats['quote'] == 1 and stats['negation'] == 1


def test_verify_identity_drops_a_sentence_about_the_text_but_keeps_a_past_fact_of_the_person():
    m = {'quotes': ['치삼이 마을에서 약을 팔았다.']}
    out = w2.Introduced(sentences=[said('치삼은 1화에서 처음 등장한다.', '마을에서 약을 팔았다'), said('치삼은 한때 군인이었다.', '마을에서 약을 팔았다')])
    text, stats = w2.verify_identity(out, m)
    assert text == '치삼은 한때 군인이었다.' and stats['meta'] == 1


def test_verify_section_ignores_the_header_lines_the_model_copied_from_the_input_without_counting_them():
    out = w2.Tightened(text='[인물] 치삼\n[3화 기억]\n[정체] 떠돌이 약장수이며 약을 판다.\n[성격] 수다스럽다')
    got, stats = w2.verify_section(ORIGINAL, out)
    assert got.splitlines()[:2] == ['[정체] 떠돌이 약장수이며 약을 판다.', '[성격] 수다스럽다'] and 'label' not in stats

# ---- ⑦ 카드 다듬기: 원문을 보는 설명 ----

def said(text, quote):
    return w2.Said(text=text, quote=quote)


def cell(episode, *sentences):
    return w2.Cell(episode=episode, sentences=[said(*s) for s in sentences])


def cited(text, *episodes):
    return w2.Cited(text=text, episodes=list(episodes))


def test_mention_blocks_collect_the_sentences_with_the_name_and_one_sentence_around_each_and_merge_neighbours():
    text = '가 문장이다. 나 문장이다. 장터가 열렸다. 다 문장이다. 라 문장이다. 마 문장이다. 바 문장이다. 장터는 컸다. 장터에는 사람이 많았다. 사 문장이다.'
    assert w2.mention_blocks(text, ['장터']) == ['나 문장이다. 장터가 열렸다. 다 문장이다.', '바 문장이다. 장터는 컸다. 장터에는 사람이 많았다. 사 문장이다.']
    assert w2.mention_blocks('큰 장 터가 열렸다.', ['장터']) == ['큰 장 터가 열렸다.']                       # 공백의 차이는 무시한다(고전은 줄 끝에서 낱말이 끊긴다)
    assert w2.mention_blocks(text, ['칼']) == [] and w2.mention_blocks(text, []) == []                          # 한 글자 이름은 다른 낱말 속에서도 맞아 글자 그대로 찾지 않는다


def test_mention_blocks_keep_at_most_cap_places_spread_over_the_text_and_cut_long_sentences():
    text = ' '.join(['장터가 있다.', '가 문장이다.', '나 문장이다.', '다 문장이다.'] * 3 + ['장터가 있다.'])
    blocks = w2.mention_blocks(text, ['장터'], cap=2)
    assert len(blocks) == 2 and blocks[0].startswith('장터가 있다.') and blocks[1].count('장터가 있다.') >= 1          # 첫머리부터 고르게 퍼뜨려 고른다
    assert w2.mention_blocks('장터' + '가' * 400 + '.', ['장터'], cut=50) == ['장터' + '가' * 48 + '…']


EP_TEXTS = {1: '철수는 영희에게 단검을 건넸다. 단검은 대장간에서 나온 것이다. 해가 졌다. 장터에는 사람이 많았다.', 2: '철수는 단검을 휘둘렀다. 칼날이 빛났다.'}
EP_RECORDS = [rec(1, {'철수': person('검객', identity='떠돌이 검객'), '영희': person('처녀')},
                  [ev('단검의 전달', '@철수는 @영희에게 @단검을 건넸다.', '철수는 영희에게 단검을 건넸다.', ('철수', 'character', 'experienced'), ('영희', 'character', 'experienced'),
                      ('단검', 'object', 'none'), ('장터', 'location', 'none'))]),
              rec(2, {'철수': person('검객')}, [ev('휘두름', '@철수가 @단검을 휘둘렀다.', '철수는 단검을 휘둘렀다.', ('철수', 'character', 'experienced'), ('단검', 'object', 'none'))])]


def epcard_world():
    built = w2.build_world2('w00', EP_RECORDS, [], ' '.join(EP_TEXTS.values()))[0]
    return {c.title: c.id for c in built['cards']}, built


def test_build_world2_keeps_the_surface_names_of_each_entity_card():
    records = [names_rec(1, '치삼', events=[ev('만남', '@치삼이 @마을에 들렀다.', '치삼이 마을에 들렀다.', ('치삼', 'character', 'experienced'), ('마을', 'location', 'none'))]),
               names_rec(2, '치삼', events=[ev('다시', '@치삼이 @마을을 떠났다.', '치삼이 마을을 떠났다.', ('치삼', 'character', 'experienced'), ('마을을', 'location', 'none'))])]
    built, _ = w2.build_world2('w00', records, [], '치삼이 마을 마을을')
    assert built['entity_names'] == {next(c.id for c in built['cards'] if c.cardType == 'location'): ['마을', '마을을']}


def test_entity_materials_gather_the_name_sentences_and_the_event_quotes_of_each_episode_from_the_first_one_on():
    ids, built = epcard_world()
    got = w2.entity_materials(built, EP_TEXTS)
    assert set(got) == {ids['장터'], ids['단검']}                                                                   # 인물·사건 카드는 대상이 아니다
    assert got[ids['단검']] == {'first': 1, 'names': ['단검'], 'events': ['단검의 전달 철수는 영희에게 단검을 건넸다.'],
                                'episodes': {1: {'spots': ['철수는 영희에게 단검을 건넸다. 단검은 대장간에서 나온 것이다. 해가 졌다.'], 'quotes': []},
                                             2: {'spots': ['철수는 단검을 휘둘렀다. 칼날이 빛났다.'], 'quotes': []}}}   # 사건 인용이 이미 문장 안에 있으면 따로 넣지 않는다, events = 처음 나온 회차 사건의 제목·설명(본문 검사용, 모델에 주지 않는다)
    assert got[ids['장터']]['episodes'] == {1: {'spots': ['해가 졌다. 장터에는 사람이 많았다.'], 'quotes': ['철수는 영희에게 단검을 건넸다.']}}   # 이름이 없는 인용(사건의 근거)은 따로 넣는다, 이름이 안 나온 2화는 칸이 없다
    before = w2.entity_materials(built, {**EP_TEXTS, 0: '장터가 있었다.'})
    assert 0 not in before[ids['장터']]['episodes']                                                                  # 처음 나온 회차(공개 회차) 앞 글은 쓰지 않는다
    assert w2.entity_materials(built, {})[ids['단검']]['episodes'] == {1: {'spots': [], 'quotes': ['철수는 영희에게 단검을 건넸다.']}, 2: {'spots': [], 'quotes': ['철수는 단검을 휘둘렀다.']}}


def test_describe_batches_split_the_episodes_by_input_size_and_count_and_keep_the_first_episode_in_the_first_batch():
    material = {'first': 3, 'names': [], 'episodes': {n: {'spots': ['가' * 400], 'quotes': []} for n in (3, 4, 5, 6)}}
    assert w2.describe_batches(material, chars=900) == [[3, 4], [5, 6]] and w2.describe_batches(material, chars=10_000) == [[3, 4, 5, 6]]
    assert w2.describe_batches(material, chars=10_000, limit=3) == [[3, 4, 5], [6]]
    assert w2.describe_batches({'first': 1, 'names': [], 'episodes': {1: {'spots': ['가' * 5000], 'quotes': []}}}, chars=100) == [[1]]      # 한 회차가 넘쳐도 그 회차는 한 묶음에 든다


def test_describe_input_names_the_kind_marks_the_first_episode_and_says_whether_this_call_writes_the_body():
    ids, built = epcard_world()
    material = w2.entity_materials(built, EP_TEXTS)
    fair = next(c for c in built['cards'] if c.title == '장터')
    text = w2.describe_input(fair, material[fair.id], [1])
    assert text.splitlines()[:3] == ['[카드] 장소 · 장터', '[처음 나온 회차] 1화', '[이번 호출] 처음 나온 회차를 포함한다: body와 cells를 쓴다.']
    assert '[1화 자료] (처음 나온 회차)' in text and '- 원문: 해가 졌다. 장터에는 사람이 많았다.' in text and '- 사건 인용: 철수는 영희에게 단검을 건넸다.' in text
    dagger = next(c for c in built['cards'] if c.title == '단검')
    later = w2.describe_input(dagger, material[dagger.id], [2])
    assert later.splitlines()[2].startswith('[이번 호출] 뒤 회차 묶음이다') and '[2화 자료]' in later and '[1화 자료]' not in later


M = {'first': 1, 'names': ['장터'], 'episodes': {1: {'spots': ['철수는 영희에게 단검을 건넸다. 장터는 마을 한가운데에 있다. 사람이 오갔다.'], 'quotes': []},
                                                 2: {'spots': ['철수는 떠났다. 장터는 텅 비었다.'], 'quotes': ['철수는 마을을 떠났다.']}}}


def test_verify_described_keeps_a_sentence_only_when_its_quote_is_in_the_material_shown_for_its_own_episode():
    out = w2.Described(body=[said('장터는 마을 한가운데에 있다.', '장터는 마을 한가운데에 있다'),                       # 처음 회차 자료 안(공백 없이 접어 대조)
                             said('장터는 큰 시장이다.', '입력에 없는 문장이다 정말로'),                                  # 자료에 없다
                             said('장터는 나중에 비었다.', '장터는 텅 비었다.'),                                           # 뒤 회차 자료는 본문의 근거가 못 된다
                             said('장터는 크다.', '장터는')],                                                             # 8자(공백 없이) 미만
                       cells=[cell(2, ('장터가 텅 비었다.', '장터는 텅 비었다.'), ('엉뚱한 근거다.', '장터는 마을 한가운데에 있다.')),   # 1화 자료는 2화 칸의 근거가 못 된다
                              cell(7, ('자료에 없는 회차다.', '장터는 텅 비었다.'))])
    got, stats = w2.verify_described(out, M, [1, 2], '장터')
    assert got == {'body': ['장터는 마을 한가운데에 있다.'], 'cells': {2: ['장터가 텅 비었다.']}, 'quotes': {2: ['장터는 텅 비었다.']}}
    assert stats['proposed'] == 7 and stats['kept'] == 2 and stats['quote'] == 4 and stats['episode'] == 1


def test_verify_described_moves_a_body_sentence_that_names_a_character_talks_about_the_text_or_ends_in_a_past_action_to_the_first_episode_cell():
    q = '철수는 영희에게 단검을 건넸다'
    out = w2.Described(body=[said('장터는 1화에서 처음 언급된다.', q), said('장터는 두 사람이 만난 곳이었다.', q), said('장터는 철수가 단검을 건넨 곳이다.', q), said('장터는 마을 한가운데에 있다.', q)],
                       cells=[cell(1, ('장터에는 사람이 많다.', '장터는 마을 한가운데에 있다'))])
    got, stats = w2.verify_described(out, M, [1, 2], '장터', ('철수', '영희'))
    assert got['body'] == ['장터는 마을 한가운데에 있다.']                                                              # 본문은 글에 대한 말·과거 동작·인물 이름이 없는 문장만
    assert got['cells'][1] == ['장터는 1화에서 처음 언급된다.', '장터는 두 사람이 만난 곳이었다.', '장터는 철수가 단검을 건넨 곳이다.', '장터에는 사람이 많다.']   # 옮긴 문장이 앞, 모델이 쓴 1화 칸이 뒤
    assert got['quotes'][1] == [q, q, q, '장터는 마을 한가운데에 있다'] and stats['moved_meta'] == 1 and stats['moved_past'] == 1 and stats['moved_name'] == 1
    titled = w2.Described(body=[said('철수 장터는 마을 한가운데에 있다.', q)], cells=[])
    assert w2.verify_described(titled, M, [1, 2], '철수 장터', ('철수',))[0]['body'] == ['철수 장터는 마을 한가운데에 있다.']      # 카드 제목 속 이름은 인물 이름으로 세지 않는다


def test_verify_described_moves_a_body_sentence_that_shares_four_characters_with_an_event_of_the_first_episode_apart_from_the_cards_own_name():
    material = {**M, 'events': ['시장 거래 철수는 장터에서 약초 거래를 했다.']}
    q = '장터는 마을 한가운데에 있다'
    out = w2.Described(body=[said('장터는 약초 거래가 이루어지는 곳이다.', q), said('장터는 마을 한가운데에 있다.', q)], cells=[])
    got, stats = w2.verify_described(out, material, [1, 2], '장터')
    assert got['body'] == ['장터는 마을 한가운데에 있다.'] and got['cells'] == {1: ['장터는 약초 거래가 이루어지는 곳이다.']} and stats['moved_event'] == 1     # 사건에서 온 사실이 정의로 둔갑한 문장은 칸으로
    assert w2.verify_described(out, M, [1, 2], '장터')[0]['body'] == ['장터는 약초 거래가 이루어지는 곳이다.', '장터는 마을 한가운데에 있다.']      # 사건 글이 없으면 거르지 않는다
    same_name = {**M, 'events': ['장터에서 장터 이야기를 했다.']}
    assert w2.verify_described(out, same_name, [1, 2], '장터')[0]['body'] == ['장터는 약초 거래가 이루어지는 곳이다.', '장터는 마을 한가운데에 있다.']   # 카드 자신의 이름만 겹치는 것은 사건의 사실이 아니다


def test_verify_described_drops_not_revealed_and_title_only_sentences_and_caps_the_body_and_each_cell():
    q = '장터는 마을 한가운데에 있다'
    out = w2.Described(body=[said('이 장소의 주인은 밝혀지지 않았다.', q), said('장터', q)] + [said(f'특징 {i}번이다.', q) for i in range(4)],
                       cells=[cell(2, *[(f'변화 {i}번이다.', '장터는 텅 비었다.') for i in range(9)])])
    got, stats = w2.verify_described(out, M, [1, 2], '장터')
    assert len(got['body']) == w2.DEFINE_MAX and len(got['cells'][2]) == w2.CELL_MAX
    assert stats['negation'] == 1 and stats['trivial'] == 1 and stats['extra'] == (4 - w2.DEFINE_MAX) + (9 - w2.CELL_MAX) and stats['proposed'] == 15


def test_verify_described_caps_the_moved_sentences_like_any_other_cell_and_ignores_the_body_of_a_later_batch():
    q = '철수는 영희에게 단검을 건넸다'
    got, stats = w2.verify_described(w2.Described(body=[said(f'철수가 한 일 {i}번이다.', q) for i in range(8)], cells=[]), M, [1, 2], '장터', ('철수',))
    assert got['body'] == [] and got['cells'] == {1: [f'철수가 한 일 {i}번이다.' for i in range(w2.CELL_MAX)]} and stats['extra'] == 8 - w2.CELL_MAX and stats['moved_name'] == 8
    later = w2.Described(body=[said('장터는 시장이다.', '장터는 텅 비었다.')], cells=[cell(2, ('장터가 텅 비었다.', '장터는 텅 비었다.'))])
    got, stats = w2.verify_described(later, M, [2], '장터')
    assert got['body'] == [] and got['cells'] == {2: ['장터가 텅 비었다.']} and stats['body_ignored'] == 1 and stats['proposed'] == 2   # 정의는 처음 나온 회차 묶음에서만


def test_join_described_takes_the_body_of_the_first_batch_merges_the_cells_and_drops_a_sentence_that_repeats_an_earlier_one():
    first = {'body': ['장터는 마을 한가운데에 있는 시장이다.'], 'cells': {1: ['장터에는 사람이 많다.']}, 'quotes': {1: ['q1']}}
    later = {'body': [], 'cells': {2: ['장터에는 사람이 많다.', '장터는 텅 비었다.'], 3: ['장터는 마을 한가운데에 있는 시장이다.']}, 'quotes': {2: ['q2', 'q3'], 3: ['q4']}}
    got, stats = w2.join_described([first, later])
    assert got == {'body': ['장터는 마을 한가운데에 있는 시장이다.'], 'cells': {1: ['장터에는 사람이 많다.'], 2: ['장터는 텅 비었다.']}, 'quotes': {1: ['q1'], 2: ['q3']}}
    assert stats['repeat'] == 2 and stats['kept'] == -2                                                              # 본문·앞 회차 칸을 그대로 되풀이한 문장은 버리고 통과 수에서 뺀다


def test_summary_materials_cover_merged_cards_and_cards_over_the_size_limit_and_nothing_else():
    built, _ = w2.build_world2('w00', CHI, [], CHI_TEXT)
    sam = next(c.id for c in built['cards'] if c.title == '치삼')
    got = w2.summary_materials(built)
    assert list(got) == [sam] and got[sam]['aliases'] == ['치삼이'] and sorted(got[sam]['episodes']) == [1, 2]       # 병합 인물만(순이는 짧고 합쳐지지 않았다)
    assert len(w2.summary_materials(built, limit=10)) == 2                                                          # 전체 글자 수가 기준을 넘으면 대상
    card = next(c for c in built['cards'] if c.id == sam)
    text = w2.summary_input(card, got[sam])
    assert text.splitlines()[:2] == ['[인물] 치삼', '[호칭] 치삼이'] and '[1화 기억]' in text and '[2화 기억]' in text
    long = {'aliases': [], 'episodes': {1: '\n'.join(f'[행적] {i}번째 한 일 ' + '가' * 60 for i in range(40)), 2: '[정체] 짧다'}}
    clipped = w2.summary_input(card, long, cap=2000)
    assert len(clipped) < 2600 and '[2화 기억]\n[정체] 짧다' in clipped and '[행적] 0번째' in clipped             # 긴 칸은 줄 단위로 잘리고 짧은 칸은 그대로


def test_verify_summary_keeps_a_sentence_only_when_every_episode_it_cites_has_a_memory_slot():
    material = {'aliases': [], 'episodes': {1: 'a', 3: 'b'}}
    out = w2.Summarized(sentences=[cited('첫 문장이다.', 1), cited('둘째 문장이다.', 1, 3), cited('셋째는 없는 회차를 댄다.', 1, 2), cited('넷째는 근거 회차가 없다.'), cited('이 인물의 정체는 밝혀지지 않았다.', 1)])
    text, stats = w2.verify_summary(out, material)
    assert text == '첫 문장이다. 둘째 문장이다.' and stats['summary_proposed'] == 5 and stats['summary_kept'] == 2 and stats['summary_episode'] == 2 and stats['summary_negation'] == 1
    many = w2.Summarized(sentences=[cited(f'{i}번째 문장이다.', 1) for i in range(12)])
    text, stats = w2.verify_summary(many, material)
    assert text.count('번째') == w2.SUMMARY_MAX and stats['summary_extra'] == 12 - w2.SUMMARY_MAX


def test_refine_plan_and_tasks_cover_each_entity_batch_and_summary_card_once_and_the_character_paths_only_when_asked():
    ids, built = epcard_world()
    plan = w2.refine_plan(built, EP_RECORDS, EP_TEXTS)
    assert w2.refine_tasks(plan) == [('card', cid, 0) for cid in plan['entity']] and set(plan['entity']) == {ids['장터'], ids['단검']}
    assert plan['summary'] == {} and plan['identity'] == {} and plan['sections'] == {}                              # 기본은 인물 카드를 건드리지 않는다(종합 소개는 대상이 있을 때만)
    assert plan['entity'][ids['단검']]['batches'] == [[1, 2]]
    sums = w2.refine_plan(built, EP_RECORDS, EP_TEXTS, summary_limit=10)
    assert set(sums['summary']) == {ids['철수'], ids['영희']} and {t[1] for t in w2.refine_tasks(sums) if t[0] == 'summary'} == set(sums['summary'])


def test_refine_plan_adds_the_merged_identity_and_long_slot_paths_only_when_tighten_is_on_and_settle_applies_only_verified_output():
    records, built = refined_world()
    assert w2.refine_plan(built, records, {})['sections'] == {}
    plan = w2.refine_plan(built, records, {}, tighten=True)
    sword = next(c.id for c in built['cards'] if c.title == '철수')
    assert ('section', sword, 2) in w2.refine_tasks(plan) and plan['sections'][sword]['long'] == [2]
    updates, stats = w2.settle(built, plan, {('section', sword, 2): w2.Tightened(text='[행적] ' + 'x' * 100)})
    kept = next(c for c in built['cards'] if c.id == sword).episodes
    assert '[정체]' not in plan['sections'][sword]['episodes'][2] and plan['sections'][sword]['removed'] == 1             # 2화 칸의 [정체] 줄은 1화와 같아서 코드가 뺐다
    assert updates[sword]['episodes'] == {1: kept[1], 2: '[행적] ' + 'x' * 100 + '\n[겪은 일] 휘두름: 철수가 칼을 휘둘렀다.'}   # 줄인 칸 + 되살린 사건 줄, 짧은 칸은 그대로
    assert stats['sections_tightened'] == 1 and w2.settle(built, plan, {})[1]['sections_failed'] == 1                  # 호출이 실패하면 그대로(실패를 성공으로 숨기지 않는다)


def refined_world():
    records = [rec(1, {'철수': person('검객', identity='떠돌이 검객')}, [ev('칼', '@철수가 @칼을 갈았다.', '철수가 칼을 갈았다.', ('철수', 'character', 'experienced'), ('칼', 'object', 'none'))]),
               rec(2, {'철수': person('검객', identity='떠돌이 검객', activity='x' * 1300)}, [ev('휘두름', '@철수가 @칼을 휘둘렀다.', '철수가 칼을 휘둘렀다.', ('철수', 'character', 'experienced'), ('칼', 'object', 'none'))])]
    return records, w2.build_world2('w00', records, [], '철수 칼')[0]


def test_settle_sets_the_body_the_cells_the_cell_quotes_and_the_summary_from_verified_output_only():
    ids, built = epcard_world()
    plan = w2.refine_plan(built, EP_RECORDS, EP_TEXTS, summary_limit=10)
    dagger = ids['단검']
    outs = {('card', dagger, 0): w2.Described(body=[said('단검은 대장간에서 나온 것이다.', '단검은 대장간에서 나온 것이다')],
                                              cells=[cell(1, ('대장간에서 만들어진 단검이다.', '단검은 대장간에서 나온 것이다')), cell(2, ('칼날이 빛난다.', '철수는 단검을 휘둘렀다'))])}
    outs |= {('summary', cid): w2.Summarized(sentences=[cited('이 인물은 검객이다.', 1), cited('근거 회차가 없는 문장이다.', 9)]) for cid in plan['summary']}
    updates, stats = w2.settle(built, plan, outs)
    assert updates[dagger] == {'text': '단검은 대장간에서 나온 것이다.', 'episodes': {1: '대장간에서 만들어진 단검이다.', 2: '칼날이 빛난다.'},
                               'quotes': {1: ['단검은 대장간에서 나온 것이다'], 2: ['철수는 단검을 휘둘렀다']}, 'sentences': {1: ['대장간에서 만들어진 단검이다.'], 2: ['칼날이 빛난다.']}}
    assert ids['장터'] not in updates and stats['entity_failed'] == 1 and stats['entity_cards'] == 1 and stats['entity_cells'] == 2          # 호출이 없던(실패한) 카드는 그대로
    assert updates[ids['철수']]['summary'] == '이 인물은 검객이다.' and updates[ids['영희']]['summary'] == '이 인물은 검객이다.' and stats['summary_cards'] == 2 and stats['summary_episode'] == 2


def test_apply_refine_replaces_only_the_updated_fields_and_puts_the_summaries_and_cell_quotes_beside_the_cards():
    ids, built = epcard_world()
    dagger, chul = ids['단검'], ids['철수']
    after = w2.apply_refine(built, {dagger: {'text': '대장간에서 나온 단검이다.', 'episodes': {2: '칼날이 빛난다.'}, 'quotes': {2: ['q']}, 'sentences': {2: ['칼날이 빛난다.']}}, chul: {'summary': '검객이다.'}})
    got = {c.id: c for c in after['cards']}
    assert got[dagger].text == '대장간에서 나온 단검이다.' and got[dagger].episodes == {2: '칼날이 빛난다.'} and got[dagger].title == '단검' and got[dagger].revealFromEpisode == 1
    assert got[chul] == next(c for c in built['cards'] if c.id == chul)                                              # 종합 소개는 카드 필드가 아니다
    assert after['summary'] == {chul: '검객이다.'} and after['cell_quotes'] == {dagger: {2: ['q']}} and after['cell_sentences'] == {dagger: {2: ['칼날이 빛난다.']}} and after['relations'] == built['relations']
    assert 'summary' not in built and next(c for c in built['cards'] if c.id == dagger).text == '단검'                  # 원래 세계관은 바뀌지 않는다
    assert 'summary' not in w2.apply_refine(built, {dagger: {'text': 'x'}})


class RefineFake(Fake):
    def _parse(self, **options):
        schema, text = options['text_format'], options['input']
        answers = {'Described': (w2.Described(body=[said('단검은 대장간에서 나온 것이다.', '단검은 대장간에서 나온 것이다')], cells=[cell(2, ('칼날이 빛난다.', '철수는 단검을 휘둘렀다'))])
                                 if '사물 · 단검' in text else w2.Described(body=[said('장터는 사람이 모이는 곳이다.', '장터에는 사람이 많았다')], cells=[])),
                   'Tightened': w2.Tightened(text='[행적] ' + 'x' * 100)}
        if schema.__name__ not in answers:
            return super()._parse(**options)
        self.calls.append(schema.__name__)
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=None)
        return SimpleNamespace(status='completed', usage=usage, model='m', output_parsed=answers[schema.__name__])


def refine_setup(tmp_path):
    records = [dict(r, work='w00') for r in EP_RECORDS]
    works = {'w00': {'episodes': [{'number': n, 'text': t} for n, t in EP_TEXTS.items()]}}
    merged = {'w00': {'links': [], 'stats': {}, 'failed': False, 'called': False, 'raw': None}}
    fake = RefineFake()
    llm = Llm(Ledger(tmp_path / 'calls.jsonl'), tmp_path / 'cache', model='m', client=fake)
    return records, works, merged, fake, llm


def test_refine_works_asks_once_per_card_batch_in_one_round_counts_the_kinds_and_a_second_run_calls_nothing(tmp_path):
    records, works, merged, fake, llm = refine_setup(tmp_path)
    got = w2.refine_works(works, records, merged, None, llm, SyncExecutor(llm))['w00']
    assert fake.calls == ['Described', 'Described'] and got['calls'] == {'card': 2} and got['failed'] == {'card': 0}
    ids = {c.title: c.id for c in w2.build_world2('w00', records, [], ' '.join(EP_TEXTS.values()))[0]['cards']}
    assert got['updates'][ids['단검']]['text'] == '단검은 대장간에서 나온 것이다.' and got['updates'][ids['장터']]['text'] == '장터는 사람이 모이는 곳이다.'
    assert got['updates'][ids['단검']]['episodes'] == {2: '칼날이 빛난다.'} and got['stats']['entity_cards'] == 2 and got['stats']['entity_cells'] == 1
    assert set(got['raw']) == {f"card:{ids['단검']}:0", f"card:{ids['장터']}:0"}
    again = w2.refine_works(works, records, merged, None, llm, SyncExecutor(llm))['w00']
    assert again == got and len(fake.calls) == 2                                                                        # 캐시: 다시 돌려도 호출 없음


def test_finish_with_a_refinement_writes_the_refined_world_the_refine_file_and_the_refine_stats(tmp_path):
    records, works, merged, fake, llm = refine_setup(tmp_path)
    steps = dict(stats={}, calls={'chars': 1, 'doc': 1, 'events': 1, 'rels': 1}, failed={'chars': False, 'doc': 0, 'events': False, 'rels': False})
    records = [dict(r, **steps) for r in records]
    refined = w2.refine_works(works, records, merged, None, llm, SyncExecutor(llm))
    plain_stats = w2.finish(works, records, merged, 'base', tmp_path / 'works', tmp_path / 'base_stats.json')
    per_work = w2.finish(works, records, merged, 'after', tmp_path / 'works', tmp_path / 'after_stats.json', None, refined)
    folder = tmp_path / 'works' / 'w00'
    after, base = load_world(folder / 'after.json'), load_world(folder / 'base.json')
    assert next(c for c in after['cards'] if c.title == '단검').text == '단검은 대장간에서 나온 것이다.' and next(c for c in base['cards'] if c.title == '단검').text == '단검'
    assert next(c for c in after['cards'] if c.title == '단검').episodes == {2: '칼날이 빛난다.'} and after['cell_quotes'] == {next(c.id for c in after['cards'] if c.title == '단검'): {'2': ['철수는 단검을 휘둘렀다']}}
    assert json.loads((folder / 'after' / 'refine.json').read_text())['calls'] == {'card': 2} and not (folder / 'base' / 'refine.json').exists()
    assert per_work['w00']['refine']['calls'] == {'card': 2} and 'refine' not in plain_stats['w00']
    assert per_work['w00']['calls_all'] == plain_stats['w00']['calls_all'] + 2 and per_work['w00']['relations'] == plain_stats['w00']['relations']      # 호출 수에 다듬기가 더해지고 관계는 그대로


def test_refine_from_reads_the_earlier_result_and_writes_a_new_name_without_asking_the_earlier_steps(tmp_path, monkeypatch):
    records, works, merged, fake, llm = refine_setup(tmp_path)
    steps = dict(stats={}, calls={'chars': 1, 'doc': 1, 'events': 1, 'rels': 1}, failed={'chars': False, 'doc': 0, 'events': False, 'rels': False})
    records = [dict(r, **steps) for r in records]
    w2.finish(works, records, merged, 'base', tmp_path / 'works', tmp_path / 'base_stats.json')
    monkeypatch.setattr(w2, 'KT', tmp_path)
    monkeypatch.setattr(w2, 'load_works', lambda ids: works)
    llm.cost = SimpleNamespace(spent=lambda: 0.0, record=lambda *args, **kwargs: None)
    monkeypatch.setattr(w2, 'setup', lambda *args: (llm, SyncExecutor(llm)))
    monkeypatch.setattr(w2, 'cost_report', lambda llm: None)
    w2.refine_from([], base='base', gen_model='m', gen_effort=None, name='after', limit_usd=1.0)
    assert fake.calls == ['Described', 'Described'] and (tmp_path / 'works' / 'w00' / 'after' / 'refine.json').exists()
    assert next(c for c in load_world(tmp_path / 'works' / 'w00' / 'after.json')['cards'] if c.title == '단검').text == '단검은 대장간에서 나온 것이다.'
    w2.refine_from([], base='base', gen_model='m', gen_effort=None, name='plain', limit_usd=1.0, refine=False)           # 호출 없이 같은 기록으로 기본 세계관만
    assert len(fake.calls) == 2 and next(c for c in load_world(tmp_path / 'works' / 'w00' / 'plain.json')['cards'] if c.title == '단검').text == '단검'
    with pytest.raises(SystemExit):
        w2.refine_from([], base='base', gen_model='m', gen_effort=None, name='base', limit_usd=1.0)                      # 앞 단계 결과를 덮어쓰지 않는다


def test_parse_routes_accepts_the_refine_kinds_and_limit_scales_their_budget():
    assert w2.parse_routes(['refine_card=gpt-6-luna@high', 'refine_summary=gpt-6-luna', 'refine_section=gpt-6.1-terra']) == {
        'refine_card': ('gpt-6-luna', 'high'), 'refine_summary': ('gpt-6-luna', None), 'refine_section': ('gpt-6.1-terra', None)}
    w2.FACTORS.clear()
    w2.FACTORS['refine_card'] = 3
    assert w2.limit('refine_card', w2.CARD_TOKENS) == 3 * w2.CARD_TOKENS and w2.limit('refine_summary', w2.SUMMARY_TOKENS) == w2.SUMMARY_TOKENS
    w2.FACTORS.clear()


def test_settle_replaces_a_merged_identity_only_when_the_verified_rewrite_is_not_shorter_than_the_current_one():
    built, _ = w2.build_world2('w00', CHI, [], CHI_TEXT)
    plan = w2.refine_plan(built, CHI, {}, tighten=True)
    card = next(c for c in built['cards'] if c.title == '치삼')
    long = w2.Introduced(sentences=[said('치삼(치삼이)은 마을에서 약을 파는 떠돌이 약장수다.', '치삼이 마을에서 약을 팔았다.')])
    short = w2.Introduced(sentences=[said('약장수다.', '치삼이 마을에서 약을 팔았다.')])
    updates, stats = w2.settle(built, plan, {('identity', card.id): long})
    assert updates[card.id] == {'text': '치삼(치삼이)은 마을에서 약을 파는 떠돌이 약장수다.'} and stats['identity_rewritten'] == 1 and stats['merged_cards'] == 1
    updates, stats = w2.settle(built, plan, {('identity', card.id): short})
    assert card.id not in updates and stats['identity_shorter'] == 1 and 'identity_rewritten' not in stats                 # 짧아지면 지금 것을 둔다
