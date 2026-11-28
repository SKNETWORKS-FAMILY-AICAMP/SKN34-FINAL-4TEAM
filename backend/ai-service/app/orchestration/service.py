"""집필 AI 오케스트레이션(#473): 메인 에이전트 하나가 요청을 해석해 서브 에이전트를 부르고 답을 종합하며, 바깥 LangGraph는 승인·장면·종료와 체크포인트만 맡는다.

바깥 그래프는 main_agent → (scene ⇄ apply) → finish → summarize다. main_agent 노드가 메인 에이전트(app/orchestration/agent.py, create_agent)를 실행한다.
메인 에이전트는 턴당 1회 Decision Guard로 범위·기능을 판정받고(거절·기능 없음이면 아무것도 실행하지 않는다), 판정된 기능의
ask_* 도구(app/orchestration/tools.py)만 순서대로 불러 원본 결과를 단계로 남긴 뒤 하나의 답변(message)을 쓴다. 상태는 체크포인트에
그대로 저장할 수 있도록 JSON 값만 담는다.

멀티턴(#57): Content가 발급한 threadId의 대화는 체크포인터에 turns로 쌓인다. 메인 에이전트는 최근 5턴의 요청·답변을, Decision Guard는
처음부터 최근 3턴의 요청·답변 앞부분·실행 기능을(#781), Q&A는 이전 질문·답을 지칭 해석용 자료로만 받는다.
5턴을 넘긴 대화는 finish가 턴을 저장한 뒤 summarize 노드가 창 밖으로 새로 밀려난 턴만 기존 요약(summary {text, upTo})에 합쳐(#790) 메인 에이전트만 최근 5턴 앞의
참고용 요약 블록으로 받는다(가드·Q&A·기획 재사용은 받지 않는다). 요약이 실패하면 턴은 그대로 끝내고 요약을 두어 다음 턴에 다시 합친다.
처음부터 다시 시작하는 턴은 요약을 비우고, 중간 턴 수정·삭제는 갈라진 checkpoint의 그 시점 요약을 이어받는다. 대화는 첫 턴의 Content 확인 scope(사용자·작품)에
묶여 다른 scope로는 이어갈 수 없다. 웹 조사 외부 검색에는 대화 기록을 보내지 않는다.

HITL: 대화 안에서 작가 입력이 빠지면 그 도구가 interrupt로 멈추고 단계와 빠진 입력을 돌려준다. 같은 threadId의 resume(승인+입력 또는 취소)은
판정·앞선 도구를 다시 실행하지 않고 멈춘 도구 호출만 이어 실행한다(메인 에이전트는 바깥 체크포인터를 이어받는다). 체크포인트는
AsyncPostgresSaver가 PostgreSQL에 보관한다.

Content MCP(DEC-49): 대화 안에서 Content가 반영 대상(target)을 보내면 Writing 결과와 시뮬레이션 장면, World 보강 제안(enrich) 뒤 apply 노드가
interrupt로 작가 승인을 기다린다. 승인 resume이면 그 요청의 사용자 Bearer로 Content MCP에 초안(회차 초안, World는 세계관 초안) 반영을 요청하고, 거절이면
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

import asyncio
import base64
import dataclasses
import operator
import os
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, contextmanager
from typing import Annotated, TypedDict

from fastapi.sse import ServerSentEvent
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import merge_configs
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, errors, sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from langgraph.errors import GraphBubbleUp
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, Overwrite, interrupt

from app import agent_runtime, tracing
from app.agent_runtime import UsageLedger
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.manuscript_review import service as manuscript_review
from app.manuscript_review.models import ReviewRequest
from app.intent import service as intent
from app.intent.errors import IntentFailure
from app.intent.prompt import CLARIFY_MESSAGE, REJECT_MESSAGES
from app.orchestration import agent, mcp_tools, tools
from app.orchestration.models import (CONTENT_ACTION, ChatHistory, ChatSession, ChatTurn, OrchestrationRequest,
                                      OrchestrationResponse, Resume)
from app.orchestration.prompt import SUMMARY_HEADER, SUMMARY_INSTRUCTIONS, screen
from app.orchestration.tools import HISTORY_TURNS, guard_history, previous as _previous, task as _task
from app.simulation import service as simulation
from app.simulation.models import Scene, SimulationPlan
from app.simulation.scene_agent import scene_agent, turn as simulation_turn
from app.simulation.service import SceneContext

LIMIT_MESSAGE = '시뮬레이션이 호출 한도를 넘어 멈췄어요.'
APPROVABLE = ('writing_editing', 'character_simulation', 'world')  # 결과를 작가가 승인하면 초안에 반영하는 단계(world는 보강 제안 enrich만)
NEEDS_INPUT_MESSAGE = '작업에 필요한 자료가 빠져 있어 아무 작업도 실행하지 않았어요.'
WAITING_MESSAGE = '작업에 필요한 자료를 기다리고 있어요. 자료를 보내거나 취소하면 이어서 진행해요.'
APPROVAL_MESSAGES = {'writing_editing': 'Writing 결과를 원고 초안에 반영할지 승인해 주세요. 거절하면 반영하지 않아요.',
                     'character_simulation': '시뮬레이션 장면을 원고 초안에 반영할지 승인해 주세요. 거절하면 반영하지 않아요.',
                     'world': '설정 보강 제안을 세계관 초안에 반영할지 승인해 주세요. 거절하면 반영하지 않아요.',
                     CONTENT_ACTION: '아래 작업을 실행할지 승인해 주세요. 거절하면 실행하지 않아요.'}
CONTENT_ACTION_REJECTED = '작가가 거절해 실행하지 않았어요. 같은 작업을 다시 시도하지 마세요.'
# 같은 기능(writing_editing) 안에서 작업(task)이 승인 문구를 가르는 경우. 계획 수정은 원고 초안이 아니라 저장된 계획을 고친다.
TASK_APPROVAL_MESSAGES = {'revise_plan': '계획 수정안을 저장할지 승인해 주세요. 거절하면 저장하지 않아요.'}
CANCELLED_MESSAGE = '요청을 취소해 아무 작업도 실행하지 않았어요.'
DECLINED_AFTER_WORK_MESSAGE = '장면은 반영하지 않았어요. 앞서 끝난 작업은 그대로예요.'
SCENE_MESSAGE = '시뮬레이션 장면을 진행하고 있어요. 다음 턴을 이어 가거나 줄을 고치고 다시 말하게 하거나 끝낼 수 있어요.'
SCENE_NOT_WAITING = '지금은 장면을 조작할 수 없어요.'
SCENE_NO_TURN = '장면에 그 번호의 턴이 없어요.'
SCENE_FIRST = '장면이 끝난 뒤에 승인할 수 있어요. 지금은 장면을 이어 가거나 끝내거나 반영하지 않기로 해 주세요.'
MODEL_UNSET_MESSAGE = '집필 AI 모델 설정이 필요합니다.'
CONVERSATION_MISMATCH_MESSAGE = '다른 사용자나 작품의 대화는 이어갈 수 없습니다.'
NOTHING_TO_RESUME_MESSAGE = '이어갈 대기 중인 작업이 없습니다.'
CONVERSATION_UNAVAILABLE_MESSAGE = '대화 저장소 설정이 필요합니다.'
CONVERSATION_NOT_FOUND_MESSAGE = '대화나 메시지를 찾을 수 없습니다.'
CONVERSATION_BUSY_MESSAGE = '진행 중인 작업이 끝난 뒤에 바꿀 수 있습니다.'
TITLE_LENGTH = 40
STREAM_FAILED_MESSAGE = '작업을 완료할 수 없습니다.'
SUMMARY_MAX = 2000  # 요약 지시는 1,000자 이내다. 넘으면 이 길이에서 잘라 쓴다(사용자 결정 2026-11-25, #891)
REWRITES = 2  # 원고 반영 대기에서 턴당 다시 쓰기 횟수(#795, 비용 상한)
REWRITE_LIMIT = '이 요청에서는 더 다시 쓸 수 없어요. 반영하거나 반영하지 않기로 정해 주세요.'
NOT_PICKABLE = '고를 수 있는 보강 제안이 아니에요. 대화를 다시 불러온 뒤 골라 주세요.'
NOT_EDITABLE = '지금은 고쳐서 승인할 작업이 없어요.'


class ConversationMismatch(Exception):
    """threadId의 대화가 다른 scope(사용자·작품)에 묶여 있다."""


class NothingToResume(Exception):
    """resume을 받았지만 그 대화에 interrupt로 멈춘 실행이 없다."""


class ConversationNotFound(Exception):
    """그 scope의 대화나 턴이 없다. 다른 사용자·작품의 대화도 여기에 든다."""


class ConversationBusy(Exception):
    """멈춘 실행이 있어 상태를 덮어쓰면 이어가기(resume)가 깨지거나, 이 프로세스에서 도는 실행이 곧 쓰는 checkpoint가 바꾼 값을 덮는다."""


class ConversationUnavailable(Exception):
    """대화 체크포인트 저장소(AI_CHECKPOINT_DATABASE_URL)가 설정되지 않았다."""


class SceneRejected(Exception):
    """resume.scene을 지금 받을 수 없다: 장면·승인 대기가 아니거나 없는 턴을 가리키거나 장면이 끝나기 전에 승인했다. 메시지는 고정 문구다."""


class SummaryFailure(Exception):
    """대화 요약을 만들지 못했다. 턴은 실패시키지 않는다."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class ResumeRejected(SceneRejected):
    """승인 카드의 답(다시 쓰기·제안 고르기·고쳐서 승인, #795)을 지금 받을 수 없다. 장면 조작 거절과 같이 422·error 고정 문구다."""


