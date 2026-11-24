"""반성 모델 호출(자동 개선 #823). 로컬 OpenCodex 게이트웨이로만 부른다: 생성·채점은 기존 OpenAI 경로이고 이 호출만 다르다.

설정: `PROMPT_OPTIMIZER_BASE_URL`(비면 기본 OpenAI)·`PROMPT_OPTIMIZER_API_KEY`(비면 OPENAI_API_KEY)·`PROMPT_OPTIMIZER_MODEL`(기본 gpt-6-sol).
게이트웨이의 Responses 호출은 input이 메시지 목록이고 store=False일 때만 된다(eval/simulation/sim_via.py). 구독 게이트웨이의 429·일시 오류는 SDK가 두 번까지 다시 시도하고(max_retries=2),
그래도 실패하면 고정 문구 502다. check는 개선이 OpenAI 호출을 쓰기 전에 게이트웨이에 닿는지 짧은 호출 한 번으로 본다.
추적에는 모델·사용량만 남긴다: 반성 입력에는 원문 발췌(공개 저작물 평가 세트)가 들어 있어 본문을 남기지 않는다.
"""

import os

from openai import OpenAI, OpenAIError

from app import tracing
from app.optimization.errors import OptimizationFailure

DEFAULT_MODEL = 'gpt-6-sol'
TIMEOUT = 600  # 초. 반성 모델은 느리고 입력이 길다
FAILED = '프롬프트 개선 모델 호출에 실패했어요.'
UNUSABLE = '프롬프트 개선 모델 응답을 쓸 수 없어요.'


def settings() -> tuple[str, str | None, str]:
    """(키, 게이트웨이 주소, 모델). 키가 없으면 모델을 부르기 전에 503이다."""
    env = lambda name: os.environ.get(name, '').strip()  # noqa: E731
    key = env('PROMPT_OPTIMIZER_API_KEY') or env('OPENAI_API_KEY')
    if not key:
        raise OptimizationFailure(503, '프롬프트 개선 모델 설정이 필요합니다.')
    return key, env('PROMPT_OPTIMIZER_BASE_URL') or None, env('PROMPT_OPTIMIZER_MODEL') or DEFAULT_MODEL


def reflect(prompt: str) -> str:
    """GEPA의 reflection_lm: 반성 입력(글)을 한 번 보내 새 지시문이 든 응답 글을 받는다."""
    key, base_url, model = settings()
    with tracing.observe('optimization.reflect', as_type='generation', model=model) as generation:
        try:
            with OpenAI(api_key=key, base_url=base_url, timeout=TIMEOUT, max_retries=2) as client:   # 구독 게이트웨이의 429·일시 오류 대비
                response = client.responses.create(model=model, store=False, input=[{'role': 'user', 'content': prompt}])
        except OpenAIError:  # 예외 메시지에 키·입력이 실릴 수 있어 고정 문구로 바꾼다
            raise OptimizationFailure(502, FAILED) from None
        if response.usage:
            generation.update(usage_details={'input': response.usage.input_tokens, 'output': response.usage.output_tokens})
        if response.status != 'completed' or not response.output_text.strip():
            raise OptimizationFailure(502, UNUSABLE)
    return response.output_text


def check() -> None:
    """게이트웨이에 닿는지 짧은 호출 한 번으로 확인한다(실패하면 reflect와 같은 OptimizationFailure). 닿지 않으면 기준 평가(OpenAI 호출)를 하기 전에 끝내려는 것이다."""
    reflect('연결 확인입니다. OK라고만 답해 주세요.')
