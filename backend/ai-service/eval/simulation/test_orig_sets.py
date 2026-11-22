"""세트 생성(orig_sets): 정답 유출 검사, 편중 없는 뽑기, 위반 사실 주입, 후보 판단."""

import random

import orig_sets as os_


def test_leaked_ignores_spacing_and_quote_marks_and_short_text():
    assert os_.leaked('"가자, 어서."', '앞서 그가 말했다. 가자,어서. 라고')
    assert not os_.leaked('"가자, 어서."', '전혀 다른 글')
    assert not os_.leaked('"응."', '응. 그래')   # 너무 짧은 정답은 우연히 겹치므로 유출로 보지 않는다


def cand(i, work, speaker):
    return {'id': f'c{i:03d}', 'work': work, 'speaker': speaker}


def test_balanced_round_robin_over_works_then_speakers_and_deterministic():
    cands = [cand(i, 'a', 'x') for i in range(10)] + [cand(i + 10, 'a', 'y') for i in range(10)] + [cand(i + 20, 'b', 'z') for i in range(3)]
    got = os_.balanced(cands, 6, seed=1)
    assert [c['work'] for c in got].count('b') == 3   # 작품 b는 후보가 3개뿐이라 모두 남고 a에서 나머지를 뽑는다
    assert {c['speaker'] for c in got if c['work'] == 'a'} == {'x', 'y'}   # 한 인물에 몰리지 않는다
    assert got == os_.balanced(cands, 6, seed=1) and got != os_.balanced(cands, 6, seed=2)
    assert len(os_.balanced(cands, 100, seed=1)) == len(cands)   # 후보가 모자라면 있는 만큼


def test_balanced_caps_per_speaker():
    cands = [cand(i, 'a', 'x') for i in range(10)] + [cand(i + 10, 'a', 'y') for i in range(2)]
    got = os_.balanced(cands, 10, seed=1, speaker_cap=3)
    assert sorted(c['speaker'] for c in got) == ['x', 'x', 'x', 'y', 'y']


def test_inject_puts_fact_at_the_end_of_the_last_quote():
    assert os_.inject('"가자, 어서."', '기차를 탄다.') == '"가자, 어서. 기차를 탄다."'
    assert os_.inject('"가자." "싫어."', '기차를 탄다.') == '"가자." "싫어. 기차를 탄다."'


def test_pick_fact_skips_revealed_in_context_and_is_seeded():
    facts = [{'id': 'a', 'text': '해리가 기차를 탄다.'}, {'id': 'b', 'text': '론이 시험을 본다.'}, {'id': 'c', 'text': '론이 시험을 본다 그리고.'}]
    context = ['해리가 기차를 탄다. 라고 했다']
    got = os_.pick_fact(facts, context, random.Random(1))
    assert got['id'] in ('b', 'c')   # 직전 줄이 이미 드러낸 사실은 쓰지 않는다
    assert os_.pick_fact(facts[:1], context, random.Random(1)) is None


class FakeCorpus:
    def people(self, work):
        return [{'id': 'h', 'title': '해리', 'aliases': [], 'reveal': 1}, {'id': 'r', 'title': '론', 'aliases': [], 'reveal': 1}, {'id': 'n', 'title': '네빌', 'aliases': [], 'reveal': 5}]


def rec(n=3, base=2):
    rows = [('narration', '비가 오는 저녁의 호그와트 성은 조용했고 복도에는 아무도 없었다.', '', '', True), ('dialogue', '"안녕, 론. 오늘은 어디 갈 거야?"', '해리', '', False), ('dialogue', '"도서관에 가려고. 숙제가 많거든."', '론', '', False),
            ('dialogue', '"나도 같이 갈게. 너 혼자 두면 안 되겠다."', '해리', '', False), ('narration', '그들은 나란히 복도를 걸어 도서관 쪽으로 천천히 걸어갔다. 창밖에는 여전히 비가 내리고 있었다.', '', '', True),
            ('narration', '해리는 속으로 이 평화가 오래가지 않을 거라고 생각했다. 어쩐지 불안한 느낌이 가시지 않았다.', '', '해리', True), ('dialogue', '"여기야, 이쪽에 자리가 있어서 좋네."', '네빌', '', False),
            ('dialogue', '"응?"', '론', '', False)]
    turns = [{'i': i, 'kind': k, 'text': t, 'tag': '', 'par': i, 'whole': w, 'speaker': s, 'monologue': m, 'status': 'agreed'} for i, (k, t, s, m, w) in enumerate(rows)]
    return {'ep': {'id': 'w#3', 'work': 'w', 'n': n, 'base': base, 'text': ' '.join(t['text'] for t in turns)}, 'turns': turns}


def kinds_of(found):
    return {(c['t'], c['use']) for c in found}


def test_candidates_by_use_and_eligibility():
    found = os_.candidates(FakeCorpus(), rec(), names={'해리': 'h', '론': 'r', '네빌': 'n'})
    uses = kinds_of(found)
    assert (3, 'act') in uses and (2, 'act') not in uses     # 앞 줄이 3개 미만이면 자격이 없다
    assert (6, 'act') not in uses                            # 네빌은 기준 회차(2) 뒤(5)에 처음 나온 인물이라 대사 문항이 될 수 없다
    assert (6, 'direct') in uses and (7, 'direct') in uses   # 연출은 처음 나온 인물이어도 된다(카드가 있으면)
    assert (4, 'narrate') in uses and (5, 'monologue') in uses and (5, 'narrate') not in uses
    assert (7, 'act') not in uses                            # 8자 미만 대사
    gold = {c['t']: c['gold'] for c in found}
    assert gold[3] == '"나도 같이 갈게. 너 혼자 두면 안 되겠다."'


