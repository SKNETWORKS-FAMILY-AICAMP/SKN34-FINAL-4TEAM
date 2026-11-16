from contextlib import nullcontext
from types import SimpleNamespace

from app.research import agent

REAL = 'https://example.org/joseon-travel'


def search_call(status='completed', urls=(REAL,)):
    action = SimpleNamespace(type='search', sources=[SimpleNamespace(url=u) for u in urls])
    return SimpleNamespace(type='web_search_call', status=status, action=action)


def fake_openai(monkeypatch, output, parsed, status='completed'):
    """OpenAI Responses 대역. 호출 인자를 담은 dict를 돌려준다."""
    seen = {}
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')

    def parse(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(status=status, output=output, output_parsed=parsed)

    monkeypatch.setattr(agent, 'OpenAI', lambda **_: nullcontext(SimpleNamespace(responses=SimpleNamespace(parse=parse))))
    return seen
