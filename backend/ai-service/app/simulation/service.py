"""인물 시뮬레이션 실행(docs/design/character-simulation-contract.md): 세계관 읽기 → 인물별 격리 턴 루프 → 결과.

한 턴은 다음 인물 선택 → NovelBrain recall(3단계 필터) → 그 인물이 아는 것만으로 입력 조립 → 행동 생성 → 검사
(오류 1 누설·2 말투·3 호칭/관계, IF 전제 또는 비트 진행) → 위반이면 그 턴만 최대 2회 재생성 → 통과하면 장면 상태 갱신이다.
인물 호출마다 입력을 새로 조립하며 이전 인물의 입력·모델 대화 상태를 넘기지 않는다. 다른 인물에게는 인물이 겉으로 드러낸
행동(observed)만 장면 상태로 보이고 소설 문단(prose)의 속마음은 가지 않는다. 한도·실패·중단은 SimulationStopped로 올려
부분 장면을 완료로 꾸미지 않는다. 모델이 판정한 결과는 형식과 근거 ref가 입력에 있는지 Python이 다시 확인한다.
근거 ref는 NovelBrain 형식(`card:<id>#soul`·`relation:<id>`·`manuscript:<발췌 id>`)을 그대로 쓴다.
"""

from collections.abc import Callable, Sequence

from pydantic import BaseModel, TypeAdapter, ValidationError

from app.content_mcp import service as content_mcp
from app.manuscript.models import Excerpt
from app.novelbrain import service as novelbrain
from app.novelbrain.models import Card, WorldSnapshot, world_snapshot
from app.retrieval import service as retrieval
from app.retrieval.models import RetrievalScope
from app.simulation import agent
from app.simulation.errors import SimulationFailure, SimulationStopped
from app.simulation.models import (Action, Beat, CharacterRef, Check, CheckItem, Evidence, SimulationPlan,
                                   SimulationResult, Turn, Verdict)
from app.simulation.prompt import FEEDBACK, KIND_LABELS

TURN_LIMIT = 12
REGENERATIONS = 2
KINDS = {'if': ['knowledge_leak', 'voice_mix', 'relation', 'premise'],
         'flow': ['knowledge_leak', 'voice_mix', 'relation', 'beat']}
NEEDS_TARGET = '시뮬레이션할 작품과 회차를 확인할 수 없어요.'
NO_LINKED_WORLD = '이 작품에 연결된 세계관이 없어 시뮬레이션을 실행할 수 없어요.'
NO_CHARACTERS = '연결된 세계관에 인물 카드가 없어 시뮬레이션을 실행할 수 없어요.'
BAD_WORLD = '세계관 응답을 확인할 수 없습니다.'
BAD_PLAN = '시뮬레이션 계획 모델 응답을 확인할 수 없습니다.'
BAD_ACTION = '시뮬레이션 모델 응답을 확인할 수 없습니다.'
BAD_VERDICT = '시뮬레이션 검사 모델 응답을 확인할 수 없습니다.'
INVALID_PLAN = '시뮬레이션 계획이 완성되지 않았거나 세계관에 없는 인물이 있어요.'


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


def plan(request: str, history: list[str], target: dict | None, given: dict | None) -> tuple[SimulationPlan, list[CharacterRef]]:
    """작가 요청에서 계획을 뽑고, 작가가 고를 수 있는 세계관 인물 목록과 함께 돌려준다.

    작가가 계획을 직접 줬으면(given) 모델을 부르지 않는다. 모델이 세계관에 없는 인물 id나 한도 밖 값을 주면 고치지 않고 실패한다.
    """
    work_id, episode = _target(target)
    cast = [CharacterRef(id=c.id, name=c.title) for c in _characters(_snapshot(read_world(work_id, episode), episode)).values()]
    if not cast:
        raise SimulationFailure(409, NO_CHARACTERS)
    answer = SimulationPlan.model_validate(given or {})
    if answer != SimulationPlan():
        return answer, cast
    try:
        drafted = SimulationPlan.model_validate(agent.plan(request, history, cast).model_dump())
    except ValidationError:
        raise SimulationFailure(502, BAD_PLAN) from None
    if not set(drafted.characterIds) <= {c.id for c in cast}:
        raise SimulationFailure(502, BAD_PLAN)
    return drafted, cast


