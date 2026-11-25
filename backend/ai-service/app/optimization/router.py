"""프롬프트 자동 개선 내부 API(#823). 접수만 하고 실행은 Celery 큐(jobs)의 ai-jobs-worker가 한다. 결과는 Langfuse의 새 버전·평가 Run·trace로 남는다."""

import logging

from fastapi import APIRouter, Header, HTTPException

from app.evaluation.errors import EvaluationFailure
from app.internal_auth import require_internal_token
from app.jobs.worker import run_optimization
from app.optimization import service
from app.optimization.errors import OptimizationFailure
from app.optimization.models import OptimizationAccepted, OptimizationRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/internal/v1/optimizations', status_code=202)
def start(data: OptimizationRequest, x_internal_token: str = Header(default='')) -> OptimizationAccepted:
    """자동 개선을 접수해 Celery 큐(jobs)에 올린다. 지원 대상이 아니면 422, 같은 프롬프트가 실행 중이면 409({"detail": …}), 큐에 올리지 못하면 503이다."""
    require_internal_token(x_internal_token)
    try:
        service.accept(data)
    except (OptimizationFailure, EvaluationFailure) as error:
        raise HTTPException(error.status, str(error)) from None
    try:
        run_optimization.delay(data.model_dump())
    except Exception as error:  # 브로커 연결·인증 실패 등 큐에 올리지 못한 모든 경우
        logger.error('프롬프트 자동 개선 %s v%s 큐 발행 실패: %s', data.prompt, data.version, type(error).__name__)  # 오류 메시지에 브로커 주소·자격이 섞일 수 있어 클래스만 남긴다
        raise HTTPException(503, '자동 개선을 큐에 올리지 못했습니다.') from None
    return OptimizationAccepted()
