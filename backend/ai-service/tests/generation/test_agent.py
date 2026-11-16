from types import SimpleNamespace

import pytest

from app.generation import agent
from app.generation.errors import ProviderFailure
from app.generation.models import Usage


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
