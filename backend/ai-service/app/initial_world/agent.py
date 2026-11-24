"""Responses API strict JSON schema 호출 1회로 초기 세계관 후보를 제안받는다. 재시도·실행 상태·저장은 5-C 책임이다."""
import os

from openai import OpenAI, OpenAIError, APITimeoutError
from pydantic import ValidationError
from app import tracing
from app.initial_world.errors import ExtractionFailure
from app.initial_world.models import Input, ProposedOutput
from app.initial_world.prompt import INSTRUCTIONS


def propose(data: Input) -> ProposedOutput:
    """모델 출력의 형식만 검증해 반환한다. 원문 근거·기존 ID 검증은 service가 한다.

    추적에는 모델·사용량·프롬프트 버전·실패만 남긴다. 설정 본문(입력·후보)은 추적 결정 범위 밖이다.
    """
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        raise ExtractionFailure('MODEL_NOT_CONFIGURED', 503)
    try:
        managed = tracing.prompt('initial_world.extract', INSTRUCTIONS)
    except tracing.PromptUnavailable:
        raise ExtractionFailure('MODEL_UNAVAILABLE', 503) from None
    model = managed.model or os.environ.get('OPENAI_MODEL')  # 운영 화면에서 고른 모델(#705), 없으면 환경 변수 기본값
    if not model:
        raise ExtractionFailure('MODEL_NOT_CONFIGURED', 503)
    client = None
    try:
        client = OpenAI(api_key=key, timeout=60, max_retries=0)
        with tracing.observe('initial_world.generation', as_type='generation', model=model, prompt=managed.client) as generation:
            response = client.responses.create(
                model=model, store=False, max_output_tokens=8000, instructions=managed.text,
                input=data.model_dump_json(),
                text={'format': {'type': 'json_schema', 'name': 'initial_world_extraction',
                                 'strict': True, 'schema': ProposedOutput.model_json_schema()}})
            generation.update(model=response.model, usage_details=response.usage and {
                'input': response.usage.input_tokens, 'output': response.usage.output_tokens})
            if response.status != 'completed':
                raise ExtractionFailure('MODEL_OUTPUT_INCOMPLETE')
        return ProposedOutput.model_validate_json(response.output_text)
    except APITimeoutError:
        raise ExtractionFailure('MODEL_TIMEOUT', 504) from None
    except OpenAIError:
        raise ExtractionFailure('MODEL_UNAVAILABLE', 503) from None
    except (ValidationError, UnicodeError):
        raise ExtractionFailure('INVALID_MODEL_OUTPUT') from None
    finally:
        if client is not None:
            client.close()