class State(TypedDict, total=False):
    request: str
    operation: str | None
    materials: list[str]
    inputs: dict
    writingBaseRevision: int | None  # 후보를 만든 초안 판본, 승인까지 보존한다.
    writingCall: dict | None  # 다시 쓰기(#795)가 같은 입력으로 다시 부를 Writing 호출 기록(tools.write)
    rewrites: int  # 이번 턴에 다시 쓴 횟수(#795). REWRITES까지다
    status: str
    message: str | None
    steps: list[dict]
    missingInputs: list[str]
    choices: list[dict]  # clarify의 선택지(#794). 턴마다 비운다
    scope: str | None
    attachments: list[dict]  # 이번 턴의 첨부(Attachment JSON, Base64 포함). 이번 턴의 메인 에이전트만 본다. 다음 새 턴의 _initial이 비워 덮고 turns에는 이름·종류만 남는다(#617).
    page: dict | None  # 작가가 지금 보는 화면(PageContext JSON). 그 턴의 메인 에이전트·Decision Guard만 본다. turns에는 남기지 않는다.
    retrievalScope: dict | None  # Content가 확인한 Q&A 조회 키. 있으면 Q&A가 Retrieval로 근거를 받는다.
    target: dict | None  # Content가 확인한 Writing 반영 대상(workId·episode). 토큰은 담지 않는다.
    simulationPlan: dict | None  # ask_character_simulation이 정한 시뮬레이션 계획(SimulationPlan JSON). scene 노드가 쓴다.
    task: str | None  # 되묻기에 기능 이름으로 답한 턴이 실행할 요청(되물음을 받은 직전 요청). 없으면 request를 실행한다.
    simulationForm: dict | None  # [시뮬레이션] 버튼의 시작 양식(SimulationPlan JSON). 있으면 도구가 모델 없이 이 값을 계획으로 쓴다.
    scene: dict | None  # 끝났거나 승인을 기다리는 장면(Scene JSON). 승인 대기 중 장면 조작이 이 장면에서 이어 간다. 진행 중 장면은 에이전트 상태에 있다.
    sceneAction: dict | None  # 승인 대기에서 장면으로 돌아온 작가의 조작(SceneAction JSON). 다음 에이전트 실행이 처리한다.
    runId: str | None  # Langfuse trace id. 이 턴을 연 요청의 루트가 정한다(_claim). resume한 요청의 루트도 같은 trace에 붙는다.
    traceParent: str | None  # 이 턴을 연 요청 루트의 id. resume한 요청의 루트가 그 아래(같은 trace)에 새 루트로 붙는다.
    title: str  # 대화 제목. 첫 턴 요청 앞부분이며 rename으로만 바뀐다.
    replaceHistory: bool
    turns: Annotated[list[dict], operator.add]  # 턴마다 {request, qa, reply}를 하나씩 덧붙인다.
    summary: dict | None  # 최근 5턴 밖 턴의 누적 요약 {text, upTo}(#790). upTo는 요약에 든 마지막 턴 번호(앞에서 upTo개)다.


def _clarified(state: State) -> tuple[str, str] | None:
    """직전 턴이 고정 확인 질문(CLARIFY_MESSAGE)이었고 이번 요청이 그 보기 이름이면 (그 기능, 되물음을 받은 요청). 아니면 None.

    UI가 operation을 골랐으면 그것이 우선한다. 시뮬레이션 계획·메인 에이전트의 되묻기는 문구가 달라 해당하지 않는다.
    """
    feature, last = intent.clarified(state['request']), _previous(state)[-1:]
    if state.get('operation') or not feature or not last or (last[0].get('reply') or {}).get('message') != CLARIFY_MESSAGE:
        return None
    return feature, last[0]['request']


