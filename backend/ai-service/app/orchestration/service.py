"""집필 AI 오케스트레이션(#473): 메인 에이전트 하나가 요청을 해석해 서브 에이전트를 부르고 답을 종합하며, 바깥 LangGraph는 승인·장면·종료와 체크포인트만 맡는다.

바깥 그래프는 main_agent → (scene ⇄ apply) → finish다. main_agent 노드가 메인 에이전트(app/orchestration/agent.py, create_agent)를 실행한다.
메인 에이전트는 턴당 1회 Decision Guard로 범위·기능을 판정받고(거절·기능 없음·미구현이면 아무것도 실행하지 않는다), 판정된 기능의
ask_* 도구(app/orchestration/tools.py)만 순서대로 불러 원본 결과를 단계로 남긴 뒤 하나의 답변(message)을 쓴다. 상태는 체크포인트에
그대로 저장할 수 있도록 JSON 값만 담는다.

멀티턴(#57): Content가 발급한 threadId의 대화는 체크포인터에 turns로 쌓인다. 메인 에이전트는 최근 5턴의 요청·답변을, Decision Guard는
기능을 고르지 못했을 때만 이전 요청을, Q&A는 이전 질문·답을 지칭 해석용 자료로만 받는다. 대화는 첫 턴의 Content 확인 scope(사용자·작품)에
묶여 다른 scope로는 이어갈 수 없다. 웹 조사 외부 검색에는 대화 기록을 보내지 않는다.

HITL: 대화 안에서 작가 입력이 빠지면 그 도구가 interrupt로 멈추고 단계와 빠진 입력을 돌려준다. 같은 threadId의 resume(승인+입력 또는 취소)은
판정·앞선 도구를 다시 실행하지 않고 멈춘 도구 호출만 이어 실행한다(메인 에이전트는 바깥 체크포인터를 이어받는다). 체크포인트는
AsyncPostgresSaver가 PostgreSQL에 보관한다.

Content MCP(DEC-49): 대화 안에서 Content가 반영 대상(target)을 보내면 Writing 결과와 시뮬레이션 장면 뒤 apply 노드가
interrupt로 작가 승인을 기다린다. 승인 resume이면 그 요청의 사용자 Bearer로 Content MCP에 초안 반영을 요청하고, 거절이면
쓰지 않는다. 토큰은 요청마다 컨텍스트로만 넘겨 체크포인트에 남기지 않는다. 메인 에이전트에는 반영 도구가 없다.

인물 시뮬레이션(#58·#362): ask_character_simulation 도구가 요청 문장(또는 [시뮬레이션] 버튼의 시작 양식)과 연결 세계관으로 계획을 정하고,
정하지 못하면 아무 장면도 쓰지 않고 clarify 한 문장으로 작가가 다음 채팅 메시지로 답하게 한다. 장면은 메인 에이전트가 끝난 뒤 scene 노드가
장면 에이전트(app/simulation/scene_agent.py)로 쓴다. 대화 안에서는 에이전트가 턴 사이마다 interrupt로 멈추고(waiting·awaitingScene) 같은
대화의 resume이 이 노드를 다시 실행하면 멈춘 자리에서 이어 간다. 턴이 끝날 때마다 공통 ProgressMiddleware가 장면 결과를 custom stream으로
흘려 SSE step(누적 결과)이 되고, 공통 UsageLedger가 턴별 사용량을 남긴다. 장면이 끝나면 apply 노드가 승인을 기다리며, 승인 대기 중의 장면
조작(edit·redo·next)은 scene 노드로 되돌려 이어 간다. 끝까지 가지 못해 이어 갈 수 없는 장면(첫 턴 실패)은 부분 결과와 함께 failed다.

대화 세션 CRUD(#331): 대화용 테이블 없이 체크포인터만 쓴다. 실행마다 checkpoint metadata에 scope를 남겨 목록을 거르고,
턴마다 최종 응답을 turns에 남겨 이력을 다시 그린다. 메시지 수정·삭제는 그 턴 직전의 완료 checkpoint에서 갈라져 나간다
(옛 갈래 checkpoint는 남지만 최신 상태가 아니라 보이지 않는다). scope가 다른 대화는 없는 대화로 본다.
"""

import operator
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, TypedDict

from fastapi.sse import ServerSentEvent
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import merge_configs
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, errors, sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from langgraph.errors import GraphBubbleUp
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, Overwrite, interrupt

from app import tracing
from app.agent_runtime import UsageLedger
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.intent import service as intent
from app.intent.errors import IntentFailure
from app.intent.prompt import CLARIFY_MESSAGE, REJECT_MESSAGES
from app.orchestration import agent
from app.orchestration.models import ChatHistory, ChatSession, ChatTurn, OrchestrationRequest, OrchestrationResponse, Resume
from app.orchestration.tools import (HISTORY_TURNS, UNSUPPORTED_MESSAGE, history as _history, previous as _previous, task as _task,
                                     trace as _trace)
