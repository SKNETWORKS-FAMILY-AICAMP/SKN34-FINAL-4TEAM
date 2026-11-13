"""Content가 확인한 발췌만 근거로 OpenAI structured output 답변을 1회 생성한다."""

import os

from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app import tracing
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest, AnswerResponse
from app.manuscript.prompt import QA_INSTRUCTIONS


def answer(data: AnswerRequest) -> AnswerResponse:
    """전달받은 발췌만 근거로 주장과 답할 수 없는 부분을 구조화해 생성한다."""
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise ManuscriptFailure(503, 'Q&A 모델 설정이 필요합니다.')
    with OpenAI(api_key=key, timeout=40, max_retries=0) as client, \
            tracing.observe('qa.generation', as_type='generation', model=model, input={
                'question': data.question, 'excerpts': tracing.excerpts(data.excerpts),
                'history': [turn.model_dump() for turn in data.history]}) as generation:
        try:
            result = client.responses.parse(
                model=model, store=False, max_output_tokens=1400, text_format=AnswerResponse,
                instructions=QA_INSTRUCTIONS, input=data.model_dump_json(),
            )
        except ValidationError:
            raise ManuscriptFailure(502, 'Q&A 모델 응답을 확인할 수 없습니다.') from None
        except OpenAIError:
            raise ManuscriptFailure(503, 'Q&A 모델 호출에 실패했습니다.') from None
        usage = getattr(result, 'usage', None)
        generation.update(model=getattr(result, 'model', model), usage_details=usage and {
            'input': usage.input_tokens, 'output': usage.output_tokens},
            output=result.output_parsed.model_dump() if getattr(result, 'output_parsed', None) else None)
        if result.status != 'completed' or result.output_parsed is None:
            raise ManuscriptFailure(502, 'Q&A 모델 응답을 확인할 수 없습니다.')
    return result.output_parsed