def _content(text: str, attachments: list[dict]):
    """메인 에이전트가 이번 턴에 받는 사람 메시지. 첨부가 없으면 글 그대로다. 있으면 글 조각 뒤에 텍스트 첨부(머리말 + 본문)와 이미지 조각(Responses API `image_url` 블록)을 붙인다."""
    if not attachments:
        return text
    blocks: list[dict] = [{'type': 'text', 'text': text}]
    for item in attachments:  # 형식·크기는 요청 검증(Attachment)이 이미 확인했다
        blocks.append({'type': 'image_url', 'image_url': {'url': f"data:{item['mediaType']};base64,{item['data']}"}} if _is_image(item)
                      else {'type': 'text', 'text': f"첨부 자료: {item['name']}\n{base64.b64decode(item['data']).decode('utf-8')}"})
    return blocks


def _is_image(item: dict) -> bool:
    return item['mediaType'].startswith('image/')


def _refs(attachments: list[dict]) -> list[dict]:
    return [{'name': a['name'], 'kind': 'image' if _is_image(a) else 'text'} for a in attachments]


def _conversation(state: State) -> list:
    """메인 에이전트가 받는 최근 5턴(거절 턴 제외)의 요청·답변과 그 앞의 이전 대화 요약(#790). 지칭 해석·맥락용이며 근거가 아니다."""
    # 가드가 거절한 턴(reply.status == 'rejected')은 통째로 빼고 센다: 가드의 guard_history와 같은 규칙이며 막은 원문을 메인 모델에 다시 보내지 않는다(#887). 되묻기 턴은 남긴다.
    kept = [t for t in _previous(state) if (t.get('reply') or {}).get('status') != 'rejected']
    recent = [m for t in kept[-HISTORY_TURNS:] for m in
              (HumanMessage(t['request']), AIMessage((t.get('reply') or {}).get('message') or ''))]
    summary = None if state.get('replaceHistory') else (state.get('summary') or {}).get('text')
    return [HumanMessage(f'{SUMMARY_HEADER}\n{summary}'), *recent] if summary else recent


async def main_agent(state: State, config: RunnableConfig) -> State:
    """새 채팅 메시지의 판정 실패는 finish에서 종료된 턴으로 저장한다."""
    try:
        return await _run_main_agent(state, config)
    except IntentFailure as error:
        if not config.get('configurable', {}).get('persist_chat_intent_failure'):
            raise
        return {'status': 'failed', 'message': str(error), 'steps': []}


async def _run_main_agent(state: State, config: RunnableConfig) -> State:
    """메인 에이전트를 실행하고 판정·단계·답변을 바깥 상태로 옮긴다.

    작가가 되묻기에 기능 이름으로 답했으면 모델에게 다시 판정시키지 않는다. 되물음을 받은 요청을 그 기능의 operation 경로(가드레일만)로
    확정하고 이번 턴은 그 요청을 실행한다(task). resume 때는 같은 노드가 다시 실행되며 메인 에이전트가 멈춘 도구 호출부터 이어 간다.
    """
    if not os.environ.get('OPENAI_API_KEY'):
        raise IntentFailure()  # 키 미설정은 판정 실패다(503)
    if not os.environ.get('OPENAI_MODEL'):
        return {'status': 'failed', 'message': MODEL_UNSET_MESSAGE, 'steps': []}
    asked = _clarified(state)
    seen = [screen(state['page'])[:2000]] if state.get('page') else []  # 화면 글은 자료일 뿐이라 Decision Guard도 materials로만 받는다
    if asked:
        decide, run_as = {'request': asked[1], 'operation': asked[0], 'materials': state['materials'], 'history': []}, asked[1]
    else:
        decide = {'request': state['request'], 'operation': state.get('operation'), 'materials': [*state['materials'], *seen],
                  'history': guard_history(state)}
        run_as = None
    turn = {**state, 'task': run_as, 'decide': decide}
    asking = _task(turn) + (f"\n\n{screen(state['page'])}" if state.get('page') else '')
    seed = {'messages': [*_conversation(state), HumanMessage(_content(asking, state.get('attachments', [])))], 'steps': [], 'inputs': state['inputs'],
            'retrievalScope': state.get('retrievalScope'), 'stopped': None, 'simulationPlan': None, 'writingBase': None, 'writingCall': None}
    found = await mcp_tools.specs()
    unavailable = '' if found is not None else f'\n\n{mcp_tools.UNAVAILABLE}'
    out = await agent.build(found or []).ainvoke(seed, config, context=turn)
    decision, steps = out['decision'], out.get('steps', [])
    if not decision['allowed']:
        return {'status': 'rejected', 'message': REJECT_MESSAGES[decision['reason']], 'steps': []}
    done: State = {'steps': steps, 'inputs': out.get('inputs', state['inputs']), 'retrievalScope': out.get('retrievalScope'),
                   'simulationPlan': out.get('simulationPlan'), 'task': run_as,
                   'message': out['messages'][-1].text + unavailable,
                   'writingBaseRevision': (out.get('writingBase') or {}).get('revision'), 'writingCall': out.get('writingCall')}
    stopped = out.get('stopped') or {}
    if stopped.get('status') == 'clarify':
        return {**done, 'status': 'clarify', 'message': stopped['message'] + unavailable, 'choices': stopped.get('choices', [])}
    if out['messages'][-1].name == agent.FAILED:
        return {**done, 'status': 'failed'}
    if stopped:
        return {**done, 'status': stopped['status'], 'missingInputs': stopped.get('missingInputs', [])}
    content = [m for m in out['messages'] if isinstance(m, ToolMessage) and m.name in mcp_tools.NAMES]
    if not steps and not content:  # 도구를 하나도 부르지 않았다: 메인 에이전트의 확인 질문(2026-11-17 사용자 결정). Content 읽기만 한 턴은 질문이 아니다.
        return {**done, 'status': 'clarify'}
    if not steps and all(m.name in mcp_tools.READ and m.status == 'error' for m in content):  # Content 읽기만 불렀고 모두 실패·차단됐으면 성공처럼 끝내지 않는다(#639). 작가가 거절한 쓰기는 실패가 아니다.
        return {**done, 'status': 'failed'}
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
    config = merge_configs(config, {'callbacks': [UsageLedger('simulation.turn', simulation_turn)]})
    out = paused = None
    with tracing.observe('step.character_simulation', as_type='agent'):
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
        kept = any(i != index and s['status'] == 'completed' for i, s in enumerate(steps))
        done.update(status='cancelled', message=DECLINED_AFTER_WORK_MESSAGE if kept else CANCELLED_MESSAGE)
    return done


