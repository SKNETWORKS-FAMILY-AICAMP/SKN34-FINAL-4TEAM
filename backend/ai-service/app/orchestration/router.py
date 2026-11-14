"""집필 AI 오케스트레이션 내부 API. 결과는 Agent별 제안이며 저장·승인은 Content가 한다."""

from collections.abc import AsyncIterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent

from app.intent.errors import IntentFailure
from app.internal_auth import require_internal_token
from app.orchestration import service
from app.orchestration.models import ChatHistory, ChatSession, OrchestrationRequest, OrchestrationResponse, RenameRequest

router = APIRouter()


@router.post('/internal/v1/orchestrations')
async def orchestrate(data: OrchestrationRequest, x_internal_token: str = Header(default=''),
                      x_user_authorization: str = Header(default='')) -> OrchestrationResponse:
    """자유 입력 또는 UI 선택 기능을 Router로 계획하고, 검증을 통과하면 구현된 Agent를 계획 순서로 실행한다.

    대화에서 입력이 빠지거나 Writing 결과·시뮬레이션 장면 반영 승인이 필요하면 waiting으로 멈추고, 같은 conversation의 resume으로 이어간다.
    X-User-Authorization은 Content가 전달한 작가의 Bearer이며 승인된 반영의 Content MCP 호출에만 쓴다.
    """
    require_internal_token(x_internal_token)
    try:
        return await service.run(data, x_user_authorization)
    except IntentFailure:
        raise HTTPException(503, service.ROUTER_FAILED_MESSAGE) from None
    except service.ConversationUnavailable:
        raise HTTPException(503, service.CONVERSATION_UNAVAILABLE_MESSAGE) from None
    except service.ConversationMismatch:
        raise HTTPException(409, service.CONVERSATION_MISMATCH_MESSAGE) from None
    except service.NothingToResume:
        raise HTTPException(409, service.NOTHING_TO_RESUME_MESSAGE) from None
    except service.ConversationNotFound:
        raise HTTPException(404, service.CONVERSATION_NOT_FOUND_MESSAGE) from None


def internal_token(x_internal_token: str = Header(default='')) -> None:
    """스트림은 응답 헤더 전에 막아야 하므로 내부 인증을 의존성으로 먼저 검사한다."""
    require_internal_token(x_internal_token)


@router.post('/internal/v1/orchestrations/stream', response_class=EventSourceResponse,
             dependencies=[Depends(internal_token)])
async def orchestrate_stream(data: OrchestrationRequest,
                             x_user_authorization: str = Header(default='')) -> AsyncIterator[ServerSentEvent]:
    """같은 실행을 SSE로 흘린다: plan, 단계마다 started·step(시뮬레이션은 턴마다 step), 멈추면 waiting, 마지막 done(실패 시 error)."""
    async for event in service.stream(data, x_user_authorization):
        yield event


# 대화 세션 CRUD(#331). scope는 Content가 확인한 사용자·작품이며 다른 scope의 대화는 404다.
@contextmanager
def _session_errors(token: str):
    require_internal_token(token)
    try:
        yield
    except service.ConversationNotFound:
        raise HTTPException(404, service.CONVERSATION_NOT_FOUND_MESSAGE) from None
    except service.ConversationBusy:
        raise HTTPException(409, service.CONVERSATION_BUSY_MESSAGE) from None
    except service.ConversationUnavailable:
        raise HTTPException(503, service.CONVERSATION_UNAVAILABLE_MESSAGE) from None


@router.get('/internal/v1/conversations')
async def list_sessions(scope: str, x_internal_token: str = Header(default='')) -> list[ChatSession]:
    """scope의 대화 목록을 최근 순으로 돌려준다."""
    with _session_errors(x_internal_token):
        return await service.sessions(scope)


@router.get('/internal/v1/conversations/{thread_id}')
async def read_session(thread_id: str, scope: str, x_internal_token: str = Header(default='')) -> ChatHistory:
    """대화 제목과 턴별 요청·응답. 멈춘 턴은 waiting 응답으로 마지막에 있다."""
    with _session_errors(x_internal_token):
        return await service.history(thread_id, scope)


@router.patch('/internal/v1/conversations/{thread_id}', status_code=204)
async def rename_session(thread_id: str, data: RenameRequest, x_internal_token: str = Header(default='')) -> None:
    """제목을 바꾼다. 승인·입력을 기다리는 중이면 409다."""
    with _session_errors(x_internal_token):
        await service.rename(thread_id, data.scope, data.title)


@router.delete('/internal/v1/conversations/{thread_id}', status_code=204)
async def delete_session(thread_id: str, scope: str, x_internal_token: str = Header(default='')) -> None:
    """대화의 checkpoint를 모두 지운다."""
    with _session_errors(x_internal_token):
        await service.delete(thread_id, scope)


@router.delete('/internal/v1/conversations/{thread_id}/turns/{index}', status_code=204)
async def truncate_session(thread_id: str, index: int, scope: str, x_internal_token: str = Header(default='')) -> None:
    """index번 턴과 그 뒤 대화를 지운다. 수정은 stream의 fromTurn으로 한다."""
    with _session_errors(x_internal_token):
        await service.truncate(thread_id, scope, index)
