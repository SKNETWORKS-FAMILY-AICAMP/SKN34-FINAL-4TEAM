"""원고 검수 내부 API. 결과는 지적 제안이며 원고·정본을 바꾸지 않는다."""

from fastapi import APIRouter, Header, HTTPException

from app.content_mcp.errors import ContentMcpFailure
from app.internal_auth import require_internal_token
from app.review import service
from app.review.errors import ReviewFailure
from app.review.models import ReviewRequest, ReviewResponse

router = APIRouter()


@router.post('/internal/v1/reviews')
def review(data: ReviewRequest, x_internal_token: str = Header(default=''),
           x_user_authorization: str = Header(default='')) -> ReviewResponse:
    """회차 초안을 Mechanical 또는 Semantic으로 검수해 위치·이유·근거·확정/의심/판단 불가가 있는 지적을 반환한다.

    X-User-Authorization은 Content가 전달한 작가의 Bearer이며 초안·세계관 읽기(Content MCP)에만 쓴다.
    """
    require_internal_token(x_internal_token)
    service.content_mcp.AUTHORIZATION.set(x_user_authorization)
    try:
        return service.review(data)
    except (ReviewFailure, ContentMcpFailure) as error:
        raise HTTPException(error.status, str(error)) from None
