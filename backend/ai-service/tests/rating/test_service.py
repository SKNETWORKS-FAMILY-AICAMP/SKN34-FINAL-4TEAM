import pytest

from app.rating import service
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest

from .stubs import WORK, adult, fake_agent, fake_content, general, result


def request(*episodes):
    return RatingRequest(workId=WORK, episodes=list(episodes or (1, 2)))


def test_work_is_adult_when_any_episode_is(monkeypatch):
    calls = fake_content(monkeypatch)
    drafts = fake_agent(monkeypatch, general(), adult())

    rating = service.rate(request())

    # 세계관·검색 없이 회차 초안만 작가 권한으로 읽는다.
    assert calls == [('episode_read', {'id': WORK, 'number': 1}), ('episode_read', {'id': WORK, 'number': 2})]
    assert drafts == ['비가 왔다.', '비명이 울렸다. 그는 칼로 손가락을 하나씩 잘랐다.']
    assert rating.workId == WORK and rating.verdict == 'adult' and rating.prohibited is False
    assert [(e.episode, e.revision, e.verdict, e.providerResponseId) for e in rating.episodes] == [
        (1, 7, 'general', 'resp-1'), (2, 7, 'adult', 'resp-2')]
    assert len(rating.episodes[1].assessments) == 7


@pytest.mark.parametrize('second, verdict', [(general(), 'general'), (result(2), 'needsReview')])
def test_work_verdict_without_adult_episode(monkeypatch, second, verdict):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, general(), second)
    assert service.rate(request()).verdict == verdict


def test_prohibited_episode_marks_work(monkeypatch):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, general(), adult(criterion='sexual', prohibited=True))
    rating = service.rate(request())
    assert (rating.verdict, rating.prohibited, rating.episodes[1].prohibited) == ('adult', True, True)


def test_quote_matches_despite_whitespace_curly_quotes_and_ellipsis(monkeypatch):
    fake_content(monkeypatch, {1: '그는 칼로\n  손가락을 “하나씩”… 잘랐다.'})
    fake_agent(monkeypatch, adult(quote='그는 칼로 손가락을 "하나씩"... 잘랐다.'))
    assert service.rate(request(1)).episodes[0].verdict == 'adult'


def test_low_level_quotes_do_not_decide_and_are_not_checked(monkeypatch):
    fake_content(monkeypatch, {1: '비가 왔다.'})
    fake_agent(monkeypatch, result(1, quote='없는 구절'))
    assert service.rate(request(1)).verdict == 'general'


def test_no_episode_rated_is_502(monkeypatch):
    fake_content(monkeypatch, {1: '비가 왔다.', 2: '비명이 울렸다.'})
    fake_agent(monkeypatch, adult(), RatingFailure(502, '심의 판별 모델 응답을 확인할 수 없습니다.'))
    with pytest.raises(RatingFailure) as error:
        service.rate(request())
    assert (error.value.status, str(error.value)) == (502, service.BAD_REASON)


@pytest.mark.parametrize('quote', [
    '그는 칼로 손가락을 하나씩 잘랐다.',  # 2화 구절을 1화 근거로 씀
    '비가',  # 너무 짧아 근거로 볼 수 없는 구절
])
def test_unverifiable_quote_fails_only_that_episode(monkeypatch, quote):
    fake_content(monkeypatch, {1: '비가 왔다.', 2: '비명이 울렸다.'})
    fake_agent(monkeypatch, adult(quote=quote), general())

    rating = service.rate(request())

    failed, rated = rating.episodes
    assert (failed.verdict, failed.error, failed.providerResponseId) == (None, service.BAD_REASON, 'resp-1')
    assert rated.verdict == 'general'
    # 판별하지 못한 회차가 있으면 전체 이용가로 내리지 않는다.
    assert rating.verdict == 'needsReview'


def test_unreadable_model_output_fails_only_that_episode(monkeypatch):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, RatingFailure(502, '심의 판별 모델 응답을 확인할 수 없습니다.'), adult())

    rating = service.rate(request())

    assert [(e.verdict, e.error) for e in rating.episodes] == [(None, '심의 판별 모델 응답을 확인할 수 없습니다.'), ('adult', None)]
    assert rating.verdict == 'adult'


def test_model_unavailable_fails_the_whole_request(monkeypatch):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, RatingFailure(503, '심의 판별 모델 호출에 실패했습니다.'))
    with pytest.raises(RatingFailure) as error:
        service.rate(request())
    assert error.value.status == 503


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
