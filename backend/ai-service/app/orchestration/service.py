"""집필 AI 오케스트레이션: Intent Router 계획을 Python이 검증하고 구현된 업무 Agent를 LangGraph로 순차 실행한다.

계획 노드가 Router를 호출해 단계를 받고, 미구현 기능·조건부 단계·빠진 입력이 하나라도 있으면 아무 Agent도
실행하지 않는다(축소 실행 금지). 통과하면 기능 노드가 계획 순서대로 하나씩 실행되고, 실패한 뒤에는 새 단계를
시작하지 않는다. 결과는 각 Agent의 원본 결과를 계획 순서로 묶을 뿐 종합 모델을 호출하지 않는다.
상태는 체크포인트에 그대로 저장할 수 있도록 JSON 값만 담는다.

멀티턴(#57): Content가 발급한 threadId의 대화는 체크포인터에 turns로 쌓이고, 다음 턴의 Router에는 이전 요청을,
Q&A에는 이전 질문·답을 지칭 해석용 자료로만 넘긴다. 대화는 첫 턴의 Content 확인 scope(사용자·작품)에 묶여
다른 scope로는 이어갈 수 없다. 웹 조사 외부 검색에는 대화 기록을 보내지 않는다.
"""

import operator
from collections.abc import AsyncIterator
from typing import Annotated, TypedDict

from fastapi.sse import ServerSentEvent
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from app.intent import service as intent
from app.intent.errors import IntentFailure
from app.manuscript import service as manuscript
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest
from app.orchestration.models import OrchestrationRequest, OrchestrationResponse
from app.research import service as research
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest
from app.writing import agent as writing
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest

# 구현된 업무 Agent. 입력은 StepInputs의 같은 이름 필드(JSON)다.
# Q&A만 대화 기록을 받는다. 웹 조사는 외부 전송이라 작가가 고른 질문·맥락 외에는 보내지 않는다.
CALLS = {
    'story_context': lambda data, state: manuscript.answer(AnswerRequest.model_validate(
        {**data, 'history': [t['qa'] for t in state.get('turns', []) if t['qa']][-HISTORY_TURNS:]})),
    'writing_editing': lambda data, state: (writing.draft(DraftRequest.model_validate(data['draft'])) if 'draft' in data
                                            else writing.patch(PatchRequest.model_validate(data['patch']))),
    'web_research': lambda data, state: research.research(ResearchRequest.model_validate(data)),
}
# shortcut: 최근 5턴만 넘기고 요약하지 않는다. 긴 대화의 앞부분 지칭이 필요해지면 요약을 검토한다.
HISTORY_TURNS = 5
FAILURES = (ManuscriptFailure, WritingFailure, ResearchFailure)
UNSUPPORTED_MESSAGE = ('요청에 아직 실행할 수 없는 작업이 있어 아무 작업도 실행하지 않았어요. '
                       '작품 질문, 집필·수정, 고증 조사는 각각 요청할 수 있어요.')
NEEDS_INPUT_MESSAGE = '작업에 필요한 자료가 빠져 있어 아무 작업도 실행하지 않았어요.'
FAILED_MESSAGE = '작업 중 실패가 있어 남은 작업을 실행하지 않았어요.'
ROUTER_FAILED_MESSAGE = '요청 분류에 실패했습니다.'
CONVERSATION_MISMATCH_MESSAGE = '다른 사용자나 작품의 대화는 이어갈 수 없습니다.'


class ConversationMismatch(Exception):
    """threadId의 대화가 다른 scope(사용자·작품)에 묶여 있다."""


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
    turns: Annotated[list[dict], operator.add]  # 턴마다 {request, qa}를 하나씩 덧붙인다.


def plan(state: State) -> State:
    """Router 계획을 검증한다. 실행할 수 있으면 status=running과 대기 단계를 남긴다."""
    history = [t['request'] for t in state.get('turns', [])][-HISTORY_TURNS:]
    routed = intent.route(state['request'], state.get('operation'), state['materials'], history)
    if routed.status != 'route':
        return {'status': routed.status, 'message': routed.message, 'steps': []}
    steps = [{'feature': s.feature, 'when': s.when, 'status': 'not_started'} for s in routed.steps]
    # 조건부 단계는 Review의 Finding 연결 계약이 필요하다. Review가 없고 웹 조사 뒤 조건부 수정은 미지원이다.
    unsupported = [s.feature for s in routed.steps if s.feature not in CALLS or s.when != 'always']
    if unsupported:
        return {'status': 'unsupported', 'message': UNSUPPORTED_MESSAGE, 'steps': steps, 'unsupported': unsupported}
    missing = [s.feature for s in routed.steps if s.feature not in state['inputs']]
    if missing:
        return {'status': 'needs_input', 'message': NEEDS_INPUT_MESSAGE, 'steps': steps, 'missingInputs': missing}
    return {'status': 'running', 'steps': steps}


