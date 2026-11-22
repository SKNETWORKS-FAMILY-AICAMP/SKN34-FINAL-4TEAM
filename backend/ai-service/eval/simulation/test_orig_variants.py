"""후보 입력 구성(orig_variants): 말투 예시(V1), 금지 목록 장면 관련분만(V2), 관계 장면 관련분만(V3). 입력만 바꾸는 순수 함수다."""

import orig_variants as ov
from app.simulation import prompt as prompt_text


class Corp:
    def people(self, work):
        return [{'id': 'h', 'title': '해리', 'aliases': ['해리 포터'], 'reveal': 1}, {'id': 'r', 'title': '론', 'aliases': [], 'reveal': 1}]

    def episodes(self):
        eps = [('w#1', 1, '"기차는 언제 떠나니?" 해리가 물었다. "곧 떠나." 론이 대답했다.\n"우린 늦었어, 서두르자." 해리가 외쳤다.\n비가 내리는 오후의 역은 사람들로 붐볐고 기차 소리가 길게 울렸다. 아이들은 짐을 끌며 달렸다.'),
               ('w#2', 2, '"저 편지는 누구에게 온 거야?" 론이 해리에게 물었다.\n"내가 먼저 말했잖아, 해리가 해야 해." 헤르미온느가 말했다.\n"그래, 알겠어. 내가 읽어 볼게." 해리가 대답했다.'),
               ('w#3', 3, '"미래의 대사다." 해리가 말했다.')]
        return [{'id': i, 'work': 'w', 'n': n, 'base': n - 1, 'text': t} for i, n, t in eps]


ITEM = {'work': 'w', 'base': 2, 'speaker': '해리', 'speaker_id': 'h', 'cast': ['해리', '론'], 'context': [{'by': '론', 'text': '"기차는 어디서 타니?"'}, {'by': '해리', 'text': '"역으로 가자."'}], 'gold': '"가자."'}


def test_voice_lines_only_the_speakers_tagged_lines_before_base_ranked_by_scene():
    lines = ov.voice_lines(Corp(), ITEM, k=5)
    assert lines == ['"기차는 언제 떠나니?"', '"우린 늦었어, 서두르자."', '"그래, 알겠어. 내가 읽어 볼게."']   # 해리가 한 대사만(론·헤르미온느의 대사와 3화(기준 회차 뒤)는 빠진다), 회차 순서
    assert ov.voice_lines(Corp(), ITEM, k=1) == ['"기차는 언제 떠나니?"']                                           # 장면(기차·역)과 비슷한 줄이 먼저 남는다
    assert ov.voice_lines(Corp(), {**ITEM, 'base': 0}, k=5) == []


def test_style_paragraphs_are_whole_narration_before_base():
    paras = ov.style_paragraphs(Corp(), ITEM, k=3)
    assert len(paras) == 1 and paras[0].startswith('비가 내리는 오후의 역')


def test_v1_act_adds_voice_doc_and_skips_when_too_few():
    asked, extra = ov.v1_act({'known': [{'ref': 'a', 'label': 'x', 'text': 't'}]}, {}, ITEM, Corp())
    assert asked['known'][-1]['ref'] == 'manuscript:voice' and asked['known'][-1]['text'].count('\n') == 2
    same, _ = ov.v1_act({'known': []}, {}, {**ITEM, 'base': 1}, Corp())   # 예시가 3줄 미만이면 입력을 그대로 둔다
    assert same == {'known': []}


def test_v1_narrate_sets_style_for_narration_and_voice_for_monologue():
    data, _ = ov.v1_narrate({'style': [], 'known': []}, {}, {**ITEM, 'kind': 'narration'}, Corp())
    assert data['style'][0]['title'].startswith('나레이터 문체 예시') and data['known'] == []
    data, _ = ov.v1_narrate({'style': [], 'known': []}, {}, {**ITEM, 'kind': 'monologue'}, Corp())
    assert data['known'][0]['ref'] == 'manuscript:voice' and data['style'] == []


