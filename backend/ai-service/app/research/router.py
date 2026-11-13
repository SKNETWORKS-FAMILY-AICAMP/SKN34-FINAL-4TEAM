"""웹 조사 내부 API. 결과는 판단 제안이며 원고·정본을 바꾸지 않는다."""

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.research import service
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest, ResearchResponse

router = APIRouter()


@router.post('/internal/v1/research/web')
def research(data: ResearchRequest, x_internal_token: str = Header(default='')) -> ResearchResponse:
    """웹 검색 근거로 주장별 확인·상충·미확인 판단과 확인하지 못한 부분을 반환한다."""
    require_internal_token(x_internal_token)
    try:
        return service.research(data)
    except ResearchFailure as error:
        raise HTTPException(error.status, str(error)) from None
