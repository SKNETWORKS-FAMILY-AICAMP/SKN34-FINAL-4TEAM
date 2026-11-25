"""이미지 비동기 작업 접수 API."""
from fastapi import APIRouter, Header, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool
from app import tracing
from app.images import moderation
from app.internal_auth import require_internal_token
from app.images.models import JobRequest, JobResponse
from app.images.worker import execute
router = APIRouter()

@router.post("/internal/v1/images/jobs", status_code=202)
def submit(data: JobRequest, x_internal_token: str = Header(default="")) -> JobResponse:
    """큐 등록 확인 후 ID를 반환한다. 모델 호출은 별도 워커가 수행한다."""
    require_internal_token(x_internal_token)
    job_id = str(data.jobId)
    with tracing.request("image_job_submit", session_id=job_id):
        try:
            execute.apply_async(args=[job_id], task_id=job_id, argsrepr="(<jobId>,)")
        except Exception:
            raise HTTPException(503, "이미지 작업 접수 실패") from None
        return JobResponse(jobId=data.jobId)


@router.post("/internal/v1/images/cover-moderation", status_code=204)
async def moderate_cover(request: Request, x_internal_token: str = Header(default="")) -> Response:
    """내부 요청의 표지 파일을 저장하지 않고 검사한다."""
    require_internal_token(x_internal_token)
    member_id = tracing.member_id(request.headers.get("X-User-Authorization", ""))
    try:
        with tracing.request("cover_moderation", user_id=member_id):
            raw = bytearray()
            async for chunk in request.stream():
                if len(raw) + len(chunk) > 10 * 1024 * 1024:
                    raise HTTPException(413, "표지 파일 크기 초과")
                raw.extend(chunk)
            await run_in_threadpool(moderation.check_cover, bytes(raw), request.headers.get("content-type", ""))
    except moderation.InvalidCover:
        raise HTTPException(400, "검사할 수 없는 표지 파일") from None
    except moderation.OutputBlocked:
        raise HTTPException(422, "표지 콘텐츠 정책 위반") from None
    except moderation.OutputModerationUnavailable:
        raise HTTPException(503, "표지 검사 실패") from None
    return Response(status_code=204)