def test_v3_keeps_same_pair_and_scene_relations_and_caps():
    known = [{'ref': 'card:h#identity', 'label': '정체', 'text': '해리 소개'}] + [{'ref': f'relation:{i}', 'label': '관계', 'text': t} for i, t in
             enumerate(['해리의 친구: 론 — 기차에서 만났다', '해리의 적: 말포이', '해리의 선생: 덤블도어 — 역으로 간다', '해리의 이모: 페투니아', '해리의 부모: 제임스'])] + [{'ref': 'manuscript:x', 'label': '조회', 'text': '발췌'}]
    asked, _ = ov.v3_relations({'known': known}, {}, ITEM, Corp(), cap=2)
    refs = [d['ref'] for d in asked['known']]
    assert refs == ['card:h#identity', 'relation:0', 'relation:2', 'manuscript:x']   # 관계 아닌 항목은 그대로, 관계는 같은 인물 쌍(론)·장면과 겹치는 순 2개


def test_v2_keeps_forbidden_docs_most_like_paragraph_and_scene():
    extra = {'forbidden': [{'ref': f'card:x#ep0{i}', 'label': '기억', 'text': t, 'owner': 'x'} for i, t in enumerate(['기차를 타고 떠난다', '전혀 다른 숲 이야기', '역에서 편지를 읽는다', '먼 바다의 일'])], 'voices': []}
    _, got = ov.v2_forbidden({}, extra, {**ITEM, 'gold': '"편지를 읽으러 역으로 가자."'}, Corp(), cap=2)
    assert [d['text'] for d in got['forbidden']] == ['기차를 타고 떠난다', '역에서 편지를 읽는다'] and got['voices'] == []   # 문단·직전 줄과 겹치는 순, 원래 순서



# --- 1단계 후보: 연출 입력 보강(V3-a)·한 질문 구성(V3-b)·지시문 주입 --------------------------------------------------------

import asyncio  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import orig_run as orr  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402
from langchain_typesafe import Choice  # noqa: E402

from app.simulation import agent, director  # noqa: E402
from app.simulation.models import SimulationPlan  # noqa: E402


def scene_from(*rows):
    """(종류, 이름, 글) 행 → 운영과 같은 Scene(인물 카드 id는 이름 그대로)."""
    lines = [{'kind': kind, 'by': by if kind == 'dialogue' else '나레이션', 'text': text, 'speaker': by if kind == 'dialogue' else ''} for kind, by, text in rows]
    return orr.scene_of(SimulationPlan(mode='flow', beats=[], characterIds=[]), lines, {})


NAMES = ['해리', '론', '헤르미온느', '네빌']


def test_turn_hints_recent_speakers_turns_since_and_name_called():
    scene = scene_from(('dialogue', '해리', '"론, 이거 좀 봐."'), ('dialogue', '론', '"뭔데?"'), ('narration', '', '헤르미온느가 책에서 고개를 들었다.'), ('dialogue', '헤르미온느', '"해리, 그거 어디서 났니?"'))
    hints = ov.turn_hints(scene, NAMES)
    assert hints['recentSpeakers'] == ['해리', '론', '헤르미온느']
    assert hints['turnsSinceSpoke'] == {'해리': 3, '론': 2, '헤르미온느': 0, '네빌': None}   # 마지막 발언 뒤 지난 턴 수(말한 적 없으면 None)
    assert hints['addressed'] == '해리'                                                       # 직전 대사에서 이름이 불린 인물


def test_turn_hints_question_without_a_name_goes_to_the_other_speaker():
    scene = scene_from(('dialogue', '해리', '"이건 뭐지?"'), ('dialogue', '론', '"글쎄, 어디서 났어?"'))
    assert ov.turn_hints(scene, NAMES)['addressed'] == '해리'                       # 이름 없는 질문: 그 앞에 말한 다른 인물
    statement = scene_from(('dialogue', '해리', '"이건 뭐지?"'), ('dialogue', '론', '"몰라."'))
    assert 'addressed' not in ov.turn_hints(statement, NAMES)                        # 평서문이고 이름도 없으면 청자를 짐작하지 않는다
    assert ov.turn_hints(scene_from(('narration', '', '비가 왔다.')), NAMES) == {'recentSpeakers': [], 'turnsSinceSpoke': {n: None for n in NAMES}}


