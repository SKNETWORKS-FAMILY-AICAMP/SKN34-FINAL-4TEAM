"""장면 에이전트의 콜백과 이벤트 리스너(#362).

`SceneEvents`(이벤트 리스너)는 미들웨어가 턴이 끝날 때 `adispatch_custom_event('scene', 단계 항목)`으로 낸 이벤트를 받아 LangGraph
custom stream으로 흘린다. 바깥 오케스트레이션이 그 chunk를 기존 SSE `step` 이벤트(누적 결과)로 중계해 무대가 실시간으로 그려진다.
`UsageCallback`(콜백)은 모델 호출마다 agent.py가 알린 `simulation.model` 이벤트와 도구 실패를 모아 턴이 끝날 때 호출별 토큰·지연·실패를
추적에 한 번 남긴다. 본문·키·설정 문서는 어느 쪽에도 담지 않는다.
"""

from langchain_core.callbacks import BaseCallbackHandler
from langgraph.config import get_stream_writer

from app import tracing


class SceneEvents(BaseCallbackHandler):
    """턴 이벤트('scene')를 받아 LangGraph custom stream으로 중계한다. 스트림이 아니면 쓰는 곳이 없어 아무 일도 하지 않는다."""

    def on_custom_event(self, name: str, data: dict, **kwargs) -> None:
        if name == 'scene':
            get_stream_writer()(data)


class UsageCallback(BaseCallbackHandler):
    """턴·모델 호출별 토큰 사용량·지연·실패를 추적에 남긴다. 호출은 턴이 끝나는 'scene' 이벤트에서 묶어 한 번에 기록한다."""

    def __init__(self, trace: dict | None = None):
        self.trace = trace  # 이 요청의 trace_context(tracing.context). 없으면 현재 문맥이 없어 추적 기록만 건너뛴다
        self.calls: list[dict] = []
        self.turns: list[dict] = []  # 지금까지 기록한 턴 요약(추적이 꺼져 있어도 남아 테스트·진단이 읽는다)

    def on_custom_event(self, name: str, data: dict, **kwargs) -> None:
        if name == 'simulation.model':
            self.calls.append(data)
        elif name == 'scene':
            self._flush(data['result'])

    def on_tool_error(self, error: BaseException, **kwargs) -> None:
        self.calls.append({'name': 'tool', 'ms': 0, 'failed': True, 'inputTokens': None, 'outputTokens': None})

    def _flush(self, result: dict) -> None:
        total = lambda key: sum(c[key] or 0 for c in self.calls)  # noqa: E731
        turn = {'turn': len(result['turns']), 'status': result['status'], 'modelCalls': len(self.calls),
                'failures': sum(c['failed'] for c in self.calls), 'ms': total('ms'),
                'inputTokens': total('inputTokens'), 'outputTokens': total('outputTokens'), 'calls': self.calls}
        self.turns.append(turn)
        self.calls = []
        span = tracing.client().start_observation(name='simulation.turn', as_type='span', trace_context=self.trace, metadata=turn)
        span.end()
