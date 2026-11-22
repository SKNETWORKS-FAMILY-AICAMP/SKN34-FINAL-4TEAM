"""평가 원천(orig_corpus)의 순수 부분: 판별 후보 이름, 해리 포터 장 덩어리·머리줄, 금지 사실(정답표), 낱말 겹침."""

import orig_corpus as oc


def test_names_in_counts_title_and_aliases_and_caps():
    people = [{'id': 'h', 'title': '해리', 'aliases': ['해리 포터'], 'reveal': 1}, {'id': 'r', 'title': '론', 'aliases': [], 'reveal': 1},
              {'id': 'x', 'title': '드래곤', 'aliases': [], 'reveal': 1}, {'id': 'late', 'title': '루핀', 'aliases': [], 'reveal': 9}]
    text = '해리는 론을 보았다. 해리 포터가 웃었다. 루핀이 왔다.'
    assert oc.names_in(text, people, n=3) == {'해리': 'h', '론': 'r', '루핀': 'late'}   # 많이 나온 순(제목+별칭 횟수), 본문에 없는 인물은 빠진다
    assert list(oc.names_in(text, people, n=3)) == ['해리', '론', '루핀'] and oc.names_in(text, people, n=1) == {'해리': 'h'}
    assert oc.names_in(text, people, n=3, upto=3) == {'해리': 'h', '론': 'r'}   # 그 회차에 아직 공개되지 않은 카드(reveal > upto)는 후보가 아니다


INDEX = {'1': {'units': [{'chapters': [1], 'chars': 10}, {'chapters': [2, 3], 'chars': 20}]}, '2': {'units': [{'chapters': [1], 'chars': 5}]}}
ORDINALS = {'1-1': 1, '1-2': 2, '1-3': 3, '2-1': 4}


def test_hp_units_map_chapters_to_ordinals_and_bases():
    units = oc.hp_units(INDEX, ORDINALS)
    assert [(u['id'], u['file'], u['n'], u['base']) for u in units] == [('b1-01', 'b1-01.txt', 1, 0), ('b1-02-03', 'b1-02-03.txt', 3, 1), ('b2-01', 'b2-01.txt', 4, 3)]


def test_hp_strip_heading_removes_only_the_chapter_title_line():
    assert oc.hp_strip_heading('제 5장 다이애건 앨리\n\n\n그 다음날 아침이었다.') == '그 다음날 아침이었다.'
    assert oc.hp_strip_heading('그 다음날 아침이었다.\n제2장은 아니다') == '그 다음날 아침이었다.\n제2장은 아니다'


DATA = {'cards': [{'key': 'harry', 'cardType': 'character'}, {'key': 'ev-1', 'cardType': 'event', 'title': '아침', 'body': '부엉이가 난다.', 'revealFromEpisode': 1},
                  {'key': 'ev-2', 'cardType': 'event', 'title': '편지', 'body': '편지가 온다.', 'revealFromEpisode': 2}, {'key': 'ev-5', 'cardType': 'event', 'title': '기차', 'body': '기차를 탄다.', 'revealFromEpisode': 5},
                  {'key': 'ev-3', 'cardType': 'event', 'title': '숲', 'body': '숲에 간다.', 'revealFromEpisode': 3}],
        'relationships': [{'source': 'harry', 'target': 'ev-2', 'label': '참여', 'from': 2}, {'source': 'harry', 'target': 'ev-5', 'label': '참여', 'from': 5}]}


def test_hp_facts_future_and_not_witnessed_but_never_the_unit_itself():
    got = oc.hp_facts(DATA, 'harry', last=3, base=2)
    assert [(f['id'], f['kind']) for f in got] == [('ev-1', 'absent'), ('ev-5', 'future')]   # ev-2는 참여했고 ev-3은 이 회차 안의 사건이라 뺀다
    assert got[1]['text'] == '기차: 기차를 탄다.' and got[1]['episode'] == 5


KNOWLEDGE = [{'episode': 1, 'events': [{'id': 'E1.1', 'episode': 1, 'summary': '갑이 집을 떠났다.', 'participants': [{'name': '갑'}], 'witnesses': []}], 'learned': []},
             {'episode': 2, 'events': [{'id': 'E2.1', 'episode': 2, 'summary': '을이 편지를 썼다.', 'participants': [{'name': '을'}], 'witnesses': []}],
              'learned': [{'event': 'E1.1', 'learner': '병', 'episode': 2, 'evidence': 'x'}]},
             {'episode': 4, 'events': [{'id': 'E4.1', 'episode': 4, 'summary': '병이 죽었다.', 'participants': [{'name': '병'}], 'witnesses': []}], 'learned': []}]


def test_kt_facts_uses_knows_for_past_and_everything_after_for_future():
    assert [(f['id'], f['kind']) for f in oc.kt_facts(KNOWLEDGE, '병', last=3, base=2)] == [('E2.1', 'absent'), ('E4.1', 'future')]   # E1.1은 전해 들었다
    assert [(f['id'], f['kind']) for f in oc.kt_facts(KNOWLEDGE, '갑', last=3, base=2)] == [('E2.1', 'absent'), ('E4.1', 'future')]


def test_bigram_overlap_and_top_facts():
    assert oc.shared('기차를 탄다', '해리는 기차를 탔다') > oc.shared('숲에 간다', '해리는 기차를 탔다')
    facts = [{'id': 'a', 'text': '숲에 간다.'}, {'id': 'b', 'text': '기차를 탄다.'}, {'id': 'c', 'text': '전혀 다른 이야기.'}]
    assert [f['id'] for f in oc.top_facts('해리는 기차를 탔다', facts, 2)][0] == 'b'
    assert len(oc.top_facts('해리는 기차를 탔다', facts, 2)) == 2


def test_sample_units_even_per_book_and_skips_first_unit():
    eps = [{'id': f'b1-{i:02d}', 'base': i - 1} for i in range(1, 11)] + [{'id': f'b2-{i:02d}', 'base': 10 + i} for i in range(1, 5)]
    assert [e['id'] for e in oc.sample_units(eps, 3)] == ['b1-02', 'b1-05', 'b1-08', 'b2-01', 'b2-02', 'b2-03']   # 1권 첫 덩어리(기준 0)는 빠진다
    assert [e['id'] for e in oc.sample_units(eps[:3], 5)] == ['b1-02', 'b1-03']                                    # 후보가 모자라면 있는 만큼
