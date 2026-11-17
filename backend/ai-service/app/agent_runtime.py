"""업무 Agent 공통 실행(#373): LangChain `create_agent` + 커스텀 미들웨어로 모델 호출 1회를 실행한다.

Story Context Q&A·Writing·웹 조사·Review·Rating이 같은 방식으로 쓴다. 모델은 `ChatOpenAI`(Responses API, store=False, 자동 재시도 없음)이고
구조화 출력은 제공사 strict JSON schema(ProviderStrategy)다. `ModelCallMiddleware`(AgentMiddleware 상속)가 모델 호출을 Langfuse
generation으로 감싸 모델·사용량·출력을 남기고, 제공사 오류·불완전(토큰 한도로 잘린) 응답·스키마 위반을 기능의 고정 실패 문구로 바꾼다.
호출 한도는 라이브러리 ModelCallLimitMiddleware가 지킨다(업무 Agent는 모델 호출 1회). 실패를 fallback·재시도로 숨기지 않는다.

여러 단계를 도는 Agent(인물 시뮬레이션)의 공통 진행 이벤트·사용량 장부도 여기 둔다. 미들웨어가 상태의 `step`에 단계 결과를 남기면
`ProgressMiddleware`가 LangGraph custom stream으로 흘리고(바깥 오케스트레이션이 SSE `step`으로 중계), `UsageLedger`(콜백)가 그 단계까지
`MODEL_EVENT`로 알려진 모델 호출의 토큰·지연·실패를 추적 span 하나로 묶는다. 본문·키는 어느 쪽에도 담지 않는다.
"""

import json
import os
from typing import Any, NotRequired

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, AgentState, ModelCallLimitMiddleware
from langchain.agents.structured_output import ProviderStrategy, StructuredOutputValidationError
from langchain_core.callbacks import BaseCallbackHandler, adispatch_custom_event
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from openai import OpenAIError
from pydantic import BaseModel

from app import tracing

WEB_SEARCH = {'type': 'web_search'}
MODEL_EVENT = 'agent.model'  # 모델 호출 하나의 {name, ms, failed, inputTokens, outputTokens}
STEP_EVENT = 'agent.step'  # 단계 결과 하나(SSE step 항목). 사용량 장부가 이 단계까지의 호출을 묶는다


class StepState(AgentState):
    step: NotRequired[dict | None]  # 알릴 단계 결과. ProgressMiddleware가 알린 뒤 비운다


class ProgressMiddleware(AgentMiddleware):
    """공통 진행 이벤트(SSE step): 상태에 남은 단계 결과를 다음 반복 앞이나 실행 끝에서 한 번 알린다.

    미들웨어 목록의 맨 앞에 둔다. 훅마다 별도 노드라, 이 훅이 끝난 뒤 다른 미들웨어가 interrupt로 멈추고 재개해도 다시 알리지 않는다.
    """
    state_schema = StepState

    async def abefore_model(self, state, runtime) -> dict | None:
        return await self._emit(state, runtime)

    async def aafter_agent(self, state, runtime) -> dict | None:
        return await self._emit(state, runtime)

    async def _emit(self, state, runtime) -> dict | None:
        if not state.get('step'):
            return None
        runtime.stream_writer(state['step'])
        await adispatch_custom_event(STEP_EVENT, state['step'])
        return {'step': None}


class UsageLedger(BaseCallbackHandler):
    """공통 사용량 장부: MODEL_EVENT로 알려진 호출과 도구 실패를 모았다가 STEP_EVENT마다 span(name) 하나로 남긴다.

    describe(step)는 span 메타데이터에 넣을 단계 식별(예: 턴 번호·상태)이다. trace가 없으면 현재 문맥이 없어 추적만 건너뛴다.
    """

    def __init__(self, name: str, describe, trace: dict | None = None):
        self.name, self.describe, self.trace = name, describe, trace
        self.calls: list[dict] = []
        self.records: list[dict] = []  # 지금까지 남긴 단계 요약(추적이 꺼져 있어도 남아 테스트·진단이 읽는다)

    def on_custom_event(self, name: str, data: dict, **kwargs) -> None:
        if name == MODEL_EVENT:
            self.calls.append(data)
        elif name == STEP_EVENT:
            self._flush(data)

    def on_tool_error(self, error: BaseException, **kwargs) -> None:
        self.calls.append({'name': 'tool', 'ms': 0, 'failed': True, 'inputTokens': None, 'outputTokens': None})

    def _flush(self, step: dict) -> None:
        total = lambda key: sum(c[key] or 0 for c in self.calls)  # noqa: E731
        record = {**self.describe(step), 'modelCalls': len(self.calls), 'failures': sum(c['failed'] for c in self.calls),
                  'ms': total('ms'), 'inputTokens': total('inputTokens'), 'outputTokens': total('outputTokens'), 'calls': self.calls}
        self.records.append(record)
        self.calls = []
        tracing.client().start_observation(name=self.name, as_type='span', trace_context=self.trace, metadata=record).end()


