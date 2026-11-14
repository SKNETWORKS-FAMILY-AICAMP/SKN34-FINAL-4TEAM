"""Content MCP 전처리 도구 호출(작업 인증).

사용자 Bearer 대신 `X-Internal-Token`과 도구 인자 `jobId`로 호출하며, 그 작업이 진행 중인지·어느 회원의 권한으로
실행할지는 Content가 판단한다. 오류 메시지에는 원고·토큰·Content의 detail을 넣지 않고 고정 코드만 쓴다.
"""
import asyncio
import os

from pydantic import ValidationError

from app.preprocessing.errors import PreprocessingFailure
from app.preprocessing.models import EpisodeText, LoadPayload


def read_episode(job_id: str, number: int) -> EpisodeText:
    """그 회차의 최신 저장 버전(`{number, title, body}`)을 읽는다."""
    text = call('preprocessing_episode_read', {'jobId': job_id, 'number': number})
    try:
        return EpisodeText.model_validate_json(text)
    except ValidationError:
        raise PreprocessingFailure('CONTENT_INVALID_RESPONSE') from None


def progress(job_id: str, stage: str, done: int, total: int, failed_episodes=(), failed: str | None = None) -> None:
    """진행 상태를 갱신한다. `failed`(고정 사유 문구)를 주면 Content가 작업을 실패로 닫는다."""
    arguments = {'jobId': job_id, 'stage': stage, 'done': done, 'total': total, 'failedEpisodes': list(failed_episodes)}
    if failed is not None:
        arguments['failed'] = failed
    call('preprocessing_progress', arguments)


def load(job_id: str, payload: LoadPayload) -> None:
    """정리 결과를 세계관 초안에 적재한다. 같은 작업의 재호출은 Content가 멱등으로 처리한다."""
    call('preprocessing_load', {'jobId': job_id} | payload.model_dump(mode='json', exclude_none=True))


def call(tool: str, arguments: dict) -> str:
    """도구 하나를 호출하고 결과 텍스트를 돌려준다."""
    base, token = os.environ.get('CONTENT_SERVICE_BASE_URL'), os.environ.get('INTERNAL_TOKEN')
    if not base or not token:
        raise PreprocessingFailure('CONTENT_NOT_CONFIGURED', 503)
    try:
        is_error, text = asyncio.run(_request(f'{base.rstrip("/")}/mcp', token, tool, arguments))
    except Exception:  # 연결·프로토콜 오류. 예외 메시지에 원고·토큰이 섞일 수 있어 고정 코드만 쓴다.
        raise PreprocessingFailure('CONTENT_UNAVAILABLE', 503) from None
    if is_error:
        raise _failure(text)
    return text


async def _request(url: str, token: str, tool: str, arguments: dict) -> tuple[bool, str]:
    from agents.mcp import MCPServerStreamableHttp  # 접수 API 프로세스가 시작할 때 SDK를 읽지 않도록 호출 시점에 가져온다.
    async with MCPServerStreamableHttp({'url': url, 'headers': {'X-Internal-Token': token}, 'timeout': 60},
                                       client_session_timeout_seconds=120) as server:
        result = await server.call_tool(tool, arguments)
    return result.is_error, ''.join(getattr(block, 'text', '') for block in result.content)


def _failure(text: str) -> PreprocessingFailure:
    """도구 오류 텍스트의 첫 줄은 `HTTP <상태>[ <코드>]`다(content-mcp-contract.md 오류 형식). detail은 버린다."""
    parts = text.partition('\n')[0].split()
    if len(parts) > 1 and parts[0] == 'HTTP' and parts[1].isdigit():
        return PreprocessingFailure(f'CONTENT_HTTP_{parts[1]}')
    return PreprocessingFailure('CONTENT_ERROR')
