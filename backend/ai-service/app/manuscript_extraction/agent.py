"""LangChain Responses API strict 구조화 호출. 단계당 1회, 자동 재시도·fallback 없음."""
import json
import os
from httpx import Timeout
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import APITimeoutError, OpenAIError
from pydantic import ValidationError
from app.manuscript_extraction import prompt
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import ProposedExtraction, ProposedResolution


def _call(instructions, data, schema):
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise PreprocessingFailure('MODEL_NOT_CONFIGURED', 503)
    serialized = json.dumps(data, ensure_ascii=False, sort_keys=True)
    # 묵시적 잘라내기는 정체·근거 누락을 만든다. 대규모 배치는 별도 계약 뒤 지원한다.
    if len(serialized) > 120000:
        raise PreprocessingFailure('MODEL_INPUT_TOO_LARGE', 422)
    try:
        llm = ChatOpenAI(api_key=key, model=model, max_retries=0, timeout=Timeout(60, read=70),
                         use_responses_api=True, store=False, max_tokens=16000)
        result = llm.with_structured_output(schema, method='json_schema', strict=True, include_raw=True).invoke(
            [SystemMessage(content=instructions), HumanMessage(content=serialized)])
        raw = result.get('raw')
        metadata = getattr(raw, 'response_metadata', {})
        if metadata.get('status', 'completed') != 'completed' or metadata.get('finish_reason') in ('length', 'content_filter'):
            raise PreprocessingFailure('MODEL_OUTPUT_INCOMPLETE')
        if result.get('parsing_error') or result.get('parsed') is None:
            raise PreprocessingFailure('INVALID_MODEL_OUTPUT')
        return schema.model_validate(result['parsed'])
    except APITimeoutError:
        raise PreprocessingFailure('MODEL_TIMEOUT', 504) from None
    except OpenAIError:
        raise PreprocessingFailure('MODEL_UNAVAILABLE', 503) from None
    except (ValidationError, ValueError, TypeError, KeyError):
        raise PreprocessingFailure('INVALID_MODEL_OUTPUT') from None


def extract(episode):
    """원문 회차 하나의 호칭·진술·관계를 제안받는다."""
    return _call(prompt.EXTRACT, episode.model_dump(), ProposedExtraction)


def resolve(extractions):
    """정렬된 회차별 원문·검증 결과로 명시적 정체 근거를 제안받는다."""
    return _call(prompt.RESOLVE, [e.model_dump() for e in extractions], ProposedResolution)
