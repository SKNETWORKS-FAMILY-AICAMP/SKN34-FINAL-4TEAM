"""회차 원고 전처리 내부 API(#343, DEC-50). 접수만 하고 실행은 Celery 큐의 ai-worker가 한다."""
import logging

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.preprocessing.models import JobRequest
from app.preprocessing.worker import run_job

log = logging.getLogger(__name__)
router = APIRouter()


@router.post('/internal/v1/preprocessing/jobs', status_code=202)
def accept_preprocessing_job(data: JobRequest, x_internal_token: str = Header(default='')) -> None:
    """Content가 접수시킨 전처리 작업을 Celery 큐(preprocessing)에 올린다. 결과·실패는 worker가 Content 내부 콜백으로 기록한다.

    큐에 올리지 못하면(브로커 연결·인증 실패 등) 202로 숨기지 않고 503이다. Content는 응답을 받지 못한 것으로 보고 작업을 queued로 둔다.
    """
    require_internal_token(x_internal_token)
    try:
        run_job.delay(data.model_dump(mode='json'))
    except Exception as error:  # 브로커 연결·인증 실패 등 큐에 올리지 못한 모든 경우
        log.error('preprocessing job %s was not queued: %s', data.jobId, type(error).__name__)  # 오류 메시지에 브로커 주소·자격이 섞일 수 있어 클래스만 남긴다
        raise HTTPException(503, '전처리 작업을 큐에 올리지 못했습니다.') from None