def test_hinted_state_adds_hints_without_touching_the_rest():
    scene = scene_from(('dialogue', '해리', '"론, 이거 좀 봐."'))
    state = {'scene': [], 'mode': 'flow'}
    got = ov.d1_hints(state, scene, [{'id': 'h', 'name': '해리'}, {'id': 'r', 'name': '론'}], {})
    assert got['mode'] == 'flow' and got['hints']['addressed'] == '론' and set(got['hints']['turnsSinceSpoke']) == {'해리', '론'} and 'hints' not in state


class Answer:
    def __init__(self, choice):
        self.choice = choice


def run_single(allowed_questions, picked):
    seen = []

    async def real(state, questions):
        seen.append(questions)
        return {'next': Answer(picked), 'pov': Answer('omniscient')}

    asked = asyncio.run(ov.single_question(real)({'x': 1}, allowed_questions))
    return seen[0], asked


def questions(turns=('narration', 'monologue', 'speech')):
    return {'turn': Choice(instructions='무엇을', criteria={t: t for t in turns}), 'speaker': Choice(instructions='누가', criteria={'c1': '카엘', 'c2': '리나'}),
            'pov': Choice(instructions='시점', criteria={'omniscient': '전지'})}


def test_single_question_merges_turn_and_speaker_into_one_next_question_and_maps_the_answer_back():
    sent, back = run_single(questions(), 'c2')
    assert list(sent) == ['next', 'pov'] and list(sent['next'].criteria) == ['c1', 'c2', 'narration', 'monologue']   # 인물 칸 + 나레이션·독백 칸
    assert (back['turn'].choice, back['speaker'].choice, back['pov'].choice) == ('speech', 'c2', 'omniscient')
    _, narrated = run_single(questions(), 'narration')
    assert narrated['turn'].choice == 'narration' and narrated['speaker'].choice == 'c1'                               # 대사가 아니면 화자는 쓰이지 않는다(첫 인물)


def test_single_question_follows_the_allowed_turns_and_passes_forced_turns_through():
    sent, _ = run_single(questions(('monologue', 'speech')), 'monologue')
    assert list(sent['next'].criteria) == ['c1', 'c2', 'monologue']
    forced = {'speaker': questions()['speaker'], 'pov': questions()['pov']}   # 고를 턴이 하나뿐이면 turn 질문이 없다: 그대로 묻는다
    sent, back = run_single(forced, 'unused')
    assert sent is forced and set(back) == {'next', 'pov'}   # 합치지 않고 실제 응답을 그대로 돌려준다


def test_patched_swaps_the_instructions_for_the_run_and_restores_them():
    before = (agent.ACT_INSTRUCTIONS, agent.NARRATE_INSTRUCTIONS, director.DIRECTOR_INSTRUCTIONS, director._ask)
    with ov.patched('P1'):
        assert agent.ACT_INSTRUCTIONS == ov.ACT_V1 and agent.ACT_INSTRUCTIONS.startswith(before[0])   # 기존 지시문 뒤에 더한 새 버전
    with ov.patched('N1'):
        assert agent.NARRATE_INSTRUCTIONS == ov.NARRATE_V1
    with ov.patched('D2'):
        assert director._ask is not before[3]
    assert (agent.ACT_INSTRUCTIONS, agent.NARRATE_INSTRUCTIONS, director.DIRECTOR_INSTRUCTIONS, director._ask) == before
    with ov.patched(None):
        assert agent.ACT_INSTRUCTIONS == before[0]


ENV_OFF = ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'SIMULATION_REASONING_EFFORT', 'SIMULATION_ACT_BASE_URL', 'SIMULATION_ACT_API_KEY', 'SIMULATION_ACT_MODEL')   # 개발자 셸·.env의 값이 단위 테스트에 새지 않게 지운다


