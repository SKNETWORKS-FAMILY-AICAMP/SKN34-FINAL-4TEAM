from itertools import count

import pytest
from langfuse import Langfuse
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app import tracing

_keys = count()


@pytest.fixture
def spans(monkeypatch):
    """Langfuse 추적을 켜되 메모리 exporter로만 내보낸다. 끝난 span 목록을 돌려주는 함수를 준다."""
    exporter = InMemorySpanExporter()
    # 같은 public key의 Langfuse는 내부 자원을 공유하므로 테스트마다 키를 바꾼다.
    client = Langfuse(public_key=f'pk-test-{next(_keys)}', secret_key='sk-test', base_url='http://127.0.0.1:9',
                      span_exporter=exporter, tracer_provider=TracerProvider())
    monkeypatch.setattr(tracing, 'client', lambda: client)

    def finished():
        client.flush()
        return exporter.get_finished_spans()
    return finished
