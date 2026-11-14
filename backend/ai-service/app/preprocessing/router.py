"""회차 원고 전처리 접수 전용 내부 API. Content가 승인된 작업을 넘기면 Celery task 하나로 등록만 하고 처리는 worker가 한다."""
import os

from fastapi import APIRouter, Header, HTTPException
from kombu.exceptions import OperationalError

from app.internal_auth import require_internal_token
from app.preprocessing import tasks
from app.preprocessing.models import Accepted, JobRequest

router = APIRouter()


@router.post('/internal/v1/preprocessing/jobs', status_code=202, response_model=Accepted)
def accept_job(job: JobRequest, x_internal_token: str = Header(default='')) -> Accepted:
    """Content가 접수한 전처리 작업을 Celery에 등록한다. 같은 jobId를 다시 보내면 받은 회차만 다시 실행한다."""
    require_internal_token(x_internal_token)
    if not os.environ.get('CELERY_BROKER_URL'):
        raise HTTPException(503, 'BROKER_NOT_CONFIGURED')
    try:
        tasks.run_job.apply_async(args=[str(job.jobId), str(job.workId), job.episodes])
    except (OperationalError, OSError):   # 브로커 주소·자격이 예외 메시지에 있을 수 있어 고정 코드만 돌려준다.
        raise HTTPException(503, 'BROKER_UNAVAILABLE') from None
    return Accepted(jobId=job.jobId)