from app.simulation import service as simulation
from app.simulation.models import Scene, SimulationPlan
from app.simulation.scene_agent import scene_agent, turn as simulation_turn
from app.simulation.service import SceneContext

LIMIT_MESSAGE = '시뮬레이션이 호출 한도를 넘어 멈췄어요.'
APPROVABLE = ('writing_editing', 'character_simulation')  # 결과를 작가가 승인하면 초안에 반영하는 단계
NEEDS_INPUT_MESSAGE = '작업에 필요한 자료가 빠져 있어 아무 작업도 실행하지 않았어요.'
WAITING_MESSAGE = '작업에 필요한 자료를 기다리고 있어요. 자료를 보내거나 취소하면 이어서 진행해요.'
APPROVAL_MESSAGES = {'writing_editing': 'Writing 결과를 원고 초안에 반영할지 승인해 주세요. 거절하면 반영하지 않아요.',
                     'character_simulation': '시뮬레이션 장면을 원고 초안에 반영할지 승인해 주세요. 거절하면 반영하지 않아요.'}
CANCELLED_MESSAGE = '요청을 취소해 아무 작업도 실행하지 않았어요.'
SCENE_MESSAGE = '시뮬레이션 장면을 진행하고 있어요. 다음 턴을 이어 가거나 줄을 고치고 다시 말하게 하거나 끝낼 수 있어요.'
SCENE_NOT_WAITING = '지금은 장면을 조작할 수 없어요.'
SCENE_NO_TURN = '장면에 그 번호의 턴이 없어요.'
SCENE_FIRST = '장면이 끝난 뒤에 승인할 수 있어요. 지금은 장면을 이어 가거나 끝내거나 반영하지 않기로 해 주세요.'
MODEL_UNSET_MESSAGE = '집필 AI 모델 설정이 필요합니다.'
ROUTER_FAILED_MESSAGE = '요청 분류에 실패했습니다.'
CONVERSATION_MISMATCH_MESSAGE = '다른 사용자나 작품의 대화는 이어갈 수 없습니다.'
NOTHING_TO_RESUME_MESSAGE = '이어갈 대기 중인 작업이 없습니다.'
CONVERSATION_UNAVAILABLE_MESSAGE = '대화 저장소 설정이 필요합니다.'
CONVERSATION_NOT_FOUND_MESSAGE = '대화나 메시지를 찾을 수 없습니다.'
CONVERSATION_BUSY_MESSAGE = '진행 중인 작업이 끝난 뒤에 바꿀 수 있습니다.'
TITLE_LENGTH = 40
STREAM_FAILED_MESSAGE = '작업을 완료할 수 없습니다.'


class ConversationMismatch(Exception):
    """threadId의 대화가 다른 scope(사용자·작품)에 묶여 있다."""


class NothingToResume(Exception):
    """resume을 받았지만 그 대화에 interrupt로 멈춘 실행이 없다."""


class ConversationNotFound(Exception):
    """그 scope의 대화나 턴이 없다. 다른 사용자·작품의 대화도 여기에 든다."""


class ConversationBusy(Exception):
    """멈춘 실행이 있어 상태를 덮어쓰면 이어가기(resume)가 깨진다."""


class ConversationUnavailable(Exception):
    """대화 체크포인트 저장소(AI_CHECKPOINT_DATABASE_URL)가 설정되지 않았다."""


class SceneRejected(Exception):
    """resume.scene을 지금 받을 수 없다: 장면·승인 대기가 아니거나 없는 턴을 가리키거나 장면이 끝나기 전에 승인했다. 메시지는 고정 문구다."""


class State(TypedDict, total=False):
    request: str
    operation: str | None
    materials: list[str]
    inputs: dict
    status: str
    message: str | None
    steps: list[dict]
    missingInputs: list[str]
    unsupported: list[str]
    scope: str | None
    retrievalScope: dict | None  # Content가 확인한 Q&A 조회 키. 있으면 Q&A가 Retrieval로 근거를 받는다.
    target: dict | None  # Content가 확인한 Writing 반영 대상(workId·episode). 토큰은 담지 않는다.
    simulationPlan: dict | None  # ask_character_simulation이 정한 시뮬레이션 계획(SimulationPlan JSON). scene 노드가 쓴다.
    task: str | None  # 되묻기에 기능 이름으로 답한 턴이 실행할 요청(되물음을 받은 직전 요청). 없으면 request를 실행한다.
    simulationForm: dict | None  # [시뮬레이션] 버튼의 시작 양식(SimulationPlan JSON). 있으면 도구가 모델 없이 이 값을 계획으로 쓴다.
    scene: dict | None  # 끝났거나 승인을 기다리는 장면(Scene JSON). 승인 대기 중 장면 조작이 이 장면에서 이어 간다. 진행 중 장면은 에이전트 상태에 있다.
    sceneAction: dict | None  # 승인 대기에서 장면으로 돌아온 작가의 조작(SceneAction JSON). 다음 에이전트 실행이 처리한다.
    runId: str | None  # Langfuse trace id. resume한 단계도 같은 trace에 붙는다.
    traceParent: str | None
    title: str  # 대화 제목. 첫 턴 요청 앞부분이며 rename으로만 바뀐다.
    replaceHistory: bool
    turns: Annotated[list[dict], operator.add]  # 턴마다 {request, qa, reply}를 하나씩 덧붙인다.


