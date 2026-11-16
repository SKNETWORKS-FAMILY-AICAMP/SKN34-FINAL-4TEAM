"""검사 종류 하나에 대한 OpenAI structured output 호출 1회로 지적 목록을 받는다."""

import json
import os

from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app import tracing
from app.review.errors import ReviewFailure
from app.review.models import ReviewResult, Usage
from app.review.prompt import INSTRUCTIONS


def review(check: str, draft: str, settings: list[dict]) -> tuple[ReviewResult, dict]:
    """초안과 허용 설정으로 지적을 만들고 모델·응답 ID·사용량을 함께 돌려준다."""
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise ReviewFailure(503, '검수 모델 설정이 필요합니다.')
    # 원고 본문은 팀 결정(2026-11-13)으로 추적에 남기고 설정 본문은 참조만 남긴다.
    with OpenAI(api_key=key, timeout=120, max_retries=0) as client, \
            tracing.observe('review.generation', as_type='generation', model=model, input={
                'check': check, 'draft': draft, 'settings': [s['ref'] for s in settings]}) as generation:
        try:
            # 출력 한도는 추론 토큰을 함께 센다. 40,000자 초안의 많은 지적이 잘리지 않을 만큼 둔다.
            response = client.responses.parse(
                model=model, store=False, max_output_tokens=16000, text_format=ReviewResult,
                instructions=INSTRUCTIONS[check],
                input=json.dumps({'check': check, 'draft': draft, 'settings': settings}, ensure_ascii=False))
        except ValidationError:
            raise ReviewFailure(502, '검수 모델 응답을 확인할 수 없습니다.') from None
        except OpenAIError:
            raise ReviewFailure(503, '검수 모델 호출에 실패했습니다.') from None
        usage = Usage(inputTokens=response.usage.input_tokens, outputTokens=response.usage.output_tokens) if response.usage else None
        generation.update(model=response.model, usage_details=usage and {'input': usage.inputTokens, 'output': usage.outputTokens},
                          output=response.output_parsed.model_dump() if response.output_parsed else None)
        # 토큰 한도로 잘린 지적 목록을 완전한 검수처럼 보이지 않게 실패로 돌려준다.
        if response.status != 'completed' or response.output_parsed is None:
            raise ReviewFailure(502, '검수 모델 응답을 확인할 수 없습니다.')
    return response.output_parsed, {'model': response.model, 'providerResponseId': response.id, 'usage': usage}
