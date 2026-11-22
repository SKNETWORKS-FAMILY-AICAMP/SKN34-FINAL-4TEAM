"""후보 입력 구성(평가 전용): 서비스가 만든 입력(asked·extra)에서 무엇을 넣고 빼는지만 바꿔 같은 문항으로 기준선(A)과 짝 비교한다. 서비스 코드는 그대로다.

V1 말투 예시: 기준 회차 이전 원문에서 그 인물이 한 대사(꼬리표에 이름이 먼저 나오는 줄) 5~8줄을 known에, ③ 나레이션은 앞 회차 지문 몇 문단을 문체 예시(style)에 넣는다. 지금 장면과 겹침이 큰 줄이 먼저다.
V2 금지 목록 장면 관련분만(#646): 검사 입력의 forbidden에서 검사할 문단·직전 줄과 겹침이 큰 항목 상위 N개만 남긴다.
V3 관계 장면 관련분만(#646): known의 관계 줄에서 장면 인물과 이어진 관계(같은 쌍)·직전 줄과 겹침이 큰 관계 상위 N개만 남긴다. V4 = V2 + V3. V5 = V3의 상한을 48로(①만).
후크는 act 계열(①·④) (asked, extra, item, corpus) → (asked, extra), narrate 계열(③) (data, extra, item, corpus) → (data, extra), 연출(②) (state, scene, cast, item) → state다.

1단계(품질 끌어올리기) 후보: 연출 D1(입력 보강: 최근 화자 순서·직전 대사의 청자·인물별 마지막 발언 뒤 턴 수)·D2(질문을 「다음에 말할 인물」 한 칸으로)·D3·D4(새 지시문 둘)와 조합,
act 지시문 P1·소울 먼저 P2·둘 다 P3, narrate 지시문 N1·N2·N3(N2를 독백 아닌 지문에만), act만 추론 강도 medium E1·reasoning 미지정(v1 요청) E2, act·narrate만 gpt-6.1-terra로 M1(`P1+M1`처럼 지시문 후보와 이어 쓴다). 지시문 후보는 코드 시드를 바꾸지 않고 이 프로세스의 agent·director 모듈 속성만 `patched`로 바꿔 잰다(Langfuse 새 버전 등록은 따로).
"""

from orig_common import SEED  # noqa: F401,I001  경로 설정이 import보다 먼저여야 한다

from contextlib import contextmanager
from types import SimpleNamespace

from langchain_typesafe import Choice

import orig_turns
from app.simulation import agent, director, prompt
from app.simulation.models import Action, Narration
from orig_corpus import _bigrams

VOICE_LINES, VOICE_MIN, VOICE_LEN = 8, 3, (8, 200)   # 말투 예시 줄 수·최소 줄 수·한 줄의 글자 수
STYLE_PARAGRAPHS, STYLE_LEN = 4, (40, 400)
RELATIONS, FORBIDDEN = 24, 20   # 장면 관련분만 남길 때의 상한


def _episodes(corpus) -> list:
    """(회차, 규칙으로 자른 턴) 목록. 말투 예시 후보를 찾느라 한 번만 자른다."""
    if getattr(corpus, '_turn_cache', None) is None:
        corpus._turn_cache = [(ep, orig_turns.split_turns(ep['text'])) for ep in corpus.episodes()]
    return corpus._turn_cache


def _scene(item: dict) -> str:
    return ' '.join(line['text'] for line in item['context'])


def _speaks(tag: str, mine: set[str], rest: list[str]) -> bool:
    """꼬리표에서 가장 먼저 나오는 장면 인물 이름이 그 인물이면 그 인물의 대사로 본다(규칙, 모델 판별 없음)."""
    where = {n: tag.find(n) for n in {*mine, *rest} if n and tag.find(n) >= 0}
    return bool(where) and min(where, key=where.get) in mine