def _clarified(state: State) -> tuple[str, str] | None:
    """직전 턴이 고정 확인 질문(CLARIFY_MESSAGE)이었고 이번 요청이 그 보기 이름이면 (그 기능, 되물음을 받은 요청). 아니면 None.

    UI가 operation을 골랐으면 그것이 우선한다. 시뮬레이션 계획·메인 에이전트의 되묻기는 문구가 달라 해당하지 않는다.
    """
    feature, last = intent.clarified(state['request']), _previous(state)[-1:]
    if state.get('operation') or not feature or not last or (last[0].get('reply') or {}).get('message') != CLARIFY_MESSAGE:
        return None
    return feature, last[0]['request']


def _conversation(state: State) -> list:
    """메인 에이전트가 받는 최근 5턴의 요청·답변. 지칭 해석용이며 근거가 아니다."""
    return [m for t in _previous(state)[-HISTORY_TURNS:] for m in
            (HumanMessage(t['request']), AIMessage((t.get('reply') or {}).get('message') or ''))]


async def main_agent(state: State, config: RunnableConfig) -> State:
    """메인 에이전트를 실행하고 판정·단계·답변을 바깥 상태로 옮긴다.

    작가가 되묻기에 기능 이름으로 답했으면 모델에게 다시 판정시키지 않는다. 되물음을 받은 요청을 그 기능의 operation 경로(가드레일만)로
    확정하고 이번 턴은 그 요청을 실행한다(task). resume 때는 같은 노드가 다시 실행되며 메인 에이전트가 멈춘 도구 호출부터 이어 간다.
    """
    if not os.environ.get('OPENAI_API_KEY'):
        raise IntentFailure()  # 키 미설정은 판정 실패다(503)
    if not os.environ.get('OPENAI_MODEL'):
        return {'status': 'failed', 'message': MODEL_UNSET_MESSAGE, 'steps': []}
    asked = _clarified(state)
    if asked:
        decide, run_as = {'request': asked[1], 'operation': asked[0], 'materials': state['materials'], 'history': []}, asked[1]
    else:
        decide = {'request': state['request'], 'operation': state.get('operation'), 'materials': state['materials'],
                  'history': _history(state)}
        run_as = None
    turn = {**state, 'task': run_as, 'decide': decide}
    seed = {'messages': [*_conversation(state), HumanMessage(_task(turn))], 'steps': [], 'inputs': state['inputs'],
            'retrievalScope': state.get('retrievalScope'), 'stopped': None, 'simulationPlan': None}
    out = await agent.build().ainvoke(seed, config, context=turn)
    decision, steps = out['decision'], out.get('steps', [])
    if not decision['allowed']:
        return {'status': 'rejected', 'message': REJECT_MESSAGES[decision['reason']], 'steps': []}
    if not decision['capabilities']:
        return {'status': 'clarify', 'message': CLARIFY_MESSAGE, 'steps': []}
    if 'world_plot' in decision['capabilities']:  # 축소 실행 금지: 미구현 기능이 하나라도 있으면 아무것도 실행하지 않는다
        return {'status': 'unsupported', 'message': UNSUPPORTED_MESSAGE, 'unsupported': ['world_plot'],
                'steps': [{'feature': f, 'when': 'always', 'status': 'not_started'} for f in decision['capabilities']]}
    done: State = {'steps': steps, 'inputs': out.get('inputs', state['inputs']), 'retrievalScope': out.get('retrievalScope'),
                   'simulationPlan': out.get('simulationPlan'), 'task': run_as, 'message': out['messages'][-1].text}
    stopped = out.get('stopped') or {}
    if stopped.get('status') == 'clarify':
        return {**done, 'status': 'clarify', 'message': stopped['message']}
    if out['messages'][-1].name == agent.FAILED:
        return {**done, 'status': 'failed'}
    if stopped:
        return {**done, 'status': stopped['status'], 'missingInputs': stopped.get('missingInputs', [])}
    if not steps:  # 도구를 하나도 부르지 않았다: 메인 에이전트의 확인 질문(2026-11-17 사용자 결정)
        return {**done, 'status': 'clarify'}
    return {**done, 'status': 'running'}


