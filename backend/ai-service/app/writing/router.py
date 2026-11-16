"""새 원고·부분 수정 내부 API. 결과는 제안이며 저장은 Content의 승인 경로에서만 한다."""

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.writing import agent
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, DraftResponse, PatchRequest, PatchResponse

router = APIRouter()


@router.post('/internal/v1/writing/drafts')
def draft(data: DraftRequest, x_internal_token: str = Header(default='')) -> DraftResponse:
    """BeatPlan/콘티와 허용 문맥으로 새 회차 원고 제안을 만든다."""
    require_internal_token(x_internal_token)
    try:
        return agent.draft(data)
    except WritingFailure as error:
        raise HTTPException(error.status, str(error)) from None


@router.post('/internal/v1/writing/patches')
def patch(data: PatchRequest, x_internal_token: str = Header(default='')) -> PatchResponse:
    """선택 구간 하나를 수정 지시대로 고친 before/after 제안을 만든다."""
    require_internal_token(x_internal_token)
    try:
        return agent.patch(data)
    except WritingFailure as error:
        raise HTTPException(error.status, str(error)) from None
