"""LangChain Responses API strict 구조화 호출. 단계당 1회, 자동 재시도·fallback 없음."""
import json
import os
from httpx import Timeout
from httpx2 import TimeoutException, TransportError
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import APITimeoutError, OpenAIError
from pydantic import ValidationError
from app import tracing
from app.manuscript_extraction import prompt
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import ProposedExtraction, ProposedResolution


def _call(name, instructions, data, schema):
    """지시문은 Langfuse 프롬프트 name의 production 버전(instructions는 최초 등록용 코드 문자열)이고 generation이 그 버전을 연결한다.

    추적에는 모델·사용량·프롬프트 버전·실패만 남기고 원고·설정 본문은 남기지 않는다.
    """
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise PreprocessingFailure('MODEL_NOT_CONFIGURED', 503)
    serialized = json.dumps(data, ensure_ascii=False, sort_keys=True)
    # 묵시적 잘라내기는 정체·근거 누락을 만든다. 대규모 배치는 별도 계약 뒤 지원한다.
    if len(serialized) > 120000:
        raise PreprocessingFailure('MODEL_INPUT_TOO_LARGE', 422)
    try:
        managed = tracing.prompt(name, instructions)
    except tracing.PromptUnavailable:
        raise PreprocessingFailure('MODEL_UNAVAILABLE', 503) from None
    try:
        llm = ChatOpenAI(api_key=key, model=model, max_retries=0, timeout=Timeout(60, read=70),
                         use_responses_api=True, streaming=True, store=False, max_tokens=16000)
        with tracing.observe('manuscript_extraction.generation', as_type='generation', model=model, prompt=managed.client) as generation:
            result = llm.with_structured_output(schema, method='json_schema', strict=True, include_raw=True).invoke(
                [SystemMessage(content=managed.text), HumanMessage(content=serialized)])
            raw = result.get('raw')
            metadata = getattr(raw, 'response_metadata', {})
            usage = getattr(raw, 'usage_metadata', None)
            generation.update(model=metadata.get('model_name') or model,
                              usage_details=usage and {'input': usage['input_tokens'], 'output': usage['output_tokens']})
            if metadata.get('status') != 'completed' or metadata.get('finish_reason') in ('length', 'content_filter'):
                raise PreprocessingFailure('MODEL_OUTPUT_INCOMPLETE')
        if result.get('parsing_error') or result.get('parsed') is None:
            raise PreprocessingFailure('INVALID_MODEL_OUTPUT')
        return schema.model_validate(result['parsed'])
    except (APITimeoutError, TimeoutException):
        raise PreprocessingFailure('MODEL_TIMEOUT', 504) from None
    except (OpenAIError, TransportError):
        raise PreprocessingFailure('MODEL_UNAVAILABLE', 503) from None
    except (ValidationError, ValueError, TypeError, KeyError):
        raise PreprocessingFailure('INVALID_MODEL_OUTPUT') from None


def extract(episode):
    """원문 회차 하나의 호칭·진술·관계를 제안받는다."""
    return _call('manuscript_extraction.extract', prompt.EXTRACT, episode.model_dump(), ProposedExtraction)


def resolve(extractions):
    """회차별 대상 목록과 검증된 인용만 보내 동명이인·별칭 링크를 제안받는다. 원문 전체·evidence는 보내지 않는다(입력 상한)."""
    data = [{'number': e.number,
             'mentions': [{'ref': f'{e.number}:{m.id}', 'name': m.name, 'kind': m.kind, 'quote': m.quote} for m in e.mentions],
             'quotes': sorted({s.quote for s in e.statements} | {r.quote for r in e.relationships})} for e in extractions]
    return _call('manuscript_extraction.resolve', prompt.RESOLVE, data, ProposedResolution)
