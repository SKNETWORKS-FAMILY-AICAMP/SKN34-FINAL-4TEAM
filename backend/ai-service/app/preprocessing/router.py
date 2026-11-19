"""회차 원고 전처리 내부 API(#343, DEC-50). 접수만 하고 실행은 응답 뒤 백그라운드에서 한다."""

from fastapi import APIRouter, BackgroundTasks, Header

from app.internal_auth import require_internal_token
from app.preprocessing.models import JobRequest
from app.preprocessing.service import run_job

router = APIRouter()


@router.post('/internal/v1/preprocessing/jobs', status_code=202)
def accept_preprocessing_job(data: JobRequest, background: BackgroundTasks, x_internal_token: str = Header(default='')) -> None:
    """Content가 접수시킨 전처리 작업을 받아 응답 뒤에 실행한다. 단계·진행·실패는 Content 진행 API로 보고한다."""
    require_internal_token(x_internal_token)
    background.add_task(run_job, data)
