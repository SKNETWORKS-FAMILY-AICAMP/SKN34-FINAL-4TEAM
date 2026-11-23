"""설정집 AI 검토(check)·보강(enrich)·영향 분석(impact): 설정집 스냅샷을 한 번 모델에 보내 카드 id가 붙은 결과를 돌려준다.

HTTP 경로(router)와 오케스트레이션의 world 단계(task=check)가 같은 review 함수를 쓴다. HTTP 경로는 Content가 보낸 스냅샷만 쓰고 Content MCP를
부르지 않는다. 채팅 경로만 linked_request·linked_world로 연결 세계관을 작가 권한(Content MCP, DEC-49)으로 읽어 같은 요청을 만든다.
enrich·impact는 채팅 경로에만 있다. 결과는 모두 제안이며 카드를 고치지 않는다(enrich의 반영은 작가 승인 뒤 content_mcp.apply_world).
모델이 입력에 없는 카드·관계·회차·계획 id나 계약 밖의 수정안을 쓰면 고치지 않고 실패한다.
"""

from app import tracing
from app.card_links import strip_card_links
from app.content_mcp import service as content_mcp
from app.world_review import agent
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import (MAX_CARD_CHARS, MAX_CARDS, MAX_FIXES, CardFix, EnrichResponse, EnrichResult, Finding, Fix,
                                     ImpactResponse, ImpactResult, Relationship, RequestCard, WorldReviewRequest, WorldReviewResponse)

MAX_MESSAGE = 300
MAX_TEXT = 3000  # 수정안 한 칸의 글자 수: 인물 문서 한도이자 카드 본문 한도
NO_LINKED_WORLD = '이 작품에 연결된 세계관이 없어 설정집을 다룰 수 없어요.'
NO_CARDS = '세계관에 보강할 설정 카드가 없어요.'
BAD_CONTENT = 'Content 세계관 응답을 확인할 수 없습니다.'
BAD_FINDING = '설정집 검토 모델 응답의 카드·수정안을 확인할 수 없습니다.'
BAD_ENRICH = '설정 보강 모델 응답의 카드·수정안을 확인할 수 없습니다.'
BAD_IMPACT = '설정 영향 분석 모델 응답의 참조를 확인할 수 없습니다.'


def review(data: WorldReviewRequest) -> WorldReviewResponse:
    """카드마다 모순·인물 문서 역할·사건 필수 정보를 검토한다. 검토할 카드가 없으면 모델을 부르지 않는다."""
    if not data.cards:
        return WorldReviewResponse(findings=[], reviewedCards=0, model='')
    cards = {c.id: c for c in data.cards}
    # 보내지 않은 카드에 이어진 관계는 모델이 없는 카드 id를 인용하게 하므로 뺀다.
    sent = data.model_copy(update={'relationships': [r for r in data.relationships if r.sourceCardId in cards and r.targetCardId in cards]})
    # 설정 본문은 추적에 남기지 않고 카드·관계 id 참조만 남긴다.
    with tracing.observe('world_review', as_type='chain', input=sent.refs()):
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


def enrich(request: str, data: WorldReviewRequest, world_id: str, revision: int) -> EnrichResponse:
    """request가 가리킨 기존 카드의 본문·인물 문서를 보강한 수정안(1~5칸)을 돌려준다. 카드를 고치지 않고 모델도 새 카드·관계를 만들 수 없다.

    world_id·revision은 읽은 세계관과 초안 revision이다. cardTitle은 모델이 쓰지 않고 입력의 카드에서 채운다.
    """
    if not data.cards:
        raise WorldReviewFailure(409, NO_CARDS)
    cards = {c.id: c for c in data.cards}
    with tracing.observe('world_review.enrich', as_type='chain', input={'request': request, **data.refs()}):
        result, meta = agent.enrich(request, data)
        _check_enrich(result, cards)
    return EnrichResponse(worldId=world_id, revision=revision, note=result.note, model=meta['model'],
                          fixes=[CardFix(**fix.model_dump(), cardTitle=cards[fix.cardId].title) for fix in result.fixes])


