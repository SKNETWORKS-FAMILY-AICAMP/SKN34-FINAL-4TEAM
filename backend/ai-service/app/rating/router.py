"""심의 등급 판별 내부 API. 결과는 19세 이용가 판정 제안이며 작품 등급·원고를 바꾸지 않는다."""

from fastapi import APIRouter, Header, HTTPException

from app.content_mcp.errors import ContentMcpFailure
from app.internal_auth import require_internal_token
from app.rating import service
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest, RatingResponse

router = APIRouter()


@router.post('/internal/v1/ratings')
def rate(data: RatingRequest, x_internal_token: str = Header(default=''),
         x_user_authorization: str = Header(default='')) -> RatingResponse:
    """회차 초안마다 19세 이용가 여부와 근거 구절을 판별하고, 하나라도 19세면 작품도 19세로 판정한다.

    X-User-Authorization은 Content가 전달한 작가의 Bearer이며 초안 읽기(Content MCP)에만 쓴다.
    """
    require_internal_token(x_internal_token)
    service.content_mcp.AUTHORIZATION.set(x_user_authorization)
    try:
        return service.rate(data)
    except (RatingFailure, ContentMcpFailure) as error:
        raise HTTPException(error.status, str(error)) from None
