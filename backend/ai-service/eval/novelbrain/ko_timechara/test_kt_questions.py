"""질문 생성 단위 테스트: 유형별 선택 규칙·공개 형식의 채점 기준 문장·질문 검증·자동 점검. 합성 지식표만 쓴다(소설 원문 없음)."""

import random

from kt_questions import (QUOTA, assemble, audit, facts, main_characters, moment_passage, pick_specs, structured_question,
                          valid_question)


def person(name):
    return {'name': name, 'evidence': f'{name}가 있었다.'}


def event(number, index, who, seen=(), summary=None):
    return {'id': f'E{number}.{index}', 'episode': number, 'summary': summary or f'{number}화의 {index}번째 사건이 일어났다.',
            'evidence': f'{number}화 {index}번 근거 문장입니다.', 'participants': [person(n) for n in who], 'witnesses': [person(n) for n in seen]}


def knowledge():
    people = {1: ['철수', '영희'], 2: ['철수', '민수'], 3: ['영희', '민수'], 4: ['철수', '영희'], 5: ['철수', '민수'], 6: ['영희', '철수']}
    return [{'episode': n, 'events': [event(n, i, people[n], summary=f'{n}화의 사건 {i}: {"와 ".join(people[n])}가 만났다.') for i in (1, 2)],
             'learned': [{'event': 'E2.1', 'learner': '영희', 'episode': 3, 'evidence': 'x'}] if n == 3 else []} for n in range(1, 7)]


WORLD = {'character_id': {'철수': 'c1', '영희': 'c2', '민수': 'c3', '길동': 'c4'}}


def test_main_characters_need_three_appearance_episodes_and_a_world_card():
    k = knowledge()
    assert main_characters(k, WORLD, 8) == ['철수', '영희', '민수']                   # 등장 회차 많은 순, 길동은 지식표에 없다
    assert main_characters(k, {'character_id': {'철수': 'c1'}}, 8) == ['철수']        # 세계관 카드가 없는 인물은 질문 대상이 아니다
    assert main_characters(k, WORLD, 2) == ['철수', '영희']


def test_pick_specs_follow_each_types_rules_with_distinct_events_and_a_fixed_seed():
    k = knowledge()
    specs = pick_specs(k, ['철수', '영희', '민수'], {t: 3 for t in QUOTA}, random.Random(1))
    again = pick_specs(k, ['철수', '영희', '민수'], {t: 3 for t in QUOTA}, random.Random(1))
    assert specs == again and {s['type'] for s in specs} == {t for t, _ in QUOTA}
    events = {e['id']: e for r in k for e in r['events']}
    for s in specs:
        ev, p = events[s['event']], s['cutoff']
        present = {x['name'] for x in ev['participants'] + ev['witnesses']}
        if s['type'] == 'future':
            assert ev['episode'] > p and s['character'] in {x['name'] for x in ev['participants']}
        elif s['type'] == 'past-absence':
            assert ev['episode'] <= p and s['character'] not in present
        else:
            assert ev['episode'] <= p and s['character'] in present
    keys = [(s['type'], s['style'], s['event']) for s in specs]
    assert len(keys) == len(set(keys))                                           # 같은 유형에서 같은 사건을 두 번 쓰지 않는다


def test_absence_questions_skip_events_the_character_learned_about_by_the_cutoff():
    k = knowledge()      # 영희는 3화에 E2.1을 전해 들었다
    for seed in range(20):
        for s in pick_specs(k, ['영희'], {('past-absence', 'fact-structured'): 6}, random.Random(seed)):
            assert not (s['event'] == 'E2.1' and s['cutoff'] >= 3)


def test_structured_questions_follow_the_public_formats_and_facts_follow_the_public_strings():
    assert '솔직한 심정' in structured_question('future', '철수가 떠났다.') and '철수가 떠났다.' in structured_question('future', '철수가 떠났다.')
    assert '직접 보았나요' in structured_question('past-absence', '철수가 떠났다.')
    temporal, spatial = facts('future', '영희', 3, {'episode': 5, 'summary': '철수가 떠났다.', 'participants': [person('철수')]}, 'p')
    assert temporal.startswith('Future: At the end of episode 3, 영희 should (1) not be aware of') and '철수가 떠났다.' in temporal and spatial == '-'
    event = {'episode': 2, 'summary': '철수가 떠났다.', 'participants': [person('철수'), person('민수')]}
    temporal, spatial = facts('past-absence', '영희', 3, event, '본문 일부')
    assert temporal.startswith('Past: At the end of episode 3, 영희 can respond based on the moment but should not wrongly recall it.')
    assert 'Moment (position: episode 2, speakers: 철수, 민수): 본문 일부' in temporal
    assert spatial.startswith('Absence: At the end of episode 3, 영희 should not say that they were present when 철수가 떠났다.')
    assert facts('past-presence', '철수', 3, event, 'p')[1].startswith('Presence:') and facts('past-only', '철수', 3, event, 'p')[1] == '-'


