"""인물 시뮬레이션의 장면 에이전트(#362): LangChain `create_agent` + 미들웨어로 장면을 턴 하나씩 쓴다.

한 번 도는 루프는 이렇다. `StageMiddleware.before_model`(작가의 조작을 기다리는 턴 사이 interrupt) → `DirectorMiddleware.before_model`
(연출 결정: 이번 턴·화자·시점) → 모델 노드(`DirectorMiddleware.wrap_model_call`이 결정대로 도구 호출을 만든다. 도구를 고르는 건 연출
결정이라 실제 모델은 부르지 않는다) → 도구(나레이션·독백·대사·마무리) → `SceneCheckMiddleware.wrap_tool_call`(검사, 위반이면 그 턴만 최대
2회 재실행, 통과한 턴을 장면에 붙임). 호출 한도는 라이브러리의 ModelCallLimit·ToolCallLimit이 안전망으로 지킨다. 한도에 닿으면
예외 없이 에이전트가 끝나(exit_behavior='end') 쌓은 장면이 상태에 그대로 남는다. 에이전트는 장면이 끝나거나 멈춰야만 끝나므로 이어 갈
장면(paused·running)인데 끝났다면 한도가 끊은 것이고, 바깥 오케스트레이션이 그 이유(call_limit)를 남긴다.
에이전트 상태는 체크포인트에 남는다: 바깥 오케스트레이션 노드 안에서 돌리면 interrupt가 바깥 그래프로 전달되고, 같은 대화의
resume이 이 에이전트를 멈춘 자리에서 이어 간다. 장면은 JSON(`Scene`)으로만 상태에 둔다.
"""

import asyncio
from functools import lru_cache
from typing import Any, NotRequired

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, AgentState, ModelCallLimitMiddleware, ToolCallLimitMiddleware, hook_config
from langchain.agents.middleware.types import ModelResponse
from langchain_core.callbacks import adispatch_custom_event
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.types import Command, interrupt

from app.content_mcp.errors import ContentMcpFailure
from app.retrieval.errors import RetrievalFailure
from app.simulation import agent, director, service
from app.simulation.errors import SimulationFailure
from app.simulation.models import Check, CheckItem, Decision, Evidence, Scene, SceneAction, Trail, Turn
from app.simulation.prompt import FEEDBACK, KIND_LABELS, NARRATION_FEEDBACK
from app.simulation.service import SceneContext
from app.simulation.tools import TOOLS

FAILURES = (SimulationFailure, RetrievalFailure, ContentMcpFailure)
LOOP_LIMIT = service.MAX_TURNS * 2  # 모델·도구 호출 안전망. 정상 장면은 턴마다 한 번씩만 부른다
TOOL_OF = {'narration': 'narrate', 'monologue': 'monologue', 'speech': 'speak', 'end': 'end_scene'}
TURN_LIMIT_MESSAGE = f'인물 대사 턴 한도({service.TURN_LIMIT})까지 장면이 끝나지 않아 멈췄어요.'


class SceneState(AgentState):
    """장면 에이전트 상태. scene은 장면 JSON이고, decision은 이번 반복의 연출 결정, pending은 턴이 만들어져 작가를 기다려야 한다는 표시다."""
    scene: NotRequired[dict]
    action: NotRequired[dict | None]  # 바깥 그래프가 이어 주는 작가의 조작(승인 대기에서 장면으로 돌아온 경우)
    decision: NotRequired[dict | None]
    pending: NotRequired[bool]


def _dump(scene: Scene) -> dict:
    return scene.model_dump(mode='json')


