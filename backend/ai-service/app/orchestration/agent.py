"""메인 에이전트(#473): LangChain `create_agent` 하나가 요청 해석·호출 순서·서브 에이전트 호출·답변 종합을 맡는다.

모델은 `ChatOpenAI`(Responses API, store=False, 자동 재시도 없음, 병렬 도구 호출 켬)이며 도구는 판정된 기능의 `ask_*`뿐이다.
메인에는 Retrieval·Content MCP·웹 검색·반영 도구가 없다. 모델의 판단은 인가·승인·정본 적용이 아니고 아래 미들웨어와 도구가 경계를 지킨다.
- `DecisionGuardMiddleware.before_agent`: 턴당 1회 Decision Guard(`intent.judge`). 거절·기능 없음·미구현 기능이면 모델을 부르지 않고 끝낸다.
- `DynamicToolMiddleware`: 판정 기능의 도구만 모델에 보이고 실행 직전 다시 확인한다. 실패·취소·입력 대기·시뮬레이션 계획 뒤와
  모델 호출 상한의 마지막 호출에는 도구를 치운다(FinalAnswerMiddleware 방식). 한 모델 턴의 병렬 묶음은 조회형(PARALLEL)만 함께 실행하고
  단독 도구·입력이 빠진 호출은 실행하지 않고 돌려 다음 모델 턴에 따로 부르게 한다(#474, 2026-11-17 사용자 결정). 함께 실행하는 호출은
  create_agent가 호출마다 Send로 같은 superstep에서 동시에 돌리고, 그래서 steps는 reducer로 모은다(모델이 부른 순서).
- `ToolCallLimit`(라이브러리 상속): 기능당 1회, 턴당 3회. `ModelCallLimitMiddleware`(라이브러리): 메인 모델 호출 5회(2026-11-17 사용자 결정).
  재개(resume) 뒤에도 세도록 체크포인트에 남는 thread 한도를 쓴다. 메인 에이전트 상태는 턴마다 새로 시작한다.
- `MainModelMiddleware`: 메인 모델 호출을 Langfuse `main_agent` generation으로 남기고, 제공사 오류·잘린 응답은 끝낸 단계를 보존한 채
  고정 실패 문구로 끝낸다(예외로 올리면 단계 결과를 잃는다).
"""

import operator
import os
from typing import Annotated, Any, NotRequired

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
# 한 모델 턴에 함께 실행할 수 있는 조회형 도구(#474). 서로의 결과를 쓰지 않는다. ask_writing·ask_character_simulation은 항상 단독이다.
PARALLEL = {'ask_story_qa', 'ask_web_research', 'ask_rating', 'ask_world_review', 'ask_review'}


class MainState(AgentState):
    decision: NotRequired[dict]  # Decision Guard 판정 {allowed, reason, capabilities}
    steps: NotRequired[Annotated[list[dict], operator.add]]  # 이번 턴 서브 에이전트 결과. 도구마다 자기 단계 하나를 덧붙인다(호출 순서)
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

    def after_model(self, state, runtime) -> dict | None:
        """노출 밖 호출과 병렬 묶음에서 함께 실행할 수 없는 호출을 실행하지 않고 오류 ToolMessage로 모델에게 돌려준다.

        묶음(실행할 호출 둘 이상)에서는 단독 도구(PARALLEL 밖)와 작가 입력이 빠진 호출을 미룬다. 동시에 둘 이상 interrupt하면 resume
        하나로 이어 갈 수 없고, 의존 호출(검수 → 수정)은 앞 결과를 본 다음 모델 턴에 부르게 하기 위해서다. 함께 실행할 것이 하나도 없으면
        첫 호출만 단독으로 실행한다(모두 미루면 모델이 같은 묶음을 되풀이해 아무것도 못 한다). 답을 단 호출은 ToolCallLimit이 세지 않고
        create_agent가 실행하지 않는다(모두 막히면 바로 모델로 돌아간다). 모델 호출 수는 이 훅보다 먼저 센다(미들웨어 목록에서
        ModelCallLimitMiddleware가 뒤에 있다). 그래서 계속 잘못 불러도 상한에서 끝난다.
        """
        calls, allowed = state['messages'][-1].tool_calls, _allowed(state)
        run = [c for c in calls if c['name'] in allowed]
        if len(run) > 1:
            run = [c for c in run if c['name'] in PARALLEL and not tools.waits(c, state, runtime.context)] or run[:1]
        refused = [_blocked(c) if c['name'] not in allowed else _deferred(c) for c in calls if c not in run]
        return {'messages': refused} if refused else None

    async def awrap_model_call(self, request, handler):
        last = request.state.get('thread_model_call_count', 0) >= MODEL_CALLS - 1
        allowed = set() if last else _allowed(request.state)
        exposed = [t for t in request.tools if t.name in allowed]
        return await handler(request.override(tools=exposed, model_settings={'parallel_tool_calls': True} if exposed else {}))

    async def awrap_tool_call(self, request, handler):
        if request.tool_call['name'] not in _allowed(request.state):
            return _blocked(request.tool_call)
        return await handler(request)


def _blocked(call: dict) -> ToolMessage:
    return ToolMessage(content=f"[차단] {call['name']}: 이번 요청에서 부를 수 없는 도구예요. 다시 부르지 마세요.",
                       tool_call_id=call['id'], name=call['name'], status='error')


def _deferred(call: dict) -> ToolMessage:
    return ToolMessage(content=f"[순차] {call['name']}: 다른 도구와 함께 실행할 수 없어 실행하지 않았어요. "
                               '함께 부른 도구의 결과를 본 뒤 이 도구만 따로 다시 부르세요.',
                       tool_call_id=call['id'], name=call['name'], status='error')


class ToolCallLimit(ToolCallLimitMiddleware):
    """라이브러리 도구 한도. DynamicToolMiddleware가 이미 답한(막거나 미룬) 호출은 세지 않는다(미룬 호출을 다음 턴에 부를 수 있게)."""

    def after_model(self, state, runtime):
        answered = set()
        for asked in reversed(state['messages']):  # 마지막 모델 응답 뒤에는 그 호출에 단 ToolMessage만 있다
            if isinstance(asked, AIMessage):
                break
            answered.add(asked.tool_call_id)
        pending = asked.model_copy(update={'tool_calls': [c for c in asked.tool_calls if c['id'] not in answered]})
        return super().after_model({**state, 'messages': [pending]}, runtime)


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
        # after_model 훅은 목록의 역순으로 돈다: 모델 호출 수 → 노출·묶음 확인 → 도구 한도. 순서를 바꾸면 막힌 호출이 한도를 쓴다.
        DecisionGuardMiddleware(), MainModelMiddleware(),
        ToolCallLimit(thread_limit=TOOL_CALLS),
        *(ToolCallLimit(tool_name=t.name, thread_limit=1) for t in TOOLS.values()),
        DynamicToolMiddleware(), ModelCallLimitMiddleware(thread_limit=MODEL_CALLS, exit_behavior='end')])
