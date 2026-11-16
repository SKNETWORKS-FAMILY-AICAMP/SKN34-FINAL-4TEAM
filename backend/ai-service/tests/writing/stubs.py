from contextlib import nullcontext
from types import SimpleNamespace

from app.writing import agent


def fake_openai(monkeypatch, text='새 문장', status='completed', error=None):
    """OpenAI Responses 대역. 호출 인자를 담은 dict를 돌려준다."""
    seen = {}
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')

    def create(**kwargs):
        seen.update(kwargs)
        if error:
            raise error
        return SimpleNamespace(status=status, output_text=text, model='resolved-model', id='resp-1',
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(agent, 'OpenAI', lambda **_: nullcontext(SimpleNamespace(responses=SimpleNamespace(create=create))))
    return seen
