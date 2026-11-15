from contextlib import nullcontext
from types import SimpleNamespace

from app.rating import agent, service
from app.rating.models import RatingResult, Reason

WORK = 'work-1'


def adult(quote='그는 칼로 손가락을 하나씩 잘랐다.', criterion='violence'):
    return RatingResult(adult=True, reasons=[Reason(criterion=criterion, quote=quote, explanation='잔혹한 신체 훼손 묘사')])


def general():
    return RatingResult(adult=False, reasons=[])


def fake_content(monkeypatch, bodies=None):
    """Content MCP 대역. bodies는 회차 번호 → 초안 본문이며 호출한 도구·인자 목록을 돌려준다."""
    bodies = bodies or {1: '비가 왔다.', 2: '비명이 울렸다. 그는 칼로 손가락을 하나씩 잘랐다.'}
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        assert tool == 'episode_read'
        return {'draft': {'title': f"{arguments['number']}화", 'body': bodies[arguments['number']], 'revision': 7, 'authorNote': None}}

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


def fake_agent(monkeypatch, *results):
    """agent.rate 대역. 결과를 순서대로 돌려주고 받은 초안 목록을 돌려준다."""
    drafts, queue = [], list(results)

    def rate(draft):
        drafts.append(draft)
        return queue.pop(0), {'model': 'resolved-model', 'providerResponseId': f'resp-{len(drafts)}', 'usage': None}

    monkeypatch.setattr(service.agent, 'rate', rate)
    return drafts


def fake_openai(monkeypatch, parsed=None, status='completed', error=None):
    """OpenAI Responses 대역. 호출 인자를 담은 dict를 돌려준다."""
    seen = {}
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')

    def parse(**kwargs):
        seen.update(kwargs)
        if error:
            raise error
        return SimpleNamespace(status=status, output_parsed=parsed, model='resolved-model', id='resp-1',
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(agent, 'OpenAI', lambda **_: nullcontext(SimpleNamespace(responses=SimpleNamespace(parse=parse))))
    return seen
