"""웹 조사: OpenAI 내장 `web_search`를 강제한 구조화 출력 1회로 주장별 판단과 실제 검색 URL을 받는다. platform: 구조화 출력 1회씩 두 번(create_agent + 공통 미들웨어)."""

from app import agent_runtime
from app.research.errors import ResearchFailure
from app.research.models import PlatformDraft, PlatformPick, ResearchRequest, ResearchResult
from app.research.prompt import PICK_INSTRUCTIONS, REFER_INSTRUCTIONS, RESEARCH_INSTRUCTIONS


def search(data: ResearchRequest) -> tuple[ResearchResult, list[str]]:
    """모델 판단과 검색 도구가 실제로 반환한 URL 목록을 함께 돌려준다. 진행 목록(#784)에는 질문 앞부분을 검색어로 보인다."""
    with agent_runtime.activity('웹 검색', data.question):
        return _search(data)


def _search(data: ResearchRequest) -> tuple[ResearchResult, list[str]]:
    message, result = agent_runtime.run('research.generation', '웹 조사', ResearchFailure, RESEARCH_INSTRUCTIONS, data.model_dump(),
                                        prompt_name='web_research.search', max_tokens=2000, timeout=90, trace=data.model_dump(),
                                        schema=ResearchResult, web_search=True)
    calls = [block for block in message.content if isinstance(block, dict) and block.get('type') == 'web_search_call']
    if not any(call.get('status') == 'completed' for call in calls):
        raise ResearchFailure(503, '웹 검색에 실패했습니다.')
    return result, [url for call in calls for url in _urls(call.get('action') or {})]


def _urls(action: dict) -> list[str]:
    if action.get('type') == 'search':
        return [source['url'] for source in action.get('sources') or [] if source.get('url')]
    return [action['url']] if action.get('url') else []


def pick(request: str, worlds: list[dict]) -> PlatformPick:
    """1회차: 공개 세계관 요약 목록에서 요청에 맞는 세계관 id를 고른다. 웹 검색은 쓰지 않는다."""
    data = {'request': request, 'worlds': worlds}
    # 추적에는 공개 세계관 설명·카드 본문을 남기지 않고 id만 남긴다(Writing이 문맥을 빼는 것과 같다, #640)
    trace = {'request': request, 'worldIds': [w['id'] for w in worlds]}
    return agent_runtime.run('research.platform_pick', '플랫폼 조사', ResearchFailure, PICK_INSTRUCTIONS, data, prompt_name='research.pick',
                             max_tokens=500, timeout=60, trace=trace, schema=PlatformPick)[1]


def refer(request: str, worlds: list[dict]) -> PlatformDraft:
    """2회차: 읽은 카드에서 참고할 카드와 이유(references), 채우지 못한 부분(gaps)을 만든다."""
    data = {'request': request, 'worlds': worlds}
    trace = {'request': request, 'worldIds': [w['worldId'] for w in worlds], 'cardIds': [c['cardId'] for w in worlds for c in w['cards']]}
    return agent_runtime.run('research.platform_refer', '플랫폼 조사', ResearchFailure, REFER_INSTRUCTIONS, data, prompt_name='research.refer',
                             max_tokens=2000, timeout=90, trace=trace, schema=PlatformDraft)[1]
