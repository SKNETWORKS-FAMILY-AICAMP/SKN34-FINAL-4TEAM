"""인물 시뮬레이션 테스트 공용 대역: 합성 세계관, Content MCP·NovelBrain·모델 대역.

세계관은 `world_studio_read` 응답 모양이고 기준 회차는 3이다. 문서마다 고유 표식(KAEL-SOUL 등)을 넣어
인물 입력에 다른 인물의 문서·미래 기억이 섞였는지 문자열로 확인한다.
"""

import asyncio
import json
from types import SimpleNamespace

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.simulation import agent, director, scene_agent, service
from app.simulation.models import Action, CheckItem, Decision, Narration, Scene, SceneAction, SimulationPlan, Verdict
from app.simulation.service import SceneContext

WORLD, KAEL, LINA, GATE, REL, REL2, REL3, REL4, SHADOW, REL5, REL6 = (f'00000000-0000-0000-0000-{n:012d}' for n in range(1, 12))
EPISODE = 3
TARGET = {'workId': 'work', 'episode': EPISODE}


def card(id, title, body, cardType='character', docs=None, lifecycle='active', aliases=(), reveal=None):
    meta = {**({'characterDocs': docs} if docs else {}), **({'revealFromEpisode': reveal} if reveal else {})}
    return {'id': id, 'title': title, 'body': body, 'cardType': cardType, 'areaCode': 'basic', 'classification': '',
            'aliases': list(aliases), 'tags': [], 'semanticMetadata': meta, 'visibility': 'private', 'lifecycle': lifecycle}


def relation(id, source, target, label, body, direction='directed', polarity='asserted', lifecycle='active'):
    return {'id': id, 'sourceCardId': source, 'targetCardId': target, 'category': 'emotional', 'body': body, 'label': label,
            'direction': direction, 'polarity': polarity, 'semanticMetadata': {}, 'lifecycle': lifecycle}


READ = {
    'worldId': WORLD, 'draftRevision': 4, 'name': '달빛 세계', 'description': '', 'relationshipStatus': 'current',
    'cards': [
        card(KAEL, '카엘', 'KAEL-IDENTITY 북문을 지키는 기사', docs={
            'soul': 'KAEL-SOUL 말이 짧고 퉁명스러운 반말', 'memory': 'KAEL-MEMORY 왕가에 맹세했다',
            'episodes': {'2': 'KAEL-EP2 리나를 처음 만났다', '5': 'KAEL-EP5-FUTURE 왕이 죽는다'}}),
        card(LINA, '리나', 'LINA-IDENTITY 떠돌이 약초상', docs={
            'soul': 'LINA-SOUL 존댓말을 쓰는 상냥한 말투', 'memory': 'LINA-MEMORY-SECRET 사실은 왕국의 첩자다',
            'episodes': {'3': 'LINA-EP3 성문을 살폈다'}}),
        card(GATE, '북문', 'GATE-LORE 북쪽 성문', cardType='location', reveal=3),  # 기준 회차(3)에 공개되는 카드
        card(SHADOW, '그림자 길드', 'SHADOW-GUILD 아직 공개되지 않은 조직', cardType='organization', reveal=5),
        card('00000000-0000-0000-0000-0000000000ff', '지워진 인물', 'REMOVED-CARD', lifecycle='removed'),
    ],
    'relationships': [
        relation(REL, KAEL, LINA, '경계', '카엘은 리나를 경계한다'),
        relation(REL2, LINA, GATE, '출입', 'REL-LINA-GATE 리나는 북문을 드나든다'),   # 카엘이 끝점이 아닌 관계
        relation(REL3, KAEL, LINA, '친구', '', direction='symmetric', polarity='denied'),
        relation(REL4, KAEL, LINA, '스승', 'REL-REMOVED', lifecycle='removed'),
        relation(REL5, KAEL, SHADOW, '숙적', 'REL-SHADOW 정체를 아직 모른다'),  # 상대 카드가 기준 회차에 아직 공개되지 않았다
        relation(REL6, KAEL, GATE, '수호', 'REL-KAEL-GATE 카엘은 북문을 지킨다'),
    ],
}
PLAN_IF = SimulationPlan(mode='if', premise='IF-PREMISE 만약 북문이 열려 있었다면?', characterIds=[KAEL, LINA])
PLAN_FLOW = SimulationPlan(mode='flow', characterIds=[KAEL, LINA], beats=[
    'B0-NOW 카엘이 성문에서 리나를 막아선다', 'B1-FUTURE 리나가 정체를 숨기며 통행을 청한다'])


