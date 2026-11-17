import pytest
from fastapi import HTTPException

from app.content_mcp.errors import ContentMcpFailure
from app.rating import router
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest

from .stubs import WORK, fake_agent, fake_content, general


def request():
    return RatingRequest(workId=WORK, episodes=[1])


def test_wrong_token_is_403(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'rating-token')
    with pytest.raises(HTTPException) as error:
        router.rate(request(), 'wrong-token', 'Bearer user')
    assert error.value.status_code == 403


def test_user_bearer_reaches_content_mcp(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'rating-token')
    fake_content(monkeypatch)
    fake_agent(monkeypatch, general())
    seen = []
    original = router.service.content_mcp.call
    monkeypatch.setattr(router.service.content_mcp, 'call',
                        lambda tool, args: seen.append(router.service.content_mcp.AUTHORIZATION.get()) or original(tool, args))

    router.rate(request(), 'rating-token', 'Bearer user')

    assert seen == ['Bearer user'] * 3  # episode_read, world_studio_list, world_studio_read


@pytest.mark.parametrize('failure', [ContentMcpFailure(404, '회차를 찾을 수 없어요.'), RatingFailure(422, '판별할 초안이 없어요.')])
def test_failures_keep_status_and_message(monkeypatch, failure):
    monkeypatch.setenv('INTERNAL_TOKEN', 'rating-token')

    def fail(_):
        raise failure
    monkeypatch.setattr(router.service, 'rate', fail)
    with pytest.raises(HTTPException) as error:
        router.rate(request(), 'rating-token', 'Bearer user')
    assert (error.value.status_code, error.value.detail) == (failure.status, str(failure))
