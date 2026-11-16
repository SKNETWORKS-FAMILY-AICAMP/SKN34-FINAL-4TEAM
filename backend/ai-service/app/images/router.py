"""이미지 비동기 작업 접수 API."""
from fastapi import APIRouter, Header, HTTPException
from app.internal_auth import require_internal_token
from app.images.models import JobRequest, JobResponse
from app.images.worker import execute
router = APIRouter()

@router.post("/internal/v1/images/jobs", status_code=202)
def submit(data: JobRequest, x_internal_token: str = Header(default="")) -> JobResponse:
    """큐 등록 확인 후 ID를 반환한다. 모델 호출은 별도 워커가 수행한다."""
    require_internal_token(x_internal_token)
    try:
        execute.apply_async(args=[str(data.jobId)], task_id=str(data.jobId), argsrepr="(<jobId>,)")
    except Exception:
        raise HTTPException(503, "이미지 작업 접수 실패") from None
    return JobResponse(jobId=data.jobId)
