"""심의 등급 판별: 작가의 회차 초안을 판별 항목별 수준으로 평가하고, 문턱값으로 회차·묶음 판정을 계산한다.

초안은 Content MCP(DEC-49)로 요청한 작가의 권한으로 읽고, 세계관·Retrieval·Simulation은 부르지 않는다.
모든 회차를 먼저 읽어 하나라도 실패하면 모델을 부르지 않는다. 결과는 판정 제안이며 작품 등급을 바꾸지 않는다.
모델 응답을 확인할 수 없거나 근거 구절이 그 회차 초안에 없으면 고치지 않고 그 회차만 판별 실패로 둔다.
"""

from pydantic import ValidationError

from app.content_mcp import service as content_mcp
from app.rating import agent
from app.rating.errors import RatingFailure
from app.rating.models import EpisodeRating, RatingRequest, RatingResponse, RatingResult

BAD_CONTENT = 'Content 응답을 확인할 수 없습니다.'
BAD_REASON = '심의 판별 모델 응답의 근거를 확인할 수 없습니다.'
MIN_QUOTE = 4  # "그"·"비가" 같은 조각은 어디에나 있어 근거가 되지 못한다
QUOTE_MARKS = str.maketrans({'“': '"', '”': '"', '‘': "'", '’': "'", '…': '...'})


def rate(data: RatingRequest) -> RatingResponse:
    drafts = [(number, *_draft(data.workId, number)) for number in data.episodes]
    episodes = [_rate(*draft) for draft in drafts]
    verdicts = [e.verdict for e in episodes]
    if not any(verdicts):  # 한 회차도 판별하지 못했으면 검토 필요로 감싸지 않고 실패를 그대로 알린다
        raise RatingFailure(502, episodes[0].error)
    verdict = 'adult' if 'adult' in verdicts else 'general' if all(v == 'general' for v in verdicts) else 'needsReview'
    return RatingResponse(workId=data.workId, verdict=verdict, prohibited=any(e.prohibited for e in episodes), episodes=episodes)


def _rate(number: int, body: str, revision: int) -> EpisodeRating:
    try:
        result, meta = agent.rate(body)
    except RatingFailure as error:
        if error.status != 502:  # 설정 누락·제공사 장애는 회차 문제가 아니므로 요청 전체를 실패시킨다
            raise
        return EpisodeRating(episode=number, revision=revision, verdict=None, error=str(error))
    if not _quoted(result, body):
        return EpisodeRating(episode=number, revision=revision, verdict=None, error=BAD_REASON, **meta)
    return EpisodeRating(episode=number, revision=revision, verdict=result.verdict(), prohibited=result.prohibited,
                         assessments=result.assessments, **meta)


def _quoted(result: RatingResult, body: str) -> bool:
    """판정을 좌우하는 근거 구절이 모두 초안에 있는지. 모델이 흔히 바꾸는 공백·줄바꿈·둥근 따옴표·말줄임표만 같게 보고 비교한다."""
    text = _normalize(body)
    return all(len(q.strip()) >= MIN_QUOTE and _normalize(q) in text for q in result.evidence())


def _normalize(text: str) -> str:
    return ' '.join(text.translate(QUOTE_MARKS).split())


def _draft(work_id: str, number: int) -> tuple[str, int]:
    try:
        draft = content_mcp.EpisodeReadResponse.model_validate(content_mcp.call('episode_read', {'id': work_id, 'number': number})).draft
    except ValidationError:
        raise RatingFailure(502, BAD_CONTENT) from None
    if not draft.body.strip():
        raise RatingFailure(422, f'{number}화에 판별할 초안 본문이 없어요.')
    return draft.body, draft.revision