def _node(feature: str):
    def run_step(state: State) -> State:
        steps = [dict(s) for s in state['steps']]
        step = next(s for s in steps if s['status'] == 'not_started')
        try:
            step.update(status='completed', result=CALLS[feature](state['inputs'][feature], state).model_dump(mode='json'))
        except FAILURES as error:
            step.update(status='failed', error=str(error))
        return {'steps': steps}
    run_step.__doc__ = f'{feature} Agent를 자기 입력으로 1회 실행한다. 기능 실패는 단계 실패로 남긴다.'
    return run_step


def finish(state: State) -> State:
    """실행 상태를 확정하고 이번 턴을 대화 기록에 남긴다. 실행하지 않은 턴도 요청은 남긴다."""
    done = {'status': state['status']}
    if state['status'] == 'running':
        failed = any(s['status'] == 'failed' for s in state['steps'])
        done = {'status': 'failed', 'message': FAILED_MESSAGE} if failed else {'status': 'completed'}
    qa = next((s['result'] for s in state['steps'] if s['feature'] == 'story_context' and s['status'] == 'completed'),
              None)
    if qa:
        answer = ' '.join(c['text'] for c in qa['claims']) or ' '.join(qa['gaps'])
        qa = {'question': state['inputs']['story_context']['question'], 'answer': answer[:2000]}
    return {**done, 'turns': [{'request': state['request'], 'qa': qa}]}


def _next(state: State) -> str:
    """대기 중인 첫 단계의 기능 노드로 간다. 실패가 있으면 새 단계를 시작하지 않는다."""
    if state['status'] != 'running':
        return 'finish'
    if any(s['status'] == 'failed' for s in state['steps']):
        return 'finish'
    return next((s['feature'] for s in state['steps'] if s['status'] == 'not_started'), 'finish')


def build() -> StateGraph:
    graph = StateGraph(State)
    graph.add_node('plan', plan)
    for feature in CALLS:
        graph.add_node(feature, _node(feature))
    graph.add_node('finish', finish)
    graph.add_edge(START, 'plan')
    for name in ('plan', *CALLS):
        graph.add_conditional_edges(name, _next, [*CALLS, 'finish'])
    graph.add_edge('finish', END)
    return graph


GRAPH = build().compile()
# shortcut: 대화를 프로세스 메모리에만 둔다. 재시작·다중 인스턴스에서 유지하려면 영속 체크포인터로 바꾼다.
CHAT = build().compile(checkpointer=InMemorySaver())


def _initial(data: OrchestrationRequest) -> State:
    """턴마다 바뀌는 값은 모두 새로 넣어 이전 턴 결과가 이번 응답에 남지 않게 한다."""
    return {'request': data.request, 'operation': data.operation, 'materials': data.materials,
            'inputs': data.inputs.model_dump(exclude_none=True), 'status': 'planning', 'message': None,
            'steps': [], 'missingInputs': [], 'unsupported': [],
            'scope': data.conversation.scope if data.conversation else None}


def _graph(data: OrchestrationRequest):
    """대화가 없으면 기록 없는 그래프, 있으면 같은 scope인지 확인한 뒤 threadId의 체크포인트를 쓴다."""
    if not data.conversation:
        return GRAPH, None
    config = {'configurable': {'thread_id': data.conversation.threadId}}
    if CHAT.get_state(config).values.get('scope', data.conversation.scope) != data.conversation.scope:
        raise ConversationMismatch()
    return CHAT, config


def _response(state: State) -> OrchestrationResponse:
    return OrchestrationResponse.model_validate({k: v for k, v in state.items() if k in OrchestrationResponse.model_fields})


def run(data: OrchestrationRequest) -> OrchestrationResponse:
    """한 요청을 계획·검증·실행한다. Router 실패(IntentFailure)·대화 scope 불일치는 그대로 올린다."""
    graph, config = _graph(data)
    return _response(graph.invoke(_initial(data), config))


async def stream(data: OrchestrationRequest) -> AsyncIterator[ServerSentEvent]:
    """같은 그래프를 노드 단위로 흘려 plan → (started → step)* → done 이벤트를 보낸다.

    started는 다음 노드가 실제로 실행할 단계라서 화면의 진행 표시가 그래프 상태와 같다.
    응답 헤더를 보낸 뒤라 Router 실패는 HTTP 상태 대신 error 이벤트 하나로 알리고 끝낸다.
    """
    state = _initial(data)
    try:
        graph, config = _graph(data)
        async for update in graph.astream(state, config, stream_mode='updates'):
            for node, change in update.items():
                state.update(change)
                if node == 'plan':
                    yield ServerSentEvent(event='plan', data={'steps': state['steps']})
                elif node in CALLS:
                    yield ServerSentEvent(event='step', data=next(s for s in state['steps'] if s['feature'] == node))
                upcoming = _next(state) if node != 'finish' else END
                if upcoming in CALLS:
                    yield ServerSentEvent(event='started', data={'feature': upcoming})
    except IntentFailure:
        yield ServerSentEvent(event='error', data={'message': ROUTER_FAILED_MESSAGE})
        return
    except ConversationMismatch:
        yield ServerSentEvent(event='error', data={'message': CONVERSATION_MISMATCH_MESSAGE})
        return
    yield ServerSentEvent(event='done', data=_response(state).model_dump(mode='json'))