def voice_lines(corpus, item: dict, k: int = VOICE_LINES) -> list[str]:
    """기준 회차 이전 원문에서 그 인물이 한 대사 k줄(지금 장면과 겹침이 큰 순으로 고른 뒤 회차 순서로)."""
    me = next((p for p in corpus.people(item['work']) if p['id'] == item['speaker_id']), None)
    if me is None:
        return []
    mine = {me['title'], *(a for a in me.get('aliases', []) if len(a) >= 2)}
    rest, scene, found = [n for n in item['cast'] if n != item['speaker']], _bigrams(_scene(item)), []
    for ep, turns in _episodes(corpus):
        if ep['work'] != item['work'] or ep['n'] > item['base']:
            continue
        for t in turns:
            size = len(t['text'])
            if t['kind'] == 'dialogue' and t['tag'] and VOICE_LEN[0] <= size <= VOICE_LEN[1] and _speaks(t['tag'], mine, rest):
                found.append((len(_bigrams(t['text']) & scene), ep['n'], t['i'], t['text']))
    best = sorted(found, reverse=True)[:k]
    return [text for _, _, _, text in sorted(best, key=lambda f: (f[1], f[2]))]


def style_paragraphs(corpus, item: dict, k: int = STYLE_PARAGRAPHS) -> list[str]:
    """기준 회차 이전 같은 작품의 지문(문단 전체) k개: 지금 장면과 겹침이 큰 순으로 고른 뒤 회차 순서로."""
    scene, found = _bigrams(_scene(item)), []
    for ep, turns in _episodes(corpus):
        if ep['work'] == item['work'] and ep['n'] <= item['base']:
            found += [(len(_bigrams(t['text']) & scene), ep['n'], t['i'], t['text']) for t in turns
                      if t['kind'] == 'narration' and t.get('whole') and STYLE_LEN[0] <= len(t['text']) <= STYLE_LEN[1]]
    return [text for _, _, _, text in sorted(sorted(found, reverse=True)[:k], key=lambda f: (f[1], f[2]))]


def _voice_doc(lines: list[str]) -> dict:
    return {'ref': 'manuscript:voice', 'label': '말투 예시(앞 회차 원문에서 이 인물이 한 대사)', 'text': '\n'.join(lines)}


def v1_act(asked: dict, extra: dict, item: dict, corpus, k: int = VOICE_LINES) -> tuple[dict, dict]:
    """① 입력의 known 끝에 말투 예시를 더한다(예시가 VOICE_MIN줄 미만이면 그대로)."""
    lines = voice_lines(corpus, item, k)
    return ({**asked, 'known': [*asked['known'], _voice_doc(lines)]} if len(lines) >= VOICE_MIN else asked), extra


