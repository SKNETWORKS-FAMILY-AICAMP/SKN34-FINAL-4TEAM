"""인물 시뮬레이션의 모델 밖 로직(docs/design/character-simulation-contract.md): 세계관 읽기, 계획, 장면 상태, 턴 입력 조립.

장면은 턴 하나씩 이어 붙는다. 턴은 나레이션(전지적·3인칭 제한·1인칭), 독백(시점 인물의 속마음), 인물 대사다. 어느 턴을 쓸지는 연출 결정
(director.py)이 정하고, 이 모듈은 그 결정이 따라야 할 규칙(rules)과 턴을 쓰기 위한 입력을 만든다. 장면 에이전트(scene_agent.py)의
도구가 이 입력으로 모델을 부르고 미들웨어가 검사해 장면에 붙인다.
인물 호출마다 입력을 새로 조립하며 이전 인물의 입력·모델 대화 상태를 넘기지 않는다. 다른 인물에게는 인물이 겉으로 드러낸 행동·나레이션이
모두에게 알린 것(observed)만 장면 상태로 보이고 소설 문단(prose)의 속마음·독백은 가지 않는다. 근거 ref는 NovelBrain 형식
(`card:<id>#soul`·`relation:<id>`·`manuscript:<발췌 id>`)을 그대로 쓴다.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from pydantic import BaseModel, TypeAdapter, ValidationError

from app.content_mcp import service as content_mcp
from app.manuscript.models import Excerpt
from app.novelbrain import service as novelbrain
from app.novelbrain.models import Card, WorldSnapshot, world_snapshot
from app.retrieval import service as retrieval
from app.retrieval.errors import RetrievalUnavailable
from app.retrieval.models import RetrievalScope
from app.simulation import agent
from app.simulation.errors import SimulationFailure
from app.simulation.models import (GAP_LABELS, Action, Beat, Evidence, Narration, Note, Scene, SceneAction, SimulationPlan,
                                   SimulationResult, Trail, Turn, Verdict)

TURN_LIMIT = 12   # 인물 대사 턴 수 한도. 나레이션·독백은 세지 않는다.
MAX_TURNS = 40    # 나레이션·독백까지 합친 턴 수 안전 한도(연출이 서술만 되풀이하지 않게)
REGENERATIONS = 2
CUT = 200  # 모델이 쓴 이유·설명을 작가에게 보일 때 자르는 길이(Structured Outputs 스키마에는 길이 제약을 못 둔다)
KINDS = {'if': ['knowledge_leak', 'voice_mix', 'relation', 'premise'],
         'flow': ['knowledge_leak', 'voice_mix', 'relation', 'beat']}
NARRATOR = '나레이션'
NARRATOR_CARD = '나레이터'  # 제목이 이 말로 시작하는 카드(유형 무관)는 나레이션 문체 지침이다
NEEDS_TARGET = '시뮬레이션할 작품과 회차를 확인할 수 없어요.'
NO_LINKED_WORLD = '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.'
NO_CHARACTERS = '연결된 세계관에 인물 카드가 없어 시뮬레이션을 실행할 수 없어요.'
BAD_WORLD = '세계관 응답을 확인할 수 없습니다.'
BAD_PLAN = '시뮬레이션 계획 모델 응답을 확인할 수 없습니다.'
BAD_ACTION = '시뮬레이션 모델 응답을 확인할 수 없습니다.'
BAD_NARRATION = '시뮬레이션 나레이션 모델 응답을 확인할 수 없습니다.'
BAD_VERDICT = '시뮬레이션 검사 모델 응답을 확인할 수 없습니다.'
INVALID_PLAN = '시뮬레이션 계획이 완성되지 않았거나 세계관에 없는 인물이 있어요.'
NOT_IN_WORLD = '연결된 세계관에 없는 인물이 있어요. 인물 카드를 다시 골라 주세요.'
NO_EXCERPTS = '원고 발췌 검색을 쓸 수 없어 세계관 설정만으로 진행했어요.'


class WorldLink(BaseModel):
    """`world_studio_list` 한 줄. linkedWorkId가 이 세계관에 연결된 작품이다(1:1, DEC-46)."""
    worldId: str
    linkedWorkId: str | None = None


def read_world(work_id: str, episode: int) -> dict:
    """작품에 연결된 세계관을 기준 회차 시점으로 읽는다. 연결이 없으면 실패한다(대체 세계관을 찾지 않는다)."""
    try:
        worlds = TypeAdapter(list[WorldLink]).validate_python(content_mcp.call('world_studio_list', {}))
    except ValidationError:
        raise SimulationFailure(502, BAD_WORLD) from None
    linked = next((w.worldId for w in worlds if w.linkedWorkId == work_id), None)
    if linked is None:
        raise SimulationFailure(409, NO_LINKED_WORLD)
    return content_mcp.call('world_studio_read', {'id': linked, 'episode': str(episode)})


def plan(request: str, history: list[str], target: dict | None) -> SimulationPlan:
    """작가 요청과 세계관 인물 목록(id·이름)으로 모드·전제·비트·참여 인물을 뽑는다.

    정하지 못한 값은 계획의 gaps()로 남기고 호출자가 작가에게 되묻는다. 모델이 세계관에 없는 인물 id나 한도 밖 값을 주면
    고치지 않고 실패한다.
    """
    work_id, episode = _target(target)
    cast = [{'id': c.id, 'name': c.title} for c in _characters(_world(read_world(work_id, episode), episode)[0]).values()]
    if not cast:
        raise SimulationFailure(409, NO_CHARACTERS)
    try:
        drafted = SimulationPlan.model_validate(agent.plan(request, history, cast).model_dump())
    except ValidationError:
        raise SimulationFailure(502, BAD_PLAN) from None
    if not set(drafted.characterIds) <= {c['id'] for c in cast}:
        raise SimulationFailure(502, BAD_PLAN)
    return drafted


def plan_from_form(form: SimulationPlan, target: dict | None) -> SimulationPlan:
    """[시뮬레이션] 버튼의 시작 양식을 계획으로 쓴다(계약 '버튼 진입'). 모델에게 묻지 않고 연결 세계관과 맞춰 보기만 한다.

    모드별 필수값이 빠졌거나 인물이 세계관의 활성 인물 카드가 아니면 되묻지 않고 실패한다(422).
    """
    if gaps := form.gaps():
        raise SimulationFailure(422, f'시뮬레이션 설정에 {", ".join(GAP_LABELS[g] for g in gaps)}이(가) 빠졌어요.')
    work_id, episode = _target(target)
    if not set(form.characterIds) <= set(_characters(_world(read_world(work_id, episode), episode)[0])):
        raise SimulationFailure(422, NOT_IN_WORLD)
    return form


# --- 세계관·원고 발췌 ---------------------------------------------------------------------------------------------------

@dataclass
class World:
    """한 요청이 읽은 세계관(기준 회차 시점)과 원고 발췌. 나레이터 문체 카드는 style로 따로 두고 스냅샷에서 뺐다.

    notice는 원고 발췌를 받지 못하고 진행한 이유다(장면 결과에 알려 숨기지 않는다).
    """
    episode: int
    read: dict
    snapshot: WorldSnapshot
    style: list[dict]
    characters: dict[str, Card]
    manuscript: list[Excerpt]
    notice: str | None = None


def load_world(target: dict | None, request: str, scope: dict | None) -> World:
    """연결 세계관을 읽고 scope가 있으면 Retrieval 발췌를 받는다. 발췌는 받은 그대로 recall에 넘기고 인물 필터가 원고만 쓴다.

    원고 발췌는 보조 근거라, Content가 원고 검색을 쓸 수 없다고(503) 답하면 발췌 없이 세계관 설정만으로 진행하고 notice를 남긴다.
    그 밖의 검색 오류(권한·범위·형식·기타 서버 오류, 우리 쪽 설정·연결 실패)는 숨기지 않고 그대로 실패한다.

    ponytail: 검색어는 이번 요청 문장 하나다. 턴마다 다시 찾으려면 recall 호출 옆으로 옮긴다.
    """
    work_id, episode = _target(target)
    read = read_world(work_id, episode)
    snapshot, style = _world(read, episode)
    manuscript, notice = [], None
    if scope:
        try:
            manuscript = retrieval.retrieve(RetrievalScope.model_validate(scope), request).excerpts
        except RetrievalUnavailable:
            notice = NO_EXCERPTS
    return World(episode, read, snapshot, style, _characters(snapshot), manuscript, notice)


@dataclass
class SceneContext:
    """장면 에이전트 한 번의 실행(요청 하나)이 쓰는 값. 체크포인트에 넣지 않고 요청마다 바깥 그래프가 새로 만든다."""
    plan: SimulationPlan
    target: dict | None
    request: str
    scope: dict | None  # 재개마다 Content가 새로 서명한 조회 토큰으로 바뀐다
    steps: list[dict]   # 바깥 그래프의 단계 목록. 대기·이벤트 payload에 장면의 현재 결과를 끼워 넣는다
    pausing: bool       # 대화 안이면 턴 사이에서 멈춘다. 대화가 없으면 끝까지 한 번에 실행한다
    loaded: World | None = field(default=None, repr=False)
    views: dict = field(default_factory=dict, repr=False)  # 이번 요청에서 조립한 턴 입력. 같은 턴의 재생성이 다시 조회하지 않게 한다

    def world(self) -> World:
        """첫 호출 때 한 번 읽는다. 한 요청 안의 재생성·검사가 같은 세계관을 쓴다."""
        if self.loaded is None:
            self.loaded = load_world(self.target, self.request, self.scope)
        return self.loaded

    def step(self, scene: Scene) -> dict:
        """장면의 현재 결과를 담은 단계 항목. 끝난 장면만 completed이고 멈춘 장면은 failed로 이유를 보인다."""
        status = {'completed': 'completed', 'paused': 'not_started', 'running': 'not_started'}.get(scene.result.status, 'failed')
        step = next(s for s in self.steps if s['feature'] == 'character_simulation')
        return {**{k: v for k, v in step.items() if k != 'error'}, 'status': status, 'result': scene.result.model_dump(mode='json'),
                **({'error': scene.error} if scene.error else {})}

    def live_steps(self, scene: Scene) -> list[dict]:
        return [self.step(scene) if s['feature'] == 'character_simulation' else s for s in self.steps]


def _world(read: dict, episode: int) -> tuple[WorldSnapshot, list[dict]]:
    """세계관 스냅샷과 나레이터 문체 지침. 제목이 '나레이터'로 시작하는 카드는 유형과 상관없이 문체 지침이라 스냅샷에서 뺀다.

    인물 카드면 IDENTITY와 SOUL을 함께 지침으로 쓴다. 그래서 인물로 고를 수도 없고 인물의 입력에 들어가지도 않는다.
    """
    try:
        snapshot = world_snapshot(read, episode)
    except ValueError:
        raise SimulationFailure(502, BAD_WORLD) from None
    narrators = {c.id: c for c in snapshot.cards if unicodedata.normalize('NFC', c.title).strip().startswith(NARRATOR_CARD)}
    style = [{'ref': f'card:{c.id}', 'title': c.title, 'text': '\n\n'.join(t for t in (c.text, c.soul) if t.strip())}
             for c in narrators.values()]
    rest = snapshot.model_copy(update={'cards': [c for c in snapshot.cards if c.id not in narrators],
                                       'relations': [r for r in snapshot.relations if not {r.source, r.target} & set(narrators)]})
    return rest, style


def _visible(snapshot: WorldSnapshot, episode: int) -> WorldSnapshot:
    """전지적 나레이터가 보는 세계관: 기준 회차에 공개된 카드와 그 회차까지의 기억만(인물 시점 필터는 없다)."""
    cards = [c.model_copy(update={'episodes': {n: t for n, t in c.episodes.items() if n <= episode}})
             for c in snapshot.cards if c.revealFromEpisode is None or c.revealFromEpisode <= episode]
    ids = {c.id for c in cards}
    return snapshot.model_copy(update={'cards': cards, 'relations': [r for r in snapshot.relations if r.source in ids and r.target in ids]})


def _target(target: dict | None) -> tuple[str, int]:
    if not target:
        raise SimulationFailure(422, NEEDS_TARGET)
    return target['workId'], target['episode']


def _characters(snapshot: WorldSnapshot) -> dict[str, Card]:
    """활성 인물 카드. 삭제 카드·모양이 어긋난 characterDocs는 world_snapshot이 이미 걸러 냈다."""
    return {c.id: c for c in snapshot.cards if c.cardType == 'character'}


# --- 장면 상태(순수 함수) ----------------------------------------------------------------------------------------------

def new_scene(plan: SimulationPlan) -> Scene:
    flow = plan.mode == 'flow'
    beats = [Beat(index=i, text=t, status='pending') for i, t in enumerate(plan.beats)] if flow else []
    return Scene(result=SimulationResult(mode=plan.mode, premise=None if flow else plan.premise, beats=beats, turns=[],
                                         status='running', stopReason=None))


def check_plan(plan: SimulationPlan, world: World) -> None:
    """계획이 끝까지 정해졌고 인물이 지금 세계관의 활성 인물 카드인지 확인한다. 세계관은 요청마다 다시 읽으므로 그 사이 바뀔 수 있다."""
    if plan.gaps() or not set(plan.characterIds) <= set(world.characters):
        raise SimulationFailure(422, INVALID_PLAN)


def current_beat(result: SimulationResult) -> Beat | None:
    return next((b for b in result.beats if b.status == 'pending'), None)


def _sync_beats(scene: Scene) -> None:
    """비트의 끝남은 턴 기록에서 다시 센다. 지운 턴이 끝냈던 비트와 거부했던 비트는 다시 진행 중이 된다."""
    for beat in scene.result.beats:
        beat.status = 'done' if any(e.beat == beat.index and e.done for e in scene.trail) else 'pending'


def apply_action(scene: Scene, action: SceneAction) -> Scene:
    """작가의 조작을 장면에 반영한다(모델 호출 없음). 턴 번호가 장면 안인지는 호출자가 확인한다.

    edit는 그 턴을 작가 글로 바꾸고, stop은 지금까지로 끝낸다. next·redo는 다음 턴을 쓰게 하며 redo는 그 턴부터 뒤를 지우고
    같은 연출(인물·시점)로 그 턴만 다시 쓴다. 끝난 장면에 next를 하면 마무리를 걷어 내고 이어 간다.
    """
    scene = scene.model_copy(deep=True)
    result, trail = scene.result, scene.trail
    note = (action.note or '').strip() or None
    if action.action == 'stop':
        result.status, result.stopReason, scene.error = 'completed', None, None
        return scene
    if action.action == 'edit':
        turn = result.turns[action.turn]
        turn.prose, turn.editedByAuthor, turn.checks = action.text.strip(), True, []
        trail[action.turn].observed = '' if turn.kind == 'monologue' else turn.prose  # 독백은 다른 인물에게 보이지 않는다
        return scene
    if action.action == 'redo':
        k = action.turn
        kept = trail[k]
        scene.redo, scene.memo, scene.hint = kept.decision, kept.note, note
        del result.turns[k:], trail[k:]
        result.notes = [n for n in result.notes if n.afterTurn < k]
        if note:
            result.notes.append(Note(afterTurn=k - 1, text=note))
    else:
        if result.status == 'completed':
            if trail and trail[-1].closing:
                result.turns.pop()
                trail.pop()
            for entry in trail:
                if entry.ended:
                    entry.ended = entry.done = False
        if note:
            scene.memo = note
            result.notes.append(Note(afterTurn=len(result.turns) - 1, text=note))
    result.status, result.stopReason, scene.error = 'paused', None, None
    _sync_beats(scene)
    return scene


def rules(plan: SimulationPlan, scene: Scene) -> tuple[list[str], str | None]:
    """다음 턴의 규칙: (연출이 고를 수 있는 턴, 나레이션이 정해진 이유). 고를 수 있는 턴이 없으면 한도에 닿았다.

    장면 시작·작가의 메모·이야기의 끝·흐름 모드의 비트 전환에는 나레이션(마무리는 end)이 먼저다. 그 밖에는 나레이션·독백·대사 중에서
    고르되 나레이션·독백이 두 번 이어지면 이번엔 대사다.
    """
    turns, trail = scene.result.turns, scene.trail
    if not trail:
        return ['narration'], 'opening'
    if scene.memo:
        return ['narration'], 'note'
    if any(e.ended for e in trail):
        return ['end'], 'closing'
    if turns[-1].kind == 'character' and trail[-1].done:
        return ['narration'], 'transition'
    if sum(t.kind == 'character' for t in turns) >= TURN_LIMIT or len(turns) >= MAX_TURNS:
        return [], None
    quiet = len(turns) >= 2 and all(t.kind != 'character' for t in turns[-2:])
    return (['speech'] if quiet else ['narration', 'monologue', 'speech']), None


def seen_lines(scene: Scene) -> list[dict]:
    """장면 상태: 지금까지 드러난 것. 인물이 겉으로 드러낸 행동과 나레이션이 알린 것뿐이고 독백·속마음은 없다."""
    return [{'ref': f'scene:{t.index}', 'by': t.characterName, 'text': e.observed} for t, e in zip(scene.result.turns, scene.trail) if e.observed]


def director_state(plan: SimulationPlan, scene: Scene, required: str | None) -> dict:
    """연출 결정 모델에 보이는 장면 요약. 인물 id·설정 문서·독백 내용은 없다."""
    result, beat = scene.result, current_beat(scene.result)
    lines = [{'kind': t.kind, 'by': t.characterName, 'pov': t.pov, **({'text': e.observed} if e.observed else {})}
             for t, e in zip(result.turns, scene.trail)]
    return {'mode': plan.mode, 'premise': result.premise, 'beats': [b.model_dump() for b in result.beats],
            'currentBeat': beat and {'index': beat.index, 'text': beat.text}, 'scene': lines[-8:],
            'notes': [n.model_dump() for n in result.notes], 'memoPending': bool(scene.memo),
            'spoken': sum(t.kind == 'character' for t in result.turns), 'limit': TURN_LIMIT, **({'required': required} if required else {})}


def with_notice(scene: Scene, notice: str | None) -> Scene:
    """장면 결과에 알림을 붙인다. 알림이 없거나 이미 같은 알림이면 그대로 돌려준다. 한 번 붙은 알림은 지우지 않는다(앞 턴이 그 조건으로 쓰였다)."""
    if not notice or scene.result.notice == notice:
        return scene
    scene = scene.model_copy(deep=True)
    scene.result.notice = notice
    return scene


def add_turn(scene: Scene, turn: Turn, entry: Trail) -> Scene:
    """통과한 턴을 장면에 붙인다. 쓴 메모·지시는 비우고 마무리 나레이션이면 장면이 끝난다."""
    scene = scene.model_copy(deep=True)
    scene.result.turns.append(turn)
    scene.trail.append(entry)
    scene.memo = scene.hint = scene.redo = scene.error = None
    _sync_beats(scene)
    scene.result.status, scene.result.stopReason = ('completed' if entry.closing else 'paused'), None
    return scene


def stop_scene(scene: Scene, message: str, status: str, reason: str | None = None, rejected: int | None = None) -> Scene:
    """멈춘 장면: 쌓은 턴과 작가의 메모는 그대로 두고 상태·이유만 바꾼다. rejected는 따르지 않은 비트 번호다."""
    scene = scene.model_copy(deep=True)
    scene.result.status, scene.result.stopReason, scene.error = status, reason, message
    for beat in scene.result.beats:
        if beat.index == rejected:
            beat.status = 'rejected'
    return scene


# --- 턴 입력 조립 ------------------------------------------------------------------------------------------------------

def _doc(ref: str, label: str, text: str) -> dict:
    return {'ref': ref, 'label': label, 'text': text}


def _memory_ref(card: Card, number: int) -> str:
    return f'card:{card.id}#ep{number:02d}'


def _docs(card: Card, episode: int) -> tuple[list[dict], list[dict]]:
    """그 인물의 문서를 (기준 회차 이하라 아는 것, 아직 오지 않은 회차라 모르는 미래 기억)으로 나눈다. 빈 문서는 뺀다."""
    memories = sorted(card.episodes.items())
    known = [(f'card:{card.id}#identity', '정체(IDENTITY)', card.text), (f'card:{card.id}#soul', '말투·사고(SOUL)', card.soul),
             (f'card:{card.id}#memory', '핵심 기억(MEMORY)', card.memory),
             *((_memory_ref(card, n), f'{n}회차 기억', t) for n, t in memories if n <= episode)]
    future = [(_memory_ref(card, n), f'{n}회차 기억', t) for n, t in memories if n > episode]
    return [_doc(*d) for d in known if d[2].strip()], [_doc(*d) for d in future if d[2].strip()]


def _private(card: Card) -> list[dict]:
    """다른 인물만 아는 것: 핵심 기억과 모든 회차 기억. 검사가 누설을 판정하는 기준이며 인물 입력에는 가지 않는다."""
    docs = [(f'card:{card.id}#memory', '핵심 기억(MEMORY)', card.memory),
            *((_memory_ref(card, n), f'{n}회차 기억', t) for n, t in sorted(card.episodes.items()))]
    return [{**_doc(*d), 'owner': card.title} for d in docs if d[2].strip()]


def _relations(snapshot: WorldSnapshot, read: dict, character_id: str) -> list[dict]:
    """기준 회차 시점의 관계 중 그 인물이 끝점인 것(삭제·끝점 없는 관계는 스냅샷이 이미 뺐다).

    상대 카드가 기준 회차에 아직 공개되지 않았으면 뺀다. 관계 문장에 상대 제목이 드러나기 때문이며 recall의 인물 필터와 같은 규칙이다.

    ponytail: WorldSnapshot의 관계에는 설명(body)과 부정(polarity=denied)이 없어 응답 원본에서 id로 찾아 읽는다.
    스냅샷에 두 필드가 생기면 이 조회를 지운다.
    """
    cards = {c.id: c for c in snapshot.cards}
    raw = {r.get('id'): r for r in read.get('relationships') or []}
    items = []
    for r in snapshot.relations:
        if character_id not in (r.source, r.target):
            continue
        other = cards[r.target if r.source == character_id else r.source]
        if other.revealFromEpisode is not None and other.revealFromEpisode > snapshot.episode:
            continue
        extra = raw.get(r.id) or {}
        arrow = '→' if r.direction == 'directed' else '↔'
        said = f'{cards[r.source].title} {arrow} {cards[r.target].title}: {r.label}{" 아님" if extra.get("polarity") == "denied" else ""}'
        items.append(_doc(f'relation:{r.id}', '관계', f'{said} — {extra["body"]}' if extra.get('body') else said))
    return items


def _direction(plan: SimulationPlan, beat: Beat | None) -> dict:
    """인물에게는 지금 비트(흐름) 또는 IF 전제만 보인다. 뒤의 비트는 미래 정보라 넣지 않는다."""
    if plan.mode == 'if':
        return {'mode': 'if', 'premise': {'ref': 'premise', 'text': plan.premise}}
    return {'mode': 'flow', **({'currentBeat': {'ref': f'beat:{beat.index}', 'text': beat.text}} if beat else {})}


def _query(direction: dict, seen: list[dict]) -> str:
    """recall 검색어: 지금 비트나 전제와 가장 최근에 드러난 일."""
    goal = direction.get('premise') or direction.get('currentBeat') or {'text': ''}
    return ' '.join([goal['text'], seen[-1]['text'] if seen else '']).strip()


def character_view(plan: SimulationPlan, world: World, scene: Scene, actor: Card) -> tuple[dict, dict, list[Evidence]]:
    """그 인물이 아는 것만으로 조립한 모델 입력과 검사 보조 자료(금지 목록·다른 인물의 말투), 조회 근거.

    인물 대사와 그 인물 시점의 나레이션·독백이 같은 입력을 쓴다. 입력은 호출마다 새로 만들고 이전 인물의 입력은 넘기지 않는다.
    """
    direction, seen = _direction(plan, current_beat(scene.result)), seen_lines(scene)
    recalled = novelbrain.recall(world.snapshot, actor.id, world.episode, _query(direction, seen), stage=3, manuscript=world.manuscript)
    own, future = _docs(actor, world.episode)
    mine = [*own, *_relations(world.snapshot, world.read, actor.id)]
    taken = {d['ref'] for d in mine}
    known = [*mine, *({'ref': i.ref, 'label': f'조회({i.source})', 'text': i.text} for i in recalled.items if i.ref not in taken)]
    cast = [world.characters[i] for i in plan.characterIds]
    asked = {'self': {'id': actor.id, 'name': actor.title}, 'known': known, 'present': [c.title for c in cast],
             'scene': seen, 'direction': direction}
    refs = {d['ref'] for d in known}
    others = [{'ref': f'card:{c.id}#identity', 'name': c.title, 'text': c.text,
               'relations': [f'relation:{r.id}' for r in world.snapshot.relations if {r.source, r.target} == {actor.id, c.id} and f'relation:{r.id}' in refs]}
              for c in cast if c.id != actor.id and c.text.strip()]  # 호칭 검사용: 그 인물이 누구이고 화자와 어떤 관계인지(인물 입력에는 가지 않는다)
    extra = {'forbidden': [*future, *(d for c in cast if c.id != actor.id for d in _private(c))],
             'voices': [{'ref': f'card:{c.id}#soul', 'name': c.title, 'text': c.soul} for c in cast if c.id != actor.id and c.soul.strip()],
             'others': others}
    return asked, extra, [Evidence(ref=i.ref, source=i.source) for i in recalled.items]


def narrator_view(plan: SimulationPlan, world: World, scene: Scene) -> tuple[dict, dict, list[Evidence]]:
    """전지적 나레이터의 모델 입력: 기준 회차까지의 세계관(2단계 조회, 인물 시점 필터 없음)과 원고 발췌. 금지 목록은 미래 정보뿐이다."""
    direction, seen = _direction(plan, current_beat(scene.result)), seen_lines(scene)
    manuscript = [e for e in world.manuscript if e.kind == 'manuscript' and e.episode <= world.episode]
    recalled = novelbrain.recall(_visible(world.snapshot, world.episode), None, world.episode, _query(direction, seen), stage=2,
                                 manuscript=manuscript)
    asked = {'self': {'id': None, 'name': NARRATOR},
             'known': [{'ref': i.ref, 'label': f'조회({i.source})', 'text': i.text} for i in recalled.items],
             'present': [world.characters[i].title for i in plan.characterIds], 'scene': seen, 'direction': direction}
    future = [{**d, 'owner': c.title} for c in world.snapshot.cards if c.cardType == 'character' for d in _docs(c, world.episode)[1]]
    hidden = [{**_doc(f'card:{c.id}', '아직 공개되지 않은 설정', c.text), 'owner': c.title} for c in world.snapshot.cards
              if c.revealFromEpisode is not None and c.revealFromEpisode > world.episode]
    return asked, {'forbidden': [*future, *hidden], 'voices': []}, [Evidence(ref=i.ref, source=i.source) for i in recalled.items]


def narration_input(plan: SimulationPlan, world: World, scene: Scene, purpose: str, pov: str) -> dict:
    """나레이터 모델 입력에 더하는 값: 쓰는 이유, 시점, 장면 계획, 문체 지침, 작가의 끼어들기 기록.

    계획의 비트는 전지적 서술만 전체를 본다. 독백·3인칭 제한·1인칭 서술은 인물이 아직 모르는 뒤의 비트를 받지 않고 지금 비트까지만
    받는다(_direction이 인물에게 지금 비트만 주는 것과 같은 이유다). 모든 비트가 끝났으면 뒤의 비트가 없어 전체를 준다.
    """
    result = scene.result
    kind, _, who = pov.partition(':')
    beat = current_beat(result)
    beats = result.beats if kind == 'omniscient' or beat is None else result.beats[:beat.index + 1]
    written = [t.prose for t in result.turns if t.kind == 'narration'][-3:]  # 반복을 피하려고 전지적 서술에만 보인다(인물 시점은 그 인물이 아는 것만)
    return {'purpose': purpose, 'pov': {'kind': kind, 'character': world.characters[who].title if who in world.characters else None},
            'plan': {'mode': plan.mode, 'premise': result.premise, 'beats': [b.model_dump() for b in beats]},
            'style': world.style, 'notes': [n.model_dump() for n in result.notes], **({'alreadyWritten': written} if kind == 'omniscient' else {})}


def check_kinds(plan: SimulationPlan, kind: str, pov: str) -> list[str]:
    """턴에 거는 검사. 대사는 전 항목, 독백·1인칭 서술은 지식 범위와 말투, 그 밖의 서술은 지식 범위(전지적은 미래 누설)만 본다."""
    if kind == 'character':
        return KINDS[plan.mode]
    return ['knowledge_leak', 'voice_mix'] if kind == 'monologue' or pov.startswith('first:') else ['knowledge_leak']


DIALOGUE_QUOTES = ('"', '"')  # 통일할 대사 따옴표: 원고와 사용자 요구(지문 + "대사")에 맞춘 직선 큰따옴표(코디네이터 결정 2026-11-14). DEC-48은 정하지 않는다.
_QUOTED = re.compile(r'「([^」\n]*)」|『([^』\n]*)』|"([^"\n]*)"|“([^“”\n]*)”')
_DIALOGUE = re.compile(r'“[^”]*(?:”|$)|"[^"]*(?:"|$)')  # 둥근·직선 큰따옴표 모두 대사로 보고, 닫히지 않은 대사는 끝까지 대사로 본다
_FIRST_PERSON = re.compile(r'(?:^|[.!?…]\s+)(?:저는|제가|저도|나는(?!\s*(?:듯|새))|내가|나도)(?![가-힣])')  # '나는 듯한 걸음'의 나는(날다)은 뺀다
_PLAIN_FORMAL = re.compile(r'(?:[었았였겠있없]소|하오|시오)$')  # 하오체


def normalize_quotes(text: str) -> str:
    """대사 따옴표를 DIALOGUE_QUOTES(직선 큰따옴표)로 통일한다(「」·『』·둥근 큰따옴표). 짝이 없는 따옴표와 작은따옴표는 건드리지 않는다."""
    return _QUOTED.sub(lambda m: DIALOGUE_QUOTES[0] + next(g for g in m.groups() if g is not None) + DIALOGUE_QUOTES[1], text)


def action_style(pov: str, actor: Card) -> dict:
    """인물 턴의 행동 묘사(대사 밖의 서술)가 따를 인칭. 인물의 말투는 대사 안에서만 쓰고 행동 묘사는 서술체(-다)다.

    1인칭 시점이고 그 시점 인물이 이 인물일 때만 1인칭이고, 그 밖(전지적·3인칭 제한·다른 인물의 1인칭 시점)은 3인칭이다.
    """
    return {'person': 'first' if pov == f'first:{actor.id}' else 'third', 'subject': actor.title}


def style_problem(prose: str, style: dict | None) -> str | None:
    """행동 묘사(대사 밖의 글)가 인칭·문체를 확실히 어기면 이유를, 아니면 None. 모델 검사 앞에서 확실한 경우만 거른다.

    3인칭이어야 하는데 문장 첫머리가 저는·나는 같은 1인칭이거나, 문장이 합쇼체(-ㅂ니다)·하오체(-소)로 끝나는 경우다. 대사 안의 글은 보지 않는다.
    ponytail: 한국어 어미 휴리스틱이라 드문 거짓 양성이 있다. 그 턴은 재생성되고 계속 어기면 말투 섞임으로 멈춘다.
    """
    if not style:
        return None
    for part in _DIALOGUE.split(prose):
        part = part.strip()
        if style['person'] == 'third' and _FIRST_PERSON.search(part):
            return '3인칭으로 써야 하는 행동 묘사가 1인칭이에요.'
        for sentence in re.split(r'(?<=[.!?…])\s+', part):
            end = sentence.rstrip('.!?…\'" ')
            if _PLAIN_FORMAL.search(end) or (end.endswith('니다') and len(end) > 2 and '가' <= end[-3] <= '힣' and (ord(end[-3]) - 0xAC00) % 28 == 17):
                return '행동 묘사가 인물의 말투(합쇼체·하오체)로 쓰였어요. 서술체(-다)로 써야 해요.'
    return None


def acted(action: Action) -> Action:
    if not action.prose.strip() or not action.observed.strip():
        raise SimulationFailure(502, BAD_ACTION)
    return action


def narrated(narration: Narration, monologue: bool) -> Narration:
    """나레이션·독백 응답 확인: 본문이 있어야 하고, 나레이션은 모두에게 알릴 것(observed)도 있어야 한다."""
    if not narration.prose.strip() or (not monologue and not narration.observed.strip()):
        raise SimulationFailure(502, BAD_NARRATION)
    return narration


def verify(verdict: Verdict, kinds: list[str], payload: dict) -> None:
    """요청한 검사가 정확히 한 번씩 있고, 위반 근거 ref가 검사 모델의 입력에 있는 것만 인정한다. 아니면 실패한다."""
    refs = {item['ref'] for key in ('known', 'scene', 'forbidden', 'voices', 'others') for item in payload.get(key, [])}
    refs |= {v['ref'] for v in payload['direction'].values() if isinstance(v, dict)}
    if sorted(c.kind for c in verdict.checks) != sorted(kinds) or any(r not in refs for c in verdict.checks for r in c.refs):
        raise SimulationFailure(502, BAD_VERDICT)
