"""인물 시뮬레이션 모델 호출: 계획·인물 턴·나레이션·검사를 각각 Structured Outputs 1회로 요청한다.

호출마다 새 입력만 보낸다(store=False, 이전 응답 id 없음). 그래서 한 인물의 입력과 모델 대화 상태가 다음 인물에게 이어지지 않는다.
키·모델은 호출 시 읽고(OPENAI_API_KEY·OPENAI_MODEL), 제공사 실패·불완전 응답은 고정 문구의 SimulationFailure로 바꾼다.
추적에는 모델·사용량·실패만 남긴다. 설정 문서·생성 문단은 팀 결정 범위(질문·원고·답변) 밖이라 남기지 않는다.
LangChain 실행(장면 에이전트의 도구) 안에서 부르면 호출마다 사용량·지연·실패를 공통 `MODEL_EVENT`로 알려 사용량 장부(app/agent_runtime.UsageLedger)가 모은다.
속도 스위치(#642): 네 호출 모두 `reasoning.effort`를 보낸다. 값은 환경 변수 `SIMULATION_REASONING_EFFORT`(호출 때 읽음)이고 비어 있으면 시뮬레이션 v2 기본값 `low`다(원문 기반·HP 평가에서 품질이 같고 장면 p50 10.8→7.9초, docs/evaluation/simulation-v2.md).
"""

import json
import os
import time

from langchain_core.callbacks import dispatch_custom_event
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ValidationError

from app import tracing
from app.agent_runtime import MODEL_EVENT
from app.simulation.errors import PROMPT_UNAVAILABLE, SimulationFailure
from app.simulation.models import Action, Narration, PlanDraft, Verdict
from app.simulation.prompt import ACT_INSTRUCTIONS, CHECK_INSTRUCTIONS, NARRATE_INSTRUCTIONS, PLAN_INSTRUCTIONS


EFFORT = 'SIMULATION_REASONING_EFFORT'
EFFORTS = ('none', 'minimal', 'low', 'medium', 'high')  # OpenAI reasoning.effort 값 그대로. 그 밖은 설정 오류다
BAD_EFFORT = '시뮬레이션 추론 강도 설정을 확인해 주세요.'
DEFAULT_EFFORT = 'low'  # 시뮬레이션 v2 기본값


def plan(request: str, history: list[str], characters: list[dict]) -> PlanDraft:
    """요청 문장과 인물 목록({id, name}만)으로 모드·전제·비트·참여 인물을 정한다. 흐름 모드에 비트가 없으면 비트를 제안한다."""
    data = {'request': request, 'history': history, 'characters': characters}
    return _parse('plan', PLAN_INSTRUCTIONS, data, PlanDraft, 1200, 40)


def act(data: dict) -> Action:
    """한 인물의 입력(그 인물이 아는 것만)으로 소설 문단 하나와 다른 인물에게 보일 행동을 만든다."""
    return _parse('act', ACT_INSTRUCTIONS, data, Action, 1500, 60)


def narrate(data: dict) -> Narration:
    """나레이터(메인 에이전트)가 지문·독백 한 문단과 그 자리의 모두에게 보일 것을 만든다. 시점·목적·허용된 지식은 입력이 정한다."""
    return _parse('narrate', NARRATE_INSTRUCTIONS, data, Narration, 1500, 60)


def check(data: dict) -> Verdict:
    """생성 문단을 오류 1~3과 IF 전제·비트 진행 기준으로 한 번에 판정한다. 나레이션(self.id 없음)은 미래 정보 누설만 판정한다."""
    return _parse('check', CHECK_INSTRUCTIONS, data, Verdict, 1500, 60)


def _parse(name: str, instructions: str, data: dict, text_format: type[BaseModel], max_tokens: int, timeout: int):
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise SimulationFailure(503, '시뮬레이션 모델 설정이 필요합니다.')
    effort = os.environ.get(EFFORT, '').strip() or DEFAULT_EFFORT
    if effort and effort not in EFFORTS:  # 모델을 부르기 전에 막는다(고친 값을 짐작해 쓰지 않는다)
        raise SimulationFailure(503, BAD_EFFORT)
    try:  # 지시문은 Langfuse 프롬프트 character_simulation.<호출>의 production 버전이고 instructions(코드 문자열)는 기본값이다
        managed = tracing.prompt(f'character_simulation.{name}', instructions)
    except tracing.PromptUnavailable:
        raise SimulationFailure(503, PROMPT_UNAVAILABLE) from None
    started, usage = time.monotonic(), None
    try:
        with OpenAI(api_key=key, timeout=timeout, max_retries=0) as client, \
                tracing.observe(f'simulation.{name}', as_type='generation', model=model, prompt=managed.client) as generation:
            try:
                result = client.responses.parse(
                    model=model, store=False, max_output_tokens=max_tokens, text_format=text_format,
                    instructions=managed.text, input=json.dumps(data, ensure_ascii=False),
                    reasoning={'effort': effort})
            except ValidationError:
                raise SimulationFailure(502, '시뮬레이션 모델 응답을 확인할 수 없습니다.') from None
            except OpenAIError:
                raise SimulationFailure(503, '시뮬레이션 모델 호출에 실패했습니다.') from None
            usage = getattr(result, 'usage', None)
            generation.update(model=getattr(result, 'model', model),
                              usage_details=usage and {'input': usage.input_tokens, 'output': usage.output_tokens})
            if result.status != 'completed' or result.output_parsed is None:
                raise SimulationFailure(502, '시뮬레이션 모델 응답을 확인할 수 없습니다.')
    except SimulationFailure:
        _report(name, started, usage, failed=True)
        raise
    _report(name, started, usage, failed=False)
    return result.output_parsed


def _report(name: str, started: float, usage, failed: bool) -> None:
    """호출 하나의 지연·토큰·실패를 LangChain 콜백에 알린다(본문·키는 없다). LangChain 실행 밖이면 알릴 곳이 없어 건너뛴다."""
    try:
        dispatch_custom_event(MODEL_EVENT, {
            'name': name, 'ms': round((time.monotonic() - started) * 1000), 'failed': failed,
            'inputTokens': getattr(usage, 'input_tokens', None), 'outputTokens': getattr(usage, 'output_tokens', None)})
    except RuntimeError:
        pass