def v1_narrate(data: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    """③ 독백은 그 인물의 말투 예시를 known에, 나레이션은 앞 회차 지문을 나레이터 문체 지침(style)에 더한다."""
    if item['kind'] == 'monologue':
        lines = voice_lines(corpus, item)
        return ({**data, 'known': [*data['known'], _voice_doc(lines)]} if len(lines) >= VOICE_MIN else data), extra
    paragraphs = style_paragraphs(corpus, item)
    doc = {'ref': 'manuscript:style', 'title': '나레이터 문체 예시(앞 회차 원문)', 'text': '\n\n'.join(paragraphs)}
    return ({**data, 'style': [*data.get('style', []), doc]} if paragraphs else data), extra


def v3_relations(asked: dict, extra: dict, item: dict, corpus, cap: int = RELATIONS) -> tuple[dict, dict]:
    """known의 관계 줄을 cap개로: 장면 인물과 이어진 관계(같은 쌍)가 먼저, 그다음 직전 줄과 겹침이 큰 순. 관계 아닌 항목은 그대로 둔다."""
    relations = [d for d in asked['known'] if d['ref'].startswith('relation:')]
    if len(relations) <= cap:
        return asked, extra
    others, scene = [n for n in item['cast'] if n != item['speaker']], _bigrams(_scene(item))
    keep = {d['ref'] for d in sorted(relations, key=lambda d: (any(n in d['text'] for n in others), len(_bigrams(d['text']) & scene)), reverse=True)[:cap]}
    return {**asked, 'known': [d for d in asked['known'] if not d['ref'].startswith('relation:') or d['ref'] in keep]}, extra


def v2_forbidden(asked: dict, extra: dict, item: dict, corpus, cap: int = FORBIDDEN) -> tuple[dict, dict]:
    """검사 입력의 forbidden을 cap개로: 검사할 문단(gold)·직전 줄과 겹침이 큰 항목(원래 순서 유지)."""
    docs = extra.get('forbidden', [])
    if len(docs) <= cap:
        return asked, extra
    query = _bigrams(item['gold'] + ' ' + _scene(item))
    keep = sorted(sorted(range(len(docs)), key=lambda i: -len(_bigrams(docs[i]['text']) & query))[:cap])
    return asked, {**extra, 'forbidden': [docs[i] for i in keep]}


def v4_check(asked: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    return v2_forbidden(*v3_relations(asked, extra, item, corpus), item, corpus)


def soul_first(asked: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    """① 입력의 known에서 말투(SOUL) 문서를 맨 앞으로 옮긴다(P2): 내용은 그대로이고 순서만 바뀐다."""
    soul = [d for d in asked['known'] if d['ref'].endswith('#soul')]
    return {**asked, 'known': [*soul, *(d for d in asked['known'] if d not in soul)]}, extra


def turn_hints(scene, names: list[str]) -> dict:
    """연출이 다음 턴을 고르는 데 쓰는 파생 정보(규칙, 모델 호출 없음): 최근 대사 화자 순서, 인물별 마지막 발언 뒤 지난 턴 수(말한 적 없으면 None),
    직전 대사가 이름을 부른 인물(없고 직전 대사가 질문이면 그 앞에 말한 다른 인물). 청자를 확신할 수 없으면 addressed를 두지 않는다."""
    turns = scene.result.turns
    said = [(k, t) for k, t in enumerate(turns) if t.kind == 'character' and t.characterName in names]
    hints = {'recentSpeakers': [t.characterName for _, t in said][-6:],
             'turnsSinceSpoke': {n: next((len(turns) - 1 - k for k, t in reversed(said) if t.characterName == n), None) for n in names}}
    if said:
        k, last = said[-1]
        text = scene.trail[k].observed
        called = sorted((text.index(n), n) for n in names if n != last.characterName and n in text)
        if called:
            hints['addressed'] = called[0][1]
        elif '?' in text:
            other = next((t.characterName for _, t in reversed(said[:-1]) if t.characterName != last.characterName), None)
            if other:
                hints['addressed'] = other
    return hints


def d1_hints(state: dict, scene, cast: list[dict], item: dict) -> dict:
    """② 연출 상태에 hints를 더한다(D1). 나머지 값은 그대로다."""
    return {**state, 'hints': turn_hints(scene, [c['name'] for c in cast])}


NEXT_QUESTION = '다음에 말할 인물은 누구입니까? 인물이 말하지 않고 지문이 필요하면 나레이션을, 시점 인물의 속마음이 필요하면 독백을 고르세요.'


def single_question(real_ask):
    """연출 질문을 「다음에 말할 인물」 한 칸으로 합친다(D2): 선택지는 허용된 인물(말한다)·나레이션·독백이고 시점은 따로 묻는다.
    director.decide가 읽는 turn·speaker 답을 이 한 답에서 만들어 돌려준다(대사가 아니면 화자는 쓰이지 않아 첫 인물로 채운다). 고를 턴이 하나뿐이면 합칠 것이 없어 그대로 묻는다."""
    async def ask(state: dict, questions: dict) -> dict:
        if 'turn' not in questions:
            return await real_ask(state, questions)
        names, turns = questions['speaker'].criteria, questions['turn'].criteria
        criteria = {**({alias: f'{name}이(가) 다음에 말한다' for alias, name in names.items()} if 'speech' in turns else {}),
                    **{t: prompt.TURN_CHOICES[t] for t in ('narration', 'monologue') if t in turns}}
        got = await real_ask(state, {'next': Choice(instructions=NEXT_QUESTION, criteria=criteria), 'pov': questions['pov']})
        pick = got['next'].choice
        return {'turn': SimpleNamespace(choice='speech' if pick in names else pick), 'speaker': SimpleNamespace(choice=pick if pick in names else next(iter(names))), 'pov': got['pov']}
    return ask


ACT_EXTRA = (
    '말투 지침: 대사는 known의 말투(SOUL)에 적힌 어미·어휘·호칭·말버릇을 그대로 드러내세요. 어느 인물이나 할 법한 매끈하고 설명적인 공손체로 흐르지 말고 입말(끊기는 말, 되묻기, 감탄, 생략)을 살리세요. '
    '대사는 scene의 가장 최근 줄에 곧바로 이어지는 반응이어야 하고(질문에는 답, 요청에는 응답, 감정에는 감정) 길이와 호흡은 scene에서 이 인물이나 다른 인물이 한 말과 비슷하게 한두 문장으로 짧게 쓰세요. '
    '대사 밖의 행동 묘사는 한 문장 이내로 줄이세요.')
NARRATE_EXTRA = (
    '문체 지침: scene에서 by가 「나레이션」인 줄과 style 지침이 있으면 그 문체를 따르세요. 평서문 과거형(-다)으로, 한 문단은 직전 지문과 비슷한 길이(대개 1~3문장)로 쓰고, '
    '추상적인 분위기 표현(「무거운 침묵이 내려앉았다」「기운이 감돌았다」 같은 상투구) 대신 보이고 들리는 구체적 사물·동작·소리·위치를 한두 개 짚으세요. 문장은 짧고 담백하게, 수식어는 줄이세요.')
NARRATE_EXTRA_2 = (
    NARRATE_EXTRA + ' scene의 맨 끝 줄이 대사였다면 그 말에 곁들일 표정·몸짓·시선·목소리, 듣는 인물의 반응처럼 대사로 옮기기 어려운 움직임을 짚는 데 쓰고, 맨 끝 줄이 지문이었다면 장면의 다음 움직임이나 주변의 변화를 보태세요.')
NARRATE_EXTRA_3 = NARRATE_EXTRA_2.replace('문체 지침:', '지문(purpose가 monologue가 아닐 때만 적용)의 문체 지침:', 1)   # 독백에는 걸리지 않게 범위를 좁힌 N2
ACT_V1 = prompt.ACT_INSTRUCTIONS + ' ' + ACT_EXTRA
NARRATE_V1 = prompt.NARRATE_INSTRUCTIONS + ' ' + NARRATE_EXTRA
NARRATE_V2 = prompt.NARRATE_INSTRUCTIONS + ' ' + NARRATE_EXTRA_2
NARRATE_V3 = prompt.NARRATE_INSTRUCTIONS + ' ' + NARRATE_EXTRA_3
_DIRECTOR_HEAD = (
    '당신은 한국어 웹소설 장면의 연출가입니다. 입력 JSON의 state는 지금까지의 장면입니다. ' + prompt.SAFETY + ' '
    '다음 한 턴을 정하세요: turn(이번 턴을 나레이션·독백·인물 대사·마무리 중 무엇으로 쓸지), speaker(대사를 할 인물), pov(서술 시점: 전지적, 인물의 3인칭 제한, 인물의 1인칭). '
    'state.turn이 있으면 그 턴으로 정해져 있으니 speaker와 pov만 고르세요. 인물은 state.cast의 alias로만 고릅니다. state.cast는 등장을 허용한 범위이며 모두 등장할 필요는 없으니 장면에 필요한 인물만 고르세요. '
    '다음 순서로 판단하세요. '
    '1) 직전 대사가 누군가에게 묻거나 부르거나 요청했다면(state.hints.addressed가 있으면 그 인물) 그 인물이 다음에 말하게 하세요(speech). 현재 비트(state.currentBeat)가 특정 인물의 말이나 결정을 요구하면 그 인물도 우선합니다. '
    '2) 방금 말한 인물이 곧바로 이어 말하는 일은 드뭅니다. 같은 인물을 연달아 고르지 말고 그 말을 들은 인물이나 오래 말하지 않은 인물(state.hints.turnsSinceSpoke가 큰 인물)을 고르세요. ')
_DIRECTOR_TAIL = (
    '5) 독백은 시점 인물이 있는 시점(3인칭 제한·1인칭)에서만 고르고 나레이션·독백을 연달아 두 번 이상 고르지 마세요. '
    '6) 시점은 직전 시점(state.lastPov)을 유지하는 것이 기본이며, 비트가 바뀌어 장면의 중심 인물이 바뀔 때만 바꾸세요.')
DIRECTOR_V1 = (_DIRECTOR_HEAD + '3) 나레이션은 장소·시간·분위기가 바뀔 때나 대사로 드러나지 않는 인물의 행동·반응을 짚어야 할 때만 고르고 이미 나온 내용을 되풀이하지 마세요. '
               '4) 현재 비트가 인물이 말하거나 결정하거나 행동하는 내용이면 나레이션으로 요약하지 말고 그 인물이 직접 말하게 하세요. ' + _DIRECTOR_TAIL)
DIRECTOR_V2 = (_DIRECTOR_HEAD + '3) 대사 한 줄이 끝나면 그 말에 곁들일 표정·몸짓·시선·목소리, 듣는 인물의 반응처럼 대사로 옮기기 어려운 움직임이 있을 때 나레이션(짧은 반응 지문)이 자연스럽고 장소·시간·분위기가 바뀔 때도 나레이션을 고릅니다. '
               '지문 뒤에는 대사로 넘어가는 것이 자연스럽습니다. 이미 나온 내용을 되풀이하거나 인물이 할 말을 지문으로 대신하지는 마세요. '
               '4) 현재 비트가 인물이 말하거나 결정하거나 행동하는 내용이면 나레이션으로 요약하지 말고 그 인물이 직접 말하게 하세요. ' + _DIRECTOR_TAIL)


def _edit_requests(edit):
    """agent.OpenAI 장식자: responses.parse 인자를 edit(kwargs) -> kwargs로 고친다(평가 전용, 요청 모양만 바꾸고 응답은 그대로 돌려준다)."""
    def wrap(real_openai):
        class Client:
            def __init__(self, **options):
                self._client = real_openai(**options)

            def __enter__(self):
                self._client.__enter__()
                return self

            def __exit__(self, *exc):
                return self._client.__exit__(*exc)

            @property
            def responses(self):
                real = self._client.responses
                return SimpleNamespace(parse=lambda **kwargs: real.parse(**edit(kwargs)))
        return Client
    return wrap


def act_reasoning(effort: str | None):
    """act 호출만 reasoning.effort를 바꾼다(E1: 값, E2: None = reasoning 인자를 보내지 않음, v1 요청). 응답 형식이 Action인 요청의 reasoning만 고치고 계획·나레이션·검사는 그대로 둔다."""
    def edit(kwargs):
        if kwargs.get('text_format') is not Action:
            return kwargs
        return {k: v for k, v in kwargs.items() if k != 'reasoning'} | ({'reasoning': {'effort': effort}} if effort else {})
    return _edit_requests(edit)


TERRA = 'gpt-6.1-terra'
RATES = {TERRA: (1.00, 0.05, 5.00)}   # 입력·캐시 입력·출력, 달러/100만 토큰(제3자 출처, 공식 단가를 확인하면 정정한다)
MODEL_CALLS: dict[str, str] = {}      # patched가 채운다: 모델 호출 이름 → 모델(장부가 그 모델 단가로 센다)


def model_for(model: str):
    """act·나레이션(응답 형식 Action·Narration) 요청의 모델만 바꾼다(M1). 연출(Decisions)·검사·계획은 OPENAI_MODEL 그대로다."""
    return _edit_requests(lambda kwargs: {**kwargs, 'model': model} if kwargs.get('text_format') in (Action, Narration) else kwargs)


def _director(hints=False, single=False, text=None) -> dict:
    return {**({'2': d1_hints} if hints else {}), **({'wrap': ((director, '_ask', single_question),)} if single else {}), **({'patch': ((director, 'DIRECTOR_INSTRUCTIONS', text),)} if text else {})}


def spec_of(name: str | None) -> dict:
    """후보 이름 → 명세. 'E1+N2'처럼 +로 이으면 지시문(patch)·감싸기(wrap)는 이어 붙이고, 같은 세트의 입력 후크가 겹치면 ValueError다. None이면 빈 명세(기준선)."""
    merged: dict = {}
    for part in (name or '').split('+'):
        for key, value in (VARIANTS[part].items() if part else ()):
            if key in ('patch', 'wrap', 'models'):
                merged[key] = (*merged.get(key, ()), *value)
            elif key in merged:
                raise ValueError(f'후보 {name}의 {key} 후크가 겹친다')
            else:
                merged[key] = value
    return merged


@contextmanager
def patched(name: str | None):
    """후보의 지시문·연출 질문 구성·요청 인자를 이 프로세스에만 끼운다(평가 전용: 코드 시드와 Langfuse 프롬프트는 그대로). 끝나면 되돌린다. name이 None이면 아무것도 하지 않고 +로 이으면 모두 끼운다."""
    spec, saved = spec_of(name), []

    def swap(module, attr, value):
        saved.append((module, attr, getattr(module, attr)))
        setattr(module, attr, value)

    for module, attr, value in spec.get('patch', ()):      # 값을 바꾼다(지시문)
        swap(module, attr, value)
    for module, attr, wrapper in spec.get('wrap', ()):     # 있던 함수·클래스를 감싼다(질문 구성·요청 인자)
        swap(module, attr, wrapper(getattr(module, attr)))
    MODEL_CALLS.update(spec.get('models', ()))              # 모델을 바꾼 호출은 장부가 그 모델 단가로 센다
    try:
        yield
    finally:
        for module, attr, old in reversed(saved):
            setattr(module, attr, old)
        for call, _ in spec.get('models', ()):
            MODEL_CALLS.pop(call, None)


def v5_relations(asked: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    """V3보다 덜 줄인다(관계 48개까지): 장면과 무관한 관계가 인물 이해에 주는 도움을 덜 버리는지 본다."""
    return v3_relations(asked, extra, item, corpus, cap=48)


# 세트 키 → 후크. 키가 없는 세트는 입력을 바꾸지 않는다.
VARIANTS = {'V1': {'1': v1_act, '3n': v1_narrate, '3m': v1_narrate}, 'V2': {'4': v2_forbidden}, 'V3': {'1': v3_relations, '4': v3_relations},
            'V4': {'1': v3_relations, '4': v4_check}, 'V5': {'1': v5_relations},
            'D1': _director(hints=True), 'D2': _director(single=True), 'D3': _director(text=DIRECTOR_V1), 'D4': _director(text=DIRECTOR_V2),
            'D12': _director(hints=True, single=True), 'D13': _director(hints=True, text=DIRECTOR_V1), 'D14': _director(hints=True, text=DIRECTOR_V2),
            'D123': _director(hints=True, single=True, text=DIRECTOR_V1), 'D124': _director(hints=True, single=True, text=DIRECTOR_V2),
            'P1': {'patch': ((agent, 'ACT_INSTRUCTIONS', ACT_V1),)}, 'P2': {'1': soul_first}, 'P3': {'1': soul_first, 'patch': ((agent, 'ACT_INSTRUCTIONS', ACT_V1),)},
            'N1': {'patch': ((agent, 'NARRATE_INSTRUCTIONS', NARRATE_V1),)}, 'N2': {'patch': ((agent, 'NARRATE_INSTRUCTIONS', NARRATE_V2),)}, 'N3': {'patch': ((agent, 'NARRATE_INSTRUCTIONS', NARRATE_V3),)},
            'E1': {'wrap': ((agent, 'OpenAI', act_reasoning('medium')),)}, 'E2': {'wrap': ((agent, 'OpenAI', act_reasoning(None)),)},
            'M1': {'wrap': ((agent, 'OpenAI', model_for(TERRA)),), 'models': (('act', TERRA), ('narrate', TERRA))}}
