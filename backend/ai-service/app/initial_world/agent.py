"""Responses API strict JSON schema 호출 1회로 초기 세계관 후보를 제안받는다. 재시도·실행 상태·저장은 5-C 책임이다."""
import os

from openai import OpenAI, OpenAIError, APITimeoutError
from pydantic import ValidationError
from app.initial_world.errors import ExtractionFailure
from app.initial_world.models import Input, ProposedOutput
from app.initial_world.prompt import INSTRUCTIONS


def propose(data: Input) -> ProposedOutput:
    """모델 출력의 형식만 검증해 반환한다. 원문 근거·기존 ID 검증은 service가 한다."""
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise ExtractionFailure('MODEL_NOT_CONFIGURED', 503)
    client = None
    try:
        client = OpenAI(api_key=key, timeout=60, max_retries=0)
        response = client.responses.create(
            model=model, store=False, max_output_tokens=8000, instructions=INSTRUCTIONS,
            input=data.model_dump_json(),
            text={'format': {'type': 'json_schema', 'name': 'initial_world_extraction',
                             'strict': True, 'schema': ProposedOutput.model_json_schema()}})
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
