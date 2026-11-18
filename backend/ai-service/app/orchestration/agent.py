"""메인 에이전트(#473): LangChain `create_agent` 하나가 요청 해석·호출 순서·서브 에이전트 호출·답변 종합을 맡는다.

모델은 `ChatOpenAI`(Responses API, store=False, 자동 재시도 없음, 병렬 도구 호출 끔)이며 도구는 판정된 기능의 `ask_*`뿐이다.
메인에는 Retrieval·Content MCP·웹 검색·반영 도구가 없다. 모델의 판단은 인가·승인·정본 적용이 아니고 아래 미들웨어와 도구가 경계를 지킨다.
- `DecisionGuardMiddleware.before_agent`: 턴당 1회 Decision Guard(`intent.judge`). 거절·기능 없음·미구현 기능이면 모델을 부르지 않고 끝낸다.
- `DynamicToolMiddleware`: 판정 기능의 도구만 모델에 보이고 실행 직전 다시 확인한다. 실패·취소·입력 대기·시뮬레이션 계획 뒤와
  모델 호출 상한의 마지막 호출에는 도구를 치운다(FinalAnswerMiddleware 방식).
- `ToolCallLimitMiddleware`(라이브러리): 기능당 1회, 턴당 3회. `ModelCallLimitMiddleware`(라이브러리): 메인 모델 호출 5회(2026-11-17 사용자 결정).
  재개(resume) 뒤에도 세도록 체크포인트에 남는 thread 한도를 쓴다. 메인 에이전트 상태는 턴마다 새로 시작한다.
- `MainModelMiddleware`: 메인 모델 호출을 Langfuse `main_agent` generation으로 남기고, 제공사 오류·잘린 응답은 끝낸 단계를 보존한 채
  고정 실패 문구로 끝낸다(예외로 올리면 단계 결과를 잃는다).
"""

import os
from typing import Any, NotRequired

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, AgentState, ModelCallLimitMiddleware, ToolCallLimitMiddleware, hook_config
from langchain.agents.middleware.types import ModelResponse
from langchain_core.messages import AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from openai import OpenAIError

from app import tracing
from app.intent import service as intent
from app.orchestration import tools
from app.orchestration.prompt import INSTRUCTIONS

MODEL_CALLS = 5  # 메인 모델 호출 상한(턴당). 마지막 호출은 도구 없이 종합한다.
TOOL_CALLS = 3  # 서브 에이전트 호출 상한(턴당). 기능마다 1회다.
FAILED = 'main_failed'  # 메인 모델 실패로 끝낸 마지막 메시지 이름
MAIN_FAILED_MESSAGE = '답변을 정리하지 못했어요. 완료한 작업의 결과는 아래에 있어요.'
TOOLS = {feature: getattr(tools, name) for feature, name in tools.TOOL_NAMES.items()}


class MainState(AgentState):
    decision: NotRequired[dict]  # Decision Guard 판정 {allowed, reason, capabilities}
    steps: NotRequired[list[dict]]  # 이번 턴 서브 에이전트 결과(호출 순서)
    inputs: NotRequired[dict]  # Content가 확인한 단계 입력. 입력 대기 resume이 채운다
    retrievalScope: NotRequired[dict | None]  # Content가 서명한 Q&A 조회 토큰. resume이 새 토큰으로 바꾼다
    stopped: NotRequired[dict | None]  # 남은 호출을 막고 끝낸 이유 {status: needs_input|cancelled|clarify, ...}
    simulationPlan: NotRequired[dict | None]  # 시뮬레이션 계획. 장면은 바깥 scene 노드가 쓴다


def _closed(state: dict) -> bool:
    """새 서브 에이전트 호출을 받지 않는 상태: 실패·취소·입력 대기·되묻기 뒤, 시뮬레이션 계획 뒤(장면은 도구 호출이 끝난 뒤 진행한다)."""
    return bool(state.get('stopped') or state.get('simulationPlan')) or any(s['status'] == 'failed' for s in state.get('steps', []))


def _allowed(state: dict) -> set[str]:
    return set() if _closed(state) else {TOOLS[c].name for c in state['decision']['capabilities'] if c in TOOLS}


class DecisionGuardMiddleware(AgentMiddleware):
    """턴당 1회 서비스 범위와 필요한 기능을 판정한다. resume 때는 체크포인트에 남은 판정을 쓰고 다시 부르지 않는다.

    판정 실패(IntentFailure)는 그대로 올려 아무것도 실행하지 않는다(503).
    """
    state_schema = MainState

    @hook_config(can_jump_to=['end'])
    def before_agent(self, state, runtime) -> dict[str, Any]:
        turn, asked = runtime.context, runtime.context['decide']
        with tracing.observe('decision_guard', trace_context=tools.trace(turn), input={'request': asked['request']}) as span:
            decided = intent.judge(asked['request'], asked['operation'], asked['materials'], asked['history'])
            span.update(metadata=decided.model_dump())
        done = {'decision': decided.model_dump()}
        if not decided.allowed or not decided.capabilities or 'world_plot' in decided.capabilities:
            done['jump_to'] = 'end'
        return done


