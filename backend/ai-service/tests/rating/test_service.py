import pytest

from app.rating import service
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest

from .stubs import WORK, adult, fake_agent, fake_content, general, result


def request(*episodes):
    return RatingRequest(workId=WORK, episodes=list(episodes or (1, 2)))


def test_work_is_adult_when_any_episode_is(monkeypatch):
    calls = fake_content(monkeypatch)
    seen = fake_agent(monkeypatch, general(), adult())

    rating = service.rate(request())

    # 회차 초안과 연결 세계관(한 번, 가장 늦은 회차 시점)만 작가 권한으로 읽는다. 검색·시뮬레이션은 부르지 않는다.
    assert calls == [('episode_read', {'id': WORK, 'number': 1}), ('episode_read', {'id': WORK, 'number': 2}),
                     ('world_studio_list', {}), ('world_studio_read', {'id': 'world-1', 'episode': '2'})]
    assert sorted(e['draft'] for e in seen) == ['비가 왔다.', '비명이 울렸다. 그는 칼로 손가락을 하나씩 잘랐다.']
    assert rating.workId == WORK and rating.verdict == 'adult' and rating.prohibited is False
    assert [(e.episode, e.revision, e.verdict, e.providerResponseId) for e in rating.episodes] == [
        (1, 7, 'general', 'resp-1'), (2, 7, 'adult', 'resp-2')]
    assert len(rating.episodes[1].assessments) == 7


def test_episode_context_has_title_note_revealed_characters_and_signals(monkeypatch):
    fake_content(monkeypatch)
    seen = fake_agent(monkeypatch, general(), general())

    service.rate(request())

    first, second = sorted(seen, key=lambda e: e['title'])
    assert (first['title'], first['authorNote']) == ('1화', '1화 메모')
    # 인물 카드만, 그 회차까지 공개된 것만 보낸다. 미성년 여부는 인물 설정에서 판단한다.
    assert first['characters'] == [{'ref': 'card:hana', 'name': '하나', 'text': '17세 고등학생.'}]
    assert [c['ref'] for c in second['characters']] == ['card:hana', 'card:late']
    assert first['signals'] == {'profanityCount': 0}


def test_unlinked_work_is_rated_without_characters(monkeypatch):
    fake_content(monkeypatch, linked='other-work')
    seen = fake_agent(monkeypatch, general())
    assert service.rate(request(1)).verdict == 'general'
    assert seen[0]['characters'] == []


def test_profanity_count_is_a_rule_signal_returned_with_the_rating(monkeypatch):
    fake_content(monkeypatch, {1: '씨발, 이 병신아. 씨발. 여기가 시발점이다. 그는 껌을 씹으며 5개년 계획을 읽었다.'})
    seen = fake_agent(monkeypatch, general())

    rating = service.rate(request(1))

    # '시발점'·'씹으며'·'5개년' 같은 일반 낱말은 세지 않는다.
    assert seen[0]['signals'] == {'profanityCount': 3} and rating.episodes[0].signals == {'profanityCount': 3}


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


@pytest.mark.parametrize('quote', [
    '그는 칼로 손가락을 하나씩 잘랐다.',  # 2화 구절을 1화 근거로 씀
    '비가',  # 너무 짧아 근거로 볼 수 없는 구절
    '17세 고등학생.',  # 초안이 아닌 인물 설정을 근거로 씀
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


def test_no_episode_rated_is_502(monkeypatch):
    fake_content(monkeypatch, {1: '비가 왔다.', 2: '비명이 울렸다.'})
    fake_agent(monkeypatch, adult(), RatingFailure(502, '심의 판별 모델 응답을 확인할 수 없습니다.'))
    with pytest.raises(RatingFailure) as error:
        service.rate(request())
    assert (error.value.status, str(error.value)) == (502, service.BAD_REASON)


def test_model_unavailable_fails_the_whole_request(monkeypatch):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, general(), RatingFailure(503, '심의 판별 모델 호출에 실패했습니다.'))
    with pytest.raises(RatingFailure) as error:
        service.rate(request())
    assert error.value.status == 503


def test_empty_draft_fails_before_any_model_call(monkeypatch):
    fake_content(monkeypatch, {1: '비가 왔다.', 2: '  '})
    seen = fake_agent(monkeypatch, general(), general())
    with pytest.raises(RatingFailure) as error:
        service.rate(request())
    assert error.value.status == 422
    assert seen == []


@pytest.mark.parametrize('call', [
    lambda tool, arguments: {'draft': {'body': None, 'revision': 1}},  # 초안 형식 오류
    lambda tool, arguments: ({'draft': {'title': '1화', 'body': '비', 'revision': 1}} if tool == 'episode_read'
                             else [{'worldId': 'w', 'linkedWorkId': WORK}] if tool == 'world_studio_list' else {'cards': 'x'}),  # 세계관 형식 오류
])
def test_unreadable_content_is_502(monkeypatch, call):
    monkeypatch.setattr(service.content_mcp, 'call', call)
    with pytest.raises(RatingFailure) as error:
        service.rate(request(1))
    assert error.value.status == 502