class StageMiddleware(AgentMiddleware):
    """턴 단위 사람 개입(HITL에 준하는 interrupt): 턴이 만들어지면 다음 반복 앞에서 멈춰 작가의 조작(next·edit·redo·stop)을 기다린다.

    next·redo는 장면에 반영하고 다음 턴으로 가며, edit는 글만 바꾸고 다시 멈춘다. stop(완결)·반려(declined)한 장면은 이어서
    DirectorMiddleware가 에이전트를 끝낸다. 쌓은 턴이 없으면(첫 턴 실패) 이어 갈 장면이 없어 멈추지 않는다. interrupt 앞에는 부수효과를
    두지 않는다(재개 때 이 훅이 처음부터 다시 실행된다).
    """
    state_schema = SceneState

    async def abefore_agent(self, state: SceneState, runtime) -> dict[str, Any] | None:
        """바깥 그래프가 이어 준 조작(승인 대기 중 edit·redo·next)을 새 실행의 시작에서 장면에 반영한다."""
        if not state.get('action'):
            return None
        scene = service.apply_action(Scene.model_validate(state['scene']), SceneAction.model_validate(state['action']))
        return {'scene': _dump(scene), 'action': None}

    async def abefore_model(self, state: SceneState, runtime) -> dict[str, Any] | None:
        if not state.get('pending'):
            return None
        context: SceneContext = runtime.context
        scene = Scene.model_validate(state['scene'])
        if scene.result.status == 'completed' or not scene.result.turns:  # 끝난 장면은 바깥 그래프의 승인으로 넘기고, 쌓은 턴이 없으면 이어 갈 장면이 없다
            return {'pending': False}
        while True:
            answer = interrupt({'steps': context.live_steps(scene), 'awaitingScene': 'character_simulation'})
            context.scope = answer.get('scope') or context.scope  # Content가 재개마다 새로 서명한 조회 토큰
            if answer.get('scene') is None:  # 장면 없는 거절: 반영하지 않고 끝낸다(승인은 서버가 이 대기에서 먼저 막았다)
                return {'scene': _dump(scene.model_copy(update={'declined': True})), 'pending': False}
            action = SceneAction.model_validate(answer['scene'])
            scene = service.apply_action(scene, action)
            if action.action != 'edit':
                return {'scene': _dump(scene), 'pending': False}


class DirectorMiddleware(AgentMiddleware):
    """연출: 인물이 말하기 전에 반드시 이번 턴(나레이션·독백·대사·마무리)·화자·시점을 정하고 그 결정대로 도구 호출을 만든다.

    장면 시작·메모·비트 전환·마무리처럼 규칙이 정한 턴(service.rules)은 선택지를 좁혀 묻는다. 다시 말하기는 기록된 결정을 그대로 쓴다.
    한도에 닿거나 결정이 실패하면 장면을 멈춘 상태로 두고(대화 안이면 작가가 이어 간다) 장면을 끝낼 수 없을 때만 에이전트를 끝낸다.
    """
    state_schema = SceneState

    @hook_config(can_jump_to=['end', 'model'])
    async def abefore_model(self, state: SceneState, runtime) -> dict[str, Any] | None:
        context: SceneContext = runtime.context
        scene = Scene.model_validate(state['scene'])
        if scene.declined or scene.result.status in ('completed', 'stopped', 'failed'):
            return {'jump_to': 'end'}  # 멈춘 장면은 StageMiddleware가 작가의 조작으로 되살린 뒤에만 이어진다
        stop = 'model' if context.pausing else 'end'
        allowed, required = service.rules(context.plan, scene)
        if not allowed:
            return {'scene': _dump(service.stop_scene(scene, TURN_LIMIT_MESSAGE, 'stopped', 'turn_limit')), 'pending': True, 'jump_to': stop}
        try:
            world = await asyncio.to_thread(context.world)
            service.check_plan(context.plan, world)  # 다시 말하기도 참여 인물이 지금 세계관에 모두 있는지 먼저 본다(세계관은 요청마다 다시 읽는다)
            scene = service.with_notice(scene, world.notice)  # 원고 발췌를 못 쓰고 진행한다는 것을 장면 결과에 알린다(숨기지 않는다)
            if scene.redo:
                return {'scene': _dump(scene), 'decision': scene.redo.model_dump()}
            cast = [{'id': i, 'name': world.characters[i].title} for i in context.plan.characterIds]
            last = scene.result.turns[-1].pov if scene.result.turns else None
            decision = await director.decide(service.director_state(context.plan, scene, required), allowed, cast, last)
        except FAILURES as failure:
            return {'scene': _dump(service.stop_scene(scene, str(failure), 'failed')), 'pending': True, 'jump_to': stop}
        return {'scene': _dump(scene), 'decision': decision.model_dump()}

    async def awrap_model_call(self, request, handler) -> ModelResponse:
        """결정대로 도구 호출을 만든다. 무엇을 쓸지는 연출 결정이 이미 정했으므로 모델을 다시 부르지 않는다."""
        decision = Decision.model_validate(request.state['decision'])
        scene = Scene.model_validate(request.state['scene'])
        purpose = service.rules(request.runtime.context.plan, scene)[1] or 'scene'
        args = {'narration': {'pov': decision.pov, 'purpose': purpose}, 'monologue': {'pov': decision.pov},
                'speech': {'character_id': decision.speaker, 'pov': decision.pov}, 'end': {'pov': decision.pov}}[decision.turn]
        call = {'name': TOOL_OF[decision.turn], 'args': args, 'id': f'turn-{len(scene.result.turns)}', 'type': 'tool_call'}
        return ModelResponse(result=[AIMessage(content='', tool_calls=[call])])


