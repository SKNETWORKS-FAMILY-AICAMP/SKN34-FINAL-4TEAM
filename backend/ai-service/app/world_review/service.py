"""설정집 AI 검토: 설정집 스냅샷을 한 번 검토해 카드 id가 붙은 지적과 수정안을 돌려준다.

HTTP 경로(router)와 오케스트레이션의 world_review 단계가 같은 review 함수를 쓴다. HTTP 경로는 Content가 보낸 스냅샷만 쓰고 Content MCP를
부르지 않는다. 채팅 경로만 linked_request로 연결 세계관을 작가 권한(Content MCP, DEC-49)으로 읽어 같은 요청을 만든다.
결과는 제안이며 카드를 고치지 않는다. 모델이 입력에 없는 카드 id나 계약 밖의 수정안을 쓰면 고치지 않고 실패한다.
"""

from app import tracing
from app.card_links import strip_card_links
from app.content_mcp import service as content_mcp
from app.world_review import agent
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import (MAX_CARD_CHARS, MAX_CARDS, Finding, Fix, Relationship, RequestCard, WorldReviewRequest,
                                     WorldReviewResponse)

MAX_MESSAGE = 300
MAX_TEXT = 3000  # 수정안 한 칸의 글자 수: 인물 문서 한도이자 카드 본문 한도
NO_LINKED_WORLD = '이 작품에 연결된 세계관이 없어 설정집을 검토할 수 없어요.'
BAD_CONTENT = 'Content 세계관 응답을 확인할 수 없습니다.'
BAD_FINDING = '설정집 검토 모델 응답의 카드·수정안을 확인할 수 없습니다.'


def review(data: WorldReviewRequest) -> WorldReviewResponse:
    """카드마다 모순·인물 문서 역할·사건 필수 정보를 검토한다. 검토할 카드가 없으면 모델을 부르지 않는다."""
    if not data.cards:
        return WorldReviewResponse(findings=[], reviewedCards=0, model='')
    cards = {c.id: c for c in data.cards}
    # 보내지 않은 카드에 이어진 관계는 모델이 없는 카드 id를 인용하게 하므로 뺀다.
    sent = data.model_copy(update={'relationships': [r for r in data.relationships if r.sourceCardId in cards and r.targetCardId in cards]})
    # 설정 본문은 추적에 남기지 않고 카드·관계 id 참조만 남긴다.
    refs = {'cards': [c.id for c in data.cards], 'relationships': [r.id for r in sent.relationships]}
    with tracing.observe('world_review', as_type='chain', input=refs):
        result, meta = agent.review(sent)
        for found in result.findings:
            _check(found, cards)
    return WorldReviewResponse(findings=result.findings, reviewedCards=len(data.cards), model=meta['model'])


def _check(found: Finding, cards: dict[str, RequestCard]) -> None:
    """지적이 계약을 지키는지 본다: 입력에 있는 카드 1~3개, 읽을 수 있는 300자 이하 문장, 수정안은 지적의 카드 하나의 한 칸."""
    valid = (1 <= len(found.cardIds) <= 3 and all(i in cards for i in found.cardIds)
             and bool(found.message.strip()) and len(found.message) <= MAX_MESSAGE
             and (found.fix is None or _valid_fix(found.fix, found.cardIds, cards)))
    if not valid:
        raise WorldReviewFailure(502, BAD_FINDING)


def _valid_fix(fix: Fix, card_ids: list[str], cards: dict[str, RequestCard]) -> bool:
    """soul·goal·episode는 인물 카드에만, 회차는 target이 episode일 때만(0 이상). 칸을 비우는 수정은 수정안이 아니다."""
    episode_ok = fix.episode is not None and fix.episode >= 0 if fix.target == 'episode' else fix.episode is None
    return (fix.cardId in card_ids and (fix.target == 'body' or cards[fix.cardId].cardType == 'character') and episode_ok
            and bool(fix.text.strip()) and len(fix.text) <= MAX_TEXT)


def linked_request(work_id: str) -> WorldReviewRequest:
    """채팅 경로: 작품에 연결된 세계관을 읽어 요청으로 만든다. 연결이 없으면 대체 세계관을 찾지 않고 실패한다.

    회차를 지정하지 않아 최신 관계다(DEC-51의 회차별 기록은 최신 시점만 본다). 보낼 수 있는 양을 넘는 카드는 보내지 않는다(계약 'ponytail 한계').
    """
    try:
        linked = next((w['worldId'] for w in content_mcp.call('world_studio_list', {}) if w.get('linkedWorkId') == work_id), None)
        if linked is None:
            raise WorldReviewFailure(409, NO_LINKED_WORLD)
        return _request(content_mcp.call('world_studio_read', {'id': linked}))
    except (LookupError, TypeError, AttributeError, ValueError):  # pydantic ValidationError도 ValueError다. 기능·Content 실패는 그대로 올라간다
        raise WorldReviewFailure(502, BAD_CONTENT) from None


def _plain(card: RequestCard) -> RequestCard:
    """본문·인물 문서의 본문 링크(DEC-53)를 글자로 벗긴 카드. 모델 입력에 카드 id가 섞이지 않고 글자 수 한도도 벗긴 길이로 센다."""
    docs = card.characterDocs
    if docs:
        docs = docs.model_copy(update={'soul': strip_card_links(docs.soul), 'goal': strip_card_links(docs.goal),
                                       'episodes': {n: strip_card_links(text) for n, text in docs.episodes.items()}})
    return card.model_copy(update={'body': strip_card_links(card.body), 'characterDocs': docs})


def _request(read: dict) -> WorldReviewRequest:
    """world_studio_read 응답의 활성 카드·관계. 삭제된(lifecycle=removed) 것과 보내지 않는 카드에 이어진 관계는 뺀다."""
    cards = []
    for c in read['cards']:
        if c.get('lifecycle') != 'removed':
            docs = (c.get('semanticMetadata') or {}).get('characterDocs') if c['cardType'] == 'character' else None
            cards.append(RequestCard(id=c['id'], cardType=c['cardType'], areaCode=c['areaCode'], title=c['title'], body=c['body'],
                                     characterDocs=docs))
    cards = [c for c in map(_plain, cards) if c.chars() <= MAX_CARD_CHARS][:MAX_CARDS]
    ids = {c.id for c in cards}
    relationships = []
    for r in read.get('relationships') or []:
        relation_id, source, target = r['id'], r.get('sourceCardId'), r.get('targetCardId')
        if r.get('lifecycle') != 'removed' and source in ids and target in ids:
            relationships.append(Relationship(id=relation_id, sourceCardId=source, targetCardId=target, label=r.get('label') or '',
                                              polarity='denied' if r.get('polarity') == 'denied' else 'asserted'))
    return WorldReviewRequest(worldName=read['name'], worldDescription=read.get('description') or '', cards=cards, relationships=relationships)
