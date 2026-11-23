"""인물 시뮬레이션 모델 호출: 계획·인물 턴·나레이션·검사를 각각 Structured Outputs 1회로 요청한다.

호출은 업무 Agent(app/agent_runtime.py)와 같은 `langchain-openai`의 `ChatOpenAI`(Responses API, store=False, 자동 재시도 없음)이고 구조화 출력은
제공사 strict JSON schema(`with_structured_output(method='json_schema', strict=True)`)다. 지시문은 system 메시지, 입력 JSON은 user 메시지로 보낸다.
호출마다 새 입력만 보낸다(store=False, 이전 응답 id 없음). 그래서 한 인물의 입력과 모델 대화 상태가 다음 인물에게 이어지지 않는다.
키·모델은 호출 시 읽고(OPENAI_API_KEY·OPENAI_MODEL), 제공사 실패·불완전 응답은 고정 문구의 SimulationFailure로 바꾼다.
추적에는 모델·사용량·실패만 남긴다. 설정 문서·생성 문단은 팀 결정 범위(질문·원고·답변) 밖이라 남기지 않는다.
LangChain 실행(장면 에이전트의 도구) 안에서 부르면 호출마다 사용량·지연·실패를 공통 `MODEL_EVENT`로 알려 사용량 장부(app/agent_runtime.UsageLedger)가 모은다.
인물 대사(act)의 기본 모델은 `ACT_MODEL`(gpt-6.1-terra, 사용자 결정 2026-11-23, 근거 원문 평가 §14)이고 나머지 호출은 OPENAI_MODEL(gpt-6-luna)이다. `SIMULATION_ACT_MODEL`로 act 모델만 덮어쓴다(luna로 되돌리기: gpt-6-luna).
act 전용 제공사: `SIMULATION_ACT_BASE_URL`(OpenAI 호환 제공사, 예 Hemmingway·OpenRouter)이 있으면 act 호출만 그 제공사의 Chat Completions로 보낸다(Responses API가 없다).
키는 `SIMULATION_ACT_API_KEY`가 있어야 하고(없으면 모델을 부르기 전에 503, OPENAI_API_KEY를 외부로 보내지 않는다. base URL이 없으면 이 키는 쓰지 않는다) 모델은 `SIMULATION_ACT_MODEL`(비면 OPENAI_MODEL)이다. 추론 강도는 `reasoning_effort`로 보내고 store는 보내지 않는다. `SIMULATION_ACT_THINKING=off`면 제공사의 생각을 끈다(`enable_thinking=false`, 생각 토큰이 출력에 섞여 비용·지연을 늘린다). 다른 호출은 OpenAI 그대로다.
속도 스위치(#642): 네 호출 모두 `reasoning.effort`를 보낸다. 값은 환경 변수 `SIMULATION_REASONING_EFFORT`(호출 때 읽음)이고 비어 있으면 시뮬레이션 v2 기본값 `low`다(HP 장면 p50 10.8→7.9초, 시공간 정확도·검사 판정은 v1과 같고 ① 대사 말투만 −0.12(p=0.025), docs/evaluation/simulation-v2.md·simulation-original.md §13).
"""

import json
import os
import time

from langchain_core.callbacks import dispatch_custom_event
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import ContentFilterFinishReasonError, LengthFinishReasonError, OpenAIError
from pydantic import BaseModel

from app import tracing
from app.agent_runtime import MODEL_EVENT
from app.simulation.errors import PROMPT_UNAVAILABLE, SimulationFailure
from app.simulation.models import Action, Monologue, Narration, PlanDraft, Verdict
from app.simulation.prompt import ACT_INSTRUCTIONS, CHECK_INSTRUCTIONS, NARRATE_INSTRUCTIONS, PLAN_INSTRUCTIONS