def fake_chat(seen):
    """agent.ChatOpenAI 대역: 만든 인자와 응답 형식·받은 메시지를 호출마다 seen에 쌓고 응답 형식의 값을 돌려준다(네트워크 없음)."""
    class Chat:
        def __init__(self, **options):
            self.options = options

        def with_structured_output(self, schema, **kwargs):
            def invoke(messages):
                seen.append({**self.options, 'schema': schema, 'messages': messages})
                fields = {'prose': '"응."', 'observed': '응', 'refusesBeat': False, 'refusalReason': None, 'checks': [], 'beatDone': False, 'sceneComplete': False}
                return {'raw': AIMessage('', response_metadata={'status': 'completed', 'model_name': 'm'}), 'parsed': schema.model_construct(**fields), 'parsing_error': None}
            return SimpleNamespace(invoke=invoke)
    return Chat


def test_patched_act_instructions_reach_the_model_request(monkeypatch):
    seen = []
    monkeypatch.setattr(agent, 'ChatOpenAI', fake_chat(seen))
    monkeypatch.setenv('OPENAI_API_KEY', 'k')
    monkeypatch.setenv('OPENAI_MODEL', 'm')
    for key in ENV_OFF:
        monkeypatch.delenv(key, raising=False)
    with ov.patched('P1'):
        agent.act({'self': {}})
    agent.act({'self': {}})
    assert seen[0]['messages'][0].content == ov.ACT_V1 and seen[1]['messages'][0].content == agent.ACT_INSTRUCTIONS != ov.ACT_V1   # 주입은 그 실행 안에서만이다


def test_soul_first_only_reorders_the_known_docs():
    known = [{'ref': 'card:h#identity', 'text': 'a'}, {'ref': 'relation:1', 'text': 'b'}, {'ref': 'card:h#soul', 'text': 'c'}, {'ref': 'card:h#goal', 'text': 'd'}]
    asked, extra = ov.soul_first({'known': known, 'scene': []}, {'x': 1}, ITEM, Corp())
    assert [d['ref'] for d in asked['known']] == ['card:h#soul', 'card:h#identity', 'relation:1', 'card:h#goal'] and asked['scene'] == [] and extra == {'x': 1}
    same, _ = ov.soul_first({'known': known[:2]}, {}, ITEM, Corp())
    assert [d['ref'] for d in same['known']] == ['card:h#identity', 'relation:1']   # SOUL이 없으면 그대로


def test_registry_names_cover_the_planned_candidates():
    assert {'D1', 'D2', 'D3', 'D4', 'D12', 'D13', 'D14', 'D123', 'D124', 'P1', 'P2', 'P3', 'N1', 'N2', 'E1', 'E2'} <= set(ov.VARIANTS)
    assert ov.VARIANTS['D1']['2'] is ov.d1_hints and ov.VARIANTS['D2']['wrap'][0][1] == '_ask' and ov.VARIANTS['P3']['1'] is ov.soul_first
    assert ov.DIRECTOR_V1 != ov.DIRECTOR_V2 and 'state.hints' in ov.DIRECTOR_V1 and ov.DIRECTOR_V1.startswith('당신은 한국어 웹소설 장면의 연출가입니다')



def test_act_only_effort_candidates_change_the_act_request_and_nothing_else(monkeypatch):
    seen = []
    chat = fake_chat(seen)
    monkeypatch.setattr(agent, 'ChatOpenAI', chat)
    monkeypatch.setenv('OPENAI_API_KEY', 'k')
    monkeypatch.setenv('OPENAI_MODEL', 'm')
    for key in ENV_OFF:
        monkeypatch.delenv(key, raising=False)
    data = {'self': {}, 'scene': [], 'known': [], 'checks': [], 'direction': {}}
    for name in (None, 'E1', 'E2'):
        seen.clear()
        with ov.patched(name):
            agent.act(data)
            agent.check(data)
        act, check = seen
        assert check['reasoning'] == {'effort': 'low'}      # 검사는 v2 기본값 그대로다
        assert act.get('reasoning') == {None: {'effort': 'low'}, 'E1': {'effort': 'medium'}, 'E2': None}[name]   # E2는 reasoning 인자 자체를 보내지 않는다(v1 요청)
        assert ('reasoning' in act) == (name != 'E2')
    assert agent.ChatOpenAI is chat   # 주입이 끝나면 원래 클래스로 돌아온다



