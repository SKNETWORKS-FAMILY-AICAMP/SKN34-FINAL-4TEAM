"""회차 초안 하나에 대한 OpenAI structured output 호출 1회로 19세 이용가 여부와 근거를 받는다."""

import json
import os

from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app import tracing
from app.rating.errors import RatingFailure
from app.rating.models import RatingResult, Usage
from app.rating.prompt import INSTRUCTIONS


def rate(draft: str) -> tuple[RatingResult, dict]:
    """초안을 심의 기준으로 판별하고 모델·응답 ID·사용량을 함께 돌려준다."""
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise RatingFailure(503, '심의 판별 모델 설정이 필요합니다.')
    # 원고 본문은 팀 결정(2026-11-13)으로 추적에 남긴다. 심의 기준은 저장소 문서라 남기지 않는다.
    with OpenAI(api_key=key, timeout=120, max_retries=0) as client, \
            tracing.observe('rating.generation', as_type='generation', model=model, input={'draft': draft}) as generation:
        try:
            # 출력 한도는 추론 토큰을 함께 센다. 근거 몇 개만 쓰므로 검수보다 작게 둔다.
            response = client.responses.parse(
                model=model, store=False, max_output_tokens=8000, text_format=RatingResult,
                instructions=INSTRUCTIONS, input=json.dumps({'draft': draft}, ensure_ascii=False))
        except ValidationError:
            raise RatingFailure(502, '심의 판별 모델 응답을 확인할 수 없습니다.') from None
        except OpenAIError:
            raise RatingFailure(503, '심의 판별 모델 호출에 실패했습니다.') from None
        usage = Usage(inputTokens=response.usage.input_tokens, outputTokens=response.usage.output_tokens) if response.usage else None
        generation.update(model=response.model, usage_details=usage and {'input': usage.inputTokens, 'output': usage.outputTokens},
                          output=response.output_parsed.model_dump() if response.output_parsed else None)
        if response.status != 'completed' or response.output_parsed is None:
            raise RatingFailure(502, '심의 판별 모델 응답을 확인할 수 없습니다.')
    return response.output_parsed, {'model': response.model, 'providerResponseId': response.id, 'usage': usage}
