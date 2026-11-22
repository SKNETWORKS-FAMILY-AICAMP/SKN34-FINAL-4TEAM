"""메인 에이전트(#473): LangChain `create_agent` 하나가 요청 해석·호출 순서·서브 에이전트 호출·답변 종합을 맡는다.

모델은 `ChatOpenAI`(Responses API, store=False, reasoning_effort=high(#619), 자동 재시도 없음, 병렬 도구 호출 켬)이며 도구는 판정된 기능의 `ask_*`뿐이다.
Retrieval·웹 검색·원고 반영 도구는 없고, 서브 에이전트에 해당하지 않는 간단한 작업용 Content MCP 도구 10개(`mcp_tools.py`, #554: 읽기 6 자동·쓰기 4 작가 승인 뒤 실행)가
있다. 모델의 판단은 인가·승인·정본 적용이 아니고 아래 미들웨어와 도구가 경계를 지킨다.
- `DecisionGuardMiddleware.before_agent`: 턴당 1회 Decision Guard(`intent.judge`). 거절이면 모델을 부르지 않고 끝낸다. 허용됐지만 기능이 비면 MCP 도구만으로 진행한다.
- `HumanInTheLoopMiddleware`: 쓰기 MCP 도구 4개는 작가가 승인(approve)한 뒤에만 실행한다(reject면 실행하지 않는다). 다른 미들웨어가 이미 답한 호출은 묻지 않는다.
- `DynamicToolMiddleware`: 판정 기능의 도구와 MCP 도구만 모델에 보이고 실행 직전 다시 확인한다(MCP 도구는 `mcp_tools.execute`가 실행). 실패·취소·입력 대기·시뮬레이션 계획 뒤와
  모델 호출 상한의 마지막 호출에는 도구를 치운다(FinalAnswerMiddleware 방식). 한 모델 턴의 병렬 묶음은 조회형(PARALLEL)만 함께 실행하고
  단독 도구·입력이 빠진 호출은 실행하지 않고 돌려 다음 모델 턴에 따로 부르게 한다(#474, 2026-11-17 사용자 결정). 함께 실행하는 호출은
  create_agent가 호출마다 Send로 같은 superstep에서 동시에 돌리고, 그래서 steps는 reducer로 모은다(모델이 부른 순서).
- `ToolCallLimit`(라이브러리 상속): 서브 에이전트 기능당 1회, 턴당 3회(MCP 도구는 세지 않는다). MCP 도구는 따로 턴당 10회(`mcpCalls`).
  `ModelCallLimitMiddleware`(라이브러리): 메인 모델 호출 8회(2026-11-17 5회 → #554에서 올림).
  재개(resume) 뒤에도 세도록 체크포인트에 남는 thread 한도를 쓴다. 메인 에이전트 상태는 턴마다 새로 시작한다.
- `MainModelMiddleware`: 메인 모델 호출을 Langfuse `main_agent` generation으로 남기고, 제공사 오류·잘린 응답은 끝낸 단계를 보존한 채
  고정 실패 문구로 끝낸다(예외로 올리면 단계 결과를 잃는다).
"""

import operator
import os
from typing import Annotated, Any, NotRequired

from langchain.agents import create_agent
from langchain.agents.middleware import (AgentMiddleware, AgentState, HumanInTheLoopMiddleware, ModelCallLimitMiddleware, ToolCallLimitMiddleware,
                                         hook_config)
from langchain.agents.middleware.types import ModelResponse
from langchain_core.messages import AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.types import Command
from openai import OpenAIError

from app import tracing
from app.intent import service as intent
from app.intent.errors import IntentFailure
from app.orchestration import mcp_tools, tools
from app.orchestration.models import current_feature
from app.orchestration.prompt import INSTRUCTIONS