async def scene(state: State, config: RunnableConfig) -> State:
    """장면 에이전트로 장면을 쓴다. 대화 안에서는 턴이 끝날 때마다 에이전트가 interrupt로 멈춘다.

    에이전트의 interrupt는 이 노드를 지나 바깥 그래프로 전달되어 waiting(awaitingScene)이 된다. 같은 대화의 resume이 이 노드를 처음부터
    다시 실행하면 에이전트는 멈춘 자리에서 이어 가므로 여기서 만드는 입력은 새 실행일 때만 쓰인다. 에이전트가 끝나면(장면 완결·작가의
    stop·반려, 이어 갈 수 없는 실패) 단계 결과를 남기고 돌아온다. 승인 대기 중 돌아온 작가의 조작(sceneAction)은 새 실행의 시작에서
    장면에 반영된다. 대화가 없으면 멈출 수 없어 에이전트가 장면이 끝날 때까지 한 번에 돈다.
    """
    steps = [dict(s) for s in state['steps']]
    plan, pausing = SimulationPlan.model_validate(state['simulationPlan']), bool(state.get('scope'))
    current = Scene.model_validate(state['scene']) if state.get('scene') else simulation.new_scene(plan)
    context = SceneContext(plan=plan, target=state.get('target'), request=_task(state), scope=state.get('retrievalScope'), steps=steps,
                           pausing=pausing)
    seed = {'messages': [HumanMessage('장면을 진행해 주세요.')], 'scene': current.model_dump(mode='json'), 'pending': False,
            'decision': None, 'action': state.get('sceneAction')}
    config = merge_configs(config, {'callbacks': [UsageLedger('simulation.turn', simulation_turn, _trace(state))]})
    out = paused = None
    with tracing.observe('step.character_simulation', as_type='agent', trace_context=_trace(state)):
        try:
            out = await scene_agent(pausing).ainvoke(seed, config, context=context)
        except GraphBubbleUp as pause:  # 턴 사이 대기는 정상이라 추적에 실패로 남기지 않는다
            paused = pause
    if paused:
        raise paused
    final = Scene.model_validate(out['scene'])
    if final.result.status in ('running', 'paused') and not final.declined:
        # 에이전트는 장면이 끝나거나 멈춰야 끝난다. 이어 갈 장면인데 끝났다면 호출 한도(안전망)가 끊은 것이다. 쌓은 턴은 두고 이유를 남긴다.
        final = simulation.stop_scene(final, LIMIT_MESSAGE, 'stopped', 'call_limit')
    index = next(i for i, s in enumerate(steps) if s['feature'] == 'character_simulation')
    steps[index] = context.step(final)
    done: State = {'steps': steps, 'sceneAction': None, 'scene': final.model_dump(mode='json')}
    if final.declined:  # 작가가 장면을 반영하지 않기로 했다
        done.update(status='cancelled', message=CANCELLED_MESSAGE)
    return done


def apply(state: State) -> State:
    """승인 대기 중인 Writing 결과나 시뮬레이션 장면을 작가에게 보여 주고 승인하면 사용자 권한으로 Content MCP에 초안 반영을 요청한다.

    resume 때 이 노드는 처음부터 다시 실행되므로 interrupt 앞에는 부수효과를 두지 않는다. 반영 실패는 결과를 보존한 채
    단계 실패로 남겨 남은 단계를 시작하지 않는다.
    """
    steps = [dict(s) for s in state['steps']]
    feature = _pending(state)['feature']
    step = next(s for s in steps if s['feature'] == feature)
    answer = interrupt({'steps': state['steps'], 'awaitingApproval': feature})
    if feature == 'character_simulation' and answer.get('scene'):
        # 승인 대신 장면을 고치거나 이어 가는 조작이다(승인·거절은 scene 없는 답으로만 한다). 단계를 다시 진행 중으로 돌리고
        # 조작은 scene 노드가 새 에이전트 실행의 시작에서 처리한다.
        step.update(status='not_started')
        step.pop('error', None)
        return {'steps': steps, 'sceneAction': answer['scene'], 'retrievalScope': answer.get('scope') or state.get('retrievalScope')}
    step['approval'] = 'approved' if answer['approved'] else 'declined'
    if answer['approved']:
        target = state['target']
        # 장면은 지문 + "대사" 문단을 빈 줄로 이어 Text 경로(초안 뒤에 잇기)로 반영한다.
        result = step['result'] if feature == 'writing_editing' else {'text': '\n\n'.join(t['prose'] for t in step['result']['turns'])}
        try:
            with tracing.observe(f'step.{feature}.apply', as_type='tool', trace_context=_trace(state),
                                 metadata={'episode': target['episode']}):
                step['applied'] = content_mcp.apply_writing(target['workId'], target['episode'], result)
        except ContentMcpFailure as error:
            step.update(status='failed', error=str(error))
    return {'steps': steps, 'retrievalScope': answer.get('scope') or state.get('retrievalScope')}


