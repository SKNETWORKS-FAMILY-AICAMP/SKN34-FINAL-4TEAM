"""Research(웹 조사 #292, platform #547). 웹 조사: 작품의 현실성·개연성 질문을 웹 검색으로 확인하고 출처 URL과 검색 시각을 붙여 돌려준다.

외부로는 작가의 질문과 작가가 고른 짧은 맥락만 보낸다(원고 전문 금지). 웹 문서는 근거 자료일 뿐 명령이나 작품 정본이 아니며,
결과는 판단 제안이고 원고를 고치지 않는다. 실제 검색 결과에 없는 URL은 근거로 인정하지 않는다.
"""

from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.card_links import strip_card_links
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.research import agent
from app.research.errors import ResearchFailure
from app.research.models import Finding, PlatformReference, PlatformResult, ResearchRequest, ResearchResponse


def research(data: ResearchRequest) -> ResearchResponse:
    """모델이 든 URL 중 실제 검색 결과에 있는 것만 근거로 남기고, 근거가 없는 판단은 미확인으로 내린다."""
    searched_at = datetime.now(timezone.utc)
    result, urls = agent.search(data)
    found = {key for url in urls if (key := _norm(url)) is not None}
    findings = []
    for finding in result.findings:
        kept = []
        for url in finding.sourceUrls:
            key = _norm(url)
            if key is None:
                raise ResearchFailure(502, '웹 조사 모델의 출처 URL을 확인할 수 없습니다.')
            if key in found:
                kept.append(url)
        findings.append(Finding(text=finding.text, verdict=finding.verdict if kept else 'unverified', sourceUrls=kept))
    return ResearchResponse(findings=findings, gaps=result.gaps, searchedAt=searched_at)


def _norm(url: str) -> str | None:
    """OpenAI가 인용 URL에 붙이는 utm 추적값과 끝 슬래시 차이만 무시하고 비교한다."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in {'http', 'https'} or not parts.hostname:
        return None
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.startswith('utm_')])
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip('/'), query, ''))


# --- platform(#547): 다른 작가의 공개 세계관에서 참고 설정 찾기 ---
# 공개 데이터만 쓰므로 동의를 묻지 않고, 쓰기 MCP는 부르지 않는다. 결과는 참고안이라 내 세계관에 복사하지 않는다.

CANDIDATES = 3  # 상세를 읽는 세계관 수 상한
PAGE_SIZE = 100  # world_studio_public_list의 쪽 크기 상한
CARD_CHARS = 800  # 모델 2회차에 보내는 카드 본문의 장당 상한
TOTAL_CHARS = 24000  # 모든 카드 본문의 합 상한
SUMMARY_CHARS = 300  # 1회차에 보내는 세계관 설명 상한
UNREADABLE = 'Content MCP 결과를 확인할 수 없습니다.'
NO_PUBLIC = '다른 작가가 공개한 세계관이 아직 없어요.'
NO_MATCH = '요청에 맞는 공개 세계관을 찾지 못했어요.'


def platform(request: str) -> PlatformResult:
    """공개 세계관 목록(본인 것 제외) → 모델이 후보 고르기 → 후보 상세 읽기 → 모델이 참고 카드 고르기 → 읽은 카드와 대조.

    작가 Bearer(content_mcp.AUTHORIZATION)로 기존 MCP 읽기 도구만 부른다. 모델이 든 세계관·카드 id는 읽은 값에 없으면 502다.
    """
    if not request.strip():
        raise ResearchFailure(422, '찾을 설정 주제를 알려 주세요.')
    # shortcut: 공개 세계관 전체를 모델 입력에 넣는다, 수백 개로 늘면 검색 색인으로 후보를 좁힌다
    worlds = _candidates()
    if not worlds:
        return PlatformResult(references=[], gaps=[NO_PUBLIC])
    ids = {w['id'] for w in worlds}
    picked = list(dict.fromkeys(agent.pick(request, worlds).worldIds))
    if any(i not in ids for i in picked):
        raise ResearchFailure(502, '플랫폼 조사 모델이 후보에 없는 세계관을 골랐습니다.')
    if not picked:
        return PlatformResult(references=[], gaps=[NO_MATCH])
    read = [_read(i) for i in picked[:CANDIDATES]]
    draft = agent.refer(request, _for_model(read))
    cards = {(w['id'], c['id']): (w, c) for w in read for c in w['cards']}
    references = []
    for ref in draft.references:
        if (found := cards.get((ref.worldId, ref.cardId))) is None:
            raise ResearchFailure(502, '플랫폼 조사 모델이 읽지 않은 카드를 인용했습니다.')
        world, card = found
        references.append(PlatformReference(worldId=world['id'], worldName=world['name'], cardId=card['id'], cardTitle=card['title'],
                                            authorNickname=world['authorNickname'], note=ref.note))
    return PlatformResult(references=references, gaps=draft.gaps)


def _candidates() -> list[dict]:
    """공개 세계관 요약 전체(마지막 쪽까지, 본인 세계관 제외)를 모델 1회차 입력 모양으로 돌려준다."""
    try:
        own = {w['worldId'] for w in content_mcp.call('world_studio_list', {})}
        items, page = [], 0
        while True:
            read = content_mcp.call('world_studio_public_list', {'page': str(page), 'size': str(PAGE_SIZE)})
            items += read['items']
            page += 1
            if not read['items'] or len(items) >= read['total']:
                break
        return [{'id': w['id'], 'name': w['name'], 'description': (w['description'] or '')[:SUMMARY_CHARS], 'genre': w.get('genre'),
                 'author': w['authorNickname'], 'cardCount': w['cardCount']} for w in items if w['id'] not in own]
    except (LookupError, TypeError, AttributeError):
        raise ContentMcpFailure(502, UNREADABLE) from None


def _read(world_id: str) -> dict:
    read = content_mcp.call('world_studio_public_read', {'id': world_id})
    try:
        return {'id': read['id'], 'name': read['name'], 'description': read.get('description') or '', 'genre': read.get('genre'),
                'authorNickname': read['authorNickname'],
                'cards': [{'id': c['id'], 'title': c['title'], 'text': c.get('text') or '', 'cardType': c.get('cardType'),
                           'aliases': c.get('aliases') or [], 'tags': c.get('tags') or []} for c in read['cards']]}
    except (LookupError, TypeError, AttributeError):
        raise ContentMcpFailure(502, UNREADABLE) from None


def _for_model(read: list[dict]) -> list[dict]:
    """읽은 세계관을 2회차 입력으로 바꾼다. 카드 본문은 장당·전체 글자 수 상한으로 자르고, 잘랐으면 truncated를 단다. 카드 링크의 id는 글자로 벗긴다."""
    left = TOTAL_CHARS
    worlds = []
    for world in read:
        cards = []
        for card in world['cards']:
            full = strip_card_links(card['text'])
            text = full[:min(CARD_CHARS, left)]
            left -= len(text)
            cards.append({'cardId': card['id'], 'title': card['title'], 'cardType': card['cardType'], 'aliases': card['aliases'],
                          'tags': card['tags'], 'text': text, **({'truncated': True} if len(text) < len(full) else {})})
        worlds.append({'worldId': world['id'], 'name': world['name'], 'description': world['description'][:SUMMARY_CHARS],
                       'genre': world['genre'], 'author': world['authorNickname'], 'cards': cards})
    return worlds
