"""채점 보강(orig_judge): 말투 기준(voiceRef) 고르기·채점 응답 검증, 기존 생성의 재채점, 같은 문항 두 후보의 A/B 선택 판정. 모델은 대역이다."""

import json

import pytest

import orig_judge as oj
import orig_run as rn

LINES = [f'나는 {w} 이야기를 오래 기다렸어, 정말이야 {i}' for i, w in enumerate('기차 편지 마법 지팡이 빗자루 호수 성 숲 시험 열쇠 지도 거울'.split())]


class Many:
    """해리의 대사가 열두 줄(1화)과 기준 회차 뒤의 한 줄(9화)이 있는 작은 작품."""

    def people(self, work):
        return [{'id': 'h', 'title': '해리', 'aliases': [], 'reveal': 1}, {'id': 'r', 'title': '론', 'aliases': [], 'reveal': 1}]

    def episodes(self):
        first = '\n'.join(f'"{text}" 해리가 말했다.' for text in LINES)
        return [{'id': 'w#1', 'work': 'w', 'n': 1, 'base': 0, 'text': first}, {'id': 'w#9', 'work': 'w', 'n': 9, 'base': 8, 'text': '"미래에 한 해리의 대사다, 쓰면 안 된다." 해리가 말했다.'}]

    def facts(self, work, person, ep):
        return [{'id': 'f1', 'text': '해리가 열쇠를 찾았다'}, {'id': 'f2', 'text': '전혀 상관없는 사건'}]


ITEM = {'id': 'hp-1-0007', 'set': '1', 'kind': 'dialogue', 'work': 'w', 'workKind': 'hp', 'base': 5, 'n': 6, 'speaker': '해리', 'speaker_id': 'h', 'cast': ['해리', '론'],
        'context': [{'by': '론', 'kind': 'dialogue', 'text': '"직전 줄이야, 어디 갔었어?"'}], 'gold': '"정답은 그냥 집에 갔었다는 말이야."', 'source': {'kind': 'hp'}}


def test_voice_ref_is_a_seeded_chronological_sample_of_the_speakers_earlier_lines_without_the_evaluation_item():
    clash = [f'"{ITEM["gold"][1:-1]}" 해리가 말했다.', '"직전 줄이야, 어디 갔었어?" 해리가 말했다.', '"정답은 그냥 집에 갔었다는 말을 했어, 정말." 해리가 말했다.']   # 정답과 같음·직전 줄과 같음·정답과 크게 겹침
    corpus = Many()
    corpus.episodes = lambda e=Many.episodes(corpus): [{**e[0], 'text': e[0]['text'] + '\n' + '\n'.join(clash)}, e[1]]
    ref = oj.voice_ref(corpus, ITEM, k=20, minimum=1)
    assert sorted(ref) == sorted(f'"{t}"' for t in LINES)   # 1화의 해리 대사 열두 줄뿐: 충돌 세 줄과 9화(기준 회차 뒤)의 줄은 빠진다
    assert ref == [f'"{t}"' for t in LINES] and oj.voice_ref(corpus, ITEM, k=20, minimum=1) == ref   # 회차·줄 순서이고 다시 불러도 같다
    five = oj.voice_ref(Many(), ITEM, k=5)
    assert len(five) == 5 and five == oj.voice_ref(Many(), ITEM, k=5) and five == [t for t in ref if t in five]
    assert five != oj.voice_ref(Many(), {**ITEM, 'id': 'hp-1-0008'}, k=5)   # 문항 id가 시드라 문항마다 다른 줄이 뽑힌다(같은 문항은 늘 같다)
    assert oj.voice_ref(Many(), {**ITEM, 'base': 0}, k=5) == [] and oj.voice_ref(Many(), ITEM, k=5, minimum=13) == []   # 줄이 모자라면 비운다


class FakeLlm:
    def __init__(self, answer):
        self.answer, self.asked = answer, []

    def ask(self, kind, instructions, text, schema=None, max_output_tokens=0):
        self.asked.append((kind, instructions, json.loads(text), schema))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer(json.loads(text)) if callable(self.answer) else self.answer


def dialogue_record(**changes):
    return {'id': ITEM['id'], 'set': '1', 'kind': 'dialogue', 'work': 'w', 'workKind': 'hp', 'variant': 'P1', 'error': None, 'skipped': None, 'generated': '"열쇠를 찾았어."',
            'grade': {'voice': 4, 'intent': 2, 'leaked': []}, 'inChars': 5, 'usage': [{'name': 'act', 'ms': 1, 'failed': False, 'inputTokens': 9, 'outputTokens': 1}],
            'via': {'sut': 'openai', 'judge': 'ocx'}, **changes}


