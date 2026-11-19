"""Langfuse 기반 집필 AI 추적(#302). 단계·근거 참조·판본·모델·사용량·실패 여부와 허용된 본문을 보낸다.

팀 결정(2026-11-13)으로 질문·원고·답변 본문은 observation의 input/output에 남긴다. 결정 범위 밖인 설정·현재 관계
발췌 본문은 참조(id·회차·종류)만 남기고(`excerpts`), 키·회원 계정 정보는 어떤 속성에도 넣지 않는다.
예외는 span 밖으로 넘겨 예외 이벤트(메시지·입력값)가 기록되지 않게 하고, 기능 실패의 고정 메시지만 남긴다.
LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY가 없으면 추적과 프롬프트 관리를 끈다. 전송은 SDK가 백그라운드로 하므로
Langfuse 장애가 작업 결과를 바꾸지 않는다(프롬프트를 읽지 못해 기능이 실패하는 경우만 예외다). 서버 주소는 SDK가 LANGFUSE_BASE_URL에서 읽는다.

DEC-55 계측 규칙: AI 요청 하나가 trace 하나다. `request`가 요청 루트를 열어 회원(trace user_id=회원 UUID)·세션·기능 태그·metadata를
이 안의 모든 observation에 붙이고, 끝나면 상태 태그(success·failed·timeout)를 루트에 더한다. 지시문은 `prompt`가
Langfuse Prompt Management의 production 버전을 읽어 주고(코드 문자열은 최초 등록용), generation에 연결한다.
"""

import base64
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from uuid import UUID, uuid4

from langfuse import Langfuse, propagate_attributes
from langfuse.api import NotFoundError

_OFF = '0' * 32


def enabled() -> bool:
    """LANGFUSE 키가 둘 다 있을 때만 추적과 프롬프트 관리를 켠다."""
    return bool(os.environ.get('LANGFUSE_PUBLIC_KEY') and os.environ.get('LANGFUSE_SECRET_KEY'))


@lru_cache(maxsize=1)
def client() -> Langfuse:
    return Langfuse(tracing_enabled=enabled(), timeout=2)


@contextmanager
def observe(name: str, **fields):
    """현재 문맥의 하위 observation. 실패하면 level=ERROR와 안전한 메시지를 남기고 예외를 그대로 올린다."""
    error = None
    with client().start_as_current_observation(name=name, **fields) as span:
        try:
            yield span
        except Exception as exc:  # span 밖에서 다시 올린다.
            error = exc
            # 기능 실패(status가 있는 예외)의 메시지는 고정 문구다. 그 밖의 예외는 입력값을 담을 수 있어 이름만 남긴다.
            span.update(level='ERROR', status_message=str(exc) if hasattr(exc, 'status') else type(exc).__name__)
    if error is not None:
        raise error


def excerpts(items) -> list[dict]:
    """근거 발췌의 추적용 표현. 원고(manuscript) 인용만 본문을 담고 설정·현재 관계는 참조만 남긴다."""
    return [{'id': e.id, 'episode': e.episode, 'kind': e.kind, **({'quote': e.quote} if e.kind == 'manuscript' else {})}
            for e in items]


def start_run(name: str, **fields) -> tuple[str | None, str | None]:
    """한 작업의 root observation을 열고 바로 닫는다. 단계는 (trace id, root id)로 나중 요청에서도 붙인다."""
    span = client().start_observation(name=name, **fields)
    span.end()
    return (None, None) if span.trace_id == _OFF else (span.trace_id, span.id)


def context(run_id: str | None, parent_id: str | None) -> dict | None:
    """저장해 둔 작업 trace에 하위 observation을 붙이는 trace_context. 추적이 꺼져 있으면 None."""
    return {'trace_id': run_id, 'parent_span_id': parent_id} if run_id else None



class Run:
    """request가 내주는 요청 결과. status는 예외 없이 끝난 요청의 결과이며 응답을 보고 바꿀 수 있다(None이면 상태 태그를 남기지 않는다)."""
    status: str | None = 'success'


def timed_out(error: BaseException | None) -> bool:
    """예외 사슬(__cause__·__context__)에 시간 초과가 있는지. 기능이 `from None`으로 고정 문구 실패로 바꿔도 __context__는 남는다.

    제공사·HTTP 라이브러리마다 시간 초과 예외 클래스가 달라(openai APITimeoutError, httpx·httpx2 TimeoutException, TimeoutError) 이름으로 본다.
    """
    while error is not None:
        if any('Timeout' in cls.__name__ for cls in type(error).__mro__):
            return True
        error = error.__cause__ or error.__context__
    return False


@contextmanager
def request(feature: str, *, user_id: str | None = None, session_id: str | None = None, trace_context: dict | None = None, **metadata):
    """AI 요청 하나 = trace 하나(DEC-55): 요청 루트 observation을 열고 회원·세션·기능 태그·metadata를 이 안의 모든 observation에 붙인다.

    끝나면 루트에 상태 태그를 더한다. 예외는 failed(시간 초과면 timeout)로 남기고 그대로 올린다. metadata는 문자열로 남고
    None·False는 뺀다(True는 'true'). trace_context를 주면 그 trace에 붙는다(대화에서 멈췄던 턴의 resume).
    """
    meta = {'request_id': uuid4().hex, **{k: 'true' if v is True else v for k, v in metadata.items() if v is not None and v is not False}}
    run = Run()
    with propagate_attributes(user_id=user_id, session_id=session_id, tags=[f'feature:{feature}'], metadata=meta):
        with observe(feature, trace_context=trace_context):
            try:
                yield run
            except Exception as error:
                run.status = 'timeout' if timed_out(error) else 'failed'
                raise
            finally:
                if run.status:
                    with propagate_attributes(tags=[f'status:{run.status}']):  # 현재 span(요청 루트)의 태그에 상태를 더한다
                        pass


def member_id(authorization: str) -> str | None:
    """Bearer 토큰(JWT)의 sub(회원 UUID). 서명은 검증하지 않는다: 추적 태그 전용이며 인가에 쓰지 않는다(Content MCP가 같은 토큰을 검증한다)."""
    try:
        payload = authorization.split('.')[1]
        return str(UUID(json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['sub']))
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        return None


class PromptUnavailable(Exception):
    """Langfuse 키가 있는데 프롬프트를 읽거나 등록할 수 없고 SDK 캐시에도 없다. 기능은 고정 문구의 503으로 끝낸다."""


@dataclass(frozen=True)
class Prompt:
    """text는 모델에 보낼 지시, client는 generation에 연결할 Langfuse 프롬프트(키가 없으면 None)."""
    text: str
    client: Any = None


def prompt(name: str, default: str) -> Prompt:
    """Langfuse Prompt Management의 production 버전 지시. 키가 없으면 코드 문자열(default)을 그대로 쓴다.

    없는 프롬프트(404)는 default를 버전 1(production)로 등록해 쓴다. 읽기에 실패하면 SDK가 캐시(마지막 성공 값)를 주고,
    캐시도 없으면 default로 바꾸지 않고 PromptUnavailable이다.
    ponytail: 서버가 막 뜬 직후 같은 프롬프트를 동시에 처음 쓰면 같은 내용의 버전이 둘 생길 수 있다. 문제 되면 시작 때 한 번 등록한다.
    """
    if not enabled():
        return Prompt(default)
    try:
        try:
            managed = client().get_prompt(name, label='production', cache_ttl_seconds=60)
        except NotFoundError:
            managed = client().create_prompt(name=name, prompt=default, labels=['production'], type='text')
    except Exception:
        raise PromptUnavailable from None
    return Prompt(managed.prompt, managed)