def fake_content(monkeypatch, worlds=None, read=READ):
    """Content MCP 대역. 호출 기록 [(도구, 인자)]를 돌려준다."""
    calls = []
    linked = [{'worldId': WORLD, 'name': '달빛 세계', 'linkedWorkId': 'work'}] if worlds is None else worlds

    def call(tool, arguments):
        calls.append((tool, arguments))
        return {'world_studio_list': linked, 'world_studio_read': read}[tool]

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


def recalled(ref=f'card:{GATE}', source='graph', text='GATE-LORE 북문은 밤에 닫힌다'):
    return SimpleNamespace(ref=ref, source=source, text=text, rank=1, score=0.5)


def fake_novelbrain(monkeypatch, items=None):
    """app.novelbrain.service.recall 대역(world_snapshot은 실제 함수). recall 호출 기록 list를 돌려준다."""
    calls = []

    def recall(world, character_id, episode, query, stage=3, manuscript=(), k=8):
        calls.append({'world': world, 'character_id': character_id, 'episode': episode, 'query': query,
                      'stage': stage, 'manuscript': list(manuscript), 'k': k})
        return SimpleNamespace(items=[recalled()] if items is None else items, gaps=[], stage=stage)

    monkeypatch.setattr(service.novelbrain, 'recall', recall)
    return calls


def action(prose='카엘이 낮게 말했다. "멈춰."', observed='카엘이 북문 앞에서 리나를 막아섰다.', refuses=False, reason=None):
    return Action(prose=prose, observed=observed, refusesBeat=refuses, refusalReason=reason)


def narration(prose='성문 위로 밤비가 내렸다.', observed='밤비가 성문 앞에 내리고 있다.'):
    return Narration(prose=prose, observed=observed)


def verdict(payload, fail=(), refs=(), detail='판정 설명', beat_done=False, scene_complete=False):
    """payload의 checks 종류마다 판정을 만든다. fail에 든 종류만 위반이고 refs는 위반 근거다."""
    items = [CheckItem(kind=k, passed=k not in fail, detail=detail, refs=list(refs) if k in fail else []) for k in payload['checks']]
    return Verdict(checks=items, beatDone=beat_done, sceneComplete=scene_complete)


def fake_models(monkeypatch, acts, verdicts, narrations=None, reviews=None, order=None):
    """act·check·narrate 대역. 인자는 (payload) -> 응답 함수, 응답 하나(계속 반복), 응답 목록(차례로, 마지막은 반복) 중 하나다.

    check는 self.id가 없는 것(전지적 나레이션)만 reviews로 보내고 인물 시점(대사·독백·인물 시점 나레이션)은 verdicts로 보낸다.
    나레이션 기본 응답은 고정 문장이고 reviews 기본은 모두 통과다. 호출한 payload 기록을 SimpleNamespace(act·check·narrate·review)로
    돌려주고, order 목록을 주면 호출 이름을 순서대로 거기에 쌓는다.
    """
    calls = SimpleNamespace(act=[], check=[], narrate=[], review=[])

    def feed(script, log, name=None):
        queue = list(script) if isinstance(script, list) else None

        def call(payload):
            log.append(payload)
            if order is not None and name:
                order.append(name)
            if callable(script):
                return script(payload)
            return script if queue is None else (queue.pop(0) if len(queue) > 1 else queue[0])
        return call

    character_check = feed(verdicts, calls.check, 'check')
    narration_check = feed(reviews or (lambda payload: verdict(payload)), calls.review, 'review')
    monkeypatch.setattr(agent, 'act', feed(acts, calls.act, 'act'))
    monkeypatch.setattr(agent, 'narrate', feed(narrations or narration(), calls.narrate, 'narrate'))
    monkeypatch.setattr(agent, 'check', lambda payload: (narration_check if payload['self']['id'] is None else character_check)(payload))
    return calls


def speech(who=KAEL, pov='omniscient'):
    return Decision(turn='speech', speaker=who, pov=pov)


def monologue(pov=f'limited:{KAEL}'):
    return Decision(turn='monologue', pov=pov)


def narrating(pov='omniscient'):
    return Decision(turn='narration', pov=pov)