def test_candidates_need_a_previous_episode():
    assert os_.candidates(FakeCorpus(), rec(n=1, base=0), names={'해리': 'h'}) == []


class Corp(FakeCorpus):
    name = 'fake'

    def works(self):
        return {'w': {'id': 'w', 'kind': 'modern', 'title': '시험', 'author': '저자', 'license': '저작권 만료', 'source': 'x', 'person': 'third'}}

    def facts(self, work, person, ep):
        return [{'id': 'f1', 'episode': 9, 'kind': 'future', 'text': '먼 미래: 아주 먼 미래의 사건이 일어났다.', 'body': '아주 먼 미래의 사건이 일어났다.'}]


def long_rec(n):
    rows = []
    for k in range(24):
        if k % 8 == 3:
            rows.append(('narration', f'{n}화 {k}번째 지문이다. 비가 오는 저녁의 호그와트 성은 조용했고 복도에는 아무도 없었으며 촛불만 흔들렸다.', '', '', True))
        elif k % 8 == 5:
            rows.append(('narration', f'{n}화 {k}번째 속마음이다. 해리는 속으로 이 평화가 오래가지 않을 거라고 생각했다. 어쩐지 불안했다.', '', '해리', True))
        else:
            rows.append(('dialogue', f'"{n}화 {k}번째 대사입니다. 오늘은 어디로 갈 건지 말해 줘."', ['해리', '론'][k % 2], '', False))
    turns = [{'i': i, 'kind': k, 'text': t, 'tag': '', 'par': i, 'whole': w, 'speaker': s, 'monologue': m, 'status': 'agreed'} for i, (k, t, s, m, w) in enumerate(rows)]
    return {'ep': {'id': f'w#{n}', 'work': 'w', 'n': n, 'base': n - 1, 'text': '해리 론 ' + ' '.join(t['text'] for t in turns)}, 'turns': turns}


def test_build_items_sizes_labels_and_ids():
    sets, stats = os_.build_items(Corp(), [long_rec(2), long_rec(3)], {'act': 6, 'direct': 6, 'narrate': 4, 'monologue': 2, 'check_pass': 3, 'check_fail': 3}, seed=1)
    assert [len(sets[k]) for k in ('1', '2', '3n', '3m')] == [6, 6, 4, 2] and len(sets['4']) == 6
    assert sets['1'][0]['id'] == 'fake-1-0001' and sets['4'][-1]['id'] == 'fake-4-0006'
    assert [i['label'] for i in sets['4']] == ['pass'] * 3 + ['reject'] * 3
    reject = [i for i in sets['4'] if i['label'] == 'reject']
    assert all(i['inject']['text'] in i['gold'] and i['original'] in i['gold'] or i['inject']['text'] in i['gold'] for i in reject) and all(i['gold'] != i['original'] for i in reject)
    assert all(len(i['context']) >= 3 and i['source']['title'] == '시험' for s in sets.values() for i in s)
    assert {i['kind'] for i in sets['2']} == {'dialogue', 'narration', 'monologue'} and all(len(i['cast']) >= 2 for i in sets['2'])
    again, _ = os_.build_items(Corp(), [long_rec(2), long_rec(3)], {'act': 6, 'direct': 6, 'narrate': 4, 'monologue': 2, 'check_pass': 3, 'check_fail': 3}, seed=1)
    assert [i['id'] for i in again['1']] == [i['id'] for i in sets['1']] and [i['t'] for i in again['1']] == [i['t'] for i in sets['1']]   # 고정 시드
    assert stats['pool']['act'] > 0 and stats['dropped'] == {}


def test_monologue_shortfall_is_filled_by_narration():
    recs = [long_rec(2)]
    for t in recs[0]['turns']:
        t['monologue'] = ''   # 독백이 하나도 없다
    sets, _ = os_.build_items(Corp(), recs, {'act': 2, 'direct': 3, 'narrate': 3, 'monologue': 2, 'check_pass': 1, 'check_fail': 1}, seed=1)
    assert len(sets['3m']) == 0 and len(sets['3n']) == 5   # ③의 합계(3 + 2)를 지킨다


def test_review_md_lists_context_gold_and_check_label():
    sets, _ = os_.build_items(Corp(), [long_rec(2), long_rec(3)], {'act': 3, 'direct': 3, 'narrate': 2, 'monologue': 1, 'check_pass': 2, 'check_fail': 2}, seed=1)
    text = os_.review_md(sets['4'], 3, seed=1)
    assert text.count('\n## fake-4-') == 3 and '직전 줄:' in text and '[ ] 판별 맞음' in text
    assert '거절(주입 사실' in os_.review_md([i for i in sets['4'] if i['label'] == 'reject'], 1) and '통과(원작 그대로)' in os_.review_md([i for i in sets['4'] if i['label'] == 'pass'], 1)
