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
    text = ' '.join(t['text'] for t in rec()['turns'])
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
