"""설정집 AI 검토 내부 API. 결과는 지적과 수정안 제안이며 카드를 바꾸지 않는다."""

from fastapi import APIRouter, Header, HTTPException

from app import tracing
from app.internal_auth import require_internal_token
from app.world_review import service
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import WorldReviewRequest, WorldReviewResponse

router = APIRouter()


@router.post('/internal/v1/world-reviews')
def review(data: WorldReviewRequest, x_internal_token: str = Header(default=''),
           x_user_authorization: str = Header(default='')) -> WorldReviewResponse:
    """Content가 보낸 설정집 스냅샷에서 설정 모순·인물 문서 역할 오류·사건 정보 누락을 찾아 카드 id가 붙은 지적과 수정안을 반환한다.

    X-User-Authorization(선택)은 추적의 회원 식별에만 쓴다.
    """
    require_internal_token(x_internal_token)
    try:
        with tracing.request('world_review', user_id=tracing.member_id(x_user_authorization)):
            return service.review(data)
    except WorldReviewFailure as error:
        raise HTTPException(error.status, str(error)) from None
