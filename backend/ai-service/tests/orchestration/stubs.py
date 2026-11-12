from datetime import datetime, timezone

from app.intent.models import IntentResult, IntentStep
from app.manuscript.models import AnswerResponse, Claim
from app.orchestration import service
from app.research.models import Finding, ResearchResponse
from app.writing.models import DraftResponse, PatchResponse

QA = {'question': '길드 규칙은?', 'excerpts': [{'id': 'a', 'episode': 4, 'quote': '길드는 밤에 문을 닫는다.'}]}
DRAFT = {'draft': {'episodeNumber': 11, 'plan': '선장이 항구에 도착한다.'}}
PATCH = {'patch': {'selection': '그는 웃었다.', 'instruction': '더 차갑게'}}
WEB = {'question': '조선 후기 한양에서 동래까지 며칠?'}


def plan(*steps, status='route', **extra):
    """Intent Router 결과 대역. steps는 feature 또는 (feature, when)."""
    items = [IntentStep(feature=s, when='always') if isinstance(s, str) else IntentStep(feature=s[0], when=s[1])
             for s in steps]
    return IntentResult(status=status, steps=items, **extra)


def fake_agents(monkeypatch, routed, fail=None):
    """Router와 구현된 업무 Agent 대역. 호출 기록 list를 돌려준다. fail은 {이름: 던질 예외}."""
    calls, fail = [], fail or {}

    def agent(name, result):
        def call(*args, **kwargs):
            calls.append((name, args, kwargs))
            if name in fail:
                raise fail[name]
            return result(*args) if callable(result) else result
        return call

    monkeypatch.setattr(service.intent, 'route', agent('route', routed))
    monkeypatch.setattr(service.manuscript, 'answer', agent('story_context', AnswerResponse(
        claims=[Claim(text='밤에 닫는다', kind='confirmed', sourceIds=['a'])], gaps=[])))
    monkeypatch.setattr(service.writing, 'draft', agent('draft', DraftResponse(
        text='선장은 항구에 내렸다.', model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.writing, 'patch', agent('patch', PatchResponse(
        before='그는 웃었다.', after='그는 차갑게 웃었다.', model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.research, 'research', agent('web_research', ResearchResponse(
        findings=[Finding(text='약 15일', verdict='unverified', sourceUrls=[])], gaps=[],
        searchedAt=datetime(2026, 11, 12, tzinfo=timezone.utc))))
    return calls
