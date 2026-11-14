"""정답표(라벨) 단위 테스트: 근거 대조 검증·나중에 전해 들은 인물·지식표 조회. 합성 입력만 쓴다(소설 원문 없음)."""

from kt_label import (EpisodeLabel, Ev, Learn, LearnedLabel, Ref, appearances, build_knowledge, knows, learned_input, verify_episode,
                      verify_learned)

TEXT = ('철수는 영희에게 칼을 건넸다. 영희는 말없이 받았다.\n민수는 문 밖에서 그 모습을 지켜보았다. 아무도 민수를 보지 못했다.\n'
        '밤이 깊어 갔다. 철수는 먼 길을 떠났다.')


def ev(summary='철수가 영희에게 칼을 건넸다.', evidence='철수는 영희에게 칼을 건넸다.', participants=(), witnesses=()):
    return Ev(summary=summary, evidence=evidence, participants=[Ref(name=n, evidence=e) for n, e in participants],
              witnesses=[Ref(name=n, evidence=e) for n, e in witnesses])


def test_verify_episode_keeps_only_items_whose_evidence_is_literally_in_the_text():
    good = ev(participants=[('철수', '철수는 영희에게 칼을 건넸다.'), ('영희', '영희는 말없이 받았다.')],
              witnesses=[('민수', '민수는 문 밖에서 그 모습을 지켜보았다.')])
    fabricated_event = ev(evidence='철수는 영희에게 칼을 던졌다.', participants=[('철수', '철수는 영희에게 칼을 건넸다.')])
    bad_person = ev(summary='철수가 길을 떠났다.', evidence='철수는 먼 길을 떠났다.',
                    participants=[('철수', '철수는 먼 길을 떠났다.'), ('영희', '영희는 울면서 배웅했다.'), ('길동', '길동은 앞서 걸었다.')])
    events, stats = verify_episode(TEXT, EpisodeLabel(events=[good, fabricated_event, bad_person]), 3)
    assert [e['id'] for e in events] == ['E3.1', 'E3.2'] and events[0]['episode'] == 3
    assert [p['name'] for p in events[0]['participants']] == ['철수', '영희'] and [w['name'] for w in events[0]['witnesses']] == ['민수']
    assert [p['name'] for p in events[1]['participants']] == ['철수']             # 근거가 없는 영희·본문에 없는 길동은 그 인물만 버린다
    assert stats['events'] == 3 and stats['event_evidence'] == 1 and stats['ref_evidence'] == 1 and stats['bad_name'] == 1
    assert (stats['evidence_checked'], stats['evidence_ok']) == (8, 6)   # 사건 3(통과 2)+인물 5(통과 4): 버려진 사건의 인물과 본문에 없는 이름은 근거를 보지 않는다


def test_verify_episode_drops_events_without_a_verified_participant_and_dedupes_people():
    only_witness = ev(witnesses=[('민수', '민수는 문 밖에서 그 모습을 지켜보았다.')])
    twice = ev(participants=[('철수', '철수는 영희에게 칼을 건넸다.')], witnesses=[('철수', '철수는 영희에게 칼을 건넸다.')])
    one_char = ev(participants=[('철', '철수는 영희에게 칼을 건넸다.'), ('철수', '철수는 영희에게 칼을 건넸다.')])        # 한 글자 이름은 이름으로 쓰지 않는다
    events, stats = verify_episode(TEXT, EpisodeLabel(events=[only_witness, twice, one_char]), 1)
    assert len(events) == 2 and stats['no_participant'] == 1 and stats['bad_name'] == 1
    assert [p['name'] for p in events[1]['participants']] == ['철수']
    assert [p['name'] for p in events[0]['participants']] == ['철수'] and events[0]['witnesses'] == []   # 참여가 목격보다 앞선다


def test_verify_learned_needs_an_earlier_event_a_new_learner_and_literal_evidence():
    earlier = {'E1.1': {'id': 'E1.1', 'episode': 1, 'participants': [{'name': '철수'}], 'witnesses': [{'name': '민수'}]}}
    text = '영희는 철수가 칼을 건넸다는 이야기를 전해 들었다. 철수는 웃었다. 민수는 고개를 끄덕였다.'
    out = LearnedLabel(learned=[
        Learn(event='E1.1', learner='영희', evidence='영희는 철수가 칼을 건넸다는 이야기를 전해 들었다.'),
        Learn(event='E1.1', learner='철수', evidence='철수는 웃었다.'),                       # 이미 참여한 인물
        Learn(event='E1.1', learner='민수', evidence='민수는 고개를 끄덕였다.'),             # 이미 목격한 인물
        Learn(event='E9.9', learner='영희', evidence='영희는 철수가 칼을 건넸다는 이야기를 전해 들었다.'),   # 없는 사건
        Learn(event='E1.1', learner='영희', evidence='영희는 그 이야기를 듣고 울었다.')])       # 근거가 원문에 없음
    kept, stats = verify_learned(text, out, earlier, 2)
    assert kept == [{'event': 'E1.1', 'learner': '영희', 'episode': 2, 'evidence': '영희는 철수가 칼을 건넸다는 이야기를 전해 들었다.'}]
    assert stats['learned'] == 5 and stats['already_present'] == 2 and stats['unknown_event'] == 1 and stats['learn_evidence'] == 1
    same_episode = {'E2.1': {'id': 'E2.1', 'episode': 2, 'participants': [], 'witnesses': []}}
    assert verify_learned(text, LearnedLabel(learned=[Learn(event='E2.1', learner='영희', evidence='철수는 웃었다.')]), same_episode, 2)[0] == []


def test_learned_input_lists_earlier_events_then_the_episode_text():
    text = learned_input('이번 회차 본문', [{'id': 'E1.1', 'episode': 1, 'summary': '철수가 떠났다.'}])
    assert text.index('E1.1') < text.index('이번 회차 본문') and '철수가 떠났다.' in text and '1화' in text


def test_build_knowledge_canonicalizes_names_and_queries_presence_absence_and_learning():
    events = {1: [{'id': 'E1.1', 'episode': 1, 'summary': 's', 'evidence': 'e', 'participants': [{'name': '김철수', 'evidence': 'x'}],
                   'witnesses': [{'name': '민수', 'evidence': 'y'}]}],
              2: [{'id': 'E2.1', 'episode': 2, 'summary': 's2', 'evidence': 'e2', 'participants': [{'name': '철수', 'evidence': 'x'}],
                   'witnesses': []}]}
    learned = {2: [{'event': 'E1.1', 'learner': '영희', 'episode': 2, 'evidence': 'z'}]}
    knowledge = build_knowledge(events, learned, {'김철수': '철수', '철수': '철수'})
    assert [k['episode'] for k in knowledge] == [1, 2]
    assert knowledge[0]['events'][0]['participants'][0]['name'] == '철수'
    assert appearances(knowledge) == {'철수': [1, 2], '민수': [1]}
    event = knowledge[0]['events'][0]
    assert knows(knowledge, '철수', event, 1) and knows(knowledge, '민수', event, 1)   # 참여·목격은 곧바로
    assert not knows(knowledge, '영희', event, 1) and knows(knowledge, '영희', event, 2)   # 전해 들은 회차부터
    assert not knows(knowledge, '길동', event, 5)
