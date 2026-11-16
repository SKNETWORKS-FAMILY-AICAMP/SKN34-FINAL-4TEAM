"""OpenAI 내장 `web_search`를 강제한 구조화 출력 1회로 주장별 판단과 실제 검색 URL을 받는다(create_agent + 공통 미들웨어)."""

from app import agent_runtime
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest, ResearchResult
from app.research.prompt import RESEARCH_INSTRUCTIONS


def search(data: ResearchRequest) -> tuple[ResearchResult, list[str]]:
    """모델 판단과 검색 도구가 실제로 반환한 URL 목록을 함께 돌려준다."""
    message, result = agent_runtime.run('research.generation', '웹 조사', ResearchFailure, RESEARCH_INSTRUCTIONS, data.model_dump(),
                                        max_tokens=2000, timeout=90, trace=data.model_dump(), schema=ResearchResult, web_search=True)
    calls = [block for block in message.content if isinstance(block, dict) and block.get('type') == 'web_search_call']
    if not any(call.get('status') == 'completed' for call in calls):
        raise ResearchFailure(503, '웹 검색에 실패했습니다.')
    return result, [url for call in calls for url in _urls(call.get('action') or {})]


def _urls(action: dict) -> list[str]:
    if action.get('type') == 'search':
        return [source['url'] for source in action.get('sources') or [] if source.get('url')]
    return [action['url']] if action.get('url') else []
