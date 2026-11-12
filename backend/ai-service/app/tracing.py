"""Langfuse 기반 집필 AI 추적(#302). 단계·근거 참조·판본·모델·사용량·실패 여부만 메타데이터로 보낸다.

원고·질문·답변 본문, 개인정보, 키는 어떤 속성에도 넣지 않는다(observation의 input/output을 쓰지 않는다).
예외는 span 밖으로 넘겨 예외 이벤트(메시지·입력값)가 기록되지 않게 하고, 기능 실패의 고정 메시지만 남긴다.
LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY가 없으면 추적을 끈다. 전송은 SDK가 백그라운드로 하므로
Langfuse 장애가 작업 결과를 바꾸지 않는다. 서버 주소는 SDK가 LANGFUSE_BASE_URL에서 읽는다.
"""

import os
from contextlib import contextmanager
from functools import lru_cache

from langfuse import Langfuse

_OFF = '0' * 32


@lru_cache(maxsize=1)
def client() -> Langfuse:
    enabled = bool(os.environ.get('LANGFUSE_PUBLIC_KEY') and os.environ.get('LANGFUSE_SECRET_KEY'))
    return Langfuse(tracing_enabled=enabled, timeout=2)


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


def start_run(name: str, **fields) -> tuple[str | None, str | None]:
    """한 작업의 root observation을 열고 바로 닫는다. 단계는 (trace id, root id)로 나중 요청에서도 붙인다."""
    span = client().start_observation(name=name, **fields)
    span.end()
    return (None, None) if span.trace_id == _OFF else (span.trace_id, span.id)


def context(run_id: str | None, parent_id: str | None) -> dict | None:
    """저장해 둔 작업 trace에 하위 observation을 붙이는 trace_context. 추적이 꺼져 있으면 None."""
    return {'trace_id': run_id, 'parent_span_id': parent_id} if run_id else None