def test_a_regrade_rebuilds_the_judge_payload_from_the_stored_generation_and_keeps_the_rest_of_the_record():
    llm = FakeLlm(rn.DialogueGrade(voice=3, intent=5, leaked=['f1']))
    out = oj.regrade('1', dialogue_record(), ITEM, Many(), llm, via={'judgeModel': 'gpt-6.2-sol'})
    (kind, instructions, payload, schema), = llm.asked
    assert (kind, instructions, schema) == ('judge', rn.DIALOGUE_JUDGE, rn.DialogueGrade) and 'voiceRef' not in payload
    assert payload == {'character': '해리', 'scene': [{'by': '론', 'text': '"직전 줄이야, 어디 갔었어?"'}], 'gold': ITEM['gold'], 'generated': '"열쇠를 찾았어."',
                       'facts': [{'id': 'f1', 'text': '해리가 열쇠를 찾았다'}, {'id': 'f2', 'text': '전혀 상관없는 사건'}]}
    assert out['grade'] == {'voice': 3, 'intent': 5, 'leaked': ['f1']} and out['via'] == {'sut': 'openai', 'judge': 'ocx', 'judgeModel': 'gpt-6.2-sol'}
    assert {k: v for k, v in out.items() if k not in ('grade', 'via')} == {k: v for k, v in dialogue_record().items() if k not in ('grade', 'via')}   # 생성·토큰·지연은 그대로


def test_a_regrade_with_voice_ref_asks_the_ref_prompt_and_keeps_voice_and_intent_next_to_the_new_score():
    llm = FakeLlm(oj.DialogueGradeRef(voice=4, intent=3, leaked=[], voiceRef=2))
    out = oj.regrade('1', dialogue_record(), ITEM, Many(), llm, with_ref=True)
    (_, instructions, payload, schema), = llm.asked
    assert instructions == oj.DIALOGUE_JUDGE_REF and schema is oj.DialogueGradeRef and payload['voiceRef'] == oj.voice_ref(Many(), ITEM)
    assert out['grade'] == {'voice': 4, 'intent': 3, 'leaked': [], 'voiceRef': 2}
    assert rn.DIALOGUE_JUDGE in oj.DIALOGUE_JUDGE_REF and 'voiceRef' in oj.DIALOGUE_JUDGE_REF   # 기존 말투·의도·누설 기준에 말투 기준 한 항목을 더한 지시문이다
    none = oj.regrade('1', dialogue_record(), {**ITEM, 'base': 0}, Many(), FakeLlm(oj.DialogueGradeRef(voice=4, intent=3, leaked=[], voiceRef=0)), with_ref=True)
    assert none['grade'] == {'voice': 4, 'intent': 3, 'leaked': [], 'voiceRef': None}   # 말투 줄이 없으면 voiceRef는 점수 없음(0을 점수로 세지 않는다)


@pytest.mark.parametrize('answer', [oj.DialogueGradeRef(voice=4, intent=3, leaked=[], voiceRef=0), oj.DialogueGradeRef(voice=4, intent=3, leaked=[], voiceRef=6),
                                    oj.DialogueGradeRef(voice=4, intent=9, leaked=[], voiceRef=3), oj.DialogueGradeRef(voice=4, intent=3, leaked=['f9'], voiceRef=3)])
def test_a_ref_grade_that_does_not_fit_the_input_is_a_failed_grade_not_a_guess(answer):
    assert oj.parse_ref_grade(answer, ['f1'], has_ref=True) is None


def test_records_without_a_generation_pass_through_and_a_failed_or_invalid_judge_leaves_no_grade():
    for record in ({**dialogue_record(), 'error': 503, 'generated': None, 'grade': None}, {**dialogue_record(), 'skipped': 'leak', 'generated': None, 'grade': None}):
        llm = FakeLlm(rn.DialogueGrade(voice=3, intent=3, leaked=[]))
        assert oj.regrade('1', record, ITEM, Many(), llm) == record and llm.asked == []   # 호출하지 않는다
    for answer in (oj.LlmFailure('호출 실패'), rn.DialogueGrade(voice=9, intent=3, leaked=[])):
        assert oj.regrade('1', dialogue_record(), ITEM, Many(), FakeLlm(answer))['grade'] is None


def test_a_narration_regrade_uses_the_narration_judge_and_the_kinds_forbidden_facts():
    item = {**ITEM, 'id': 'hp-3m-0001', 'kind': 'monologue', 'set': '3m'}
    record = {**dialogue_record(id=item['id'], kind='monologue', generated='속으로 열쇠를 떠올렸다.'), 'grade': {'style': 2, 'info': 2, 'leaked': []}}
    llm = FakeLlm(rn.NarrationGrade(style=4, info=3, leaked=[]))
    out = oj.regrade('3m', record, item, Many(), llm)
    (_, instructions, payload, schema), = llm.asked
    assert (instructions, schema) == (rn.NARRATION_JUDGE, rn.NarrationGrade) and payload['kind'] == 'monologue' and payload['generated'] == '속으로 열쇠를 떠올렸다.'
    assert out['grade'] == {'style': 4, 'info': 3, 'leaked': []}