EFFORT = 'SIMULATION_REASONING_EFFORT'
EFFORTS = ('none', 'minimal', 'low', 'medium', 'high')  # OpenAI reasoning.effort 값 그대로. 그 밖은 설정 오류다
BAD_EFFORT = '시뮬레이션 추론 강도 설정을 확인해 주세요.'
BAD_THINKING = '시뮬레이션 act 생각 설정을 확인해 주세요.'
DEFAULT_EFFORT = 'low'  # 시뮬레이션 v2 기본값
ACT_MODEL = 'gpt-6.1-terra'  # 인물 대사(act)의 기본 모델(사용자 결정 2026-11-23). SIMULATION_ACT_MODEL로 덮어쓰고, 외부 제공사(BASE_URL)에는 쓰지 않는다(그쪽은 OPENAI_MODEL로 되돌아간다)
UNUSABLE = '시뮬레이션 모델 응답을 확인할 수 없습니다.'


def plan(request: str, history: list[str], characters: list[dict]) -> PlanDraft:
    """요청 문장과 인물 목록({id, name}만)으로 모드·전제·비트·참여 인물을 정한다. 흐름 모드에 비트가 없으면 비트를 제안한다."""
    data = {'request': request, 'history': history, 'characters': characters}
    return _parse('plan', PLAN_INSTRUCTIONS, data, PlanDraft, 1200, 40)


def act(data: dict, instructions: str | None = None) -> Action:
    """한 인물의 입력(그 인물이 아는 것만)으로 소설 문단 하나와 다른 인물에게 보일 행동을 만든다.
    instructions는 회귀 평가가 지정한 프롬프트 버전 본문이다(있으면 production 버전을 읽지 않고 그대로 쓴다)."""
    return _parse('act', ACT_INSTRUCTIONS, data, Action, 1500, 60, instructions)


def narrate(data: dict, instructions: str | None = None) -> Narration:
    """나레이터(메인 에이전트)가 지문·독백 한 문단과 그 자리의 모두에게 보일 것을 만든다. 시점·목적·허용된 지식은 입력이 정한다.
    instructions는 회귀 평가가 지정한 프롬프트 버전 본문이다(있으면 production 버전을 읽지 않고 그대로 쓴다)."""
    schema = Monologue if data.get('purpose') == 'monologue' else Narration
    return _parse('narrate', NARRATE_INSTRUCTIONS, data, schema, 1500, 60, instructions)


def check(data: dict) -> Verdict:
    """생성 문단을 오류 1~3과 IF 전제·비트 진행 기준으로 한 번에 판정한다. 나레이션(self.id 없음)은 미래 정보 누설만 판정한다."""
    return _parse('check', CHECK_INSTRUCTIONS, data, Verdict, 1500, 60)


def _endpoint(name: str) -> tuple[str | None, str | None, str | None, str | None]:
    """호출의 (base URL, 키, 모델, 생각 설정). act만 SIMULATION_ACT_BASE_URL·API_KEY·MODEL을 따르고(공백은 빈 값) 나머지 호출은 OPENAI_*다.
    act의 빈 모델은 base URL이 없으면 ACT_MODEL(gpt-6.1-terra)이고 있으면(외부 제공사) OPENAI_MODEL이다.
    생각 설정(SIMULATION_ACT_THINKING)은 base URL이 있을 때만 읽는다.
    키는 base URL(OpenAI 호환 제공사)이 있으면 SIMULATION_ACT_API_KEY뿐이고(OPENAI_API_KEY를 외부로 보내지 않는다) 없으면 OPENAI_API_KEY뿐이다(제공사 키를 OpenAI로 보내지 않는다)."""
    own = lambda var: (os.environ.get(f'SIMULATION_ACT_{var}', '').strip() or None) if name == 'act' else None  # noqa: E731
    base_url = own('BASE_URL')
    default_model = ACT_MODEL if name == 'act' and not base_url else os.environ.get('OPENAI_MODEL')
    return base_url, own('API_KEY') if base_url else os.environ.get('OPENAI_API_KEY'), own('MODEL') or default_model, own('THINKING') if base_url else None


def _details(usage: dict | None) -> dict | None:
    """generation에 남기는 사용량(응답의 usage_metadata 모양을 Langfuse usage_details 모양으로)."""
    return usage and {'input': usage['input_tokens'], 'output': usage['output_tokens']}


