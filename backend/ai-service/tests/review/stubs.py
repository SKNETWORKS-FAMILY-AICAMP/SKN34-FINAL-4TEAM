from fake_chat import fake_chat

from app.review import service
from app.review.models import DraftFinding, ReviewResult

WORK = 'work-1'
WORLD = {
    'worldId': 'world-1',
    'cards': [
        {'id': 'seoyun', 'cardType': 'character', 'title': '서윤', 'body': '29세. 10년 전 고향을 떠났다.',
         'semanticMetadata': {'characterDocs': {'soul': '말수가 적다.', 'goal': '', 'episodes': {'2': '편지를 받았다.', '5': '비밀을 안다.'}}}},
        {'id': 'secret', 'cardType': 'event', 'title': '숨은 결말', 'body': '7화에 밝혀진다.',
         'semanticMetadata': {'revealFromEpisode': 7}},
    ],
    'relationships': [{'id': 'rel-1', 'sourceCardId': 'seoyun', 'targetCardId': 'secret', 'label': '모른다'}],
}


def finding(quote='서윤은 웃엇다.', category='spelling', status='confirmed', refs=()):
    return DraftFinding(category=category, quote=quote, reason='이유', status=status, evidenceRefs=list(refs), suggestion='고친 문장')


NO_INHERITED = {'workId': WORK, 'worldId': None, 'upto': 0, 'cards': [], 'relationships': [], 'relationshipStatus': 'current', 'relationshipVersion': 0}


def fake_content(monkeypatch, body='비가 왔다. 서윤은 웃엇다.', world=WORLD, linked=WORK, inherited=NO_INHERITED):
    """Content MCP 대역. 호출한 도구 이름과 인자 목록을 돌려준다."""
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        if tool == 'episode_read':
            return {'draft': {'title': '3화', 'body': body, 'revision': 4, 'authorNote': None}}
        if tool == 'world_studio_list':
            return [{'worldId': 'world-1', 'linkedWorkId': linked}]
        if tool == 'world_studio_read':
            return world
        if tool == 'work_inherited_world':
            return inherited
        raise AssertionError(tool)

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


def fake_agent(monkeypatch, *findings, gaps=()):
    """agent.review 대역. 받은 인자를 담은 dict를 돌려준다."""
    seen = {}

    def review(check, draft, settings):
        seen.update(check=check, draft=draft, settings=settings)
        return ReviewResult(findings=list(findings), gaps=list(gaps)), {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': None}

    monkeypatch.setattr(service.agent, 'review', review)
    return seen


def fake_openai(monkeypatch, parsed=None, status='completed', error=None, text=None):
    """ChatOpenAI 대역(create_agent 실행). 생성자·bind 인자와 받은 메시지를 담은 dict를 돌려준다."""
    return fake_chat(monkeypatch, text=text if text is not None else (parsed.model_dump_json() if parsed else ''), status=status, error=error)