def _pending(state: State) -> dict | None:
    """대화 안의 반영 대상이 있을 때, 작가의 답을 아직 못 받은 완료된 결과(Writing·시뮬레이션 장면)의 첫 단계."""
    if not (state.get('scope') and state.get('target')):
        return None
    # 기획 결과(plans)는 원고가 아니라 반영하지 않는다.
    return next((s for s in state['steps'] if s['feature'] in APPROVABLE and s['status'] == 'completed'
                 and 'approval' not in s and 'plans' not in s['result']), None)


def finish(state: State) -> State:
    """실행 상태를 확정하고 이번 턴을 대화 기록에 남긴다. 실행하지 않은 턴도 요청과 응답은 남긴다."""
    done = {'status': state['status']}
    if state['status'] == 'running':
        done = {'status': 'failed' if any(s['status'] == 'failed' for s in state['steps']) else 'completed'}
    qa = next((s['result'] for s in state['steps'] if s['feature'] == 'story_context' and s['status'] == 'completed'),
              None)
    if qa:
        answer = ' '.join(c['text'] for c in qa['claims']) or ' '.join(qa['gaps'])
        question = state['inputs'].get('story_context', {}).get('question') or _task(state)[:500]
        qa = {'question': question, 'answer': answer[:2000]}
    reply = _response({**state, **done}).model_dump(mode='json')
    turn = [{'request': state['request'], 'qa': qa, 'reply': reply}]
    if state.get('replaceHistory'):
        return {**done, 'turns': Overwrite(turn), 'title': state['request'][:TITLE_LENGTH], 'replaceHistory': False}
    return {**done, 'turns': turn}


def _next(state: State) -> str:
    """진행할 장면(scene), 승인 대기 중인 Writing 결과·시뮬레이션 장면(apply) 순으로 가고, 없으면 끝낸다.

    실패가 있으면 장면을 시작하지 않는다. 앞서 끝난 결과의 승인은 뒤 도구가 실패하거나 작가가 뒤 입력을 취소해도 묻는다(완료한 결과 보존).
    작가가 장면을 반영하지 않기로 한 턴(scene의 declined)은 묻지 않는다.
    """
    failed = any(s['status'] == 'failed' for s in state['steps'])
    if state['status'] == 'running' and not failed and state.get('simulationPlan') and any(
            s['feature'] == 'character_simulation' and s['status'] == 'not_started' for s in state['steps']):
        return 'scene'
    declined = (state.get('scene') or {}).get('declined')
    return 'apply' if state['status'] in ('running', 'cancelled', 'failed') and not declined and _pending(state) else 'finish'


def build() -> StateGraph:
    graph = StateGraph(State)
    graph.add_node('main_agent', main_agent)
    graph.add_node('scene', scene)
    graph.add_node('apply', apply)
    graph.add_node('finish', finish)
    graph.add_edge(START, 'main_agent')
    for name in ('main_agent', 'scene', 'apply'):
        graph.add_conditional_edges(name, _next, ['scene', 'apply', 'finish'])
    graph.add_edge('finish', END)
    return graph


GRAPH = build().compile()
CHAT = None  # lifespan이 AsyncPostgresSaver로 컴파일한다. 설정이 없으면 대화 요청은 503이다.


class CheckpointDatabaseMissing(Exception):
    """체크포인트 DB가 없고 이 계정으로는 만들 수 없다(운영 외부 DB 등)."""


async def ensure_database(url: str) -> None:
    """URL의 체크포인트 DB가 없으면 같은 서버의 기본 DB(postgres)에 접속해 만든다.

    체크포인트는 Core·Content가 쓰는 DB와 다른 전용 DB(예: storyfork_ai)에 둔다. 같은 DB의 public에 먼저 테이블이 생기면
    Core Flyway가 빈 DB가 아니라며 시작을 멈춘다(#337). CREATE DATABASE는 트랜잭션 밖에서만 실행돼 autocommit으로 접속한다.
    """
    name = conninfo_to_dict(url)['dbname']
    async with await AsyncConnection.connect(make_conninfo(url, dbname='postgres'), autocommit=True) as conn:
        if await (await conn.execute('SELECT 1 FROM pg_database WHERE datname = %s', (name,))).fetchone():
            return
        try:
            await conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        except errors.DuplicateDatabase:
            pass  # 다른 AI 인스턴스가 먼저 만들었다.
        except errors.InsufficientPrivilege:
            raise CheckpointDatabaseMissing(
                f'체크포인트 DB {name}가 없고 이 계정에는 DB 생성 권한이 없습니다. DB를 먼저 만들어 주세요.') from None


@asynccontextmanager
async def lifespan(_app):
    """AI_CHECKPOINT_DATABASE_URL(postgresql://…/storyfork_ai)이 있으면 전용 DB와 체크포인트 테이블을 준비하고 대화 그래프를 연다."""
    global CHAT
    url = os.environ.get('AI_CHECKPOINT_DATABASE_URL')
    if not url:
        yield
        return
    await ensure_database(url)
    # shortcut: 연결 하나를 모든 요청이 잠금으로 나눠 쓴다. 동시 대화가 많아지면 AsyncConnectionPool로 바꾼다.
    async with AsyncPostgresSaver.from_conn_string(url) as saver:
        await saver.setup()
        CHAT = build().compile(checkpointer=saver)
        try:
            yield
        finally:
            CHAT = None


