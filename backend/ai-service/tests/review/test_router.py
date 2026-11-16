import pytest
from fastapi import HTTPException

from app.content_mcp.errors import ContentMcpFailure
from app.review import router
from app.review.models import ReviewRequest

from .stubs import WORK, fake_agent, fake_content


def request():
    return ReviewRequest(workId=WORK, episode=3, check='mechanical')


def test_wrong_token_is_403(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    with pytest.raises(HTTPException) as error:
        router.review(request(), 'wrong-token', 'Bearer user')
    assert error.value.status_code == 403


def test_user_bearer_reaches_content_mcp(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    fake_content(monkeypatch)
    fake_agent(monkeypatch)
    seen = []
    original = router.service.content_mcp.call
    monkeypatch.setattr(router.service.content_mcp, 'call',
                        lambda tool, args: seen.append(router.service.content_mcp.AUTHORIZATION.get()) or original(tool, args))

    router.review(request(), 'review-token', 'Bearer user')

    assert seen == ['Bearer user']


@pytest.mark.parametrize('failure', [ContentMcpFailure(404, '회차를 찾을 수 없어요.'), router.ReviewFailure(422, '검수할 초안이 없어요.')])
def test_failures_keep_status_and_message(monkeypatch, failure):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')

    def fail(_):
        raise failure
    monkeypatch.setattr(router.service, 'review', fail)
    with pytest.raises(HTTPException) as error:
        router.review(request(), 'review-token', 'Bearer user')
    assert (error.value.status_code, error.value.detail) == (failure.status, str(failure))
