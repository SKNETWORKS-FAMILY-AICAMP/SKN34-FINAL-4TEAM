"""집필 AI 오케스트레이션: Intent Router 계획을 Python이 검증하고 구현된 업무 Agent를 LangGraph로 순차 실행한다.

계획 노드가 Router를 호출해 단계를 받고, 미구현 기능·조건부 단계·빠진 입력이 하나라도 있으면 아무 Agent도
실행하지 않는다(축소 실행 금지). 통과하면 기능 노드가 계획 순서대로 하나씩 실행되고, 실패한 뒤에는 새 단계를
시작하지 않는다. 결과는 각 Agent의 원본 결과를 계획 순서로 묶을 뿐 종합 모델을 호출하지 않는다.
상태는 체크포인트에 그대로 저장할 수 있도록 JSON 값만 담는다.
"""

from collections.abc import AsyncIterator
from typing import TypedDict

from fastapi.sse import ServerSentEvent
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
CALLS = {
    'story_context': lambda data: manuscript.answer(AnswerRequest.model_validate(data)),
    'writing_editing': lambda data: (writing.draft(DraftRequest.model_validate(data['draft'])) if 'draft' in data
                                     else writing.patch(PatchRequest.model_validate(data['patch']))),
    'web_research': lambda data: research.research(ResearchRequest.model_validate(data)),
}
FAILURES = (ManuscriptFailure, WritingFailure, ResearchFailure)
UNSUPPORTED_MESSAGE = ('요청에 아직 실행할 수 없는 작업이 있어 아무 작업도 실행하지 않았어요. '
                       '작품 질문, 집필·수정, 고증 조사는 각각 요청할 수 있어요.')
NEEDS_INPUT_MESSAGE = '작업에 필요한 자료가 빠져 있어 아무 작업도 실행하지 않았어요.'
FAILED_MESSAGE = '작업 중 실패가 있어 남은 작업을 실행하지 않았어요.'
ROUTER_FAILED_MESSAGE = '요청 분류에 실패했습니다.'


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


def plan(state: State) -> State:
    """Router 계획을 검증한다. 실행할 수 있으면 status=running과 대기 단계를 남긴다."""
    routed = intent.route(state['request'], state.get('operation'), state['materials'])
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
            step.update(status='completed', result=CALLS[feature](state['inputs'][feature]).model_dump(mode='json'))
        except FAILURES as error:
            step.update(status='failed', error=str(error))
        return {'steps': steps}
    run_step.__doc__ = f'{feature} Agent를 자기 입력으로 1회 실행한다. 기능 실패는 단계 실패로 남긴다.'
    return run_step


def finish(state: State) -> State:
    if any(s['status'] == 'failed' for s in state['steps']):
        return {'status': 'failed', 'message': FAILED_MESSAGE}
    return {'status': 'completed'}


def _next(state: State) -> str:
    """대기 중인 첫 단계의 기능 노드로 간다. 실패가 있으면 새 단계를 시작하지 않는다."""
    if state['status'] != 'running':
        return END
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
        graph.add_conditional_edges(name, _next, [*CALLS, 'finish', END])
    graph.add_edge('finish', END)
    return graph


GRAPH = build().compile()


def _initial(data: OrchestrationRequest) -> State:
    return {'request': data.request, 'operation': data.operation, 'materials': data.materials,
            'inputs': data.inputs.model_dump(exclude_none=True)}


def _response(state: State) -> OrchestrationResponse:
    return OrchestrationResponse.model_validate({k: v for k, v in state.items() if k in OrchestrationResponse.model_fields})


def run(data: OrchestrationRequest) -> OrchestrationResponse:
    """한 요청을 계획·검증·실행한다. Router 실패(IntentFailure)는 그대로 올린다."""
    return _response(GRAPH.invoke(_initial(data)))


async def stream(data: OrchestrationRequest) -> AsyncIterator[ServerSentEvent]:
    """같은 그래프를 노드 단위로 흘려 plan → (started → step)* → done 이벤트를 보낸다.

    started는 다음 노드가 실제로 실행할 단계라서 화면의 진행 표시가 그래프 상태와 같다.
    응답 헤더를 보낸 뒤라 Router 실패는 HTTP 상태 대신 error 이벤트 하나로 알리고 끝낸다.
    """
    state = _initial(data)
    try:
        async for update in GRAPH.astream(state, stream_mode='updates'):
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
    yield ServerSentEvent(event='done', data=_response(state).model_dump(mode='json'))
