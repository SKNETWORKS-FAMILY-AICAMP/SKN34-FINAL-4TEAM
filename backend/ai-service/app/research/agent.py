"""OpenAI `web_search`를 강제한 structured output 호출 1회로 주장별 판단과 실제 검색 URL을 받는다."""

import os

from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest, ResearchResult
from app.research.prompt import RESEARCH_INSTRUCTIONS


def search(data: ResearchRequest) -> tuple[ResearchResult, list[str]]:
    """모델 판단과 검색 도구가 실제로 반환한 URL 목록을 함께 돌려준다."""
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise ResearchFailure(503, '웹 조사 모델 설정이 필요합니다.')
    with OpenAI(api_key=key, timeout=90, max_retries=0) as client:
        try:
            result = client.responses.parse(
                model=model, store=False, max_output_tokens=2000, text_format=ResearchResult,
                tools=[{'type': 'web_search'}], tool_choice='required', include=['web_search_call.action.sources'],
                instructions=RESEARCH_INSTRUCTIONS, input=data.model_dump_json(),
            )
        except ValidationError:
            raise ResearchFailure(502, '웹 조사 모델 응답을 확인할 수 없습니다.') from None
        except OpenAIError:
            raise ResearchFailure(503, '웹 조사 모델 호출에 실패했습니다.') from None
    calls = [item for item in result.output if item.type == 'web_search_call']
    if not any(call.status == 'completed' for call in calls):
        raise ResearchFailure(503, '웹 검색에 실패했습니다.')
    if result.status != 'completed' or result.output_parsed is None:
        raise ResearchFailure(502, '웹 조사 모델 응답을 확인할 수 없습니다.')
    return result.output_parsed, [url for call in calls for url in _urls(call.action)]


def _urls(action) -> list[str]:
    if action.type == 'search':
        return [source.url for source in action.sources or []]
    return [action.url] if getattr(action, 'url', None) else []
