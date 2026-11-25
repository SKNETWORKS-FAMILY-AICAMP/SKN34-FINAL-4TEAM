import pytest
from fastapi import HTTPException

from app.world_review import router
from app.world_review.errors import WorldReviewFailure

from .stubs import fake_agent, fake_fill, fill_line, fill_request, finding, request


def test_wrong_token_is_403_without_a_model_call(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    seen = fake_agent(monkeypatch)
    with pytest.raises(HTTPException) as error:
        router.review(request(), 'wrong-token')
    assert error.value.status_code == 403 and seen == {}


def test_the_review_is_returned_as_is(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    fake_agent(monkeypatch, finding())

    result = router.review(request(), 'review-token')

    assert (len(result.findings), result.reviewedCards, result.model) == (1, 3, 'resolved-model')


@pytest.mark.parametrize('status, message', [(502, '설정집 검토 모델 응답을 확인할 수 없습니다.'), (503, '설정집 검토 모델 설정이 필요합니다.')])
def test_failures_keep_status_and_message(monkeypatch, status, message):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')

    def fail(_):
        raise WorldReviewFailure(status, message)

    monkeypatch.setattr(router.service, 'review', fail)
    with pytest.raises(HTTPException) as error:
        router.review(request(), 'review-token')
    assert (error.value.status_code, error.value.detail) == (status, message)


def test_fill_with_a_wrong_token_is_403_without_a_model_call(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    seen = fake_fill(monkeypatch)
    with pytest.raises(HTTPException) as error:
        router.fill(fill_request(), 'wrong-token')
    assert error.value.status_code == 403 and seen == {}


def test_the_fill_result_is_returned_as_is(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    fake_fill(monkeypatch, fill_line())

    result = router.fill(fill_request(), 'review-token')

    assert ([line.quote for line in result.lines], result.skipped, result.model) == (['키가 작고 얼굴이 검게 탔다.'], 0, 'resolved-model')


@pytest.mark.parametrize('status, message', [(502, '인물 문서 채우기 모델 응답을 확인할 수 없습니다.'), (503, '설정집 검토 모델 설정이 필요합니다.')])
def test_fill_failures_keep_status_and_message(monkeypatch, status, message):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')

    def fail(_):
        raise WorldReviewFailure(status, message)

    monkeypatch.setattr(router.service, 'fill', fail)
    with pytest.raises(HTTPException) as error:
        router.fill(fill_request(), 'review-token')
    assert (error.value.status_code, error.value.detail) == (status, message)
