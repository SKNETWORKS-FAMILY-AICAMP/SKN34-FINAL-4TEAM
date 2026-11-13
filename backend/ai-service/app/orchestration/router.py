"""집필 AI 오케스트레이션 내부 API. 결과는 Agent별 제안이며 저장·승인은 Content가 한다."""

from fastapi import APIRouter, Header, HTTPException

from app.intent.errors import IntentFailure
from app.internal_auth import require_internal_token
from app.orchestration import service
from app.orchestration.models import OrchestrationRequest, OrchestrationResponse

router = APIRouter()


@router.post('/internal/v1/orchestrations')
def orchestrate(data: OrchestrationRequest, x_internal_token: str = Header(default='')) -> OrchestrationResponse:
    """자유 입력 또는 UI 선택 기능을 Router로 계획하고, 검증을 통과하면 구현된 Agent를 계획 순서로 실행한다."""
    require_internal_token(x_internal_token)
    try:
        return service.run(data)
    except IntentFailure:
        raise HTTPException(503, '요청 분류에 실패했습니다.') from None