def apply(state: State) -> State:
    """승인 대기 중인 Writing 결과·시뮬레이션 장면·World 보강 제안을 작가에게 보여 주고 승인하면 사용자 권한으로 Content MCP에 초안 반영을 요청한다.

    resume 때 이 노드는 처음부터 다시 실행되므로 interrupt 앞에는 부수효과를 두지 않는다. 반영 실패는 결과를 보존한 채
    단계 실패로 남겨 남은 단계를 시작하지 않는다.
    """
    steps = [dict(s) for s in state['steps']]
    pending = _pending(state)
    feature, step = pending['feature'], steps[state['steps'].index(pending)]  # _pending이 고른 단계 그대로다(같은 feature의 앞 단계를 다시 찾지 않는다)
    asked = {'steps': state['steps'], 'awaitingApproval': feature, 'approvalTask': step.get('task')}
    if feature == 'writing_editing' and step.get('task') != 'revise_plan' and state.get('writingCall'):
        asked['rewritesLeft'] = REWRITES - state.get('rewrites', 0)
    answer = interrupt(asked)
    if answer.get('refresh'):  # 다시 쓰기(#795): 반영하지 않고 같은 입력으로 새 결과를 만든 뒤 다시 승인을 기다린다(_next가 이 노드로 돌아온다)
        return _rewrite(state, steps, step, answer)
    if feature == 'character_simulation' and answer.get('scene'):
        # 승인 대신 장면을 고치거나 이어 가는 조작이다(승인·거절은 scene 없는 답으로만 한다). 단계를 다시 진행 중으로 돌리고
        # 조작은 scene 노드가 새 에이전트 실행의 시작에서 처리한다.
        step.update(status='not_started')
        step.pop('error', None)
        return {'steps': steps, 'sceneAction': answer['scene'], 'retrievalScope': answer.get('scope') or state.get('retrievalScope')}
    step['approval'] = 'approved' if answer['approved'] else 'declined'
    if answer['approved']:
        target = state['target']
        expected_revision = state.get('writingBaseRevision') if feature == 'writing_editing' else None
        try:
            with tracing.observe(f'step.{feature}.apply', as_type='tool', metadata={'episode': target['episode']}):
                if feature == 'world':
                    # 보강 제안은 세계관 초안의 그 칸만 바꾼다. applied는 회차 초안 반영과 같은 모양이라 episode는 채팅 대상 회차를 그대로 싣고(world에서는 뜻 없음)
                    # revision은 반영 뒤 세계관 초안 revision이다.
                    fixes = step['result']['fixes']
                    if picked := answer.get('selected'):  # 작가가 고른 수정안만 반영한다(#795). 번호는 _target이 확인했다
                        fixes, step['selected'] = [fixes[i] for i in picked], picked
                    saved = content_mcp.apply_world(step['result']['worldId'], step['result']['revision'], fixes)
                    step['applied'] = {'episode': target['episode'], 'revision': saved['revision']}
                elif step.get('task') == 'revise_plan':
                    # 계획 수정은 제목·내용만 저장한다. revision은 제안을 만든 때의 값이라 그 사이 계획이 바뀌었으면 쓰지 않고 409다.
                    # applied는 회차 초안 반영과 같은 모양이라 episode는 채팅 대상 회차를 그대로 싣고(뜻 없음) revision은 저장 뒤 계획 revision이다.
                    revised = step['result']
                    saved = content_mcp.apply_plan(target['workId'], revised['planId'], revised['revision'], revised['after']['title'],
                                                   revised['after']['content'])
                    step['applied'] = {'episode': target['episode'], 'revision': saved['revision']}
                else:
                    # 장면은 지문 + "대사" 문단을 빈 줄로 이어 Text 경로(초안 뒤에 잇기)로 반영한다.
                    result = step['result'] if feature == 'writing_editing' else {'text': '\n\n'.join(t['prose'] for t in step['result']['turns'])}
                    call = (state.get('writingCall') or {}) if feature == 'writing_editing' else {}
                    legacy_fork = target.get('fork') and 'forkBasis' not in call and call.get('call') in ('draft', 'plan_and_draft')
                    if call.get('forkBasis') or legacy_fork:
                        current = tools._read_context(target, '', include_settings=False, fork_draft=True)
                        basis = call.get('forkBasis')
                        if tools._fork_basis(target, current) != basis or (basis and expected_revision is None):
                            raise ContentMcpFailure(409, '집필 기준이 변경되어 반영하지 않았어요. 제안은 대화에 남아 있어요.')
                    step['applied'] = content_mcp.apply_writing(target['workId'], target['episode'], result, expected_revision=expected_revision)
        except ContentMcpFailure as error:
            step.update(status='failed', error=str(error))
    return {'steps': steps, 'retrievalScope': answer.get('scope') or state.get('retrievalScope')}


def _rewrite(state: State, steps: list[dict], step: dict, answer: dict) -> State:
    """다시 쓰기(#795): 기록한 같은 Writing 입력으로 새 결과를 만들고, 같은 턴의 후보 검수가 있으면 새 결과로 다시 검수한다.

    실패하면 마지막 결과를 보존한 채 단계 실패로 남긴다(반영 실패와 같다). 횟수는 실패해도 쓴다.
    """
    call = state['writingCall']
    try:
        with tracing.observe('step.writing_editing', as_type='agent'):
            step['result'] = tools.write(call).model_dump(mode='json')
    except tools.FAILURES as error:
        step.update(status='failed', error=str(error))
    # 후보 검수는 같은 턴에서 Writing 단계 뒤에 돈 검수다. 첫 실행이 실패해 result가 없어도 찾고, check는 작가 입력, 없으면 직전 검수 결과에서 읽는다.
    reviewed = next((s for s in steps[steps.index(step) + 1:] if s['feature'] == 'manuscript_review'), None)
    check = tools._check(state['inputs'], ((reviewed or {}).get('result') or {}).get('check'))
    if step['status'] == 'completed' and reviewed and check and call.get('base'):
        try:
            with tracing.observe('step.manuscript_review', as_type='agent'):
                target = tools._target(state, tools.ReviewFailure, tools.NO_REVIEW_TARGET)  # 첫 실행과 같은 대상 확인(없으면 단계 실패)
                result = manuscript_review.review_candidate(ReviewRequest(workId=target['workId'], episode=target['episode'], check=check),
                                                            call['base'], step['result']).model_dump(mode='json')
                reviewed.update(status='completed', result=result)
                reviewed.pop('error', None)
        except tools.FAILURES as error:
            reviewed.update(status='failed', error=str(error))
    return {'steps': steps, 'rewrites': state.get('rewrites', 0) + 1, 'retrievalScope': answer.get('scope') or state.get('retrievalScope')}


def _pending(state: State) -> dict | None:
    """대화 안의 반영 대상이 있을 때, 작가의 답을 아직 못 받은 완료된 결과(Writing·시뮬레이션 장면·World 보강 제안)의 첫 단계."""
    if not (state.get('scope') and state.get('target')):
        return None
    # 기획 결과(plans)는 원고가 아니라 반영하지 않는다. World는 보강 제안(enrich)만 반영하고 검사·영향 분석(check·impact)은 읽기뿐이다.
    return next((s for s in state['steps'] if s['feature'] in APPROVABLE and s['status'] == 'completed'
                 and 'approval' not in s and 'plans' not in s['result'] and s.get('task') not in ('check', 'impact')), None)


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
    turn = [{'request': state['request'], 'qa': qa, 'reply': reply, 'attachments': _refs(state.get('attachments', []))}]
    plan_bases = {str(i): step['forkBasis'] for i, step in enumerate(state['steps']) if step.get('forkBasis')}
    if plan_bases:
        turn[0]['planBases'] = plan_bases
    if state.get('replaceHistory'):
        return {**done, 'turns': Overwrite(turn), 'title': state['request'][:TITLE_LENGTH], 'replaceHistory': False, 'attachments': [],
                'summary': None}
    # 첨부 원본은 이 턴이 끝나면 상태에서 비운다(turns에는 이름·종류만 남는다)
    return {**done, 'turns': turn, 'attachments': []}