def fake_director(monkeypatch, *script, order=None):
    """연출 결정 대역. script는 Decision(또는 (state, allowed, cast, last_pov) -> Decision 함수) 목록이며 차례로 쓰고 마지막은 반복한다.

    규칙이 턴을 하나로 정한 때(장면 시작·마무리·비트 전환)는 script의 다음 결정이 그 턴이면 쓰고 아니면 전지적 시점으로 정한다.
    호출 기록 [{state, allowed, cast, last_pov}]을 돌려준다.
    """
    calls, queue = [], list(script)

    async def decide(state, allowed, cast, last_pov=None):
        calls.append({'state': state, 'allowed': list(allowed), 'cast': cast, 'last_pov': last_pov})
        if order is not None:
            order.append('director')
        nxt = queue[0] if queue else None
        if len(allowed) == 1:
            if nxt is not None and not callable(nxt) and nxt.turn == allowed[0]:
                return queue.pop(0) if len(queue) > 1 else queue[0]
            return Decision(turn=allowed[0], pov='omniscient')
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        return item(state, allowed, cast, last_pov) if callable(item) else item

    monkeypatch.setattr(director, 'decide', decide)
    return calls


def text(payload) -> str:
    """payload 전체를 한 문자열로. 표식 포함 여부를 확인할 때 쓴다."""
    return json.dumps(payload, ensure_ascii=False)


STEP = {'feature': 'character_simulation', 'when': 'always', 'status': 'not_started'}


def context(plan=PLAN_IF, scope=None, pausing=False):
    return SceneContext(plan=plan, target=TARGET, request='카엘과 리나가 만나면', scope=scope, steps=[STEP], pausing=pausing)


def seed(plan, scene=None, action=None):
    """바깥 그래프가 에이전트에 넘기는 시작 입력."""
    return {'messages': [HumanMessage('장면을 진행해 주세요.')], 'pending': False, 'decision': None,
            'scene': (scene or service.new_scene(plan)).model_dump(mode='json'), 'action': action}


def run_auto(plan=PLAN_IF, **kwargs) -> Scene:
    """대화 밖(턴 사이에 멈추지 않는) 장면 에이전트를 끝까지 돌린다."""
    out = asyncio.run(scene_agent.build_scene_agent(False).ainvoke(seed(plan), {}, context=context(plan, **kwargs)))
    return Scene.model_validate(out['scene'])


class Run:
    """대화 안(턴 사이에서 멈추는) 장면 에이전트 시험용 진행기. 메모리 체크포인터로 요청 한 번을 에이전트 실행 한 번처럼 흉내 낸다."""

    def __init__(self, plan=PLAN_IF, scope=None):
        self.plan, self.scope = plan, scope
        self.agent = scene_agent.build_scene_agent(True, InMemorySaver())
        self.config = {'configurable': {'thread_id': 'sim'}}
        self.waiting, self.out = None, None

    def request(self, payload) -> 'Run':
        out = asyncio.run(self.agent.ainvoke(payload, self.config, context=context(self.plan, self.scope, pausing=True)))
        interrupts = out.get('__interrupt__')
        self.waiting, self.out = (interrupts[0].value if interrupts else None), out
        return self

    def start(self, scene=None, action=None) -> 'Run':
        return self.request(seed(self.plan, scene, action))

    def resume(self, scene: dict | SceneAction | None = None, approved: bool = True, scope: dict | None = None) -> 'Run':
        body = scene.model_dump(mode='json', exclude_none=True) if isinstance(scene, SceneAction) else scene
        return self.request(Command(resume={'approved': approved, **({'scene': body} if body else {}), **({'scope': scope} if scope else {})}))

    def next(self, note=None) -> 'Run':
        return self.resume(SceneAction(action='next', note=note))

    @property
    def scene(self) -> Scene:
        """에이전트 상태의 장면(멈춰 있어도 읽는다)."""
        return Scene.model_validate(asyncio.run(self.agent.aget_state(self.config)).values['scene'])

    @property
    def shown(self) -> dict:
        """멈춘 payload가 바깥에 보이는 단계 항목."""
        return next(s for s in self.waiting['steps'] if s['feature'] == 'character_simulation')


def staged(monkeypatch, *script, acts=None, verdicts=None, **models):
    """세계관·NovelBrain·연출 결정·모델 대역을 한꺼번에 둔다. 호출 기록과 호출 순서를 SimpleNamespace로 돌려준다."""
    content = fake_content(monkeypatch)
    recall = fake_novelbrain(monkeypatch)
    order = []
    director = fake_director(monkeypatch, *(script or (speech(KAEL),)), order=order)
    calls = fake_models(monkeypatch, acts or action(), verdicts or (lambda payload: verdict(payload)), order=order, **models)
    return SimpleNamespace(director=director, calls=calls, order=order, recall=recall, content=content)