class SceneCheckMiddleware(AgentMiddleware):
    """장면 검사: 도구가 쓴 턴을 누설·말투·호칭(나레이션은 미래 누설)으로 검사하고, 위반이면 그 턴만 최대 2회 다시 쓰게 한다.

    통과하면 턴을 장면에 붙이고 끝내면 stopReason 없이 completed가 된다. 계속 위반하거나 비트를 따르지 않거나 호출이 실패하면 쌓은
    턴은 그대로 두고 stopped·failed와 이유를 남긴다. 턴이 끝날 때마다 장면의 현재 결과를 이벤트로 알린다(콜백이 SSE로 중계한다).
    """
    state_schema = SceneState

    async def awrap_tool_call(self, request, handler):
        call = request.tool_call
        context: SceneContext = request.runtime.context
        scene, decision = Scene.model_validate(request.state['scene']), Decision.model_validate(request.state['decision'])
        feedback: list[str] = []
        try:
            for attempt in range(service.REGENERATIONS + 1):
                again = request.override(tool_call={**call, 'args': {**call['args'], **({'feedback': feedback} if feedback else {})}})
                made = (await handler(again)).artifact
                if made['refusal'] is not None:  # 인물이 성격상 비트를 따를 수 없다고 한다: 기획 쪽 문제라 다시 쓰지 않는다
                    beat = next(b for b in scene.result.beats if b.index == made['beat'])
                    message = (f'{made["characterName"]}이(가) 비트 “{beat.text}”을(를) 따르지 않아 멈췄어요. 흐름을 고치거나 이대로 진행할지 정해 주세요. '
                               f'이유: {made["refusal"][:service.CUT]}')
                    return await self._done(call, context, service.stop_scene(scene, message, 'stopped', 'beat_rejected', made['beat']), 'error')
                spec = made['check']
                if problem := service.style_problem(made['prose'], spec['payload'].get('actionStyle')):  # 확실한 문체 위반은 검사 모델을 부르지 않고 다시 쓴다
                    failed = [CheckItem(kind='voice_mix', passed=False, detail=problem, refs=[])]
                else:
                    payload = {**spec['payload'], 'checks': spec['kinds'], 'paragraph': made['prose']}
                    verdict = await asyncio.to_thread(agent.check, payload)
                    service.verify(verdict, spec['kinds'], payload)
                    failed = [c for c in verdict.checks if not c.passed]
                    if not failed:
                        return await self._added(call, context, scene, decision, made, verdict, attempt)
                notices = NARRATION_FEEDBACK if spec['notices'] == 'narration' else FEEDBACK
                feedback = [notices[c.kind] for c in failed]
            labels = ', '.join(KIND_LABELS[c.kind] for c in failed)
            message = f'{spec["who"]}이(가) 검사를 통과하지 못해 멈췄어요: {labels}. {failed[0].detail[:service.CUT]}'
            return await self._done(call, context, service.stop_scene(scene, message, 'stopped', 'check_failed'), 'error')
        except FAILURES as failure:
            return await self._done(call, context, service.stop_scene(scene, str(failure), 'failed'), 'error')

    async def _added(self, call: dict, context: SceneContext, scene: Scene, decision: Decision, made: dict, verdict, attempt: int) -> Command:
        turn_kind = made['kind']
        beat = next((b for b in scene.result.beats if b.index == made['beat']), None)
        done = turn_kind == 'character' and context.plan.mode == 'flow' and verdict.beatDone
        ended = turn_kind == 'character' and (
            verdict.sceneComplete if context.plan.mode == 'if' else done and all(b.status == 'done' or b is beat for b in scene.result.beats))
        turn = Turn(index=len(scene.result.turns), kind=turn_kind, characterId=made['characterId'], characterName=made['characterName'],
                    prose=made['prose'], regenerated=attempt, pov=decision.pov, evidence=[Evidence(**e) for e in made['evidence']],
                    checks=[Check(kind=c.kind, passed=c.passed, detail=c.detail[:service.CUT]) for c in verdict.checks] if turn_kind == 'character' else [])
        entry = Trail(decision=decision, observed=made['observed'], beat=made['beat'], done=done, ended=ended,
                      closing=decision.turn == 'end', note=scene.memo if turn_kind == 'narration' else None)
        return await self._done(call, context, service.add_turn(scene, turn, entry))

    async def _done(self, call: dict, context: SceneContext, scene: Scene, status: str = 'success') -> Command:
        await adispatch_custom_event('scene', context.step(scene))
        message = ToolMessage(content=scene.error or '턴을 장면에 붙였어요.', tool_call_id=call['id'], name=call['name'], status=status)
        return Command(update={'scene': _dump(scene), 'pending': True, 'decision': None, 'messages': [message]})

    async def aafter_agent(self, state: SceneState, runtime) -> dict[str, Any] | None:
        """에이전트가 끝날 때 결과를 정리한다: 턴 사이 표시를 비운다. 마지막 결과는 바깥 그래프의 단계 결과가 알린다."""
        return {'pending': False, 'decision': None}