def summarize_node(state: State) -> State:
    """finish가 턴을 저장한 뒤 요약만 갱신한다(#891). 요약 호출이 길어져 연결이 끊겨도 이미 답한 턴은 저장돼 있다."""
    return _summarized(state.get('summary'), state.get('turns', []))


def _summarized(summary: dict | None, turns: list[dict]) -> State:
    """최근 5턴 밖으로 밀려났는데 요약에 아직 없는 턴만 기존 요약에 합친다(#790). 실패하면 요약을 그대로 두어 다음 턴에 다시 합친다.

    Decision Guard가 거절한 턴(민감정보·인젝션)은 요청 원문을 요약 모델·추적에 보내지 않고 건너뛴다(upTo는 그 턴도 지난다).
    """
    summary = summary or {'text': '', 'upTo': 0}
    upto = len(turns) - HISTORY_TURNS
    if upto <= summary['upTo']:
        return {}
    pushed = [t for t in turns[summary['upTo']:upto] if (t.get('reply') or {}).get('status') != 'rejected']
    try:
        return {'summary': {'text': summarize(summary['text'], pushed) if pushed else summary['text'], 'upTo': upto}}
    except SummaryFailure:  # orchestration.summary span에 ERROR로 남았다
        return {}


def summarize(text: str, turns: list[dict]) -> str:
    """기존 요약 text에 turns의 요청·답변을 합친 새 요약. 모델·지시문은 Langfuse 프롬프트 orchestration.summary(#705)이고 추론 강도는 낮게 둔다."""
    data = {'summary': text, 'turns': [{'request': t['request'], 'reply': (t.get('reply') or {}).get('message') or ''} for t in turns]}
    trace = {'turns': len(turns)}
    with tracing.observe('orchestration.summary', input=trace):
        message, _ = agent_runtime.run('orchestration.summary.generation', '대화 요약', SummaryFailure, SUMMARY_INSTRUCTIONS, data,
                                       prompt_name='orchestration.summary', max_tokens=2000, timeout=40, trace=trace, effort='low')
        summary = message.text.strip()
        if not summary:
            raise SummaryFailure(502, '대화 요약 모델 응답을 확인할 수 없습니다.')
    return summary[:SUMMARY_MAX]


def _next(state: State) -> str:
    """진행할 장면(scene), 승인 대기 중인 Writing 결과·시뮬레이션 장면(apply) 순으로 가고, 없으면 끝낸다.

    실패가 있으면 장면을 시작하지 않는다. 앞서 끝난 결과의 승인은 뒤 도구가 실패하거나 작가가 뒤 입력을 취소하거나 시뮬레이션이 되묻기로 끝나도 먼저 묻는다(완료한 결과 보존, #491).
    작가가 장면을 반영하지 않기로 한 턴(scene의 declined)은 묻지 않는다.
    """
    failed = any(s['status'] == 'failed' for s in state['steps'])
    if state['status'] == 'running' and not failed and state.get('simulationPlan') and any(
            s['feature'] == 'character_simulation' and s['status'] == 'not_started' for s in state['steps']):
        return 'scene'
    declined = (state.get('scene') or {}).get('declined')
    return 'apply' if state['status'] in ('running', 'cancelled', 'failed', 'clarify') and not declined and _pending(state) else 'finish'


