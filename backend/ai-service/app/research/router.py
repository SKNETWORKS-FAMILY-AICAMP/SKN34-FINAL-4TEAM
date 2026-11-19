"""웹 조사 내부 API. 결과는 판단 제안이며 원고·정본을 바꾸지 않는다."""

from fastapi import APIRouter, Header, HTTPException

from app import tracing
from app.internal_auth import require_internal_token
from app.research import service
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest, ResearchResponse

router = APIRouter()


@router.post('/internal/v1/research/web')
def research(data: ResearchRequest, x_internal_token: str = Header(default=''),
             x_user_authorization: str = Header(default='')) -> ResearchResponse:
    """웹 검색 근거로 주장별 확인·상충·미확인 판단과 확인하지 못한 부분을 반환한다. X-User-Authorization(선택)은 추적의 회원 식별에만 쓴다."""
    require_internal_token(x_internal_token)
    try:
        with tracing.request('web_research', user_id=tracing.member_id(x_user_authorization)):
            return service.research(data)
    except ResearchFailure as error:
        raise HTTPException(error.status, str(error)) from None