MODEL_CALLS = 8  # 메인 모델 호출 상한(턴당). 마지막 호출은 도구 없이 종합한다. MCP 도구 호출(#554)로 5에서 올렸다.
TOOL_CALLS = 3  # 서브 에이전트 호출 상한(턴당). 기능마다 1회다.
FAILED = 'main_failed'  # 메인 모델 실패로 끝낸 마지막 메시지 이름
MAIN_FAILED_MESSAGE = '답변을 정리하지 못했어요. 완료한 작업의 결과는 아래에 있어요.'
MAIN_FAILED_NOTHING_MESSAGE = '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'  # 완료한 단계가 없을 때
BAD_ARGUMENTS = '작업 지시가 형식에 맞지 않아 실행하지 않았어요.'  # 도구 인자 검증 실패(예: request 2,000자 초과)
TOOLS = {feature: getattr(tools, name) for feature, name in tools.TOOL_NAMES.items()}
# 한 모델 턴에 함께 실행할 수 있는 조회형 도구(#474). 서로의 결과를 쓰지 않는다. ask_writing·ask_character_simulation은 항상 단독이고,
# ask_world는 작가 승인이 필요한 enrich만 단독이다(tools.WAITS). check·impact는 조회형이라 함께 실행한다.
PARALLEL = {'ask_story_qa', 'ask_research', 'ask_rating', 'ask_world', 'ask_manuscript_review', *mcp_tools.READ}  # MCP 읽기도 조회형이다. 쓰기 4개는 항상 단독이라 한 번에 승인 카드 하나다.


class MainState(AgentState):
    decision: NotRequired[dict]  # Decision Guard 판정 {allowed, reason, capabilities}
    steps: NotRequired[Annotated[list[dict], operator.add]]  # 이번 턴 서브 에이전트 결과. 도구마다 자기 단계 하나를 덧붙인다(호출 순서)
    writingBase: NotRequired[dict | None]  # 검수 후보의 기준이 되는 집필 직전 초안
    inputs: NotRequired[dict]  # Content가 확인한 단계 입력. 입력 대기 resume이 채운다
    retrievalScope: NotRequired[dict | None]  # Content가 서명한 Q&A 조회 토큰. resume이 새 토큰으로 바꾼다
    stopped: NotRequired[dict | None]  # 남은 호출을 막고 끝낸 이유 {status: needs_input|cancelled|clarify, ...}
    simulationPlan: NotRequired[dict | None]  # 시뮬레이션 계획. 장면은 바깥 scene 노드가 쓴다
    mcpCalls: NotRequired[Annotated[int, operator.add]]  # 이번 턴 실행한 MCP 도구 호출 수(서브 에이전트 한도와 따로 센다)


def _allowed(state: dict) -> set[str]:
    if state.get('stopped') or state.get('simulationPlan'):
        return set()
    capabilities = map(current_feature, state['decision']['capabilities'])
    available = {TOOLS[c].name for c in capabilities if c in TOOLS}
    # UI가 기능을 고른 요청(operation)은 그 기능의 서브 에이전트만 쓴다. Content 도구는 기능을 고르지 않은 자유 입력에서만 쓴다.
    if state.get('mcpCalls', 0) < mcp_tools.MCP_CALLS and not state['decision'].get('operation'):
        available |= set(mcp_tools.NAMES)  # 실제 노출은 request.tools(Content가 알려 준 도구)와의 교집합이다
    steps = state.get('steps', [])
    failed = {s['feature'] for s in steps if s['status'] == 'failed'}
    if failed:
        # 작성에 실패해도 판정에 포함된 검수는 저장된 초안으로 한 번 실행할 수 있다.
        if failed == {'writing_editing'} and not any(current_feature(s['feature']) == 'manuscript_review' for s in steps):
            return available & {'ask_manuscript_review'}
        return set()
    return available


class DecisionGuardMiddleware(AgentMiddleware):
    """턴당 1회 서비스 범위와 필요한 기능을 판정한다. resume 때는 체크포인트에 남은 판정을 쓰고 다시 부르지 않는다.

    판정 실패(IntentFailure)는 그대로 올려 아무것도 실행하지 않는다(503).
    """
    state_schema = MainState

    @hook_config(can_jump_to=['end'])
    def before_agent(self, state, runtime) -> dict[str, Any]:
        turn, asked = runtime.context, runtime.context['decide']
        with tracing.observe('decision_guard', input={'request': asked['request']}) as span:
            decided = intent.judge(asked['request'], asked['operation'], asked['materials'], asked['history'])
            span.update(metadata=decided.model_dump())
        done = {'decision': {**decided.model_dump(), 'operation': asked['operation']}}  # operation은 UI가 기능을 골랐는지(Content 도구 노출 판단)
        if not decided.allowed:  # 기능이 비어도 허용됐다면 메인이 MCP 도구만으로 실행한다(#554)
            done['jump_to'] = 'end'
        return done


