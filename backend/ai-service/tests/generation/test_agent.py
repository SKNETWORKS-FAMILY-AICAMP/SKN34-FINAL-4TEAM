from types import SimpleNamespace

import pytest

from app import tracing
from app.generation import agent
from app.generation.errors import ProviderFailure
from app.generation.models import Usage
from app.generation.prompt import INSTRUCTIONS

from traced import attrs


def test_provider_uses_server_key_and_returns_proposal(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-placeholder')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    calls = []

    class Client:
        def __init__(self, **kwargs):
            self.responses = self

        def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status='completed', output_text='새로운 문장', model='provider-resolved-model',
                                   id='resp-test', usage=SimpleNamespace(input_tokens=100, output_tokens=20))

        def close(self):
            pass

    monkeypatch.setattr(agent, 'OpenAI', Client)
    result = agent.generate({'title': '별', 'draft': '밤'}, '이어쓰기')
    assert result.text == '새로운 문장'
    assert result.model == 'provider-resolved-model'
    assert result.providerResponseId == 'resp-test'
    assert result.usage == Usage(inputTokens=100, outputTokens=20)
    assert calls[0]['store'] is False
    assert calls[0]['model'] == 'test-model'


def test_missing_key_is_explicit_failure(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with pytest.raises(ProviderFailure):
        agent.generate({}, '이어쓰기')



def provider(monkeypatch, calls, status='completed'):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-placeholder')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')

    class Client:
        def __init__(self, **kwargs):
            self.responses = self

        def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status=status, output_text='새로운 문장', model='provider-resolved-model', id='resp-test',
                                   usage=SimpleNamespace(input_tokens=100, output_tokens=20))

        def close(self):
            pass

    monkeypatch.setattr(agent, 'OpenAI', Client)


def managed(monkeypatch, text='관리된 지시'):
    asked, version = [], SimpleNamespace(name='proposals.continue', version=2, is_fallback=False)
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: asked.append((name, default)) or tracing.Prompt(text, version))
    return asked


def test_the_model_call_is_a_generation_of_the_managed_prompt_without_any_text(monkeypatch, spans):
    calls = []
    provider(monkeypatch, calls)
    asked = managed(monkeypatch)

    agent.generate({'title': '별'}, '이어쓰기')

    assert asked == [('proposals.continue', INSTRUCTIONS)] and calls[0]['instructions'] == '관리된 지시'
    [span] = spans()
    found = attrs(span)
    assert span.name == 'proposals.generation' and found['langfuse.observation.type'] == 'generation'
    assert found['langfuse.observation.model.name'] == 'provider-resolved-model'
    assert found['langfuse.observation.usage_details'] == '{"input": 100, "output": 20}'
    assert (found['langfuse.observation.prompt.name'], found['langfuse.observation.prompt.version']) == ('proposals.continue', 2)
    assert 'langfuse.observation.input' not in found and 'langfuse.observation.output' not in found  # 문맥·요청·제안 본문은 남기지 않는다


def test_an_incomplete_model_call_is_an_error_generation(monkeypatch, spans):
    provider(monkeypatch, [], status='incomplete')
    with pytest.raises(ProviderFailure):
        agent.generate({}, '이어쓰기')
    [span] = spans()
    assert span.attributes['langfuse.observation.level'] == 'ERROR'


def test_an_unavailable_prompt_is_a_provider_failure_before_the_model_call(monkeypatch):
    calls = []
    provider(monkeypatch, calls)

    def unavailable(name, default):
        raise tracing.PromptUnavailable

    monkeypatch.setattr(tracing, 'prompt', unavailable)
    with pytest.raises(ProviderFailure):
        agent.generate({}, '이어쓰기')
    assert calls == []