class DynamicToolMiddleware(AgentMiddleware):
    """판정된 기능의 도구만 노출하고(wrap_model_call), 실행 직전 다시 확인한다(wrap_tool_call)."""

    @hook_config(can_jump_to=['end'])
    def before_model(self, state, runtime) -> dict | None:
        # 시뮬레이션 계획을 정하지 못해 되묻는 턴은 종합하지 않고 고정 문구로 끝낸다(2026-11-17 사용자 결정).
        return {'jump_to': 'end'} if (state.get('stopped') or {}).get('status') == 'clarify' else None

    @hook_config(can_jump_to=['model'])
    def after_model(self, state, runtime) -> dict | None:
        """노출 밖 도구 호출을 도구 한도가 세기 전에 막고 모델에게 돌려준다(막힌 호출이 턴당 3회를 쓰지 않게).

        모델 호출 수는 이 훅보다 먼저 센다(미들웨어 목록에서 ModelCallLimitMiddleware가 뒤에 있다). 그래서 계속 잘못 불러도 상한에서 끝난다.
        """
        calls, allowed = state['messages'][-1].tool_calls, _allowed(state)
        if not calls or any(c['name'] in allowed for c in calls):
            return None
        return {'jump_to': 'model', 'messages': [_blocked(c) for c in calls]}

    async def awrap_model_call(self, request, handler):
        last = request.state.get('thread_model_call_count', 0) >= MODEL_CALLS - 1
        allowed = set() if last else _allowed(request.state)
        exposed = [t for t in request.tools if t.name in allowed]
        return await handler(request.override(tools=exposed, model_settings={'parallel_tool_calls': False} if exposed else {}))

    async def awrap_tool_call(self, request, handler):
        if request.tool_call['name'] not in _allowed(request.state):
            return _blocked(request.tool_call)
        return await handler(request)


def _blocked(call: dict) -> ToolMessage:
    return ToolMessage(content=f"[차단] {call['name']}: 이번 요청에서 부를 수 없는 도구예요. 다시 부르지 마세요.",
                       tool_call_id=call['id'], name=call['name'], status='error')


class MainModelMiddleware(AgentMiddleware):
    """메인 모델 호출 하나를 추적하고, 쓸 수 없는 응답은 고정 실패 메시지로 끝낸다. 실패를 성공으로 바꾸지 않는다(status=failed)."""

    async def awrap_model_call(self, request, handler):
        failed = ModelResponse(result=[AIMessage(content=MAIN_FAILED_MESSAGE, name=FAILED)])
        with tracing.observe('main_agent', as_type='generation', model=request.model.model_name,
                             trace_context=tools.trace(request.runtime.context)) as generation:
            try:
                response = await handler(request)
            except (OpenAIError, ValueError):
                generation.update(level='ERROR', status_message=MAIN_FAILED_MESSAGE)
                return failed
            message = response.result[-1]
            usage = message.usage_metadata
            generation.update(model=message.response_metadata.get('model_name'), output=message.text or [c['name'] for c in message.tool_calls],
                              usage_details=usage and {'input': usage['input_tokens'], 'output': usage['output_tokens']})
            if message.response_metadata.get('status') != 'completed':  # 토큰 한도로 잘린 응답
                generation.update(level='ERROR', status_message=MAIN_FAILED_MESSAGE)
                return failed
        return response


def build():
    """메인 에이전트. 바깥 오케스트레이션 노드 안에서 돌며 체크포인터는 바깥 그래프의 것을 이어받는다(도구 안 interrupt·resume)."""
    chat = ChatOpenAI(model=os.environ['OPENAI_MODEL'], api_key=os.environ['OPENAI_API_KEY'], use_responses_api=True, store=False,
                      max_tokens=4000, timeout=120, max_retries=0)
    return create_agent(chat, tools=list(TOOLS.values()), system_prompt=INSTRUCTIONS, state_schema=MainState, context_schema=dict, middleware=[
        # after_model 훅은 목록의 역순으로 돈다: 모델 호출 수 → 노출 확인 → 도구 한도. 순서를 바꾸면 막힌 호출이 한도를 쓴다.
        DecisionGuardMiddleware(), MainModelMiddleware(),
        ToolCallLimitMiddleware(thread_limit=TOOL_CALLS),
        *(ToolCallLimitMiddleware(tool_name=t.name, thread_limit=1) for t in TOOLS.values()),
        DynamicToolMiddleware(), ModelCallLimitMiddleware(thread_limit=MODEL_CALLS, exit_behavior='end')])