class DynamicToolMiddleware(AgentMiddleware):
    """판정된 기능의 도구만 노출하고(wrap_model_call), 실행 직전 다시 확인한다(wrap_tool_call)."""

    @hook_config(can_jump_to=['end'])
    def before_model(self, state, runtime) -> dict | None:
        # 시뮬레이션 계획을 정하지 못해 되묻는 턴은 종합하지 않고 고정 문구로 끝낸다(2026-11-17 사용자 결정).
        return {'jump_to': 'end'} if (state.get('stopped') or {}).get('status') == 'clarify' else None

    def after_model(self, state, runtime) -> dict | None:
        """노출 밖 호출과 병렬 묶음에서 함께 실행할 수 없는 호출을 실행하지 않고 오류 ToolMessage로 모델에게 돌려준다.

        묶음(실행할 호출 둘 이상)에서는 단독 도구(PARALLEL 밖)와 작가 입력이 빠진 호출, 작가 승인이 필요한 World 보강(enrich)을 미룬다.
        동시에 둘 이상 interrupt하면 resume 하나로 이어 갈 수 없고, 의존 호출(검수 → 수정)은 앞 결과를 본 다음 모델 턴에 부르게 하기 위해서다. 함께 실행할 것이 하나도 없으면
        첫 호출만 단독으로 실행한다(모두 미루면 모델이 같은 묶음을 되풀이해 아무것도 못 한다). 답을 단 호출은 ToolCallLimit이 세지 않고
        create_agent가 실행하지 않는다(모두 막히면 바로 모델로 돌아간다). 모델 호출 수는 이 훅보다 먼저 센다(미들웨어 목록에서
        ModelCallLimitMiddleware가 뒤에 있다). 그래서 계속 잘못 불러도 상한에서 끝난다.
        """
        calls, allowed = state['messages'][-1].tool_calls, _allowed(state)
        # MCP 도구는 서브 에이전트 한도와 따로 턴당 MCP_CALLS회다. 한 묶음이 남은 횟수를 넘으면 넘는 호출은 실행하지 않는다.
        over = [c for c in calls if c['name'] in mcp_tools.NAMES and c['name'] in allowed][max(0, mcp_tools.MCP_CALLS - state.get('mcpCalls', 0)):]
        run = [c for c in calls if c['name'] in allowed and c not in over]
        if len(run) > 1:
            writing = next((i for i, c in enumerate(run) if c['name'] == 'ask_writing'), len(run))
            review = next((i for i, c in enumerate(run) if c['name'] == 'ask_manuscript_review'), -1)
            if writing < review:  # 같은 묶음에서도 집필을 먼저 요청했다면 뒤 검수에 후보가 필요하다.
                run = run[:1]
            else:
                run = [c for c in run if c['name'] in PARALLEL and not tools.waits(c, state, runtime.context)] or run[:1]
        # 대상 작품·세계관이 아닌 id를 가리키는 Content 도구는 승인을 묻기 전에 막는다(HumanInTheLoopMiddleware는 이미 답한 호출을 묻지 않는다).
        foreign = [c for c in run if c['name'] in mcp_tools.NAMES and mcp_tools.mismatch(c, runtime.context)]
        run = [c for c in run if c not in foreign]
        refused = [_foreign(c, mcp_tools.mismatch(c, runtime.context)) if c in foreign else _limited(c) if c in over else _blocked(c) if c['name'] not in allowed else _deferred(c)
                   for c in calls if c not in run]
        return {'messages': refused} if refused else None

    async def awrap_model_call(self, request, handler):
        last = request.state.get('thread_model_call_count', 0) >= MODEL_CALLS - 1
        allowed = set() if last else _allowed(request.state)
        exposed = [t for t in request.tools if t.name in allowed]
        return await handler(request.override(tools=exposed, model_settings={'parallel_tool_calls': True} if exposed else {}))

    async def awrap_tool_call(self, request, handler):
        call = request.tool_call
        if call['name'] == 'ask_review' and 'review' in request.state['decision']['capabilities']:
            # 입력 대기 중 저장된 옛 호출을 복원한다. 모델에는 새 도구 이름만 노출한다.
            tool = TOOLS['manuscript_review']
            request = request.override(tool=tool, tool_call={**call, 'name': tool.name})
        elif call['name'] == 'ask_web_research' and 'web_research' in request.state['decision']['capabilities']:
            tool = TOOLS['research']
            request = request.override(tool=tool, tool_call={**call, 'name': tool.name, 'args': {'task': 'web'}})
        if request.tool_call['name'] not in _allowed(request.state):
            return _blocked(call)
        if call['name'] in mcp_tools.NAMES:  # 쓰기는 HumanInTheLoopMiddleware가 승인을 받은 뒤 여기까지 온다
            return await mcp_tools.execute(request)
        result = await handler(request)
        # 도구는 항상 Command로 답한다. 오류 ToolMessage만 왔다면 ToolNode가 인자 검증 실패를 돌려준 것이라 그 기능 단계를 실패로 남긴다.
        if isinstance(result, ToolMessage) and result.status == 'error':
            feature = next(f for f, t in TOOLS.items() if t.name == request.tool_call['name'])
            step = {'feature': feature, 'when': 'always', 'status': 'failed', 'error': BAD_ARGUMENTS}
            return Command(update={'steps': [step], 'messages': [result.model_copy(update={'content': tools._summary(step)})]})
        return result