def test_spec_of_merges_plus_joined_candidates_and_refuses_clashing_hooks():
    spec = ov.spec_of('E1+N2')
    assert [a for _, a, _ in spec['wrap']] == ['ChatOpenAI'] and [a for _, a, _ in spec['patch']] == ['NARRATE_INSTRUCTIONS']
    assert ov.spec_of('D1+P1')['2'] is ov.d1_hints and ov.spec_of(None) == {}
    import pytest
    with pytest.raises(ValueError):
        ov.spec_of('P2+P3')   # 같은 세트의 입력 후크가 둘이면 순서를 정할 수 없다


def test_patched_applies_every_part_of_a_combined_candidate_and_restores_all():
    before = (agent.NARRATE_INSTRUCTIONS, agent.ChatOpenAI, director.DIRECTOR_INSTRUCTIONS)
    with ov.patched('E1+N2+D3'):
        assert agent.NARRATE_INSTRUCTIONS == ov.NARRATE_V2 and agent.ChatOpenAI is not before[1] and director.DIRECTOR_INSTRUCTIONS == ov.DIRECTOR_V1
    assert (agent.NARRATE_INSTRUCTIONS, agent.ChatOpenAI, director.DIRECTOR_INSTRUCTIONS) == before



def test_n3_scopes_the_style_guidance_to_non_monologue_narration():
    assert 'N3' in ov.VARIANTS and ov.NARRATE_V3 != ov.NARRATE_V2 and ov.NARRATE_V3.startswith(prompt_text.NARRATE_INSTRUCTIONS)
    assert 'monologue가 아닐 때만' in ov.NARRATE_V3 and ov.NARRATE_EXTRA_3.count('문체 지침') == 1
    with ov.patched('N3'):
        assert agent.NARRATE_INSTRUCTIONS == ov.NARRATE_V3
    assert agent.NARRATE_INSTRUCTIONS == prompt_text.NARRATE_INSTRUCTIONS



def test_model_candidate_swaps_the_model_of_act_and_narrate_requests_only(monkeypatch):
    seen = []
    monkeypatch.setattr(agent, 'ChatOpenAI', fake_chat(seen))
    monkeypatch.setenv('OPENAI_API_KEY', 'k')
    monkeypatch.setenv('OPENAI_MODEL', 'luna')
    for key in ENV_OFF:
        monkeypatch.delenv(key, raising=False)
    data = {'self': {}, 'scene': [], 'known': [], 'checks': [], 'direction': {}}
    with ov.patched('M1'):
        agent.act(data)
        agent.narrate(data)
        agent.check(data)
        assert ov.MODEL_CALLS == {'act': ov.TERRA, 'narrate': ov.TERRA}   # 장부가 이 호출들을 terra 단가로 센다
    assert [s['model'] for s in seen] == [ov.TERRA, ov.TERRA, 'luna']      # 검사는 OPENAI_MODEL(luna) 그대로
    assert ov.MODEL_CALLS == {}
    seen.clear()
    with ov.patched('E1+M1'):   # 추론 강도와 모델 후보는 함께 끼울 수 있다
        agent.act(data)
    assert seen[0]['model'] == ov.TERRA and seen[0]['reasoning'] == {'effort': 'medium'}



def test_p1b_adds_a_beat_advancing_sentence_to_the_p1_paragraph_and_combines_with_n3():
    assert ov.ACT_V1B.startswith(ov.ACT_V1) and ov.ACT_BEAT in ov.ACT_V1B and 'currentBeat' in ov.ACT_BEAT and '되풀이' in ov.ACT_BEAT
    with ov.patched('P1b+N3'):
        assert ov.agent.ACT_INSTRUCTIONS == ov.ACT_V1B and ov.agent.NARRATE_INSTRUCTIONS == ov.NARRATE_V3
    assert ov.agent.ACT_INSTRUCTIONS == ov.prompt.ACT_INSTRUCTIONS   # 끼운 것은 되돌아온다
