"""전달받은 작품 문맥으로 OpenAI Responses API를 1회 호출해 이어쓰기 제안을 만든다."""

import json
import os

from openai import OpenAI, OpenAIError

from app import tracing
from app.generation.errors import ProviderFailure
from app.generation.models import GenerationResponse, Usage
from app.generation.prompt import INSTRUCTIONS


def generate(context: dict, prompt: str) -> GenerationResponse:
    """키·모델은 요청 시 읽고 클라이언트는 호출 후 닫는다. 미설정·제공사 실패·빈 응답·프롬프트를 읽을 수 없음은 ProviderFailure.

    추적에는 모델·사용량·프롬프트 버전·실패만 남긴다. 문맥은 설정 본문을 담아 추적 결정 범위 밖이다.
    """
    key = os.environ.get('OPENAI_API_KEY')
    model = os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise ProviderFailure()
    try:
        managed = tracing.prompt('proposals.continue', INSTRUCTIONS)
    except tracing.PromptUnavailable:
        raise ProviderFailure() from None
    client = OpenAI(api_key=key, timeout=60, max_retries=0)
    try:
        with tracing.observe('proposals.generation', as_type='generation', model=model, prompt=managed.client) as generation:
            response = client.responses.create(
                model=model, store=False, max_output_tokens=1800, instructions=managed.text,
                input=json.dumps({'context': context, 'request': prompt}, ensure_ascii=False))
            generation.update(model=response.model, usage_details=response.usage and {
                'input': response.usage.input_tokens, 'output': response.usage.output_tokens})
            if response.status != 'completed' or not response.output_text.strip():
                raise ProviderFailure()
        usage = Usage(inputTokens=response.usage.input_tokens, outputTokens=response.usage.output_tokens) if response.usage else None
        return GenerationResponse(text=response.output_text.strip(), model=response.model,
                                  providerResponseId=response.id, usage=usage)
    except OpenAIError:
        raise ProviderFailure() from None
    finally:
        client.close()