def _blocked(call: dict) -> ToolMessage:
    return ToolMessage(content=f"[차단] {call['name']}: 이번 요청에서 부를 수 없는 도구예요. 다시 부르지 마세요.",
                       tool_call_id=call['id'], name=call['name'], status='error')


def _deferred(call: dict) -> ToolMessage:
    return ToolMessage(content=f"[순차] {call['name']}: 다른 도구와 함께 실행할 수 없어 실행하지 않았어요. "
                               '함께 부른 도구의 결과를 본 뒤 이 도구만 따로 다시 부르세요.',
                       tool_call_id=call['id'], name=call['name'], status='error')


def _foreign(call: dict, reason: str) -> ToolMessage:
    return ToolMessage(content=f"[차단] {call['name']}: {reason}", tool_call_id=call['id'], name=call['name'], status='error')


def _limited(call: dict) -> ToolMessage:
    return ToolMessage(content=f"[한도] {call['name']}: {mcp_tools.LIMIT_REACHED} 더 부르지 마세요.", tool_call_id=call['id'], name=call['name'], status='error')


def _unanswered(request) -> bool:
    """다른 미들웨어가 이미 답한(막거나 미룬·한도 넘은) 호출은 작가에게 승인을 묻지 않는다."""
    return not any(isinstance(m, ToolMessage) and m.tool_call_id == request.tool_call['id'] for m in request.state['messages'])


OLD_TOOL_NAMES = {'ask_manuscript_review': 'ask_review', 'ask_research': 'ask_web_research'}  # 이름을 바꾸기 전 체크포인트의 호출 횟수를 이어받는다


class ToolCallLimit(ToolCallLimitMiddleware):
    """라이브러리 도구 한도. DynamicToolMiddleware가 이미 답한(막거나 미룬) 호출은 세지 않는다(미룬 호출을 다음 턴에 부를 수 있게)."""

    def after_model(self, state, runtime):
        answered = set()
        for asked in reversed(state['messages']):  # 마지막 모델 응답 뒤에는 그 호출에 단 ToolMessage만 있다
            if isinstance(asked, AIMessage):
                break
            answered.add(asked.tool_call_id)
        pending = asked.model_copy(update={'tool_calls': [c for c in asked.tool_calls if c['id'] not in answered and c['name'] not in mcp_tools.NAMES]})
        counted = {**state, 'messages': [pending]}
        if (old_name := OLD_TOOL_NAMES.get(self.tool_name)) and (old_count := state.get('thread_tool_call_count', {}).get(old_name)):
            counts = state['thread_tool_call_count']
            counted['thread_tool_call_count'] = {**counts, self.tool_name: counts.get(self.tool_name, old_count)}
        return super().after_model(counted, runtime)


