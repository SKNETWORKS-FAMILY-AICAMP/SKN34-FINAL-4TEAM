"""심의 등급 판별: 작가의 회차 초안이 19세 이용가로 분류할 내용인지 회차마다 판별하고 작품 판정을 묶는다.

초안은 Content MCP(DEC-49)로 요청한 작가의 권한으로 읽고, 세계관·Retrieval·Simulation은 부르지 않는다.
모든 회차를 먼저 읽어 하나라도 실패하면 모델을 부르지 않는다. 결과는 판정 제안이며 작품 등급을 바꾸지 않는다.
모델이 그 회차 초안에 없는 구절을 근거로 쓰면 고치지 않고 실패한다.
"""

from pydantic import ValidationError

from app.content_mcp import service as content_mcp
from app.rating import agent
from app.rating.errors import RatingFailure
from app.rating.models import EpisodeRating, RatingRequest, RatingResponse

BAD_CONTENT = 'Content 응답을 확인할 수 없습니다.'
BAD_REASON = '심의 판별 모델 응답의 근거를 확인할 수 없습니다.'


def rate(data: RatingRequest) -> RatingResponse:
    drafts = [(number, *_draft(data.workId, number)) for number in data.episodes]
    episodes = []
    for number, body, revision in drafts:
        result, meta = agent.rate(body)
        if any(not r.quote or r.quote not in body for r in result.reasons):
            raise RatingFailure(502, BAD_REASON)
        episodes.append(EpisodeRating(episode=number, revision=revision, **result.model_dump(), **meta))
    return RatingResponse(workId=data.workId, adult=any(e.adult for e in episodes), episodes=episodes)


def _draft(work_id: str, number: int) -> tuple[str, int]:
    try:
        draft = content_mcp.EpisodeReadResponse.model_validate(content_mcp.call('episode_read', {'id': work_id, 'number': number})).draft
    except ValidationError:
        raise RatingFailure(502, BAD_CONTENT) from None
    if not draft.body.strip():
        raise RatingFailure(422, f'{number}화에 판별할 초안 본문이 없어요.')
    return draft.body, draft.revision