def _initial(data: OrchestrationRequest) -> State:
    """턴마다 바뀌는 값은 모두 새로 넣어 이전 턴 결과가 이번 응답에 남지 않게 한다. 턴마다 새 trace를 연다."""
    run_id, parent = tracing.start_run('writing_ai.orchestration', as_type='chain', input={'request': data.request},
                                       metadata={'operation': data.operation, 'conversation': data.conversation is not None})
    return {'runId': run_id, 'traceParent': parent, 'request': data.request, 'operation': data.operation, 'materials': data.materials,
            'inputs': data.inputs.model_dump(exclude_none=True), 'status': 'planning', 'message': None,
            'steps': [], 'missingInputs': [], 'unsupported': [], 'replaceHistory': False, 'simulationPlan': None, 'task': None,
            'scene': None, 'sceneAction': None, 'simulationForm': data.simulation.model_dump(mode='json') if data.simulation else None,
            'scope': data.conversation.scope if data.conversation else None,
            'retrievalScope': data.scope.model_dump() if data.scope else None,
            'target': data.target.model_dump(exclude_none=True) if data.target else None}


async def _target(data: OrchestrationRequest):
    """실행할 그래프·설정·입력과 스트림용 현재 상태. 대화는 같은 scope일 때만, resume은 멈춘 실행이 있을 때만 쓴다."""
    if not data.conversation:
        state = _initial(data)
        return GRAPH, None, state, dict(state)
    if CHAT is None:
        raise ConversationUnavailable()
    config = _config(data.conversation.threadId, data.conversation.scope)
    snapshot = await CHAT.aget_state(config)
    if snapshot.values.get('scope', data.conversation.scope) != data.conversation.scope:
        raise ConversationMismatch()
    if data.resume is None:
        state = {**_initial(data), 'title': snapshot.values.get('title') or data.request[:TITLE_LENGTH]}
        if data.fromTurn is not None:
            fork = await _fork_point(config, snapshot, data.fromTurn)
            if fork is None:  # 새 첫 턴이 끝날 때까지 기존 이력을 보존한다.
                state['replaceHistory'] = True
            else:
                config = {**config, 'configurable': fork.config['configurable']}
        return CHAT, config, state, dict(state)
    if not snapshot.interrupts:
        raise NothingToResume()
    _check_scene(data.resume, snapshot.interrupts[0].value)
    return CHAT, config, Command(resume=data.resume.model_dump(mode='json', exclude_none=True)), dict(snapshot.values)


def _check_scene(resume: Resume, waiting: dict) -> None:
    """멈춘 실행이 받을 수 있는 장면 조작인지 그래프를 실행하기 전에 확인한다(어긋나면 상태가 바뀌지 않는다).

    scene은 장면 대기나 장면 승인 대기에서만 받고 턴 번호는 장면 안이어야 한다. 장면이 끝나기 전의 승인(scene 없는 approved=true)은
    받지 않는다. 거절(approved=false)만 장면을 반영하지 않고 끝낸다.
    """
    on_scene = waiting.get('awaitingScene') == 'character_simulation'
    on_approval = waiting.get('awaitingApproval') == 'character_simulation'
    if resume.scene is None:
        if on_scene and resume.approved:
            raise SceneRejected(SCENE_FIRST)
        return
    if not (on_scene or on_approval):
        raise SceneRejected(SCENE_NOT_WAITING)
    shown = next(step for step in waiting['steps'] if step['feature'] == 'character_simulation')
    if resume.scene.turn is not None and resume.scene.turn >= len((shown.get('result') or {}).get('turns', [])):
        raise SceneRejected(SCENE_NO_TURN)


def _response(state: dict) -> OrchestrationResponse:
    if state.get('__interrupt__'):
        waiting = state['__interrupt__'][0].value
        approval, scene = waiting.get('awaitingApproval'), waiting.get('awaitingScene')
        message = APPROVAL_MESSAGES[approval] if approval else SCENE_MESSAGE if scene else WAITING_MESSAGE
        if approval and state.get('message'):  # 승인 대기는 메인 에이전트가 답을 종합한 뒤라 그 답과 승인 안내를 함께 보인다
            message = '\n\n'.join((state['message'], message))
        # 장면은 에이전트 상태에서 진행 중이라 바깥 상태의 단계에는 아직 결과가 없다. 멈춘 payload의 단계가 현재 모습이다.
        state = {**state, 'status': 'waiting', 'message': message, 'steps': waiting.get('steps', state.get('steps', [])),
                 'missingInputs': waiting.get('missingInputs', []), 'awaitingApproval': approval, 'awaitingScene': scene,
                 'approvalEpisode': (state.get('target') or {}).get('episode') if approval else None}
    return OrchestrationResponse.model_validate({k: v for k, v in state.items() if k in OrchestrationResponse.model_fields})


