"""회귀 평가·누설 판정 내부 API(DEC-55). 평가는 Celery 태스크(큐 jobs)로 실행하고 결과는 Langfuse의 Run 점수로 남아 운영 서비스가 Langfuse에서 읽는다."""

import logging

from fastapi import APIRouter, Header, HTTPException

from app.evaluation import service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationAccepted, EvaluationRequest, LeakCheckRequest, LeakCheckResponse
from app.internal_auth import require_internal_token
from app.jobs.worker import run_evaluation

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/internal/v1/evaluations', status_code=202)
def start(data: EvaluationRequest, x_internal_token: str = Header(default='')) -> EvaluationAccepted:
    """평가 세트·프롬프트 버전을 확인하고 평가를 Celery 큐(jobs)에 올린다. 응답의 runName이 Langfuse Run 이름이다.

    큐에 올리지 못하면(브로커 연결·인증 실패 등) 202로 숨기지 않고 503이다. Run은 워커가 시작할 때 만들어지므로 남는 것이 없다.
    """
    require_internal_token(x_internal_token)
    try:
        plan = service.prepare(data)
    except EvaluationFailure as error:
        raise HTTPException(error.status, str(error)) from None
    try:
        run_evaluation.delay(service.to_job(plan))
    except Exception as error:  # 브로커 연결·인증 실패 등 큐에 올리지 못한 모든 경우
        logger.error('회귀 평가 %s 큐 발행 실패: %s', plan.run_name, type(error).__name__)  # 오류 메시지에 브로커 주소·자격이 섞일 수 있어 클래스만 남긴다
        raise HTTPException(503, '평가를 큐에 올리지 못했습니다.') from None
    return EvaluationAccepted(runName=plan.run_name)


@router.post('/internal/v1/evaluations/leak-check')
def leak_check(data: LeakCheckRequest, x_internal_token: str = Header(default='')) -> LeakCheckResponse:
    """응답이 비공개 참조(설정 카드·미발행 회차 제목)의 내용을 드러내는지 판정한다. 입력 본문은 로그·오류에 남기지 않는다."""
    require_internal_token(x_internal_token)
    try:
        return service.leak_check(data)
    except EvaluationFailure as error:
        raise HTTPException(error.status, str(error)) from None
