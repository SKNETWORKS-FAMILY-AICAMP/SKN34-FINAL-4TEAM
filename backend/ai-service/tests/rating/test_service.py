import pytest

from app.rating import service
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest

from .stubs import WORK, adult, fake_agent, fake_content, general


def request(*episodes):
    return RatingRequest(workId=WORK, episodes=list(episodes or (1, 2)))


def test_work_is_adult_when_any_episode_is(monkeypatch):
    calls = fake_content(monkeypatch)
    drafts = fake_agent(monkeypatch, general(), adult())

    result = service.rate(request())

    # 세계관·검색 없이 회차 초안만 작가 권한으로 읽는다.
    assert calls == [('episode_read', {'id': WORK, 'number': 1}), ('episode_read', {'id': WORK, 'number': 2})]
    assert drafts == ['비가 왔다.', '비명이 울렸다. 그는 칼로 손가락을 하나씩 잘랐다.']
    assert result.workId == WORK and result.adult is True
    assert [(e.episode, e.revision, e.adult, e.providerResponseId) for e in result.episodes] == [
        (1, 7, False, 'resp-1'), (2, 7, True, 'resp-2')]
    assert result.episodes[1].reasons[0].criterion == 'violence'


def test_work_is_general_when_no_episode_is_adult(monkeypatch):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, general(), general())
    assert service.rate(request()).adult is False


def test_quote_not_in_that_episode_is_502(monkeypatch):
    fake_content(monkeypatch)
    # 2화 구절을 1화 근거로 쓴 응답
    fake_agent(monkeypatch, adult())
    with pytest.raises(RatingFailure) as error:
        service.rate(request(1))
    assert error.value.status == 502


def test_empty_draft_fails_before_any_model_call(monkeypatch):
    fake_content(monkeypatch, {1: '비가 왔다.', 2: '  '})
    drafts = fake_agent(monkeypatch, general(), general())
    with pytest.raises(RatingFailure) as error:
        service.rate(request())
    assert error.value.status == 422
    assert drafts == []


def test_unreadable_content_is_502(monkeypatch):
    monkeypatch.setattr(service.content_mcp, 'call', lambda tool, arguments: {'draft': {'body': None, 'revision': 1}})
    with pytest.raises(RatingFailure) as error:
        service.rate(request(1))
    assert error.value.status == 502