class DirectorModel(BaseChatModel):
    """create_agent가 요구해서 두는 자리 표시 모델. 도구 호출은 연출 결정이 만들어 모델 노드에서 호출되지 않는다."""

    @property
    def _llm_type(self) -> str:
        return 'director-decides'

    def _generate(self, *args: Any, **kwargs: Any) -> ChatResult:
        raise RuntimeError('장면 에이전트는 모델을 부르지 않는다. 도구 호출은 연출 결정이 만든다.')

    def bind_tools(self, tools, **kwargs: Any):
        return self


def build_scene_agent(pausing: bool, checkpointer=None):
    """장면 에이전트. pausing이면 턴 사이에서 멈춘다(대화 안, 체크포인터 필요). 아니면 장면이 끝날 때까지 한 번에 돈다."""
    return create_agent(
        DirectorModel(), tools=TOOLS, name='scene_agent', context_schema=SceneContext, checkpointer=checkpointer,
        middleware=[*([StageMiddleware()] if pausing else []), DirectorMiddleware(),
                    ModelCallLimitMiddleware(thread_limit=LOOP_LIMIT, run_limit=LOOP_LIMIT, exit_behavior='end'),
                    ToolCallLimitMiddleware(thread_limit=LOOP_LIMIT, run_limit=LOOP_LIMIT, exit_behavior='end'), SceneCheckMiddleware()])


@lru_cache(maxsize=2)
def scene_agent(pausing: bool):
    """바깥 오케스트레이션 노드가 부르는 에이전트. 체크포인터는 바깥 그래프의 것을 이어받는다."""
    return build_scene_agent(pausing)
