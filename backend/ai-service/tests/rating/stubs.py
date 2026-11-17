from contextlib import nullcontext
from types import SimpleNamespace
from typing import get_args

from app.rating import agent, service
from app.rating.models import Assessment, Criterion, RatingResult

WORK = 'work-1'
QUOTE = '그는 칼로 손가락을 하나씩 잘랐다.'


def result(level=0, quote=QUOTE, criterion='violence', prohibited=False):
    """모든 판별 항목을 평가한 응답. criterion 하나만 level이고 나머지는 0이다."""
    return RatingResult(prohibited=prohibited, assessments=[
        Assessment(criterion=c, level=level if c == criterion else 0,
                   quotes=[quote] if c == criterion and level else [], rationale='근거')
        for c in get_args(Criterion)])


def adult(**kwargs):
    return result(3, **kwargs)


def general():
    return result(0)


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
    """agent.rate 대역. 결과를 순서대로 돌려주고(예외면 던짐) 받은 초안 목록을 돌려준다."""
    drafts, queue = [], list(results)

    def rate(draft):
        drafts.append(draft)
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item, {'model': 'resolved-model', 'providerResponseId': f'resp-{len(drafts)}', 'usage': None}

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
