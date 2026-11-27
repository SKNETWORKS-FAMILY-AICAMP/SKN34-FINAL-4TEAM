"""업무 Agent 공통 실행(#373): LangChain `create_agent` + 커스텀 미들웨어로 모델 호출 1회를 실행한다.

Story Context Q&A·Writing·웹 조사·Review·Rating이 같은 방식으로 쓴다. 모델은 `ChatOpenAI`(Responses API, store=False, SDK 숨은 재시도 없음)이고
구조화 출력은 제공사 strict JSON schema(ProviderStrategy)다. `ModelCallMiddleware`(AgentMiddleware 상속)가 모델 호출을 Langfuse
generation으로 감싸 모델·사용량·출력을 남기고, 제공사 오류·불완전(토큰 한도로 잘린) 응답·스키마 위반을 기능의 고정 실패 문구로 바꾼다.
호출 한도는 라이브러리 ModelCallLimitMiddleware가 지킨다(업무 Agent는 모델 호출 1회). 실패를 fallback으로 숨기지 않는다.
재시도는 DEC-61의 두 가지뿐이다: 집필 AI 채팅 안(그래프 실행)의 일시 장애(연결·시간 초과·429·5xx)는 1초 뒤 같은 입력으로 한 번 더 부르고
진행 목록에 보인다(REST 업무 API·연재·회귀 평가처럼 채팅 밖에서는 재시도하지 않는다). 출력 문제(502)는
이 모듈이 다시 부르지 않고 `failure.retry = 'output'`만 단다(서비스가 모델 출력을 검증해 올리는 502도 같은 표식을 단다). 집필 채팅의 `orchestration.tools._ask`가 같은 입력으로 한 번 더 부른다.

여러 단계를 도는 Agent(인물 시뮬레이션)의 공통 진행 이벤트·사용량 장부도 여기 둔다. 미들웨어가 상태의 `step`에 단계 결과를 남기면
`ProgressMiddleware`가 LangGraph custom stream으로 흘리고(바깥 오케스트레이션이 SSE `step`으로 중계), `UsageLedger`(콜백)가 그 단계까지
`MODEL_EVENT`로 알려진 모델 호출의 토큰·지연·실패를 추적 span 하나로 묶는다. 본문·키는 어느 쪽에도 담지 않는다.

요청 하나가 모델을 여러 번 부르는 기능(AI 자율 연재, #659)의 크레딧은 `CreditMiddleware`가 맡는다: 요청 안 모든 `run`에 같은 인스턴스를 넘겨
입력+출력 토큰을 누적하고, 상한에 닿으면 다음 모델 호출을 막는다.

집필 채팅 진행 목록(#784)의 한 줄은 `activity`가 LangGraph custom stream으로 알리고 오케스트레이션이 SSE `activity`로 중계한다.
업무 Agent가 실제로 부르는 바깥 작업(Content MCP 호출·Retrieval·웹 검색)과 판정·`ask_*`가 쓴다. 그래프 실행 밖(REST 업무 API·워커)에서는 알리지 않는다.
"""

import json
import os
from contextlib import contextmanager
from time import sleep
from typing import Any, NotRequired
from uuid import uuid4

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, AgentState, ModelCallLimitMiddleware
from langchain.agents.structured_output import ProviderStrategy, StructuredOutputValidationError
from langchain_core.callbacks import BaseCallbackHandler, adispatch_custom_event
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.config import get_stream_writer
from openai import APIConnectionError, InternalServerError, OpenAIError, RateLimitError
from pydantic import BaseModel

from app import tracing

WEB_SEARCH = {'type': 'web_search'}
MODEL_EVENT = 'agent.model'  # 모델 호출 하나의 {name, ms, failed, inputTokens, outputTokens}
STEP_EVENT = 'agent.step'  # 단계 결과 하나(SSE step 항목). 사용량 장부가 이 단계까지의 호출을 묶는다


TRANSIENT = (APIConnectionError, RateLimitError, InternalServerError)  # 일시 장애(APITimeoutError는 APIConnectionError). 같은 입력으로 한 번 더 부른다(DEC-61)
RETRY_WAIT = 1  # 일시 장애 재시도 전 대기(초)
RETRY_LABEL, RETRY_TARGET = '다시 시도하는 중', '일시 장애'
TARGET_CHARS = 40  # 진행 목록 대상(회차·카드 이름·검색어)은 앞 40자만 보인다. 도구 인자 원문은 싣지 않는다


def _writer():
    """지금 실행 중인 그래프(집필 AI 채팅)의 stream writer. 그래프 실행 밖(REST 업무 API·워커)에는 SSE가 없어 None이다."""
    try:
        return get_stream_writer()
    except (RuntimeError, KeyError):
        return None