def _parse(name: str, instructions: str, data: dict, text_format: type[BaseModel], max_tokens: int, timeout: int, fixed: str | None = None):
    base_url, key, model, thinking = _endpoint(name)
    if not key or not model:
        raise SimulationFailure(503, '시뮬레이션 모델 설정이 필요합니다.')
    if thinking not in (None, 'off'):  # 끄는 값만 있다: 오타를 짐작해 쓰지 않는다
        raise SimulationFailure(503, BAD_THINKING)
    effort = os.environ.get(EFFORT, '').strip() or DEFAULT_EFFORT
    if effort and effort not in EFFORTS:  # 모델을 부르기 전에 막는다(고친 값을 짐작해 쓰지 않는다)
        raise SimulationFailure(503, BAD_EFFORT)
    try:  # 지시문은 Langfuse 프롬프트 character_simulation.<호출>의 production 버전이고 instructions(코드 문자열)는 기본값이다. fixed(회귀 평가의 버전 본문)가 있으면 그것을 그대로 쓴다
        managed = tracing.prompt(f'character_simulation.{name}', instructions) if fixed is None else tracing.Prompt(fixed)
    except tracing.PromptUnavailable:
        raise SimulationFailure(503, PROMPT_UNAVAILABLE) from None
    started, usage = time.monotonic(), None
    # OpenAI 호환 제공사(Hemmingway·OpenRouter)에는 Responses API가 없다: Chat Completions로 보내고 추론 강도는 reasoning_effort로 보낸다(store는 보내지 않는다).
    api = ({'base_url': base_url, 'use_responses_api': False, 'reasoning_effort': effort, **({'extra_body': {'enable_thinking': False}} if thinking else {})} if base_url
           else {'use_responses_api': True, 'store': False, 'reasoning': {'effort': effort}})
    structured = ChatOpenAI(model=model, api_key=key, max_tokens=max_tokens, timeout=timeout, max_retries=0, **api).with_structured_output(
        text_format, method='json_schema', strict=True, include_raw=True)
    try:
        with tracing.observe(f'simulation.{name}', as_type='generation', model=model, prompt=managed.client) as generation:
            try:
                out = structured.invoke([SystemMessage(managed.text), HumanMessage(json.dumps(data, ensure_ascii=False))])
            # Chat Completions는 길이 초과·콘텐츠 필터 중단을 SDK가 OpenAIError 하위 예외로 올리므로 503보다 먼저 잡는다. 길이 초과로 잘린 호출도 토큰은 썼다.
            except LengthFinishReasonError as error:
                used = error.completion.usage
                usage = used and {'input_tokens': used.prompt_tokens, 'output_tokens': used.completion_tokens}
                generation.update(usage_details=_details(usage))
                raise SimulationFailure(502, UNUSABLE) from None
            # 스키마 위반·잘린 JSON(pydantic ValidationError는 ValueError)과 langchain-openai가 응답의 error를 올리는 ValueError는 쓸 수 없는 응답이다.
            except (ValueError, ContentFilterFinishReasonError):
                raise SimulationFailure(502, UNUSABLE) from None
            except OpenAIError:
                raise SimulationFailure(503, '시뮬레이션 모델 호출에 실패했습니다.') from None
            raw, parsed = out['raw'], out['parsed']
            usage = raw.usage_metadata
            generation.update(model=raw.response_metadata.get('model_name', model), usage_details=_details(usage))
            if raw.response_metadata.get('status', 'completed') != 'completed' or parsed is None:  # Chat Completions 응답에는 status가 없다
                raise SimulationFailure(502, UNUSABLE)
    except SimulationFailure:
        _report(name, started, usage, failed=True)
        raise
    _report(name, started, usage, failed=False)
    return parsed


def _report(name: str, started: float, usage: dict | None, failed: bool) -> None:
    """호출 하나의 지연·토큰·실패를 LangChain 콜백에 알린다(본문·키는 없다). usage는 응답의 usage_metadata다. LangChain 실행 밖이면 알릴 곳이 없어 건너뛴다."""
    try:
        dispatch_custom_event(MODEL_EVENT, {
            'name': name, 'ms': round((time.monotonic() - started) * 1000), 'failed': failed,
            'inputTokens': usage and usage['input_tokens'], 'outputTokens': usage and usage['output_tokens']})
    except RuntimeError:
        pass
