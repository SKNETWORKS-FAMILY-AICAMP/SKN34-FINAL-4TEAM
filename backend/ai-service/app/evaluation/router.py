"""회귀 평가·누설 판정 내부 API(DEC-55). 평가 결과는 Langfuse의 Run 점수로 남고 운영 서비스가 Langfuse에서 읽는다."""

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from app.evaluation import service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationAccepted, EvaluationRequest, LeakCheckRequest, LeakCheckResponse
from app.internal_auth import require_internal_token

router = APIRouter()


@router.post('/internal/v1/evaluations', status_code=202)
def start(data: EvaluationRequest, background: BackgroundTasks, x_internal_token: str = Header(default='')) -> EvaluationAccepted:
    """평가 세트·프롬프트 버전을 확인하고 평가를 백그라운드로 시작한다. 응답의 runName이 Langfuse Run 이름이다."""
    require_internal_token(x_internal_token)
    try:
        plan = service.prepare(data)
    except EvaluationFailure as error:
        raise HTTPException(error.status, str(error)) from None
    background.add_task(service.run, plan)
    return EvaluationAccepted(runName=plan.run_name)


@router.post('/internal/v1/evaluations/leak-check')
def leak_check(data: LeakCheckRequest, x_internal_token: str = Header(default='')) -> LeakCheckResponse:
    """응답이 비공개 참조(설정 카드·미발행 회차 제목)의 내용을 드러내는지 판정한다. 입력 본문은 로그·오류에 남기지 않는다."""
    require_internal_token(x_internal_token)
    try:
        return service.leak_check(data)
    except EvaluationFailure as error:
        raise HTTPException(error.status, str(error)) from None
