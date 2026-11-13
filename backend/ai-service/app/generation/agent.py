"""전달받은 작품 문맥으로 OpenAI Responses API를 1회 호출해 이어쓰기 제안을 만든다."""

import json
import os

from openai import OpenAI, OpenAIError

from app.generation.errors import ProviderFailure
from app.generation.models import GenerationResponse, Usage
from app.generation.prompt import INSTRUCTIONS


def generate(context: dict, prompt: str) -> GenerationResponse:
    """키·모델은 요청 시 읽고 클라이언트는 호출 후 닫는다. 미설정·제공사 실패·빈 응답은 ProviderFailure."""
    key = os.environ.get('OPENAI_API_KEY')
    model = os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise ProviderFailure()
    client = OpenAI(api_key=key, timeout=60, max_retries=0)
    try:
        response = client.responses.create(
            model=model, store=False, max_output_tokens=1800, instructions=INSTRUCTIONS,
            input=json.dumps({'context': context, 'request': prompt}, ensure_ascii=False))
        if response.status != 'completed' or not response.output_text.strip():
            raise ProviderFailure()
        usage = Usage(inputTokens=response.usage.input_tokens, outputTokens=response.usage.output_tokens) if response.usage else None
        return GenerationResponse(text=response.output_text.strip(), model=response.model,
                                  providerResponseId=response.id, usage=usage)
    except OpenAIError:
        raise ProviderFailure() from None
    finally:
        client.close()