def test_moment_passage_returns_the_lines_around_the_evidence_and_falls_back_to_the_evidence():
    text = '첫 줄이다.\n철수는  영희에게\t칼을 건넸다. 영희는 받았다.\n마지막 줄이다.'
    assert moment_passage(text, '철수는 영희에게 칼을 건넸다.', 600) == '철수는  영희에게\t칼을 건넸다. 영희는 받았다.'
    assert moment_passage(text, '본문에 없는 문장입니다.', 600) == '본문에 없는 문장입니다.'
    assert len(moment_passage('가' * 2000, '가' * 30, 600)) == 600


def test_valid_question_rejects_copied_evidence_bad_lengths_and_duplicates():
    evidence = '철수는 영희에게 오래된 칼을 건넸다.'
    assert valid_question('철수가 영희에게 무엇을 주었나요?', evidence, set()) is None
    assert valid_question('철수는 영희에게 오래된 칼을 건넸다. 왜 그랬나요?', evidence, set()) == 'copies_evidence'
    assert valid_question('짧다', evidence, set()) == 'bad_length'
    assert valid_question('가' * 200, evidence, set()) == 'bad_length'
    assert valid_question('철수가 영희에게 무엇을 주었나요?', evidence, {'철수가 영희에게 무엇을 주었나요?'}) == 'duplicate'


def row(**kw):
    base = {'data_type': 'past-presence', 'character': '철수', 'cutoff': 4, 'event_id': 'E1.1', 'event_episode': 1, 'question': '다음 장면을 직접 보았나요? 1화의 1번째 사건이 일어났다.'}
    return {**base, **kw}


def test_audit_rechecks_each_rule_from_the_final_row_and_knowledge():
    k = knowledge()
    assert audit(row(), k) == []
    assert audit(row(data_type='past-absence'), k) == ['absence_but_present']
    assert audit(row(character='민수'), k) == ['presence_but_absent']
    assert audit(row(data_type='future', cutoff=4), k) == ['future_not_after_cutoff']
    assert audit(row(data_type='past-absence', character='영희', event_id='E2.1', event_episode=2, cutoff=3), k) == ['absence_but_learned']
    assert audit(row(event_id='E9.9'), k) == ['unknown_event']


def test_assemble_builds_rows_with_public_style_facts_trims_to_quota_and_drops_invalid_freeform_questions():
    k = knowledge()
    texts = {n: f'{n}화 본문입니다.\n{n}화 1번 근거 문장입니다. 그리고 이어진다.\n끝.' for n in range(1, 7)}
    meta = {'id': 'w00', 'kind': 'web', 'genre': '무협'}
    specs = pick_specs(k, ['철수', '영희', '민수'], {('future', 'fact-freeform'): 4, ('past-presence', 'fact-structured'): 2}, random.Random(3))
    written = {i: (f'철수가 {i}번째로 어디로 갔는지 아시나요?' if i % 2 else '짧다') for i, s in enumerate(specs) if s['style'] == 'fact-freeform'}
    rows, drops = assemble(meta, k, texts, specs, written, {('future', 'fact-freeform'): 2, ('past-presence', 'fact-structured'): 2})
    assert [r['data_type'] for r in rows].count('future') == 2 and [r['data_type'] for r in rows].count('past-presence') == 2
    assert drops['bad_length'] >= 1 and all(audit(r, k) == [] for r in rows)
    structured = next(r for r in rows if r['data_type'] == 'past-presence')
    assert structured['question'].startswith('다음 장면을 직접 보았나요?') and structured['question_generation'] == 'fact-structured'
    assert structured['spatial_label'].startswith('Presence:') and 'Moment (position: episode' in structured['temporal_label']
    assert structured['id'].startswith('w00-') and structured['work'] == 'w00' and structured['genre'] == '무협'
    assert len({r['id'] for r in rows}) == len(rows)