def build() -> StateGraph:
    graph = StateGraph(State)
    graph.add_node('main_agent', main_agent)
    graph.add_node('scene', scene)
    graph.add_node('apply', apply)
    graph.add_node('finish', finish)
    graph.add_node('summarize', summarize_node)
    graph.add_edge(START, 'main_agent')
    for name in ('main_agent', 'scene', 'apply'):
        graph.add_conditional_edges(name, _next, ['scene', 'apply', 'finish'])
    graph.add_edge('finish', 'summarize')
    graph.add_edge('summarize', END)
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
    """턴마다 바뀌는 값은 모두 새로 넣어 이전 턴 결과가 이번 응답에 남지 않게 한다. runId·traceParent는 이 턴을 여는 요청의 루트가 채운다(_claim)."""
    return {'runId': None, 'traceParent': None, 'request': data.request, 'operation': data.operation, 'materials': data.materials,
            'inputs': data.inputs.model_dump(exclude_none=True), 'status': 'planning', 'message': None,
            'steps': [], 'missingInputs': [], 'choices': [], 'writingBaseRevision': None, 'writingCall': None, 'rewrites': 0, 'replaceHistory': False, 'simulationPlan': None, 'task': None,
            'scene': None, 'sceneAction': None, 'simulationForm': data.simulation.model_dump(mode='json') if data.simulation else None,
            'attachments': [a.model_dump() for a in data.attachments],
            'scope': data.conversation.scope if data.conversation else None, 'page': data.page.model_dump(exclude_none=True) if data.page else None,
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
            # 평가·지우기·삭제와 차례로: 잠금 안에서 다시 읽은 턴으로 갈라진다(#775). 스트림 실행은 잠그지 않는다.
            async with _THREAD_LOCKS[data.conversation.threadId]:
                snapshot = await CHAT.aget_state(config)
                fork = await _fork_point(config, snapshot, data.fromTurn)
                if fork is None:  # 새 첫 턴이 끝날 때까지 기존 이력을 보존한다.
                    state['replaceHistory'] = True
                else:
                    config = await _branch(config, snapshot, fork, data.fromTurn)
        return CHAT, config, state, dict(state)
    if not snapshot.interrupts:
        raise NothingToResume()
    waiting = snapshot.interrupts[0].value
    _check_scene(data.resume, waiting)
    _check_card(data.resume, waiting)
    asked = waiting.get('action_requests')
    answer = data.resume.model_dump(mode='json', exclude_none=True)
    if asked:  # Content 쓰기 도구 승인(HITL): {approved, refresh, edited}를 HumanInTheLoopMiddleware의 결정으로 바꾼다
        edited = data.resume.edited
        decision = ({'type': 'edit', 'edited_action': {'name': asked[0]['name'], 'args': edited}} if edited is not None
                    else {'type': 'approve'} if data.resume.approved else {'type': 'respond', 'message': agent.REFRESH} if data.resume.refresh
                    else {'type': 'reject', 'message': CONTENT_ACTION_REJECTED})
        # 결정에 작가가 본 카드의 인자(고쳤으면 고친 인자)를 싣는다: 승인 뒤 낡아 다시 묻는 작품 정보 수정 카드(#687)는 이어갈 때 함수가 처음부터 다시 돌아도 그 인자 그대로 실행해야 한다(mcp_tools.execute).
        answer = {'decisions': [{**decision, 'args': edited if edited is not None else a['args']} for a in asked]}
        if token := data.resume.scope:  # 결정에는 실을 자리가 없어 이 요청의 설정으로 넘긴다. WriteApproval이 저장한다(#678).
            config = merge_configs(config, {'configurable': {agent.RESUME_SCOPE: token.model_dump()}})
        if edited is not None:  # 쓰기 결과의 authorEdited가 된다(#875)
            config = merge_configs(config, {'configurable': {mcp_tools.AUTHOR_EDITED: mcp_tools.edited_fields(asked[0]['name'], asked[0]['args'], edited)}})
    return CHAT, config, Command(resume=answer), dict(snapshot.values)


def _check_card(resume: Resume, waiting: dict) -> None:
    """승인 카드의 답(#662·#795)이 멈춘 대기에 맞는지 그래프를 실행하기 전에 확인한다(어긋나면 상태가 바뀌지 않는다). 화면 밖에서 보낸 이어가기도 같다.

    refresh는 세계관 카드 수정 승인(제안 다시 받기)이나 다시 쓸 수 있는 원고 반영 대기(남은 횟수 안)에서만, selected는 World 보강 제안의 수정안 번호로만,
    edited는 Content 쓰기 승인에서 글 필드만 고친 인자로만 받는다. 맞는 대기가 없는 refresh는 다른 대기에 넘기면 취소·거절이 되므로 이어갈 작업이 없다고 본다.
    """
    asked = waiting.get('action_requests')
    if resume.refresh:
        if 'rewritesLeft' in waiting:
            if waiting['rewritesLeft'] <= 0:
                raise ResumeRejected(REWRITE_LIMIT)
        elif not asked or asked[0]['name'] != 'world_studio_edit_draft':
            raise NothingToResume()
    if resume.selected is not None:
        step = next((s for s in waiting.get('steps', []) if s['feature'] == 'world' and s.get('task') == 'enrich' and 'approval' not in s), None)
        if waiting.get('awaitingApproval') != 'world' or step is None or max(resume.selected) >= len(step['result']['fixes']):
            raise ResumeRejected(NOT_PICKABLE)
    if resume.edited is not None:
        if not asked:
            raise ResumeRejected(NOT_EDITABLE)
        if reason := mcp_tools.edit_refused(asked[0]['name'], asked[0]['args'], resume.edited):
            raise ResumeRejected(reason)


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


def _waiting(value: dict) -> dict:
    """멈춘 payload. Content 쓰기 도구 승인(HITL)은 awaitingApproval=content_action과 실제 실행할 도구·인자(pendingAction)로 바꾼다.

    이 턴에서 끝난 단계는 agent.WriteApproval이 payload에 실어 응답·스트림·이력이 같다(#587). 그 전에 멈춘 체크포인트에는 없어 빈 목록이다.
    """
    if 'action_requests' not in value:
        return value
    action = value['action_requests'][0]
    return {'steps': value.get('steps', []), 'awaitingApproval': CONTENT_ACTION,
            'pendingAction': {'tool': action['name'], 'label': mcp_tools.LABELS.get(action['name'], action['name']), 'args': action['args']}}


def _response(state: dict) -> OrchestrationResponse:
    if state.get('__interrupt__'):
        waiting = _waiting(state['__interrupt__'][0].value)
        approval, scene = waiting.get('awaitingApproval'), waiting.get('awaitingScene')
        message = (TASK_APPROVAL_MESSAGES.get(waiting.get('approvalTask')) or APPROVAL_MESSAGES[approval] if approval
                   else SCENE_MESSAGE if scene else WAITING_MESSAGE)
        if approval and state.get('message'):  # 승인 대기는 메인 에이전트가 답을 종합한 뒤라 그 답과 승인 안내를 함께 보인다
            message = '\n\n'.join((state['message'], message))
        target = state.get('target') or {}
        basis = ({'episode': target.get('baseEpisode') or target['episode'], 'episodeVersionId': version}
                 if (version := target.get('episodeVersionId')) else None)
        # 장면은 에이전트 상태에서 진행 중이라 바깥 상태의 단계에는 아직 결과가 없다. 멈춘 payload의 단계가 현재 모습이다.
        state = {**state, 'basis': basis, 'status': 'waiting', 'message': message, 'steps': waiting.get('steps', state.get('steps', [])),
                 'missingInputs': waiting.get('missingInputs', []), 'awaitingApproval': approval, 'awaitingScene': scene, 'pendingAction': waiting.get('pendingAction'),
                 'rewritesLeft': waiting.get('rewritesLeft'),
                 'approvalEpisode': target.get('episode') if approval in APPROVABLE or scene or waiting.get('missingInputs') else None}
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


def _turns(snapshot) -> list[dict]:
    """저장된 턴. 첫 턴을 고쳐 다시 실행하다 멈췄으면 옛 이력은 지워질 예정이라 없다."""
    return [] if snapshot.interrupts and snapshot.values.get('replaceHistory') else snapshot.values.get('turns', [])


def _unrated(turns: list[dict]) -> list[dict]:
    """평가는 턴이 끝난 뒤에 붙어 옛 checkpoint에는 없을 수 있으므로 갈라질 지점을 찾을 때는 뺀다."""
    return [{k: v for k, v in turn.items() if k != 'feedback'} for turn in turns]


def _running(snapshot) -> bool:
    """멈추거나 도는 실행이 있는지. 요약만 남은 checkpoint(next=('summarize',))는 턴이 이미 저장돼 끝난 대화로 본다(#891): 요약은 다음 턴에 다시 합친다(이 프로세스에서 도는 요약은 _EXECUTING이 따로 막는다)."""
    return bool(snapshot.next) and snapshot.next != ('summarize',)


# ponytail: 이 프로세스에서 실행이 도는 대화의 threadId. 요약 노드가 도는 동안(next=('summarize',))은 checkpoint가 끊겨 남은 대화와 같아 보이지만, 그 사이 쓴 제목·평가를
# 곧 끝나는 요약 checkpoint가 앞 checkpoint의 자식으로 써서 덮는다. _THREAD_LOCKS처럼 uvicorn 단일 프로세스 전제이고, 여러 프로세스로 늘리면 체크포인트 버전 비교로 바꾼다.
_EXECUTING: set[str] = set()


@contextmanager
def _executing(data: OrchestrationRequest):
    """대화 요청의 실행이 도는 동안만 그 threadId를 _EXECUTING에 둔다. 오류·연결 끊김으로 끝나도 뺀다(끊겨 남은 대화는 다시 바꿀 수 있다)."""
    thread = data.conversation.threadId if data.conversation else ''
    if thread:
        _EXECUTING.add(thread)
    try:
        yield
    finally:
        _EXECUTING.discard(thread)


async def _fork_point(config: dict, snapshot, index: int):
    """index번 턴 직전의 완료 checkpoint. 첫 턴이면 None이다. 멈춘 턴(마지막)도 고치거나 지울 수 있다."""
    turns = _turns(snapshot)
    if index > len(turns) - (0 if _running(snapshot) else 1):
        raise ConversationNotFound()
    if index == 0:
        return None
    kept = _unrated(turns[:index])
    async for past in CHAT.aget_state_history(config):
        if not _running(past) and _unrated(past.values.get('turns', [])) == kept:
            return past
    raise ConversationNotFound()


async def _branch(config: dict, snapshot, fork, index: int) -> dict:
    """fork에서 갈라지되 남는 index개 턴과 제목은 지금 값을 쓴다(fork 뒤에 남긴 평가·바꾼 제목을 잃지 않게)."""
    branched = await CHAT.aupdate_state({**config, 'configurable': fork.config['configurable']},
                                        {'title': _title(snapshot.values), 'turns': Overwrite(_turns(snapshot)[:index])}, as_node='summarize')
    return {**config, 'configurable': branched['configurable']}


def _title(values: dict) -> str:
    return values.get('title') or values.get('request', '')[:TITLE_LENGTH]


async def sessions(scope: str) -> list[ChatSession]:
    """scope의 대화를 최근 순으로. thread마다 가장 새 checkpoint의 제목과 시각을 쓴다."""
    if CHAT is None:
        raise ConversationUnavailable()
    latest = {}
    # shortcut: scope의 checkpoint를 모두 읽어 thread별로 고른다. 대화가 많아지면 thread 단위 목록 쿼리로 바꾼다.
    async for row in CHAT.checkpointer.alist(None, filter={'scope': scope}):
        if row.config['configurable'].get('checkpoint_ns'):  # 장면 에이전트 같은 하위 그래프의 checkpoint는 제목·요청이 없어 진행 중인 대화 제목이 비어 보인다
            continue
        if row.metadata.get('feedback'):  # 답변 평가는 대화를 이어간 것이 아니라 목록 순서·시각을 바꾸지 않는다(제목은 앞 checkpoint와 같다)
            continue
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
    turns = [ChatTurn(request=t['request'], reply=t.get('reply'), attachments=t.get('attachments', []), feedback=t.get('feedback'))
             for t in _turns(snapshot)]
    if snapshot.interrupts:
        turns.append(ChatTurn(request=values['request'], reply=_response({**values, '__interrupt__': snapshot.interrupts}),
                              attachments=_refs(values.get('attachments', []))))
    return ChatHistory(threadId=thread_id, title=_title(values), turns=turns)


async def rename(thread_id: str, scope: str, title: str) -> None:
    config, snapshot = await _owned(thread_id, scope)
    if _running(snapshot) or thread_id in _EXECUTING:
        raise ConversationBusy()
    await CHAT.aupdate_state(config, {'title': title}, as_node='summarize')


# ponytail: 같은 대화의 평가·지우기·삭제·메시지 수정(갈라지는 지점)은 이 프로세스 안에서만 차례로 처리한다(uvicorn 단일 프로세스, 잠금은 지우지 않는다). 여러 프로세스로 늘리면 체크포인트 버전 비교로 바꾼다.
_THREAD_LOCKS = defaultdict(asyncio.Lock)


async def delete(thread_id: str, scope: str) -> None:
    async with _THREAD_LOCKS[thread_id]:  # 먼저 읽은 평가가 삭제 뒤에 써서 지운 대화를 되살리지 못하게 한다
        await _owned(thread_id, scope)
        await CHAT.checkpointer.adelete_thread(thread_id)


async def truncate(thread_id: str, scope: str, index: int) -> None:
    """index번 턴과 그 뒤를 지운다. 첫 턴부터 지우면 대화가 없어진다."""
    async with _THREAD_LOCKS[thread_id]:  # 먼저 읽은 평가가 그 사이 지운 턴을 되살리지 못하게 읽기부터 쓰기까지 한 번에 처리한다
        config, snapshot = await _owned(thread_id, scope)
        fork = await _fork_point(config, snapshot, index)
        if fork is None:
            await CHAT.checkpointer.adelete_thread(thread_id)
            return
        await _branch(config, snapshot, fork, index)


async def feedback(thread_id: str, scope: str, index: int, value: str | None) -> None:
    """index번 턴 답변의 좋아요·싫어요(#560, None이면 취소). 그 턴의 trace(runId)가 있으면 Langfuse 점수도 맞춘다. 멈춘 실행이 있거나 이 프로세스에서 실행이 도는 중이면 409다."""
    async with _THREAD_LOCKS[thread_id]:  # 점수도 저장 순서대로 맞추려고 잠금 안에서 보낸다
        config, snapshot = await _owned(thread_id, scope)
        if _running(snapshot) or thread_id in _EXECUTING:
            raise ConversationBusy()
        turns = snapshot.values.get('turns', [])
        if not 0 <= index < len(turns):
            raise ConversationNotFound()
        turns = [{**turn, 'feedback': value} if i == index else turn for i, turn in enumerate(turns)]
        await CHAT.aupdate_state(merge_configs(config, {'metadata': {'feedback': True}}), {'turns': Overwrite(turns)}, as_node='summarize')
        if run_id := (turns[index].get('reply') or {}).get('runId'):
            await asyncio.to_thread(tracing.feedback, run_id, value)  # 점수 삭제는 동기 HTTP다


def _traced(data: OrchestrationRequest, authorization: str, state: dict):
    """한 HTTP 요청의 추적(DEC-55 v4): 요청 루트 관측 하나가 이 요청 전체를 덮는다. 새 턴은 새 trace의 루트이고, 멈춘 턴을 이어 가는
    resume 요청은 그 턴의 trace에 새 루트로 붙는다(state의 runId·traceParent).

    회원은 Bearer, 세션은 대화 id, 작품·Fork는 반영 대상(resume은 체크포인트에 남은 대상)에서 읽는다. 단계 observation은 현재 문맥(이 루트)의 하위로 붙는다.
    """
    target = state.get('target') or {}
    return tracing.request('orchestration', user_id=tracing.member_id(authorization),
                           session_id=data.conversation.threadId if data.conversation else None,
                           work_id=target.get('workId'), fork=bool(target.get('fork')),
                           trace_context=tracing.context(state.get('runId'), state.get('traceParent')))


def _claim(turn, *states: dict) -> None:
    """새 턴이면 이 요청의 루트가 그 턴의 trace다. 이어 가는 요청의 루트가 붙도록 그 id를 상태(체크포인트에 남는다)에 적는다."""
    for state in states:
        if isinstance(state, dict) and state.get('runId') is None and turn.trace_id:
            state['runId'], state['traceParent'] = turn.trace_id, turn.span_id


async def _begin(data: OrchestrationRequest, authorization: str):
    """`_target`을 부르고, 대화 확인 단계(저장소·scope 일치·이어갈 작업·장면 조작)의 실패도 실패한 요청 trace로 남긴 뒤 그대로 올린다.

    이 단계는 붙일 턴에 닿기 전이라(다른 대화의 trace에 붙이면 안 된다) 그 요청만의 새 trace가 된다. 회원·세션은 요청에서 안다.
    """
    try:
        return await _target(data)
    except Exception:
        with _traced(data, authorization, {}):
            raise


def _outcome(response: OrchestrationResponse) -> str | None:
    """턴의 상태 태그. 대기(waiting) 중인 턴은 끝나지 않았으므로 태그 없이 두고 같은 턴의 resume이 남긴다."""
    return None if response.status == 'waiting' else 'failed' if response.status == 'failed' else 'success'


async def run(data: OrchestrationRequest, authorization: str = '') -> OrchestrationResponse:
    """한 턴을 판정·실행하거나 멈춘 실행을 이어간다. 판정 실패·대화 오류는 그대로 올린다.

    authorization은 AI를 호출한 사용자의 Bearer이며 이 요청의 Content MCP 반영과 추적의 회원 식별에 쓴다.
    """
    content_mcp.AUTHORIZATION.set(authorization)
    graph, config, payload, state = await _begin(data, authorization)
    with _traced(data, authorization, state) as turn, _executing(data):
        _claim(turn, payload, state)
        response = _response(await graph.ainvoke(payload, config))
        turn.status = _outcome(response)
    return response


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

    판정·도구·업무 Agent의 바깥 작업(Content MCP 호출·Retrieval·웹 검색)마다 activity {id, label, target, status, feature}가 온다(#784).
    같은 id로 running → done|failed이며 표시용이고 저장하지 않는다. 쓰기 도구는 승인 뒤 실제 호출할 때만 알린다.

    메인 모델이 글을 쓰는 동안에는 사이사이 answer {delta}가 온다(#618). delta가 null이면 받은 글을 비운다. 표시용이고 저장하지 않으며
    완성된 답은 done의 message다.

    plan은 Decision Guard가 판정한 기능이고, started는 도구가 입력을 다 받고 실제로 실행하기 직전에 알린다. interrupt로 멈추면
    waiting(계획·빠진 입력·승인·장면 대기)과 done(status=waiting)으로 끝난다. 시뮬레이션 장면은 노드가 끝나기 전에 턴이 끝날 때마다
    장면 에이전트의 이벤트를 받아 step 이벤트(그때까지의 누적 결과, 단계 status는 아직 not_started)로 중계하고, 모델을 부르지 않은 조작
    (edit)이면 멈춘 payload의 장면을 step으로 알린 뒤 waiting(awaitingScene)을 보낸다. 응답 헤더를 보낸 뒤라
    새 대화 메시지의 판정 실패는 턴을 저장한 뒤 done(status=failed)으로 끝난다. 그 밖의 판정 실패와 대화 오류는 error로 알린다.
    """
    errors = {ConversationMismatch: CONVERSATION_MISMATCH_MESSAGE,
              NothingToResume: NOTHING_TO_RESUME_MESSAGE, ConversationUnavailable: CONVERSATION_UNAVAILABLE_MESSAGE,
              ConversationNotFound: CONVERSATION_NOT_FOUND_MESSAGE}
    content_mcp.AUTHORIZATION.set(authorization)
    relayed = False
    try:
        graph, config, payload, state = await _begin(data, authorization)
        if config is not None and data.resume is None and data.fromTurn is None:
            config = merge_configs(config, {'configurable': {'persist_chat_intent_failure': True}})
        with _traced(data, authorization, state) as turn, _executing(data):
            _claim(turn, payload, state)
            async for namespace, mode, update in graph.astream(payload, config, stream_mode=['updates', 'custom'], subgraphs=True):
                if mode == 'custom':
                    if 'started' in update:  # 도구가 입력을 다 받고 실제로 실행하기 직전에 알린 기능
                        yield ServerSentEvent(event='started', data={'feature': update['started']})
                    elif 'activity' in update:  # 진행 목록 한 줄(#784): 판정·도구·업무 Agent의 바깥 작업. 같은 id로 running → done|failed
                        yield ServerSentEvent(event='activity', data=update['activity'])
                    elif 'answer' in update:  # 메인 모델이 쓰는 중인 답변 조각(agent.AnswerStream)
                        yield ServerSentEvent(event='answer', data={'delta': update['answer']})
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
                        state['__interrupt__'] = [dataclasses.replace(change[0], value=_waiting(change[0].value))]
                        waiting = state['__interrupt__'][0].value
                        if waiting.get('awaitingScene') and not relayed:  # 턴 이벤트 없이 멈췄다(edit): 고친 장면을 알린다
                            yield ServerSentEvent(event='step', data=next(s for s in waiting['steps'] if s['feature'] == waiting['awaitingScene']))
                        yield ServerSentEvent(event='waiting', data=waiting)
                        continue
                    before = state.get('steps', [])
                    state.update(change or {})  # 바꿀 요약이 없는 summarize 갱신은 None으로 온다
                    if node == 'scene':
                        yield ServerSentEvent(event='step', data=next(s for s in state['steps'] if s['feature'] == 'character_simulation'))
                    elif node == 'apply':  # 방금 작가의 답을 받은 단계, 다시 쓰기(#795)로 결과가 바뀐 단계(후보 검수 포함)
                        for changed in [s for s, old in zip(state['steps'], before)
                                        if (s != old if 'rewrites' in change else 'approval' in s and 'approval' not in old)]:
                            yield ServerSentEvent(event='step', data=changed)
                    if node in ('main_agent', 'scene', 'apply') and _next(state) == 'scene':
                        yield ServerSentEvent(event='started', data={'feature': 'character_simulation'})
            response = _response(state)
            turn.status = _outcome(response)
            yield ServerSentEvent(event='done', data=response.model_dump(mode='json'))  # 요청 루트가 done까지 덮는다
    except (SceneRejected, IntentFailure) as error:  # 판정 실패는 원인별 고정 문구(제공사 한도·인증·시간 초과 등)를 그대로 보인다
        yield ServerSentEvent(event='error', data={'message': str(error)})
        return
    except tuple(errors) as error:
        yield ServerSentEvent(event='error', data={'message': errors[type(error)]})
        return
    except Exception:  # 체크포인트 DB 장애·버그도 연결만 끊기지 않게 알린다. 메시지에 입력이 섞일 수 있어 고정 문구만 보낸다.
        yield ServerSentEvent(event='error', data={'message': STREAM_FAILED_MESSAGE})
        return
