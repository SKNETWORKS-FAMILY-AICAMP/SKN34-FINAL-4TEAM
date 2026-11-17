"""심의 등급 판별: 작가의 회차 초안을 판별 항목별 수준으로 평가하고, 문턱값으로 회차·묶음 판정을 계산한다.

초안·연결 세계관은 Content MCP(DEC-49)로 요청한 작가의 권한으로 읽고, Retrieval·Simulation은 부르지 않는다. 모델에는 회차의 제목·작가 메모·
초안과 그 회차까지 공개된 인물 카드(미성년 여부 판단용), 비속어 빈도(규칙 신호)를 보낸다. 근거 구절은 초안에서만 인정한다.
모든 회차를 먼저 읽어 하나라도 실패하면 모델을 부르지 않고, 회차 판별은 서로 독립이라 동시에 부른다.
결과는 판정 제안이며 작품 등급을 바꾸지 않는다. 모델 응답을 확인할 수 없거나 근거 구절이 그 회차 초안에 없으면 그 회차만 판별 실패로 둔다.
"""

import contextvars
from concurrent.futures import ThreadPoolExecutor

from pydantic import ValidationError

from app.content_mcp import service as content_mcp
from app.novelbrain.models import Card, world_snapshot
from app.rating import agent
from app.rating.errors import RatingFailure
from app.rating.models import EpisodeRating, RatingRequest, RatingResponse, RatingResult

BAD_CONTENT = 'Content 응답을 확인할 수 없습니다.'
BAD_REASON = '심의 판별 모델 응답의 근거를 확인할 수 없습니다.'
MIN_QUOTE = 4  # "그"·"비가" 같은 조각은 어디에나 있어 근거가 되지 못한다
QUOTE_MARKS = str.maketrans({'“': '"', '”': '"', '‘': "'", '’': "'", '…': '...'})
# 서로 겹치지 않는 비속어 어근. '시발(점)'·'씹(다)'·'(5)개년'처럼 일반 낱말과 겹치는 형태는 넣지 않는다.
# shortcut: 고정 목록의 부분 문자열 빈도라 변형 표기(ㅅㅂ·씨1발)는 세지 않는다. 오탐·미탐이 문제 되면 형태소 분석이나 사전 확장을 검토한다.
PROFANITY = ('씨발', '씨팔', '시팔', '좆', '개새끼', '병신', '지랄', '염병', '썅', '엿같', '쌍년', '미친년', '미친놈')


def rate(data: RatingRequest) -> RatingResponse:
    drafts = [(number, _draft(data.workId, number)) for number in data.episodes]
    cards = _characters(data.workId, max(data.episodes))
    inputs = [(number, draft, [c for c in cards if c.revealFromEpisode is None or c.revealFromEpisode <= number]) for number, draft in drafts]
    # 회차 판별은 서로의 결과를 쓰지 않아 동시에 부른다. 추적 문맥(contextvars)은 스레드마다 복사해 넘긴다.
    with ThreadPoolExecutor(len(inputs)) as pool:
        episodes = [run.result() for run in [pool.submit(contextvars.copy_context().run, _rate, *i) for i in inputs]]
    verdicts = [e.verdict for e in episodes]
    if not any(verdicts):  # 한 회차도 판별하지 못했으면 검토 필요로 감싸지 않고 실패를 그대로 알린다
        raise RatingFailure(502, episodes[0].error)
    verdict = 'adult' if 'adult' in verdicts else 'general' if all(v == 'general' for v in verdicts) else 'needsReview'
    return RatingResponse(workId=data.workId, verdict=verdict, prohibited=any(e.prohibited for e in episodes), episodes=episodes)


def _rate(number: int, draft: content_mcp.Draft, characters: list[Card]) -> EpisodeRating:
    signals = {'profanityCount': sum(draft.body.count(word) for word in PROFANITY)}
    episode = {'title': draft.title, 'authorNote': draft.authorNote, 'draft': draft.body,
               'characters': [{'ref': f'card:{c.id}', 'name': c.title, 'text': c.text} for c in characters], 'signals': signals}
    base = {'episode': number, 'revision': draft.revision, 'signals': signals}
    try:
        result, meta = agent.rate(episode)
    except RatingFailure as error:
        if error.status != 502:  # 설정 누락·제공사 장애는 회차 문제가 아니므로 요청 전체를 실패시킨다
            raise
        return EpisodeRating(**base, verdict=None, error=str(error))
    if not _quoted(result, draft.body):
        return EpisodeRating(**base, verdict=None, error=BAD_REASON, **meta)
    return EpisodeRating(**base, verdict=result.verdict(), prohibited=result.prohibited, assessments=result.assessments, **meta)


def _quoted(result: RatingResult, body: str) -> bool:
    """판정을 좌우하는 근거 구절이 모두 초안에 있는지. 모델이 흔히 바꾸는 공백·줄바꿈·둥근 따옴표·말줄임표만 같게 보고 비교한다."""
    text = _normalize(body)
    return all(len(q.strip()) >= MIN_QUOTE and _normalize(q) in text for q in result.evidence())


def _normalize(text: str) -> str:
    return ' '.join(text.translate(QUOTE_MARKS).split())


def _draft(work_id: str, number: int) -> content_mcp.Draft:
    try:
        draft = content_mcp.EpisodeReadResponse.model_validate(content_mcp.call('episode_read', {'id': work_id, 'number': number})).draft
    except ValidationError:
        raise RatingFailure(502, BAD_CONTENT) from None
    if not draft.body.strip():
        raise RatingFailure(422, f'{number}화에 판별할 초안 본문이 없어요.')
    return draft


def _characters(work_id: str, episode: int) -> list[Card]:
    """작품에 연결된 세계관의 인물 카드. 심의는 세계관 없이도 할 수 있어 연결이 없으면 인물 없이 판별한다(Review와 다름)."""
    try:
        linked = next((w['worldId'] for w in content_mcp.call('world_studio_list', {}) if w.get('linkedWorkId') == work_id), None)
        if linked is None:
            return []
        world = world_snapshot(content_mcp.call('world_studio_read', {'id': linked, 'episode': str(episode)}), episode)
    except (LookupError, TypeError, AttributeError, ValueError):
        raise RatingFailure(502, BAD_CONTENT) from None
    return [c for c in world.cards if c.cardType == 'character']
