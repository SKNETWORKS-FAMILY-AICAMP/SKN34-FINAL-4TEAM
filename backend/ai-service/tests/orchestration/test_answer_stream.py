"""답변 본문 스트리밍(#618). 실제 ChatOpenAI에 Responses API SSE만 대역으로 흘린다."""

import asyncio
import json

import httpx2
import pytest
from langchain_openai import ChatOpenAI

from app.orchestration import agent, service
from app.orchestration.models import OrchestrationRequest

from traced import attrs

from .stubs import QA, fake_agents, plan

REASONING = {'type': 'reasoning', 'id': 'rs_1', 'summary': []}


def sent(kind, **data):
    return f'event: {kind}\ndata: {json.dumps({"type": kind, "sequence_number": 0, **data}, ensure_ascii=False)}\n\n'.encode()


def response(status='completed', error=None, name='resp_1'):
    return {'id': name, 'object': 'response', 'created_at': 1, 'model': 'test-model', 'status': status, 'error': error,
            'output': [], 'tools': [], 'tool_choice': 'auto', 'parallel_tool_calls': True,
            'usage': {'input_tokens': 20, 'output_tokens': 5, 'total_tokens': 25,
                      'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0}}}


def written(*parts, name='resp_1'):
    return [sent('response.created', response=response('in_progress', name=name)),
            sent('response.output_item.added', output_index=0, item=REASONING),
            *(sent('response.output_text.delta', output_index=1, content_index=0, item_id='msg_1', delta=p, logprobs=[]) for p in parts)]


def asked(*parts):
    call = {'type': 'function_call', 'id': 'fc_1', 'call_id': 'call_1', 'name': 'ask_story_qa', 'arguments': '', 'status': 'in_progress'}
    return [*written(*parts),
            sent('response.output_item.added', output_index=2, item=call),
            sent('response.function_call_arguments.delta', output_index=2, item_id='fc_1', delta='{"request":'),
            sent('response.function_call_arguments.delta', output_index=2, item_id='fc_1', delta='"길드 규칙"}'),
            sent('response.completed', response=response())]


def openai(monkeypatch, *replies):
    """모델 호출마다 replies를 차례로 흘린다. 조각 자리에 예외가 있으면 흐르던 중에 올린다. 보낸 요청 본문 목록을 돌려준다."""
    bodies = []

    def serve(request):
        bodies.append(json.loads(request.content))

        async def body(pieces=replies[len(bodies) - 1]):
            for piece in pieces:
                if isinstance(piece, Exception):
                    raise piece
                yield piece

        return httpx2.Response(200, headers={'content-type': 'text/event-stream'}, content=body())

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(serve))
    monkeypatch.setattr(agent, 'ChatOpenAI', lambda **kwargs: ChatOpenAI(**kwargs, http_async_client=client))
    return bodies


def stream():
    async def collect():
        data = OrchestrationRequest(request='길드 규칙은?', inputs={'story_context': QA})
        return [(e.event, e.data) async for e in service.stream(data) if e.event != 'activity']  # 진행 목록(#784)은 test_service가 본다
    return asyncio.run(collect())


def test_answer_deltas_replace_the_remark_made_before_a_tool_call(monkeypatch, spans):
    fake_agents(monkeypatch, plan('story_context'))
    bodies = openai(monkeypatch, asked('확인해 ', '볼게요.'),
                    [*written('길드는 ', '밤에 ', '닫아요.', name='resp_2'), sent('response.completed', response=response(name='resp_2'))])

    events = stream()

    assert [(name, data.get('delta')) for name, data in events] == [
        ('plan', None),
        ('answer', None), ('answer', '확인해 '), ('answer', '볼게요.'), ('answer', None),  # 도구 호출이 시작되면 비운다
        ('started', None), ('step', None),
        ('answer', None), ('answer', '길드는 '), ('answer', '밤에 '), ('answer', '닫아요.'),
        ('done', None)]
    done = events[-1][1]
    assert (done['status'], done['message']) == ('completed', '길드는 밤에 닫아요.')
    assert all(body['stream'] for body in bodies)
    replayed = bodies[1]['input']  # 스트림으로 모은 응답도 저장 없이(store=False) 다음 호출에 다시 보낼 수 있다
    [call] = [item for item in replayed if item.get('type') == 'function_call']
    assert json.loads(call['arguments']) == {'request': '길드 규칙'} and 'index' not in call
    assert not any(item.get('type') == 'reasoning' for item in replayed)
    generations = [attrs(span) for span in spans() if span.name == 'main_agent']
    assert len(generations) == 2  # 스트림에서도 비용 집계용 모델·사용량이 남는다(DEC-55)
    for generation in generations:
        assert generation['langfuse.observation.model.name'] == 'test-model'
        assert json.loads(generation['langfuse.observation.usage_details']) == {'input': 20, 'output': 5}


@pytest.mark.parametrize('ending', [
    [httpx2.RemoteProtocolError('peer closed')],
    [httpx2.ReadTimeout('read timed out')],
    [TimeoutError('no chunk')],
    [sent('response.incomplete', response=response('incomplete'))],
    [sent('response.failed', response=response('failed', error={'code': 'server_error', 'message': 'provider detail'}))],
    [],  # 완료 이벤트 없이 닫힘
], ids=['disconnected', 'read-timeout', 'chunk-timeout', 'incomplete', 'failed', 'no-completion'])
def test_a_broken_answer_ends_failed_with_the_fixed_message(monkeypatch, ending):
    fake_agents(monkeypatch, plan(status='clarify'))
    openai(monkeypatch, [*written('쓰다 만 '), *ending])

    events = stream()

    assert ('answer', {'delta': '쓰다 만 '}) in events
    assert events[-2] == ('answer', {'delta': None})  # 쓰다 만 글은 어떤 상태로 끝나든(승인 대기 포함) 비운다
    name, done = events[-1]
    assert (name, done['status'], done['message']) == ('done', 'failed', agent.MAIN_FAILED_NOTHING_MESSAGE)


def test_a_failure_after_a_tool_keeps_the_finished_step(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'))
    openai(monkeypatch, asked(), [*written('길드는 ', name='resp_2'), httpx2.RemoteProtocolError('peer closed')])

    name, done = stream()[-1]

    assert (name, done['status'], done['message']) == ('done', 'failed', agent.MAIN_FAILED_MESSAGE)
    assert [step['status'] for step in done['steps']] == ['completed']