def _config(thread_id: str, scope: str) -> dict:
    """실행·갱신이 남기는 checkpoint마다 scope를 metadata로 기록해 세션 목록을 거른다."""
    return {'configurable': {'thread_id': thread_id}, 'metadata': {'scope': scope}}


async def _owned(thread_id: str, scope: str):
    if CHAT is None:
        raise ConversationUnavailable()
    config = _config(thread_id, scope)
    snapshot = await CHAT.aget_state(config)
    if not snapshot.values or snapshot.values.get('scope') != scope:
        raise ConversationNotFound()
    return config, snapshot


async def _fork_point(config: dict, snapshot, index: int):
    """index번 턴 직전의 완료 checkpoint. 첫 턴이면 None이다. 멈춘 턴(마지막)도 고치거나 지울 수 있다."""
    turns = [] if snapshot.interrupts and snapshot.values.get('replaceHistory') else snapshot.values.get('turns', [])
    if index > len(turns) - (0 if snapshot.next else 1):
        raise ConversationNotFound()
    if index == 0:
        return None
    async for past in CHAT.aget_state_history(config):
        if not past.next and past.values.get('turns') == turns[:index]:
            return past
    raise ConversationNotFound()


def _title(values: dict) -> str:
    return values.get('title') or values.get('request', '')[:TITLE_LENGTH]


async def sessions(scope: str) -> list[ChatSession]:
    """scope의 대화를 최근 순으로. thread마다 가장 새 checkpoint의 제목과 시각을 쓴다."""
    if CHAT is None:
        raise ConversationUnavailable()
    latest = {}
    # shortcut: scope의 checkpoint를 모두 읽어 thread별로 고른다. 대화가 많아지면 thread 단위 목록 쿼리로 바꾼다.
    async for row in CHAT.checkpointer.alist(None, filter={'scope': scope}):
        thread = row.config['configurable']['thread_id']
        if thread not in latest or row.checkpoint['id'] > latest[thread].checkpoint['id']:
            latest[thread] = row
    rows = sorted(latest.values(), key=lambda row: row.checkpoint['id'], reverse=True)
    return [ChatSession(threadId=row.config['configurable']['thread_id'], title=_title(row.checkpoint['channel_values']),
                        updatedAt=row.checkpoint['ts']) for row in rows]


async def history(thread_id: str, scope: str) -> ChatHistory:
    """최신 상태의 턴과 각 응답. 멈춘 실행이 있으면 그 턴을 waiting 응답과 함께 마지막에 붙인다."""
    _, snapshot = await _owned(thread_id, scope)
    values = snapshot.values
    previous = [] if snapshot.interrupts and values.get('replaceHistory') else values.get('turns', [])
    turns = [ChatTurn(request=t['request'], reply=t.get('reply')) for t in previous]
    if snapshot.interrupts:
        turns.append(ChatTurn(request=values['request'], reply=_response({**values, '__interrupt__': snapshot.interrupts})))
    return ChatHistory(threadId=thread_id, title=_title(values), turns=turns)


async def rename(thread_id: str, scope: str, title: str) -> None:
    config, snapshot = await _owned(thread_id, scope)
    if snapshot.next:
        raise ConversationBusy()
    await CHAT.aupdate_state(config, {'title': title}, as_node='finish')


async def delete(thread_id: str, scope: str) -> None:
    await _owned(thread_id, scope)
    await CHAT.checkpointer.adelete_thread(thread_id)


async def truncate(thread_id: str, scope: str, index: int) -> None:
    """index번 턴과 그 뒤를 지운다. 첫 턴부터 지우면 대화가 없어진다."""
    config, snapshot = await _owned(thread_id, scope)
    fork = await _fork_point(config, snapshot, index)
    if fork is None:
        await CHAT.checkpointer.adelete_thread(thread_id)
        return
    await CHAT.aupdate_state({**config, 'configurable': fork.config['configurable']}, {'title': _title(snapshot.values)},
                             as_node='finish')


async def run(data: OrchestrationRequest, authorization: str = '') -> OrchestrationResponse:
    """한 턴을 판정·실행하거나 멈춘 실행을 이어간다. 판정 실패·대화 오류는 그대로 올린다.

    authorization은 AI를 호출한 사용자의 Bearer이며 이 요청의 Content MCP 반영에만 쓴다.
    """
    content_mcp.AUTHORIZATION.set(authorization)
    graph, config, payload, _ = await _target(data)
    return _response(await graph.ainvoke(payload, config))


