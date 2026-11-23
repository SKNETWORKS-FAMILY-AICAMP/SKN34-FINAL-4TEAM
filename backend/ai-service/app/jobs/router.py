"""운영 정기 작업 실행 내부 API(계약 §4). 접수만 하고 실행은 Celery 큐(jobs)의 ai-jobs-worker가 한다."""
import logging

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.jobs.models import JobRunRequest
from app.jobs.worker import run_operations_job

log = logging.getLogger(__name__)
router = APIRouter()


@router.post('/internal/v1/jobs', status_code=202)
def accept_job(data: JobRunRequest, x_internal_token: str = Header(default='')) -> None:
    """운영 스케줄러가 접수시킨 작업 실행을 Celery 큐(jobs)에 올린다. 실행·상태 기록은 워커가 운영 내부 API를 불러 운영이 한다.

    큐에 올리지 못하면(브로커 연결·인증 실패 등) 202로 숨기지 않고 503이다. 운영은 응답을 받지 못한 것으로 보고 그 기록을 failed로 남긴다.
    """
    require_internal_token(x_internal_token)
    try:
        run_operations_job.delay(data.model_dump(mode='json'))
    except Exception as error:  # 브로커 연결·인증 실패 등 큐에 올리지 못한 모든 경우
        log.error('operations job run %s was not queued: %s', data.runId, type(error).__name__)  # 오류 메시지에 브로커 주소·자격이 섞일 수 있어 클래스만 남긴다
        raise HTTPException(503, '작업을 큐에 올리지 못했습니다.') from None
