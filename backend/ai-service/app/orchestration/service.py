"""집필 AI 오케스트레이션: Intent Router 계획을 Python이 검증하고 구현된 업무 Agent를 LangGraph로 순차 실행한다.

plan 노드가 Router를 호출해 단계를 받고, 미구현 기능·조건부 단계가 하나라도 있으면 아무 Agent도 실행하지 않는다
(축소 실행 금지). gate 노드는 단계 입력을 확인하고, 통과하면 기능 노드가 계획 순서대로 하나씩 실행된다.
실패한 뒤에는 새 단계를 시작하지 않는다. 결과는 각 Agent의 원본 결과를 계획 순서로 묶을 뿐 종합 모델을 호출하지 않는다.
상태는 체크포인트에 그대로 저장할 수 있도록 JSON 값만 담는다.

멀티턴(#57): Content가 발급한 threadId의 대화는 체크포인터에 turns로 쌓이고, 다음 턴의 Router에는 이전 요청을,
Q&A에는 이전 질문·답을 지칭 해석용 자료로만 넘긴다. 대화는 첫 턴의 Content 확인 scope(사용자·작품)에 묶여
다른 scope로는 이어갈 수 없다. 웹 조사 외부 검색에는 대화 기록을 보내지 않는다.

HITL: 대화 안에서 단계 입력이 빠지면 gate가 interrupt로 멈추고 계획과 빠진 입력을 돌려준다. 같은 threadId의
resume(승인+입력 또는 취소)으로 Router를 다시 부르지 않고 저장된 계획을 이어 실행한다. 체크포인트는
AsyncPostgresSaver가 PostgreSQL에 보관한다.

Content MCP(DEC-49): 대화 안에서 Content가 반영 대상(target)을 보내면 Writing 결과 뒤 apply 노드가 interrupt로
작가 승인을 기다린다. 승인 resume이면 그 요청의 사용자 Bearer로 Content MCP에 초안 반영을 요청하고, 거절이면 쓰지 않는다.
토큰은 요청마다 컨텍스트로만 넘겨 체크포인트에 남기지 않는다.

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
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, errors, sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, Overwrite, interrupt

from app import tracing
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.intent import service as intent
from app.intent.errors import IntentFailure
from app.manuscript import service as manuscript
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest
from app.orchestration.models import (ChatHistory, ChatSession, ChatTurn, OrchestrationRequest, OrchestrationResponse,
                                      QaStepResult)
from app.research import service as research
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest
from app.retrieval import service as retrieval
from app.retrieval.errors import RetrievalFailure
from app.retrieval.models import RetrievalScope
from app.writing import agent as writing
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest



def _story_context(data: dict | None, state: dict) -> QaStepResult:
    """Q&A. 발췌가 없으면 공통 Retrieval 도구로 Content가 확인한 근거를 받아 온다. 근거가 없으면 모델을 부르지 않는다."""
    gaps, coverage = [], None
    if data is None:
        # shortcut: 검색어는 이번 요청 문장 그대로다. 지칭만 있는 후속 질문의 검색이 약하면 이전 질문을 붙이는 재작성을 검토한다.
        found = retrieval.retrieve(RetrievalScope.model_validate(state['retrievalScope']), state['request'])
        gaps, coverage = [g.detail for g in found.gaps], found.coverage
        if not found.excerpts:
            return QaStepResult(claims=[], gaps=gaps, coverage=coverage)
        data = {'question': state['request'][:500], 'excerpts': [e.model_dump() for e in found.excerpts]}
    history = [] if state.get('replaceHistory') else [t['qa'] for t in state.get('turns', []) if t['qa']][-HISTORY_TURNS:]
    answer = manuscript.answer(AnswerRequest.model_validate({**data, 'history': history}))
    cited = {i for claim in answer.claims for i in claim.sourceIds}
    return QaStepResult(claims=answer.claims, gaps=gaps + answer.gaps, coverage=coverage,
                        sources=[e for e in data['excerpts'] if e['id'] in cited])


# 구현된 업무 Agent. 입력은 StepInputs의 같은 이름 필드(JSON)다.
# Q&A만 대화 기록·Retrieval을 쓴다. 웹 조사는 외부 전송이라 작가가 고른 질문·맥락 외에는 보내지 않는다.
CALLS = {
    'story_context': _story_context,
    'writing_editing': lambda data, state: (writing.draft(DraftRequest.model_validate(data['draft'])) if 'draft' in data
                                            else writing.patch(PatchRequest.model_validate(data['patch']))),
    'web_research': lambda data, state: research.research(ResearchRequest.model_validate(data)),
}
# shortcut: 최근 5턴만 넘기고 요약하지 않는다. 긴 대화의 앞부분 지칭이 필요해지면 요약을 검토한다.
HISTORY_TURNS = 5
FAILURES = (ManuscriptFailure, WritingFailure, ResearchFailure, RetrievalFailure)
UNSUPPORTED_MESSAGE = ('요청에 아직 실행할 수 없는 작업이 있어 아무 작업도 실행하지 않았어요. '
                       '작품 질문, 집필·수정, 고증 조사는 각각 요청할 수 있어요.')
NEEDS_INPUT_MESSAGE = '작업에 필요한 자료가 빠져 있어 아무 작업도 실행하지 않았어요.'
WAITING_MESSAGE = '작업에 필요한 자료를 기다리고 있어요. 자료를 보내거나 취소하면 이어서 진행해요.'
APPROVAL_MESSAGE = 'Writing 결과를 원고 초안에 반영할지 승인해 주세요. 거절하면 반영하지 않아요.'
CANCELLED_MESSAGE = '요청을 취소해 아무 작업도 실행하지 않았어요.'
FAILED_MESSAGE = '작업 중 실패가 있어 남은 작업을 실행하지 않았어요.'
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
    runId: str | None  # Langfuse trace id. resume한 단계도 같은 trace에 붙는다.
    traceParent: str | None
    title: str  # 대화 제목. 첫 턴 요청 앞부분이며 rename으로만 바뀐다.
    replaceHistory: bool
    turns: Annotated[list[dict], operator.add]  # 턴마다 {request, qa, reply}를 하나씩 덧붙인다.


def plan(state: State) -> State:
    """Router 계획을 검증한다. 실행할 수 있으면 status=running과 대기 단계를 남긴다."""
    history = [] if state.get('replaceHistory') else [t['request'] for t in state.get('turns', [])][-HISTORY_TURNS:]
    with tracing.observe('plan', trace_context=_trace(state), input={'request': state['request']}) as span:
        routed = intent.route(state['request'], state.get('operation'), state['materials'], history)
        span.update(metadata={'status': routed.status, 'steps': [[s.feature, s.when] for s in routed.steps]})
    if routed.status != 'route':
        return {'status': routed.status, 'message': routed.message, 'steps': []}
    steps = [{'feature': s.feature, 'when': s.when, 'status': 'not_started'} for s in routed.steps]
    # 조건부 단계는 Review의 Finding 연결 계약이 필요하다. Review가 없고 웹 조사 뒤 조건부 수정은 미지원이다.
    unsupported = [s.feature for s in routed.steps if s.feature not in CALLS or s.when != 'always']
    if unsupported:
        return {'status': 'unsupported', 'message': UNSUPPORTED_MESSAGE, 'steps': steps, 'unsupported': unsupported}
    return {'status': 'running', 'steps': steps}


def gate(state: State) -> State:
    """모든 단계 입력이 있어야 실행한다. 대화에서는 interrupt로 멈춰 입력이나 취소를 기다린다.

    resume 때 이 노드만 다시 실행되므로 Router는 다시 호출하지 않는다. interrupt는 호출 순서대로 이전 resume
    값을 돌려받아 여러 번 기다려도 같은 결과가 된다.
    """
    inputs, scope = dict(state['inputs']), state.get('retrievalScope')
    while missing := [s['feature'] for s in state['steps'] if s['feature'] not in inputs
                      and not (s['feature'] == 'story_context' and scope)]:
        if not state.get('scope'):  # 대화가 없으면 체크포인트가 없어 멈췄다 이어갈 수 없다.
            return {'status': 'needs_input', 'message': NEEDS_INPUT_MESSAGE, 'missingInputs': missing}
        answer = interrupt({'steps': state['steps'], 'missingInputs': missing})
        if not answer['approved']:
            return {'status': 'cancelled', 'message': CANCELLED_MESSAGE}
        inputs.update(answer['inputs'])
        # Content가 resume마다 새로 서명한 조회 토큰을 쓴다. 저장된 토큰은 만료·Content 재시작으로 무효일 수 있다.
        scope = answer.get('scope') or scope
    return {'inputs': inputs, 'retrievalScope': scope}


def _node(feature: str):
    def run_step(state: State) -> State:
        steps = [dict(s) for s in state['steps']]
        step = next(s for s in steps if s['status'] == 'not_started')
        try:
            with tracing.observe(f'step.{feature}', as_type='agent', trace_context=_trace(state)):
                step.update(status='completed', result=CALLS[feature](state['inputs'].get(feature), state).model_dump(mode='json'))
        except FAILURES as error:
            step.update(status='failed', error=str(error))
        return {'steps': steps}
    run_step.__doc__ = f'{feature} Agent를 자기 입력으로 1회 실행한다. 기능 실패는 단계 실패로 남긴다.'
    return run_step


def apply(state: State) -> State:
    """Writing 결과를 작가에게 보여 주고 승인하면 사용자 권한으로 Content MCP에 초안 반영을 요청한다.

    resume 때 이 노드는 처음부터 다시 실행되므로 interrupt 앞에는 부수효과를 두지 않는다. 반영 실패는 결과를 보존한 채
    단계 실패로 남겨 남은 단계를 시작하지 않는다.
    """
    steps = [dict(s) for s in state['steps']]
    step = next(s for s in steps if s['feature'] == 'writing_editing')
    answer = interrupt({'steps': state['steps'], 'awaitingApproval': 'writing_editing'})
    step['approval'] = 'approved' if answer['approved'] else 'declined'
    if answer['approved']:
        target = state['target']
        try:
            with tracing.observe('step.writing_editing.apply', as_type='tool', trace_context=_trace(state),
                                 metadata={'episode': target['episode']}):
                step['applied'] = content_mcp.apply_writing(target['workId'], target['episode'], step['result'])
        except ContentMcpFailure as error:
            step.update(status='failed', error=str(error))
    return {'steps': steps, 'retrievalScope': answer.get('scope') or state.get('retrievalScope')}


def _awaiting_approval(state: State) -> bool:
    """대화 안의 반영 대상이 있고, 완료된 Writing 결과에 아직 작가의 답이 없다."""
    return bool(state.get('scope') and state.get('target')) and any(
        s['feature'] == 'writing_editing' and s['status'] == 'completed' and 'approval' not in s for s in state['steps'])


def finish(state: State) -> State:
    """실행 상태를 확정하고 이번 턴을 대화 기록에 남긴다. 실행하지 않은 턴도 요청과 응답은 남긴다."""
    done = {'status': state['status']}
    if state['status'] == 'running':
        failed = any(s['status'] == 'failed' for s in state['steps'])
        done = {'status': 'failed', 'message': FAILED_MESSAGE} if failed else {'status': 'completed'}
    qa = next((s['result'] for s in state['steps'] if s['feature'] == 'story_context' and s['status'] == 'completed'),
              None)
    if qa:
        answer = ' '.join(c['text'] for c in qa['claims']) or ' '.join(qa['gaps'])
        question = state['inputs'].get('story_context', {}).get('question') or state['request'][:500]
        qa = {'question': question, 'answer': answer[:2000]}
    reply = _response({**state, **done}).model_dump(mode='json')
    turn = [{'request': state['request'], 'qa': qa, 'reply': reply}]
    if state.get('replaceHistory'):
        return {**done, 'turns': Overwrite(turn), 'title': state['request'][:TITLE_LENGTH], 'replaceHistory': False}
    return {**done, 'turns': turn}


def _trace(state: State) -> dict | None:
    return tracing.context(state.get('runId'), state.get('traceParent'))


def _next(state: State) -> str:
    """승인 대기 중인 Writing 결과가 있으면 apply로, 아니면 대기 중인 첫 단계의 기능 노드로 간다.

    실패가 있으면 새 단계를 시작하지 않는다.
    """
    if state['status'] != 'running' or any(s['status'] == 'failed' for s in state['steps']):
        return 'finish'
    if _awaiting_approval(state):
        return 'apply'
    return next((s['feature'] for s in state['steps'] if s['status'] == 'not_started'), 'finish')


def build() -> StateGraph:
    graph = StateGraph(State)
    graph.add_node('plan', plan)
    graph.add_node('gate', gate)
    for feature in CALLS:
        graph.add_node(feature, _node(feature))
    graph.add_node('apply', apply)
    graph.add_node('finish', finish)
    graph.add_edge(START, 'plan')
    graph.add_conditional_edges('plan', lambda state: 'gate' if state['status'] == 'running' else 'finish',
                                ['gate', 'finish'])
    for name in ('gate', *CALLS, 'apply'):
        graph.add_conditional_edges(name, _next, [*CALLS, 'apply', 'finish'])
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
            'steps': [], 'missingInputs': [], 'unsupported': [], 'replaceHistory': False,
            'scope': data.conversation.scope if data.conversation else None,
            'retrievalScope': data.scope.model_dump() if data.scope else None,
            'target': data.target.model_dump() if data.target else None}


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
    return CHAT, config, Command(resume=data.resume.model_dump(mode='json', exclude_none=True)), dict(snapshot.values)


def _response(state: dict) -> OrchestrationResponse:
    if state.get('__interrupt__'):
        waiting = state['__interrupt__'][0].value
        approval = waiting.get('awaitingApproval')
        state = {**state, 'status': 'waiting', 'message': APPROVAL_MESSAGE if approval else WAITING_MESSAGE,
                 'missingInputs': waiting.get('missingInputs', []), 'awaitingApproval': approval,
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
    """한 턴을 계획·검증·실행하거나 멈춘 실행을 이어간다. Router 실패·대화 오류는 그대로 올린다.

    authorization은 AI를 호출한 사용자의 Bearer이며 이 요청의 Content MCP 반영에만 쓴다.
    """
    content_mcp.AUTHORIZATION.set(authorization)
    graph, config, payload, _ = await _target(data)
    return _response(await graph.ainvoke(payload, config))


async def stream(data: OrchestrationRequest, authorization: str = '') -> AsyncIterator[ServerSentEvent]:
    """같은 그래프를 노드 단위로 흘려 plan → (started → step)* → done 이벤트를 보낸다.

    started는 다음 노드가 실제로 실행할 단계라서 화면의 진행 표시가 그래프 상태와 같다. interrupt로 멈추면
    waiting(계획·빠진 입력)과 done(status=waiting)으로 끝난다. 응답 헤더를 보낸 뒤라 Router 실패·대화 오류는
    HTTP 상태 대신 error 이벤트 하나로 알린다.
    """
    errors = {IntentFailure: ROUTER_FAILED_MESSAGE, ConversationMismatch: CONVERSATION_MISMATCH_MESSAGE,
              NothingToResume: NOTHING_TO_RESUME_MESSAGE, ConversationUnavailable: CONVERSATION_UNAVAILABLE_MESSAGE,
              ConversationNotFound: CONVERSATION_NOT_FOUND_MESSAGE}
    content_mcp.AUTHORIZATION.set(authorization)
    try:
        graph, config, payload, state = await _target(data)
        async for update in graph.astream(payload, config, stream_mode='updates'):
            for node, change in update.items():
                if node == '__interrupt__':
                    state['__interrupt__'] = change
                    yield ServerSentEvent(event='waiting', data=change[0].value)
                    continue
                state.update(change)
                if node == 'plan':
                    yield ServerSentEvent(event='plan', data={'steps': state['steps']})
                elif node in CALLS or node == 'apply':
                    feature = 'writing_editing' if node == 'apply' else node
                    yield ServerSentEvent(event='step', data=next(s for s in state['steps'] if s['feature'] == feature))
                if node in ('gate', *CALLS, 'apply') and (upcoming := _next(state)) in CALLS:
                    yield ServerSentEvent(event='started', data={'feature': upcoming})
    except tuple(errors) as error:
        yield ServerSentEvent(event='error', data={'message': errors[type(error)]})
        return
    except Exception:  # 체크포인트 DB 장애·버그도 연결만 끊기지 않게 알린다. 메시지에 입력이 섞일 수 있어 고정 문구만 보낸다.
        yield ServerSentEvent(event='error', data={'message': STREAM_FAILED_MESSAGE})
        return
    yield ServerSentEvent(event='done', data=_response(state).model_dump(mode='json'))
