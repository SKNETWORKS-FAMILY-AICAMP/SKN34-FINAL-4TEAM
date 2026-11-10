"""서비스 인증을 거친 내부 Run 접수·조회·취소 HTTP 경계."""
import os
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request

from .schemas import RunRequest, RunResponse
from .service import RunError, RunService
from .state import Ref
from .approval import DecisionSignal


def service(request: Request, x_internal_token: Annotated[list[str] | None, Header()] = None) -> RunService:
    token = os.environ.get("INTERNAL_TOKEN", "")
    if (not token.strip() or not x_internal_token or len(x_internal_token) != 1
            or not secrets.compare_digest(token.encode(), x_internal_token[0].encode())):
        raise HTTPException(403, "internal_auth_required")
    instance = request.app.state.run_service
    if instance is None:
        raise HTTPException(503, "run_service_unconfigured")
    return instance


Service = Annotated[RunService, Depends(service)]
Grant = Annotated[list[str], Header(alias="X-Grant-Ref")]
Thread = Annotated[list[str], Header(alias="X-Thread-Ref")]
router = APIRouter(prefix="/internal/v1/ai/runs", tags=["internal-runs"])


def credentials(grants: list[str], threads: list[str]) -> tuple[str, str]:
    if len(grants) != 1 or len(threads) != 1:
        raise HTTPException(403, "invalid_scope")
    return grants[0], threads[0]


@router.post("", response_model=RunResponse, status_code=202)
async def start_run(data: RunRequest, instance: Service):
    """작업별 합성 위임을 검증하고 같은 run을 한 번만 접수한다."""
    try:
        return instance.start(data)
    except RunError as error:
        raise HTTPException(error.status, error.code) from None


@router.get("/{run_id}", response_model=RunResponse)
async def get_run(run_id: Annotated[Ref, Path()], instance: Service, x_grant_ref: Grant, x_thread_ref: Thread):
    """현재 위임·thread를 다시 확인하고 실행 상태를 반환한다."""
    grant, thread = credentials(x_grant_ref, x_thread_ref)
    try:
        return instance.status(run_id, grant, thread)
    except RunError as error:
        raise HTTPException(error.status, error.code) from None


@router.post("/{run_id}/cancel", response_model=RunResponse)
async def cancel_run(run_id: Annotated[Ref, Path()], instance: Service, x_grant_ref: Grant, x_thread_ref: Thread):
    """현재 위임으로 실행을 취소하며 완료된 결과는 그대로 반환한다."""
    grant, thread = credentials(x_grant_ref, x_thread_ref)
    try:
        return instance.cancel(run_id, grant, thread)
    except RunError as error:
        raise HTTPException(error.status, error.code) from None


@router.post("/{run_id}/resume", response_model=RunResponse)
async def resume_run(run_id: Annotated[Ref, Path()], data: DecisionSignal, instance: Service,
                     x_grant_ref: Grant, x_thread_ref: Thread):
    """Content에서 이미 커밋한 결정 참조로 정확한 중단만 재개한다. 모델 판단·적용 요청은 받지 않는다."""
    grant, thread = credentials(x_grant_ref, x_thread_ref)
    try:
        return await instance.resume(run_id, grant, thread, data)
    except RunError as error:
        raise HTTPException(error.status, error.code) from None