def report(id: str, label: str, status: str, target: str | None = None, feature: str | None = None, write=None) -> None:
    """진행 목록 한 줄 {id, label, target, status(running|done|failed), feature}을 알린다. 같은 id가 화면의 한 줄을 갱신한다.
    write를 주면 그 writer로 보낸다(업무 Agent 안처럼 바깥 그래프의 writer를 미리 잡아 둔 곳)."""
    if not (write := write or _writer()):
        return
    write({'activity': {'id': id, 'label': label, 'target': target[:TARGET_CHARS] if target else None, 'status': status, 'feature': feature}})


@contextmanager
def activity(label: str, target: str | None = None, write=None):
    """감싼 작업을 running으로 알리고 끝나면 done, 예외면 failed로 알린 뒤 예외를 그대로 올린다."""
    id = uuid4().hex
    report(id, label, 'running', target, write=write)
    try:
        yield
    except Exception:
        report(id, label, 'failed', target, write=write)
        raise
    report(id, label, 'done', target, write=write)


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

    describe(step)는 span 메타데이터에 넣을 단계 식별(예: 턴 번호·상태)이다. span은 호출한 요청의 루트 아래(현재 문맥)에 붙는다.
    """

    def __init__(self, name: str, describe):
        self.name, self.describe = name, describe
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
        tracing.client().start_observation(name=self.name, as_type='span', metadata=record).end()


class ModelCallMiddleware(AgentMiddleware):
    """모델 호출 하나를 추적하고, 결과를 쓸 수 있는지 확인한다. 실패는 failure(status, 고정 문구)로 올린다."""

    def __init__(self, name: str, label: str, failure: type[Exception], trace: dict, settings: dict, prompt=None, write=None):
        super().__init__()
        self.observation, self.label, self.failure, self.trace, self.settings, self.prompt = name, label, failure, trace, settings, prompt
        self.write = write  # 집필 AI 채팅의 stream writer. 있을 때만 일시 장애를 한 번 다시 부르고 그 줄을 진행 목록에 보인다(DEC-61)

    def wrap_model_call(self, request, handler):
        unusable = self.failure(502, f'{self.label} 모델 응답을 확인할 수 없습니다.')
        unusable.retry = 'output'  # orchestration._ask가 같은 입력으로 한 번 다시 부를 수 있는 출력 문제(DEC-61)
        with tracing.observe(self.observation, as_type='generation', model=request.model.model_name, input=self.trace,
                             prompt=self.prompt) as generation:
            try:
                called = request.override(model_settings={**request.model_settings, **self.settings})
                try:
                    response = handler(called)
                except TRANSIENT:  # 숨은 SDK 재시도 대신 보이는 재시도 한 번. 두 번째도 실패하면 아래 except가 고정 503으로 끝낸다
                    if self.write is None:  # 채팅 밖(REST 업무 API·연재·회귀 평가)은 재시도하지 않는다
                        raise
                    generation.update(metadata={'retries': 1, 'retryReason': 'transient'})
                    with activity(RETRY_LABEL, RETRY_TARGET, write=self.write):
                        sleep(RETRY_WAIT)
                        response = handler(called)
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


TOKENS_PER_CREDIT = 1000  # 1 크레딧 = 1,000 토큰(입력+출력, 코드 상수). 금액은 소수 4자리로 올려 확정한다.


class CreditMiddleware(AgentMiddleware):
    """요청 하나의 모든 모델 호출 사용량(입력+출력 토큰)을 모아 크레딧 금액을 확정하고, 상한에 닿으면 다음 모델 호출을 막는다(#659).

    한 요청에서 `run`을 여러 번 부르면 같은 인스턴스를 넘겨 누적한다. 누적 금액이 limit 이상이면 다음 모델 호출 전에 모델을 부르지 않고
    failure(402)로 끝낸다. 호출 하나의 사용량은 부르기 전에 알 수 없어 상한 아래에서 시작한 호출은 상한을 넘겨도 끝까지 간다.
    확정 금액(credits)은 그래도 limit을 넘지 않는다: Core 정산은 예약 상한 이하의 금액만 받는다(credit-internal-api). 넘긴 몫은 플랫폼이 부담하고
    실제 토큰은 input_tokens·output_tokens에 그대로 남는다.
    ponytail: 호출 전 토큰 예측은 하지 않아 상한을 넘기는 마지막 호출 하나까지 허용한다. 문제 되면 입력 토큰을 미리 세어 막는다.
    """

    def __init__(self, limit: float, failure: type[Exception]):
        super().__init__()
        self.limit, self.failure = limit, failure
        self.input_tokens = self.output_tokens = 0

    @property
    def credits(self) -> float:
        tokens = self.input_tokens + self.output_tokens
        return min(-(-tokens * 10_000 // TOKENS_PER_CREDIT) / 10_000, self.limit)  # 정수 올림나눗셈(부동소수 오차 없이 소수 4자리 올림)

    def gate(self) -> None:
        """누적 금액이 상한 이상이면 failure(402)로 끝낸다. 다음 모델 호출 전에 부른다."""
        if self.credits >= self.limit:
            raise self.failure(402, '크레딧 상한을 넘었습니다.')

    def record(self, input_tokens: int, output_tokens: int) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens

    def wrap_model_call(self, request, handler):
        self.gate()
        response = handler(request)
        usage = response.result[-1].usage_metadata
        if usage:
            self.record(usage['input_tokens'], usage['output_tokens'])
        return response


class CreditLedger(BaseCallbackHandler):
    """create_agent 밖에서 모델을 부르는 실행(인물 시뮬레이션의 장면 에이전트)이 호출마다 알리는 MODEL_EVENT를 같은 CreditMiddleware에 더한다(#659).

    호출 하나가 끝나 사용량을 알리면 더하고, 상한 이상이면 raise_error로 그 실행을 바로 끝낸다(다음 모델 호출은 없다). 사용량 없는 실패 호출은 0으로 센다.
    """
    raise_error = True

    def __init__(self, credit: CreditMiddleware):
        self.credit = credit

    def on_custom_event(self, name: str, data: dict, **kwargs) -> None:
        if name == MODEL_EVENT:
            self.credit.record(data['inputTokens'] or 0, data['outputTokens'] or 0)
            self.credit.gate()


def run(name: str, label: str, failure: type[Exception], instructions: str, data: dict, *, prompt_name: str | None = None, max_tokens: int,
        timeout: int, trace: dict, schema: type[BaseModel] | None = None, web_search: bool = False,
        credit: CreditMiddleware | None = None, model: str | None = None, effort: str | None = None) -> tuple[AIMessage, Any]:
    """data(JSON 자료)를 지시문으로 한 번 처리해 마지막 모델 메시지와 구조화 결과(schema가 없으면 None)를 돌려준다.

    지시문은 Langfuse 프롬프트 prompt_name의 production 버전이고 instructions(코드 문자열)는 최초 등록용 기본값이다(tracing.prompt).
    generation이 그 프롬프트 버전을 연결한다. 프롬프트를 읽을 수 없으면 모델을 부르지 않고 503이다.
    prompt_name이 없으면 Langfuse 프롬프트를 읽지 않고 instructions를 그대로 지시문으로 쓰며 generation에도 연결하지 않는다(회귀 평가처럼
    평가할 프롬프트 버전의 본문을 직접 넘기는 호출. production 버전을 읽으면 안 된다). 모델은 프롬프트 버전이 고른 모델(prompt_name이 없으면
    model 인자: 평가하는 버전의 모델)이고 없으면 OPENAI_MODEL이다(#705).
    web_search면 OpenAI 내장 `web_search`를 반드시 쓰게 하고 검색 출처를 응답에 포함시킨다. trace는 추적에 남길 입력이다.
    credit을 주면 가장 바깥 미들웨어로 끼워 이 호출의 사용량을 그 인스턴스에 더하고, 상한에 닿았으면 모델을 부르지 않는다.
    effort를 주면 OpenAI 추론 강도(reasoning_effort)로 보낸다(없으면 모델 기본값).
    """
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        raise failure(503, f'{label} 모델 설정이 필요합니다.')
    try:
        managed = tracing.Prompt(instructions, model=model) if prompt_name is None else tracing.prompt(prompt_name, instructions)
    except tracing.PromptUnavailable:
        raise failure(503, f'{label} 프롬프트를 불러올 수 없습니다.') from None
    model = managed.model or os.environ.get('OPENAI_MODEL')  # 운영 화면에서 고른 모델(#705), 없으면 환경 변수 기본값
    if not model:
        raise failure(503, f'{label} 모델 설정이 필요합니다.')
    chat = ChatOpenAI(model=model, api_key=key, use_responses_api=True, store=False, max_tokens=max_tokens, timeout=timeout,
                      max_retries=0, include=['web_search_call.action.sources'] if web_search else None,
                      **({'reasoning_effort': effort} if effort else {}))
    agent = create_agent(
        # checkpointer=False: 오케스트레이션 노드 안에서 돌아도 바깥 대화 체크포인터를 이어받아 입력(원고·허용 문맥)을 남기지 않는다.
        chat, tools=[WEB_SEARCH] if web_search else [], system_prompt=managed.text, checkpointer=False,
        response_format=ProviderStrategy(schema, strict=True) if schema else None,
        middleware=[*([credit] if credit is not None else []),
                    ModelCallMiddleware(name, label, failure, trace, {'tool_choice': 'required'} if web_search else {}, managed.client,
                                        write=_writer()),  # 업무 Agent는 따로 그래프를 돌아 바깥 채팅의 writer를 여기서 잡는다
                    ModelCallLimitMiddleware(run_limit=1, exit_behavior='error')])
    state = agent.invoke({'messages': [HumanMessage(json.dumps(data, ensure_ascii=False))]})
    return state['messages'][-1], state.get('structured_response')


def meta(message: AIMessage) -> dict:
    """기능 응답의 model·providerResponseId·usage(Usage DTO 모양)."""
    usage = message.usage_metadata
    return {'model': message.response_metadata['model_name'], 'providerResponseId': message.response_metadata['id'],
            'usage': usage and {'inputTokens': usage['input_tokens'], 'outputTokens': usage['output_tokens']}}