def run(plan: SimulationPlan, target: dict | None, request: str, scope: dict | None,
        progress: Callable[[SimulationResult], None] | None = None) -> SimulationResult:
    """연결 세계관을 읽고 scope가 있으면 원고 발췌를 받아 장면을 실행한다. 원고 발췌는 manuscript 종류만 recall에 넘긴다.

    설정·현재 관계 발췌는 기준 회차 시점의 세계관과 겹치고, 현재 관계를 과거 관계로 쓰지 않기 위해 뺀다.
    """
    work_id, episode = _target(target)
    read = read_world(work_id, episode)
    manuscript = []
    if scope:
        # ponytail: 검색어는 이번 요청 문장 하나이고 장면 전체가 같은 발췌를 쓴다. 턴마다 다시 찾으려면 recall 호출 옆으로 옮긴다.
        found = retrieval.retrieve(RetrievalScope.model_validate(scope), request)
        manuscript = [e for e in found.excerpts if e.kind == 'manuscript']
    return simulate(plan, read, episode, manuscript, progress)


def simulate(plan: SimulationPlan, read: dict, episode: int, manuscript: Sequence[Excerpt] = (),
             progress: Callable[[SimulationResult], None] | None = None) -> SimulationResult:
    """장면을 끝까지 실행해 completed 결과를 돌려준다. 그 밖의 끝은 부분 결과를 담은 SimulationStopped다.

    progress는 통과한 턴마다 그때까지의 running 결과를 받는다. 마지막 턴(완결)은 반환값으로만 알린다.
    """
    snapshot = _snapshot(read, episode)
    characters = _characters(snapshot)
    if plan.gaps() or not set(plan.characterIds) <= set(characters):
        raise SimulationFailure(422, INVALID_PLAN)
    cast = [characters[i] for i in plan.characterIds]
    flow, kinds = plan.mode == 'flow', KINDS[plan.mode]
    beats = [Beat(index=i, text=t, status='pending') for i, t in enumerate(plan.beats)] if flow else []
    turns: list[Turn] = []
    scene: list[dict] = []  # 장면 상태: 인물이 겉으로 드러낸 행동. 모든 참여 인물이 같은 장소에 있다고 본다.
    last: dict[str, int] = {}

    def result(status, reason=None) -> SimulationResult:
        return SimulationResult(mode=plan.mode, premise=None if flow else plan.premise, beats=[b.model_copy() for b in beats],
                                turns=list(turns), status=status, stopReason=reason)

    try:
        for index in range(TURN_LIMIT):
            beat = next((b for b in beats if b.status == 'pending'), None)
            direction = _direction(plan, beat)
            actor = _actor(cast, beat and beat.text, last)
            recalled = novelbrain.recall(snapshot, actor.id, episode, _query(direction, scene), stage=3, manuscript=manuscript)
            own, future = _docs(actor, episode)
            mine = [*own, *_relations(snapshot, read, actor.id)]
            taken = {d['ref'] for d in mine}
            known = [*mine, *({'ref': i.ref, 'label': f'조회({i.source})', 'text': i.text} for i in recalled.items
                              if i.ref not in taken)]
            asked = {'self': {'id': actor.id, 'name': actor.title}, 'known': known, 'present': [c.title for c in cast],
                     'scene': list(scene), 'direction': direction}
            forbidden = [*future, *(d for c in cast if c.id != actor.id for d in _private(c))]
            voices = [{'ref': f'card:{c.id}#soul', 'name': c.title, 'text': c.soul} for c in cast
                      if c.id != actor.id and c.soul.strip()]
            feedback: list[str] = []
            for attempt in range(REGENERATIONS + 1):
                action = _acted(agent.act({**asked, **({'feedback': feedback} if feedback else {})}))
                if flow and action.refusesBeat:
                    beat.status = 'rejected'
                    raise SimulationStopped(
                        f'{actor.title}이(가) 비트 “{beat.text}”을(를) 따르지 않아 멈췄어요. 흐름을 고치거나 이대로 진행할지 정해 주세요. '
                        f'이유: {action.refusalReason or "알 수 없어요."}', result('stopped', 'beat_rejected'))
                checked = {**asked, 'forbidden': forbidden, 'voices': voices, 'checks': kinds, 'paragraph': action.prose}
                verdict = _verified(agent.check(checked), kinds, checked)
                failed = [c for c in verdict.checks if not c.passed]
                if not failed:
                    break
                feedback = [FEEDBACK[c.kind] for c in failed]
            else:
                raise SimulationStopped(
                    f'{actor.title}의 {index + 1}번째 장면이 검사를 통과하지 못해 멈췄어요: '
                    f'{", ".join(KIND_LABELS[c.kind] for c in failed)}. {failed[0].detail}', result('stopped', 'check_failed'))
            turns.append(Turn(index=index, characterId=actor.id, characterName=actor.title, prose=action.prose.strip(),
                              checks=[Check(kind=c.kind, passed=c.passed, detail=c.detail) for c in verdict.checks],
                              regenerated=attempt, evidence=[Evidence(ref=i.ref, source=i.source) for i in recalled.items]))
            scene.append({'ref': f'scene:{index}', 'by': actor.title, 'text': action.observed.strip()})
            last[actor.id] = index
            if flow and verdict.beatDone:
                beat.status = 'done'
            if all(b.status == 'done' for b in beats) if flow else verdict.sceneComplete:
                return result('completed')
            if progress:
                progress(result('running'))
        raise SimulationStopped(f'턴 한도({TURN_LIMIT})까지 장면이 끝나지 않아 멈췄어요.', result('stopped', 'turn_limit'))
    except SimulationFailure as failure:
        raise SimulationStopped(str(failure), result('failed')) from None