class ModelCallMiddleware(AgentMiddleware):
    """모델 호출 하나를 추적하고, 결과를 쓸 수 있는지 확인한다. 실패는 failure(status, 고정 문구)로 올린다."""

    def __init__(self, name: str, label: str, failure: type[Exception], trace: dict, settings: dict):
        super().__init__()
        self.observation, self.label, self.failure, self.trace, self.settings = name, label, failure, trace, settings

    def wrap_model_call(self, request, handler):
        unusable = self.failure(502, f'{self.label} 모델 응답을 확인할 수 없습니다.')
        with tracing.observe(self.observation, as_type='generation', model=request.model.model_name, input=self.trace) as generation:
            try:
                response = handler(request.override(model_settings={**request.model_settings, **self.settings}))
            # 스키마 위반(pydantic ValidationError는 ValueError)과 langchain-openai가 응답의 error를 올리는 ValueError는 쓸 수 없는 응답이다.
            except (StructuredOutputValidationError, ValueError):
                raise unusable from None
            except OpenAIError:
                raise self.failure(503, f'{self.label} 모델 호출에 실패했습니다.') from None
            message, parsed = response.result[-1], response.structured_response
            usage = message.usage_metadata
            generation.update(model=message.response_metadata.get('model_name'),
                              usage_details=usage and {'input': usage['input_tokens'], 'output': usage['output_tokens']},
                              output=parsed.model_dump() if parsed is not None else message.text)
            # 토큰 한도로 잘린 결과를 완성본처럼 보이지 않게 실패로 돌려준다.
            if message.response_metadata.get('status') != 'completed' or (request.response_format is not None and parsed is None):
                raise unusable
        return response


def run(name: str, label: str, failure: type[Exception], instructions: str, data: dict, *, max_tokens: int, timeout: int,
        trace: dict, schema: type[BaseModel] | None = None, web_search: bool = False) -> tuple[AIMessage, Any]:
    """data(JSON 자료)를 instructions로 한 번 처리해 마지막 모델 메시지와 구조화 결과(schema가 없으면 None)를 돌려준다.

    web_search면 OpenAI 내장 `web_search`를 반드시 쓰게 하고 검색 출처를 응답에 포함시킨다. trace는 추적에 남길 입력이다.
    """
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise failure(503, f'{label} 모델 설정이 필요합니다.')
    chat = ChatOpenAI(model=model, api_key=key, use_responses_api=True, store=False, max_tokens=max_tokens, timeout=timeout,
                      max_retries=0, include=['web_search_call.action.sources'] if web_search else None)
    agent = create_agent(
        # checkpointer=False: 오케스트레이션 노드 안에서 돌아도 바깥 대화 체크포인터를 이어받아 입력(원고·허용 문맥)을 남기지 않는다.
        chat, tools=[WEB_SEARCH] if web_search else [], system_prompt=instructions, checkpointer=False,
        response_format=ProviderStrategy(schema, strict=True) if schema else None,
        middleware=[ModelCallMiddleware(name, label, failure, trace, {'tool_choice': 'required'} if web_search else {}),
                    ModelCallLimitMiddleware(run_limit=1, exit_behavior='error')])
    state = agent.invoke({'messages': [HumanMessage(json.dumps(data, ensure_ascii=False))]})
    return state['messages'][-1], state.get('structured_response')


def meta(message: AIMessage) -> dict:
    """기능 응답의 model·providerResponseId·usage(Usage DTO 모양)."""
    usage = message.usage_metadata
    return {'model': message.response_metadata['model_name'], 'providerResponseId': message.response_metadata['id'],
            'usage': usage and {'inputTokens': usage['input_tokens'], 'outputTokens': usage['output_tokens']}}