def _main_events(update: dict) -> list[ServerSentEvent]:
    """메인 에이전트 안쪽 갱신의 SSE: Decision Guard 판정은 plan(판정 기능을 대기 단계로), 도구가 남긴 단계는 step이다.

    시뮬레이션 계획만 세운 단계(not_started)는 장면을 쓰는 scene 노드가 알린다.
    """
    events = []
    for node, change in update.items():
        for item in change if isinstance(change, list) else [change]:
            if not isinstance(item, dict):
                continue
            if (decided := item.get('decision')) and decided['allowed'] and decided['capabilities']:
                events.append(ServerSentEvent(event='plan', data={'steps': [
                    {'feature': f, 'when': 'always', 'status': 'not_started'} for f in decided['capabilities']]}))
            elif node == 'tools' and item.get('steps') and item['steps'][-1]['status'] != 'not_started':
                events.append(ServerSentEvent(event='step', data=item['steps'][-1]))
    return events


async def stream(data: OrchestrationRequest, authorization: str = '') -> AsyncIterator[ServerSentEvent]:
    """같은 그래프를 흘려 plan → (started → step)* → done 이벤트를 보낸다.

    plan은 Decision Guard가 판정한 기능이고, started는 도구가 입력을 다 받고 실제로 실행하기 직전에 알린다. interrupt로 멈추면
    waiting(계획·빠진 입력·승인·장면 대기)과 done(status=waiting)으로 끝난다. 시뮬레이션 장면은 노드가 끝나기 전에 턴이 끝날 때마다
    장면 에이전트의 이벤트를 받아 step 이벤트(그때까지의 누적 결과, 단계 status는 아직 not_started)로 중계하고, 모델을 부르지 않은 조작
    (edit)이면 멈춘 payload의 장면을 step으로 알린 뒤 waiting(awaitingScene)을 보낸다. 응답 헤더를 보낸 뒤라
    Router 실패·대화 오류는 HTTP 상태 대신 error 이벤트 하나로 알린다.
    """
    errors = {IntentFailure: ROUTER_FAILED_MESSAGE, ConversationMismatch: CONVERSATION_MISMATCH_MESSAGE,
              NothingToResume: NOTHING_TO_RESUME_MESSAGE, ConversationUnavailable: CONVERSATION_UNAVAILABLE_MESSAGE,
              ConversationNotFound: CONVERSATION_NOT_FOUND_MESSAGE}
    content_mcp.AUTHORIZATION.set(authorization)
    relayed = False
    try:
        graph, config, payload, state = await _target(data)
        async for namespace, mode, update in graph.astream(payload, config, stream_mode=['updates', 'custom'], subgraphs=True):
            if mode == 'custom':
                if 'started' in update:  # 도구가 입력을 다 받고 실제로 실행하기 직전에 알린 기능
                    yield ServerSentEvent(event='started', data={'feature': update['started']})
                else:  # 장면 에이전트가 턴이 끝날 때 낸 그때까지의 결과
                    relayed = True
                    yield ServerSentEvent(event='step', data=update)
                continue
            if namespace:  # 메인 에이전트의 판정·도구 결과만 알리고 장면 에이전트 안쪽 노드의 갱신은 알리지 않는다
                if len(namespace) == 1 and namespace[0].startswith('main_agent'):
                    for event in _main_events(update):
                        yield event
                continue
            for node, change in update.items():
                if node == '__interrupt__':
                    state['__interrupt__'] = change
                    waiting = change[0].value
                    if waiting.get('awaitingScene') and not relayed:  # 턴 이벤트 없이 멈췄다(edit): 고친 장면을 알린다
                        yield ServerSentEvent(event='step', data=next(s for s in waiting['steps'] if s['feature'] == waiting['awaitingScene']))
                    yield ServerSentEvent(event='waiting', data=waiting)
                    continue
                before = state.get('steps', [])
                state.update(change)
                if node == 'scene':
                    yield ServerSentEvent(event='step', data=next(s for s in state['steps'] if s['feature'] == 'character_simulation'))
                elif node == 'apply' and (answered := next((s for s, old in zip(state['steps'], before)
                                                            if 'approval' in s and 'approval' not in old), None)):  # 방금 작가의 답을 받은 단계
                    yield ServerSentEvent(event='step', data=answered)
                if node in ('main_agent', 'scene', 'apply') and _next(state) == 'scene':
                    yield ServerSentEvent(event='started', data={'feature': 'character_simulation'})
    except SceneRejected as error:
        yield ServerSentEvent(event='error', data={'message': str(error)})
        return
    except tuple(errors) as error:
        yield ServerSentEvent(event='error', data={'message': errors[type(error)]})
        return
    except Exception:  # 체크포인트 DB 장애·버그도 연결만 끊기지 않게 알린다. 메시지에 입력이 섞일 수 있어 고정 문구만 보낸다.
        yield ServerSentEvent(event='error', data={'message': STREAM_FAILED_MESSAGE})
        return
    yield ServerSentEvent(event='done', data=_response(state).model_dump(mode='json'))