class MainModelMiddleware(AgentMiddleware):
    """메인 모델 호출 하나를 추적하고, 쓸 수 없는 응답은 고정 실패 메시지로 끝낸다. 실패를 성공으로 바꾸지 않는다(status=failed).

    generation에는 이번 턴 지시문의 Langfuse 프롬프트 버전(prompt)을 연결한다.
    """

    def __init__(self, prompt=None):
        super().__init__()
        self.prompt = prompt

    async def awrap_model_call(self, request, handler):
        done = any(s['status'] == 'completed' for s in request.state.get('steps') or [])
        text = MAIN_FAILED_MESSAGE if done else MAIN_FAILED_NOTHING_MESSAGE
        failed = ModelResponse(result=[AIMessage(content=text, name=FAILED)])
        with tracing.observe('main_agent', as_type='generation', model=request.model.model_name, prompt=self.prompt) as generation:
            try:
                response = await handler(request)
            except (OpenAIError, ValueError) as error:
                # langchain-openai는 응답 오류도 ValueError로 올려 둘 다 실패로 끝낸다. 제공사 오류가 아니면 원인이 가려지지 않게
                # 예외 종류를 남긴다(메시지는 입력을 담을 수 있어 남기지 않는다).
                generation.update(level='ERROR', status_message=MAIN_FAILED_MESSAGE if isinstance(error, OpenAIError) else type(error).__name__)
                return failed
            message = response.result[-1]
            usage = message.usage_metadata
            generation.update(model=message.response_metadata.get('model_name'), output=message.text or [c['name'] for c in message.tool_calls],
                              usage_details=usage and {'input': usage['input_tokens'], 'output': usage['output_tokens']})
            if message.response_metadata.get('status') != 'completed':  # 토큰 한도로 잘린 응답
                generation.update(level='ERROR', status_message=MAIN_FAILED_MESSAGE)
                return failed
        return response


def build(found: list[dict] = ()):
    """메인 에이전트. 바깥 오케스트레이션 노드 안에서 돌며 체크포인터는 바깥 그래프의 것을 이어받는다(도구 안 interrupt·resume).

    지시문은 Langfuse 프롬프트 orchestration.main의 production 버전이다(INSTRUCTIONS는 최초 등록용 기본값). 읽을 수 없으면 판정 실패(503)다.
    found는 Content MCP가 알려 준 도구 정의(mcp_tools.specs)이며 허용 목록의 도구만 감싼다. 쓰기 도구가 있으면 승인 미들웨어를 단다.
    """
    try:
        managed = tracing.prompt('orchestration.main', INSTRUCTIONS)
    except tracing.PromptUnavailable:
        raise IntentFailure() from None
    chat = ChatOpenAI(model=os.environ['OPENAI_MODEL'], api_key=os.environ['OPENAI_API_KEY'], use_responses_api=True, store=False,
                      reasoning_effort='high', max_tokens=8000, timeout=120, max_retries=0)
    mcp = mcp_tools.tools(found)
    approval = {t.name: {'allowed_decisions': ['approve', 'reject'], 'when': _unanswered, 'description': mcp_tools.LABELS[t.name]}
                for t in mcp if t.name in mcp_tools.WRITE}
    return create_agent(chat, tools=[*TOOLS.values(), *mcp], system_prompt=managed.text, state_schema=MainState, context_schema=dict, middleware=[
        # after_model 훅은 목록의 역순으로 돈다: 모델 호출 수 → 노출·묶음 확인 → 도구 한도 → 쓰기 승인. 순서를 바꾸면 막힌 호출이 한도를 쓰거나 승인을 묻는다.
        DecisionGuardMiddleware(), MainModelMiddleware(managed.client),
        *([HumanInTheLoopMiddleware(interrupt_on=approval)] if approval else []),
        ToolCallLimit(thread_limit=TOOL_CALLS),
        *(ToolCallLimit(tool_name=t.name, thread_limit=1) for t in TOOLS.values()),
        DynamicToolMiddleware(), ModelCallLimitMiddleware(thread_limit=MODEL_CALLS, exit_behavior='end')])