def _target(target: dict | None) -> tuple[str, int]:
    if not target:
        raise SimulationFailure(422, NEEDS_TARGET)
    return target['workId'], target['episode']


def _snapshot(read: dict, episode: int) -> WorldSnapshot:
    try:
        return world_snapshot(read, episode)
    except ValueError:
        raise SimulationFailure(502, BAD_WORLD) from None


def _characters(snapshot: WorldSnapshot) -> dict[str, Card]:
    """활성 인물 카드. 삭제 카드·모양이 어긋난 characterDocs는 world_snapshot이 이미 걸러 냈다."""
    return {c.id: c for c in snapshot.cards if c.cardType == 'character'}


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

    ponytail: WorldSnapshot의 관계에는 설명(body)과 부정(polarity=denied)이 없어 응답 원본에서 id로 찾아 읽는다.
    스냅샷에 두 필드가 생기면 이 조회를 지운다.
    """
    names = {c.id: c.title for c in snapshot.cards}
    raw = {r.get('id'): r for r in read.get('relationships') or []}
    items = []
    for r in snapshot.relations:
        if character_id not in (r.source, r.target):
            continue
        extra = raw.get(r.id) or {}
        arrow = '→' if r.direction == 'directed' else '↔'
        said = f'{names[r.source]} {arrow} {names[r.target]}: {r.label}{" 아님" if extra.get("polarity") == "denied" else ""}'
        items.append(_doc(f'relation:{r.id}', '관계', f'{said} — {extra["body"]}' if extra.get('body') else said))
    return items


def _direction(plan: SimulationPlan, beat: Beat | None) -> dict:
    """인물에게는 지금 비트(흐름) 또는 IF 전제만 보인다. 뒤의 비트는 미래 정보라 넣지 않는다."""
    if plan.mode == 'if':
        return {'mode': 'if', 'premise': {'ref': 'premise', 'text': plan.premise}}
    return {'mode': 'flow', 'currentBeat': {'ref': f'beat:{beat.index}', 'text': beat.text}}


def _query(direction: dict, scene: list[dict]) -> str:
    """recall 검색어: 지금 비트나 전제와 가장 최근에 드러난 행동."""
    goal = direction.get('premise') or direction['currentBeat']
    return ' '.join([goal['text'], scene[-1]['text'] if scene else '']).strip()


def _actor(cast: list[Card], beat_text: str | None, last: dict[str, int]) -> Card:
    """비트에 이름이 나오는 인물을 우선하고, 그 안에서(없으면 전원) 가장 오래 차례가 없던 인물이 돌아가며 맡는다.

    ponytail: 이름이 그대로 나올 때만 알아본다(별칭·호칭 미지원). 필요하면 비트에 인물 id를 따로 받는다.
    """
    named = [c for c in cast if beat_text and c.title in beat_text]
    return min(named or cast, key=lambda c: last.get(c.id, -1))


def _acted(action: Action) -> Action:
    if not action.prose.strip() or not action.observed.strip():
        raise SimulationFailure(502, BAD_ACTION)
    return action


def _verified(verdict: Verdict, kinds: list[str], payload: dict) -> Verdict:
    """요청한 검사가 정확히 한 번씩 있고, 위반 근거 ref가 검사 모델의 입력에 있는 것만 인정한다."""
    refs = {item['ref'] for key in ('known', 'scene', 'forbidden', 'voices') for item in payload[key]}
    refs |= {v['ref'] for v in payload['direction'].values() if isinstance(v, dict)}
    if sorted(c.kind for c in verdict.checks) != sorted(kinds) or any(r not in refs for c in verdict.checks for r in c.refs):
        raise SimulationFailure(502, BAD_VERDICT)
    return verdict.model_copy(update={'checks': [CheckItem(kind=c.kind, passed=c.passed, detail=c.detail[:200], refs=c.refs)
                                                 for c in verdict.checks]})
