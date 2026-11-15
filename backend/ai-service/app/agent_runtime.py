"""업무 Agent 공통 실행(#373): LangChain `create_agent` + 커스텀 미들웨어로 모델 호출 1회를 실행한다.

Story Context Q&A·Writing·웹 조사·Review가 같은 방식으로 쓴다. 모델은 `ChatOpenAI`(Responses API, store=False, 자동 재시도 없음)이고
구조화 출력은 제공사 strict JSON schema(ProviderStrategy)다. `ModelCallMiddleware`(AgentMiddleware 상속)가 모델 호출을 Langfuse
generation으로 감싸 모델·사용량·출력을 남기고, 제공사 오류·불완전(토큰 한도로 잘린) 응답·스키마 위반을 기능의 고정 실패 문구로 바꾼다.
호출 한도는 라이브러리 ModelCallLimitMiddleware가 지킨다(업무 Agent는 모델 호출 1회). 실패를 fallback·재시도로 숨기지 않는다.
"""

import json
import os
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, ModelCallLimitMiddleware
from langchain.agents.structured_output import ProviderStrategy, StructuredOutputValidationError
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from openai import OpenAIError
from pydantic import BaseModel

from app import tracing

WEB_SEARCH = {'type': 'web_search'}


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
