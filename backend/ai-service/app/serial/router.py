"""AI 자율 연재 내부 API(#659). 결과는 제안이고 저장·발행·과금 확정(settle)은 Content가 한다.

Content MCP는 쓰지 않는다. 사용자 토큰도 문맥·인가에는 쓰지 않으며, 시뮬레이션의 선택 X-User-Authorization만 추적의 회원 식별에 쓴다
(선택지 생성·회차 실행은 일정 점검이 불러 사용자 토큰이 없다).
"""

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from app import tracing
from app.internal_auth import require_internal_token
from app.serial import service
from app.serial.errors import SerialFailure
from app.serial.models import (ChoicesRequest, ChoicesResponse, EpisodeRequest, EpisodeResponse, SimulationRequest,
                               SimulationResponse)
from app.writing.errors import WritingFailure

router = APIRouter()


@router.post('/internal/v1/serial/choices', response_model=ChoicesResponse)
def choices(data: ChoicesRequest, x_internal_token: str = Header(default='')) -> ChoicesResponse | JSONResponse:
    """문맥·연재 방향으로 독자가 투표할 다음 전개 선택지 4개와 확정 크레딧을 돌려준다. 저장은 Content가 한다."""
    require_internal_token(x_internal_token)
    return _serve('serial.choices', service.choices, data)


@router.post('/internal/v1/serial/simulations', response_model=SimulationResponse)
def simulate(data: SimulationRequest, x_internal_token: str = Header(default=''),
             x_user_authorization: str = Header(default='')) -> SimulationResponse | JSONResponse:
    """독자에게 공개된 문맥(회차·카드)만으로 제안 글에 붙일 짧은 장면 미리보기와 확정 크레딧을 돌려준다.

    X-User-Authorization(선택)은 글을 쓴 회원을 추적에 남기는 회원 식별에만 쓴다.
    """
    require_internal_token(x_internal_token)
    return _serve('serial.simulation', service.simulate, data, tracing.member_id(x_user_authorization))


@router.post('/internal/v1/serial/episodes', response_model=EpisodeResponse)
def episode(data: EpisodeRequest, x_internal_token: str = Header(default='')) -> EpisodeResponse | JSONResponse:
    """1위 선택지·추천 상위 제안 글·연재 방향으로 다음 회차(제목·원고)와 종합·검수 결과·확정 크레딧을 돌려준다. 발행은 Content가 한다."""
    require_internal_token(x_internal_token)
    return _serve('serial.episode', service.episode, data)


def _serve(feature: str, call, data, user_id: str | None = None):
    """요청 하나를 trace 하나로 실행한다. 기능 실패는 고정 문구(detail) 응답이고, 상한 초과(402)·검수 실패(422)에는 Content가 구분할 code를 더한다."""
    try:
        with tracing.request(feature, user_id=user_id, work_id=data.workId, credit_reservation_id=data.creditReservationId):
            return call(data)
    except (SerialFailure, WritingFailure) as error:
        code = getattr(error, 'code', None)
        return JSONResponse({'detail': str(error), **({'code': code} if code else {})}, status_code=error.status)
