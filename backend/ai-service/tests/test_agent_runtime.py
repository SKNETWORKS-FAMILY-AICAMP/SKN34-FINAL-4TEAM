import json

import pytest
from openai import OpenAIError
from pydantic import BaseModel, ConfigDict

from app import agent_runtime

from fake_chat import fake_chat


class Answer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str


class Failure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def run(**kwargs):
    return agent_runtime.run('test.generation', '테스트', Failure, 'INSTRUCTIONS', {'question': '서윤은 누구?'},
                             max_tokens=100, timeout=7, trace={'question': '서윤은 누구?'}, **kwargs)


def test_run_calls_the_model_once_through_create_agent_with_structured_output(monkeypatch):
    seen = fake_chat(monkeypatch, text='{"text": "주인공"}')

    message, parsed = run(schema=Answer)

    assert parsed == Answer(text='주인공')
    assert seen['init'] == {'model': 'test-model', 'api_key': 'test-key', 'use_responses_api': True, 'store': False,
                            'max_tokens': 100, 'timeout': 7, 'max_retries': 0, 'include': None}
    assert seen['response_format']['json_schema']['strict'] is True
    system, human = seen['messages']
    assert system.content == 'INSTRUCTIONS' and json.loads(human.content) == {'question': '서윤은 누구?'}
    assert message.response_metadata['id'] == 'resp-1'


def test_text_run_returns_the_message_without_structured_output(monkeypatch):
    seen = fake_chat(monkeypatch, text='새 원고')

    message, parsed = run()

    assert parsed is None and message.text == '새 원고' and 'response_format' not in seen


def test_web_search_forces_the_built_in_tool_and_asks_for_sources(monkeypatch):
    seen = fake_chat(monkeypatch, text='{"text": "확인"}')

    run(schema=Answer, web_search=True)

    assert seen['tools'] == [{'type': 'web_search'}] and seen['tool_choice'] == 'required'
    assert seen['init']['include'] == ['web_search_call.action.sources']


def test_model_call_is_traced_with_model_usage_and_output(monkeypatch, spans):
    fake_chat(monkeypatch, text='{"text": "주인공"}')

    run(schema=Answer)

    [span] = [s for s in spans() if s.name == 'test.generation']
    assert json.loads(span.attributes['langfuse.observation.input']) == {'question': '서윤은 누구?'}
    assert json.loads(span.attributes['langfuse.observation.output']) == {'text': '주인공'}
    assert span.attributes['langfuse.observation.model.name'] == 'resolved-model'
    assert span.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 5}'


def test_usage_meta_is_the_feature_response_shape(monkeypatch):
    fake_chat(monkeypatch, text='새 원고')
    message, _ = run()
    assert agent_runtime.meta(message) == {'model': 'resolved-model', 'providerResponseId': 'resp-1',
                                           'usage': {'inputTokens': 10, 'outputTokens': 5}}


