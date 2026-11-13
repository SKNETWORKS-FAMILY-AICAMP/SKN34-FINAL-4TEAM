"""집필 AI 오케스트레이션 내부 API. 결과는 Agent별 제안이며 저장·승인은 Content가 한다."""

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent

from app.intent.errors import IntentFailure
from app.internal_auth import require_internal_token
from app.orchestration import service
from app.orchestration.models import OrchestrationRequest, OrchestrationResponse

router = APIRouter()


@router.post('/internal/v1/orchestrations')
async def orchestrate(data: OrchestrationRequest, x_internal_token: str = Header(default='')) -> OrchestrationResponse:
    """자유 입력 또는 UI 선택 기능을 Router로 계획하고, 검증을 통과하면 구현된 Agent를 계획 순서로 실행한다.

    대화에서 입력이 빠지면 waiting으로 멈추고, 같은 conversation의 resume으로 이어간다.
    """
    require_internal_token(x_internal_token)
    try:
        return await service.run(data)
    except IntentFailure:
        raise HTTPException(503, service.ROUTER_FAILED_MESSAGE) from None
    except service.ConversationUnavailable:
        raise HTTPException(503, service.CONVERSATION_UNAVAILABLE_MESSAGE) from None
    except service.ConversationMismatch:
        raise HTTPException(409, service.CONVERSATION_MISMATCH_MESSAGE) from None
    except service.NothingToResume:
        raise HTTPException(409, service.NOTHING_TO_RESUME_MESSAGE) from None


def internal_token(x_internal_token: str = Header(default='')) -> None:
    """스트림은 응답 헤더 전에 막아야 하므로 내부 인증을 의존성으로 먼저 검사한다."""
    require_internal_token(x_internal_token)


@router.post('/internal/v1/orchestrations/stream', response_class=EventSourceResponse,
             dependencies=[Depends(internal_token)])
async def orchestrate_stream(data: OrchestrationRequest) -> AsyncIterator[ServerSentEvent]:
    """같은 실행을 SSE로 흘린다: plan, 단계마다 started·step, 멈추면 waiting, 마지막 done(실패 시 error)."""
    async for event in service.stream(data):
        yield event