def _check_enrich(result: EnrichResult, cards: dict[str, RequestCard]) -> None:
    """제안이 계약을 지키는지 본다: 1~5개, 지적과 같은 수정안 규칙, 같은 칸은 한 번만(둘이면 어느 글이 맞는지 정할 수 없다), 설명 300자 이하."""
    fixes = result.fixes
    valid = (1 <= len(fixes) <= MAX_FIXES and len({(f.cardId, f.target, f.episode) for f in fixes}) == len(fixes)
             and len(result.note) <= MAX_MESSAGE and all(_valid_fix(f, list(cards), cards) for f in fixes))
    if not valid:
        raise WorldReviewFailure(502, BAD_ENRICH)


def impact(request: str, data: WorldReviewRequest, context: dict, plans: list[dict]) -> ImpactResponse:
    """바꾸려는 설정·사건이 영향을 주는 곳을 분석한다(읽기만 하며 조건부 수정과 잇지 않는다).

    context는 Content가 허용한 원고 문맥(work_context_read), plans는 계획 목록(story_plan_list, 정본 아님)이다. ref는 입력의 카드·관계 id, 원고 문맥의
    회차 번호(읽은 회차와 기준 회차), 계획 id만 인정한다.
    """
    try:
        known = {'card': {c.id for c in data.cards}, 'relationship': {r.id for r in data.relationships},
                 'episode': {str(e['number']) for e in context['episodes']} | {str(context['basisEpisode'])}, 'scene': {p['id'] for p in plans}}
    except (LookupError, TypeError, AttributeError):
        raise WorldReviewFailure(502, BAD_CONTENT) from None
    with tracing.observe('world_review.impact', as_type='chain', input={'request': request, **data.refs()}):
        result, meta = agent.impact(request, data, context, plans)
        _check_impact(result, known)
    return ImpactResponse(**result.model_dump(), model=meta['model'])


def _check_impact(result: ImpactResult, known: dict[str, set[str]]) -> None:
    """ref는 그 종류로 입력에 있던 것만, 모든 문장은 읽을 수 있는 300자 이하여야 한다."""
    sentences = [*result.conflicts, *result.gaps, *(t for a in result.affected for t in (a.title, a.reason))]
    if not (all(a.ref in known[a.kind] for a in result.affected) and all(s.strip() and len(s) <= MAX_MESSAGE for s in sentences)):
        raise WorldReviewFailure(502, BAD_IMPACT)


def linked_request(work_id: str) -> WorldReviewRequest:
    """채팅 경로(check·impact): 작품에 연결된 세계관의 요청(스냅샷)."""
    return linked_world(work_id)[0]


def linked_world(work_id: str) -> tuple[WorldReviewRequest, str, int]:
    """채팅 경로: 작품에 연결된 세계관을 읽어 (요청, 세계관 id, 읽은 초안 revision)으로 돌려준다. 연결이 없으면 대체 세계관을 찾지 않고 실패한다.

    enrich는 세계관 id와 revision으로 제안의 기준을 남기고 반영 때 그 revision이 그대로인지 본다.
    회차를 지정하지 않아 최신 관계다(DEC-51의 회차별 기록은 최신 시점만 본다). 보낼 수 있는 양을 넘는 카드는 보내지 않는다(계약 'ponytail 한계').

    `content_mcp.linked_world(work_id, episode)`(Review·Q&A·Rating의 공용 읽기)와 같은 일이 아니라 따로 둔다: 그것은 회차 시점 관계를 읽고 연결이 없으면
    Fork가 이어받은 원작 세계관(읽기 전용, 초안 revision 없음)이나 None을 돌려주지만, 여기는 작가가 고칠 수 있는 연결 세계관의 최신 관계와 id·초안 revision이 필요하고
    연결이 없으면 계약대로 409다.
    """
    try:
        linked = next((w['worldId'] for w in content_mcp.call('world_studio_list', {}) if w.get('linkedWorkId') == work_id), None)
        if linked is None:
            raise WorldReviewFailure(409, NO_LINKED_WORLD)
        read = content_mcp.call('world_studio_read', {'id': linked})
        return _request(read), linked, int(read['draftRevision'])
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
