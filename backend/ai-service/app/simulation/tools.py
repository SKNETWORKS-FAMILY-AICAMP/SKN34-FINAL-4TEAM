"""장면 에이전트의 도구: 나레이션·독백·인물 대사·장면 마무리 한 턴을 쓴다(#362).

도구는 연출 결정이 정한 인자(시점·인물·이유)로 그 턴의 모델 입력을 조립해 부르기만 하고 장면은 바꾸지 않는다. 결과 문단과 검사에
쓸 자료(artifact)를 돌려주면 SceneCheckMiddleware가 검사·재실행하고 통과한 턴을 장면에 붙인다. 입력 조립·모델 호출은 기존
service·agent 함수를 그대로 쓴다. 모델·Content·NovelBrain 호출은 막힘 없이 기다리도록 스레드에서 실행한다.
"""

import asyncio

from langchain.tools import ToolRuntime, tool

from app.simulation import agent, service
from app.simulation.errors import SimulationFailure
from app.novelbrain.models import Card
from app.simulation.models import Scene
from app.simulation.service import NARRATOR, SceneContext

Runtime = ToolRuntime[SceneContext]  # 컨텍스트 타입을 알려 줘야 도구 인자 스키마가 SceneContext를 None으로 직렬화하려 하지 않는다


def _owner(world: service.World, plan, kind: str, pov: str, character_id: str | None) -> Card | None:
    """그 턴이 아는 것을 정하는 인물. 대사는 화자, 독백·인물 시점 나레이션은 시점 인물이고 전지적 나레이션은 없다.

    참여 인물이 아니면 연출이 잘못 고른 것이라 실패한다(연출 결정은 모델이 정한 값이라 인물 id를 믿지 않는다).
    """
    point, _, who = pov.partition(':')
    if kind == 'narration' and point == 'omniscient':
        return None
    owner = world.characters.get(character_id or who)
    if owner is None or owner.id not in plan.characterIds:
        raise SimulationFailure(502, service.BAD_ACTION)
    return owner


async def _write(runtime: Runtime, kind: str, pov: str, character_id: str | None = None, purpose: str = 'scene',
                 feedback: list[str] | None = None) -> tuple[str, dict]:
    """한 턴을 쓴다. kind는 character(대사)·monologue(독백)·narration(나레이션). 시점 인물이 있으면 그 인물이 아는 것만으로 쓴다."""
    context: SceneContext = runtime.context
    plan, scene = context.plan, Scene.model_validate(runtime.state['scene'])
    world = await asyncio.to_thread(context.world)
    owner = _owner(world, plan, kind, pov, character_id)
    key = (len(scene.result.turns), kind, owner and owner.id)
    if key not in context.views:  # 같은 턴을 다시 쓸 때는 조회한 입력을 다시 만들지 않는다
        context.views[key] = await asyncio.to_thread(service.character_view if owner else service.narrator_view, plan, world, scene,
                                                     *([owner] if owner else []))
    asked, extra, evidence = context.views[key]
    beat, index = service.current_beat(scene.result), len(scene.result.turns)
    given = {**({'authorNote': scene.hint} if scene.hint else {}), **({'feedback': feedback} if feedback else {})}
    refusal = None
    if kind == 'character':
        action = service.acted(await asyncio.to_thread(agent.act, {**asked, **given}))
        prose, observed = action.prose.strip(), action.observed.strip()
        refusal = (action.refusalReason or '알 수 없어요.') if action.refusesBeat and plan.mode == 'flow' else None
        label = f'{owner.title}의 {index + 1}번째 장면'
    else:
        inner = kind == 'monologue'
        data = {**asked, **service.narration_input(plan, world, scene, 'monologue' if inner else purpose, pov), **given}
        written = service.narrated(await asyncio.to_thread(agent.narrate, data), monologue=inner)
        prose, observed = written.prose.strip(), '' if inner else written.observed.strip()
        label = f'{owner.title}의 {index + 1}번째 독백' if inner else f'{NARRATOR}의 {index + 1}번째 장면'
    named = owner if kind != 'narration' else None  # 나레이션은 어느 시점이든 인물이 없다. 시점 인물은 지식 범위일 뿐이다
    artifact = {'kind': kind, 'characterId': named and named.id, 'characterName': named.title if named else NARRATOR,
                'prose': prose, 'observed': observed, 'refusal': refusal, 'beat': beat.index if beat else None,
                'evidence': [e.model_dump() for e in evidence],
                'check': {'payload': {**asked, **extra}, 'kinds': service.check_kinds(plan, kind, pov),
                          'notices': 'character' if kind == 'character' else 'narration', 'who': label}}
    return f'{label}을(를) 썼어요.', artifact


@tool(response_format='content_and_artifact')
async def narrate(pov: str, purpose: str, runtime: Runtime, feedback: list[str] | None = None) -> tuple[str, dict]:
    """나레이터가 장면의 지문 한 문단을 쓴다. pov는 시점(omniscient·limited:<인물 id>·first:<인물 id>), purpose는 쓰는 이유다."""
    return await _write(runtime, 'narration', pov, purpose=purpose, feedback=feedback)


@tool(response_format='content_and_artifact')
async def monologue(pov: str, runtime: Runtime, feedback: list[str] | None = None) -> tuple[str, dict]:
    """시점 인물(limited:<인물 id>·first:<인물 id>)의 속마음을 나레이터가 그 인물이 아는 범위에서 쓴다. 인물의 대사와 따로 쓰는 턴이다."""
    return await _write(runtime, 'monologue', pov, feedback=feedback)


@tool(response_format='content_and_artifact')
async def speak(character_id: str, pov: str, runtime: Runtime, feedback: list[str] | None = None) -> tuple[str, dict]:
    """인물 한 명이 자기가 아는 것만으로 대사와 짧은 행동을 쓴다. 다른 인물의 속마음과 입력은 받지 않는다."""
    return await _write(runtime, 'character', pov, character_id=character_id, feedback=feedback)


@tool(response_format='content_and_artifact')
async def end_scene(pov: str, runtime: Runtime, feedback: list[str] | None = None) -> tuple[str, dict]:
    """장면을 맺는 마무리 지문을 쓴다. 통과하면 장면이 끝난다."""
    return await _write(runtime, 'narration', pov, purpose='closing', feedback=feedback)


TOOLS = [narrate, monologue, speak, end_scene]
