from types import SimpleNamespace
import pytest
from app.generation import router as ai


def test_provider_uses_server_key_and_returns_proposal(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-placeholder')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    calls = []
    class Client:
        def __init__(self, **kwargs):
            self.responses = self
        def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status='completed', output_text='새로운 문장', model='provider-resolved-model', id='resp-test', usage=SimpleNamespace(input_tokens=100,output_tokens=20))
        def close(self):
            pass
    monkeypatch.setattr(ai, 'OpenAI', Client)
    result = ai.generate({'title': '별', 'draft': '밤'}, '이어쓰기')
    assert result['text'] == '새로운 문장'
    assert result['model'] == 'provider-resolved-model'
    assert result['providerResponseId'] == 'resp-test'
    assert result['usage'] == {'inputTokens':100,'outputTokens':20}
    assert calls[0]['store'] is False
    assert calls[0]['model'] == 'gpt-6-luna'


def test_missing_key_is_explicit_failure(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with pytest.raises(ai.ProviderFailure):
        ai.generate({}, '이어쓰기')


@pytest.mark.integration
def test_internal_auth_and_limit(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    monkeypatch.setenv('INTERNAL_TOKEN', 'unit-token')
    with TestClient(create_app()) as client:
        assert client.post('/internal/v1/proposals', json={'context':{},'prompt':'continue'}).status_code == 403
        assert client.post('/internal/v1/proposals', headers={'X-Internal-Token':'unit-token'}, json={'context':{'draft':'x'*60001},'prompt':'continue'}).status_code == 422