# ---- A/B 선택 ----

def test_the_pair_is_asked_in_both_orders_with_the_same_item_and_voice_lines():
    first, second = oj.pair_payloads(ITEM, ['"예시 하나"'], '후보 글', '기준 글')
    assert first['A'] == '후보 글' and first['B'] == '기준 글' and second['A'] == '기준 글' and second['B'] == '후보 글'
    assert {k: v for k, v in first.items() if k not in ('A', 'B')} == {k: v for k, v in second.items() if k not in ('A', 'B')} == {
        'character': '해리', 'scene': [{'by': '론', 'text': '"직전 줄이야, 어디 갔었어?"'}], 'gold': ITEM['gold'], 'voiceRef': ['"예시 하나"']}


@pytest.mark.parametrize('first, second, outcome', [('A', 'B', 1), ('B', 'A', -1), ('A', 'A', 0), ('B', 'B', 0), (None, 'B', None), ('A', None, None)])
def test_a_pair_has_a_winner_only_when_both_orders_agree_on_the_same_candidate(first, second, outcome):
    assert oj.decide(first, second) == outcome   # 순서 1은 A=후보, 순서 2는 A=기준이라 같은 후보를 고르면 (A, B)·(B, A)다


def test_judge_pair_asks_twice_and_a_failed_call_leaves_no_outcome():
    answers = iter(['A', 'B'])
    llm = FakeLlm(lambda payload: oj.PairChoice(winner=next(answers)))
    out = oj.judge_pair(llm, ITEM, [], '후보 글', '기준 글')
    assert out == {'answers': ['A', 'B'], 'outcome': 1} and [q[3] for q in llm.asked] == [oj.PairChoice] * 2 and llm.asked[0][1] == oj.PAIR_JUDGE
    broken = oj.judge_pair(FakeLlm(oj.LlmFailure('호출 실패')), ITEM, [], 'a', 'b')
    assert broken == {'answers': [None, None], 'outcome': None}


def test_the_tally_counts_candidate_wins_losses_and_position_ties_with_an_exact_test_on_the_decided_pairs():
    records = [{'answers': ['A', 'B'], 'outcome': 1}] * 8 + [{'answers': ['B', 'A'], 'outcome': -1}] * 2 + [{'answers': ['A', 'A'], 'outcome': 0}] * 3 + [{'answers': [None, 'A'], 'outcome': None}]
    got = oj.tally(records)
    assert (got['n'], got['failed'], got['wins'], got['losses'], got['ties']) == (13, 1, 8, 2, 3) and got['winRate'] == 0.8
    assert got['p'] == pytest.approx(0.109375) and got['aRate'] == pytest.approx((8 + 2 + 6 + 1) / 27)   # 승패 10쌍 중 8:2(양측 정확 p), A를 고른 비율(위치 편향 확인용)
    assert oj.tally([])['winRate'] is None



def test_a_grader_name_picks_the_runs_folder_and_the_judge_cache_so_one_folder_holds_one_graders_records(tmp_path):
    import sim_via
    assert oj.LUNA == sim_via.MODEL
    assert oj.grader_name() == 'gpt-6-luna' and oj.grader_name('gpt-6.2-sol') == 'gpt-6.2-sol' and oj.grader_name('gpt-6.2-sol', True) == 'gpt-6.2-sol+ref'
    assert oj.grader_name('gpt-6-luna', name='luna-retest') == 'luna-retest'
    assert oj.runs_folder(tmp_path, 'gpt-6-luna') == tmp_path / 'runs' and oj.runs_folder(tmp_path, 'gpt-6.2-sol+ref') == tmp_path / 'runs-gpt-6.2-sol+ref'   # 지금까지의 채점은 runs 그대로
    assert oj.judge_cache(tmp_path, 'gpt-6-luna') == tmp_path / 'cache-judge-ocx' and oj.judge_cache(tmp_path, 'luna-retest') == tmp_path / 'cache-judge-luna-retest'



def test_a_pair_is_judged_only_on_items_where_both_runs_have_a_usable_generation():
    cand = {'i0': {'generated': 'a0'}, 'i1': {'generated': 'a1', 'error': 503}, 'i2': {'generated': 'a2'}, 'i3': {'generated': None, 'skipped': 'leak'}, 'i4': {'generated': 'a4'}}
    base = {'i0': {'generated': 'b0'}, 'i1': {'generated': 'b1'}, 'i2': {'generated': ''}, 'i3': {'generated': 'b3'}}   # i4는 기준 기록이 아예 없다
    assert oj.shared_generations(cand, base) == {'i0': ('a0', 'b0')}
