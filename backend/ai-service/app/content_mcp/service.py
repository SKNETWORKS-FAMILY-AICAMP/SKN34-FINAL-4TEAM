"""Content MCP 창구(DEC-49) 클라이언트: 작가가 승인한 Writing 결과를 그 작가의 권한으로 회차 초안에 반영한다.

Stateless Streamable HTTP `{CONTENT_SERVICE_BASE_URL}/mcp`에 AI를 호출한 사용자의 Bearer를 그대로 보내고,
인가·revision 충돌 판단은 Content Service가 한다. 토큰은 요청마다 `AUTHORIZATION` 컨텍스트로만 받고
그래프 상태·체크포인트·추적에 넣지 않는다. 쓰기는 초안 수정(`episode_update_draft`)뿐이며 버전 저장·발행·삭제 도구는 부르지 않는다.
"""

import asyncio
import json
import os
from contextvars import ContextVar

from agents.mcp import MCPServerStreamableHttp
from pydantic import BaseModel, ConfigDict, ValidationError

from app.content_mcp.errors import ContentMcpFailure

AUTHORIZATION: ContextVar[str] = ContextVar('content_mcp_authorization', default='')
# Content가 사용자에게 보여 줄 detail로 거절하는 상태. 그 밖의 도구 오류는 502로 닫는다.
PASSED_STATUSES = {401, 403, 404, 409, 422}
SELECTION_CHANGED = '선택한 문장이 초안에서 바뀌었거나 여러 곳에 있어 반영하지 않았어요. 다시 요청해 주세요.'


class DraftRevision(BaseModel):
    model_config = ConfigDict(strict=True)
    revision: int


class Draft(DraftRevision):
    title: str
    body: str
    authorNote: str | None = None


class EpisodeReadResponse(BaseModel):
    draft: Draft


class EpisodeUpdateResponse(BaseModel):
    draft: DraftRevision


def apply_writing(work_id: str, number: int, result: dict) -> dict:
    """승인된 Text는 기존 초안 뒤에 잇고, Patch는 초안 안에 하나뿐인 선택 구간만 바꿔 저장한다."""
    try:
        draft = EpisodeReadResponse.model_validate(call('episode_read', {'id': work_id, 'number': number})).draft
    except ValidationError:
        raise ContentMcpFailure(502, 'Content 초안 응답을 확인할 수 없습니다.') from None
    if 'text' in result:
        # 기존 초안을 덮어써 작가 원고를 잃지 않도록 뒤에 잇는다.
        body = f"{draft.body}\n\n{result['text']}" if draft.body.strip() else result['text']
    elif draft.body.count(result['before']) == 1:
        body = draft.body.replace(result['before'], result['after'])
    else:
        raise ContentMcpFailure(409, SELECTION_CHANGED)
    saved = call('episode_update_draft', {'id': work_id, 'number': number, 'data': {
        'title': draft.title, 'body': body, 'revision': draft.revision, 'authorNote': draft.authorNote or ''}})
    try:
        revision = EpisodeUpdateResponse.model_validate(saved).draft.revision
    except ValidationError:
        raise ContentMcpFailure(502, 'Content 초안 저장 응답을 확인할 수 없습니다.') from None
    return {'episode': number, 'revision': revision}


def call(tool: str, arguments: dict) -> dict:
    """도구 하나를 호출하고 JSON 결과를 돌려준다. 도구 오류는 Content의 상태·detail을 유지한다."""
    base, authorization = os.environ.get('CONTENT_SERVICE_BASE_URL'), AUTHORIZATION.get()
    if not base:
        raise ContentMcpFailure(503, 'Content MCP 설정이 필요합니다.')
    if not authorization:
        raise ContentMcpFailure(401, '사용자 인증을 확인할 수 없어요. 다시 로그인한 뒤 승인해 주세요.')
    try:
        is_error, text = asyncio.run(_request(f'{base.rstrip("/")}/mcp', authorization, tool, arguments))
    except Exception:  # 연결·프로토콜 오류. 예외 메시지에 원고가 섞일 수 있어 고정 문구만 쓴다.
        raise ContentMcpFailure(503, 'Content MCP를 호출할 수 없습니다.') from None
    if is_error:
        raise _failure(text)
    try:
        return json.loads(text)
    except ValueError:
        raise ContentMcpFailure(502, 'Content MCP 결과를 확인할 수 없습니다.') from None


async def _request(url: str, authorization: str, tool: str, arguments: dict) -> tuple[bool, str]:
    async with MCPServerStreamableHttp({'url': url, 'headers': {'Authorization': authorization}, 'timeout': 20},
                                       client_session_timeout_seconds=20) as server:
        result = await server.call_tool(tool, arguments)
    return result.is_error, ''.join(getattr(block, 'text', '') for block in result.content)


def _failure(text: str) -> ContentMcpFailure:
    """도구 오류 텍스트는 첫 줄 `HTTP <상태>[ <코드>]`, 둘째 줄 detail이다(docs/design/content-mcp-contract.md 오류 형식)."""
    head, _, detail = text.partition('\n')
    parts = head.split()
    status = int(parts[1]) if len(parts) > 1 and parts[0] == 'HTTP' and parts[1].isdigit() else None
    if status not in PASSED_STATUSES:
        return ContentMcpFailure(502, 'Content 작업에 실패했습니다.')
    return ContentMcpFailure(status, detail.strip()[:200] or 'Content 작업을 완료할 수 없습니다.')