def test_missing_model_settings_is_503_before_building_a_model(monkeypatch):
    seen = fake_chat(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(Failure) as error:
        run()
    assert (error.value.status, str(error.value)) == (503, '테스트 모델 설정이 필요합니다.') and 'init' not in seen


@pytest.mark.parametrize('kwargs, code, message', [
    ({'error': OpenAIError('down')}, 503, '테스트 모델 호출에 실패했습니다.'),
    ({'text': '{"wrong": 1}'}, 502, '테스트 모델 응답을 확인할 수 없습니다.'),
    ({'text': '{"text": "잘린"}', 'status': 'incomplete'}, 502, '테스트 모델 응답을 확인할 수 없습니다.'),
])
def test_provider_failure_and_unreadable_or_cut_output_are_fixed_failures(monkeypatch, spans, kwargs, code, message):
    fake_chat(monkeypatch, **kwargs)
    with pytest.raises(Failure) as error:
        run(schema=Answer)
    assert (error.value.status, str(error.value)) == (code, message)
    [span] = [s for s in spans() if s.name == 'test.generation']
    assert span.attributes['langfuse.observation.level'] == 'ERROR'


def test_failed_response_error_is_a_fixed_502(monkeypatch):
    # langchain-openai는 Responses 응답에 error가 있으면 ValueError를 올린다.
    fake_chat(monkeypatch, error=ValueError('response error'))
    with pytest.raises(Failure) as error:
        run(schema=Answer)
    assert (error.value.status, str(error.value)) == (502, '테스트 모델 응답을 확인할 수 없습니다.')


def test_agent_inside_an_orchestration_node_does_not_write_the_outer_checkpointer(monkeypatch):
    from typing import TypedDict

    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph

    class State(TypedDict):
        out: str

    fake_chat(monkeypatch, text='{"text": "주인공"}')
    saver = InMemorySaver()
    graph = StateGraph(State)
    graph.add_node('step', lambda _: {'out': run(schema=Answer)[1].text})
    graph.add_edge(START, 'step')
    graph.add_edge('step', END)

    assert graph.compile(checkpointer=saver).invoke({'out': ''}, {'configurable': {'thread_id': 't'}}) == {'out': '주인공'}
    # 안쪽 Agent의 메시지(원고·허용 문맥 입력)를 대화 체크포인트에 남기지 않는다.
    assert {c.config['configurable']['checkpoint_ns'] for c in saver.list(None)} == {''}


def test_generation_stays_under_the_callers_observation(monkeypatch, spans):
    from app import tracing
    fake_chat(monkeypatch, text='{"text": "주인공"}')
    with tracing.observe('story_context.qa', as_type='chain'):
        run(schema=Answer)
    generation, parent = spans()
    assert (generation.name, parent.name) == ('test.generation', 'story_context.qa')
    assert generation.parent.span_id == parent.context.span_id


def test_progress_middleware_streams_a_step_left_in_state_once_and_clears_it(monkeypatch):
    import asyncio

    from langchain.agents import create_agent
    from langchain.agents.middleware import AgentMiddleware

    from fake_chat import FakeChat
    from langchain_core.messages import AIMessage, HumanMessage

    class Finisher(AgentMiddleware):
        state_schema = agent_runtime.StepState

        async def aafter_model(self, state, runtime):
            return {'step': {'feature': 'x', 'status': 'completed'}}

    model = FakeChat(seen={}, reply=AIMessage(content='끝', response_metadata={'status': 'completed'}), model_name='m')
    agent = create_agent(model, middleware=[agent_runtime.ProgressMiddleware(), Finisher()], checkpointer=False)

    async def collect():
        return [c async for c in agent.astream({'messages': [HumanMessage('시작')]}, stream_mode=['custom', 'values'])]

    chunks = asyncio.run(collect())
    assert [c for mode, c in chunks if mode == 'custom'] == [{'feature': 'x', 'status': 'completed'}]
    assert [c for mode, c in chunks if mode == 'values'][-1].get('step') is None


def test_usage_ledger_closes_the_model_calls_of_each_step_in_one_span(spans):
    from app import tracing
    ledger = agent_runtime.UsageLedger('test.turn', lambda step: {'turn': step['n']},
                                       trace=tracing.context(*tracing.start_run('run', as_type='chain')))
    call = {'name': 'act', 'ms': 5, 'failed': False, 'inputTokens': 10, 'outputTokens': 4}
    ledger.on_custom_event(agent_runtime.MODEL_EVENT, call)
    ledger.on_tool_error(RuntimeError('x'))
    ledger.on_custom_event(agent_runtime.STEP_EVENT, {'n': 1})
    ledger.on_custom_event(agent_runtime.STEP_EVENT, {'n': 2})
    first, second = ledger.records
    assert (first['turn'], first['modelCalls'], first['failures'], first['inputTokens'], first['ms']) == (1, 2, 1, 10, 5)
    assert second['modelCalls'] == 0 and ledger.calls == []
    assert len([s for s in spans() if s.name == 'test.turn']) == 2


def test_a_step_from_an_agent_inside_an_orchestration_node_reaches_the_outer_custom_stream():
    import asyncio
    from typing import TypedDict

    from langchain.agents import create_agent
    from langchain.agents.middleware import AgentMiddleware
    from langchain_core.messages import AIMessage, HumanMessage
    from langgraph.graph import END, START, StateGraph

    from fake_chat import FakeChat

    class Finisher(AgentMiddleware):
        state_schema = agent_runtime.StepState

        async def aafter_model(self, state, runtime):
            return {'step': {'feature': 'character_simulation'}}

    inner = create_agent(FakeChat(seen={}, reply=AIMessage(content='끝'), model_name='m'),
                         middleware=[agent_runtime.ProgressMiddleware(), Finisher()])

    class State(TypedDict):
        done: bool

    async def node(state, config):
        await inner.ainvoke({'messages': [HumanMessage('시작')]}, config)
        return {'done': True}

    graph = StateGraph(State)
    graph.add_node('step', node)
    graph.add_edge(START, 'step')
    graph.add_edge('step', END)

    async def collect():
        # 바깥 오케스트레이션(orchestrate_stream)과 같은 스트림 설정
        return [(mode, data) async for _, mode, data in graph.compile().astream({'done': False}, stream_mode=['updates', 'custom'], subgraphs=True)]

    assert ('custom', {'feature': 'character_simulation'}) in asyncio.run(collect())
