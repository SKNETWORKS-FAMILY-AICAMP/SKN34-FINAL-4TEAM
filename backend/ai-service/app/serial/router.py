"""AI 자율 연재 내부 API(#659). 결과는 제안이고 저장·발행·과금 확정(settle)은 Content가 한다.

Content MCP는 쓰지 않는다. 사용자 토큰도 문맥·인가에는 쓰지 않으며, 시뮬레이션의 선택 X-User-Authorization만 추적의 회원 식별에 쓴다
(회차 실행은 일정으로도 돌아 사용자 토큰이 없다).
"""

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from app import tracing
from app.internal_auth import require_internal_token
from app.serial import service
from app.serial.errors import SerialFailure
from app.serial.models import EpisodeRequest, EpisodeResponse, SimulationRequest, SimulationResponse
from app.writing.errors import WritingFailure

router = APIRouter()


@router.post('/internal/v1/serial/simulations', response_model=SimulationResponse)
def simulate(data: SimulationRequest, x_internal_token: str = Header(default=''),
             x_user_authorization: str = Header(default='')) -> SimulationResponse | JSONResponse:
    """독자에게 공개된 문맥(회차·카드)만으로 의견에 붙일 짧은 장면 미리보기와 확정 크레딧을 돌려준다.

    X-User-Authorization(선택)은 의견을 낸 회원을 추적에 남기는 회원 식별에만 쓴다.
    """
    require_internal_token(x_internal_token)
    try:
        with tracing.request('serial.simulation', user_id=tracing.member_id(x_user_authorization), work_id=data.workId,
                             credit_reservation_id=data.creditReservationId):
            return service.simulate(data)
    except (SerialFailure, WritingFailure) as error:
        return _failure(error)


@router.post('/internal/v1/serial/episodes', response_model=EpisodeResponse)
def episode(data: EpisodeRequest, x_internal_token: str = Header(default='')) -> EpisodeResponse | JSONResponse:
    """득표 상위 의견과 연재 방향으로 다음 회차(제목·원고)와 의견 종합·검수 결과·확정 크레딧을 돌려준다. 발행은 Content가 한다."""
    require_internal_token(x_internal_token)
    try:
        with tracing.request('serial.episode', work_id=data.workId, credit_reservation_id=data.creditReservationId):
            return service.episode(data)
    except (SerialFailure, WritingFailure) as error:
        return _failure(error)


def _failure(error: SerialFailure | WritingFailure) -> JSONResponse:
    """고정 문구 오류(detail). 상한 초과(402)·검수 실패(422)에는 Content가 구분할 code를 더한다."""
    code = getattr(error, 'code', None)
    return JSONResponse({'detail': str(error), **({'code': code} if code else {})}, status_code=error.status)
