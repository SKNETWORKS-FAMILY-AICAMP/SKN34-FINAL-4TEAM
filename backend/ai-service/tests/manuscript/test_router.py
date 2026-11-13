import pytest
from fastapi import HTTPException

from app.manuscript import router
from app.manuscript.models import AnswerRequest, EmbeddingRequest, Excerpt


@pytest.mark.parametrize('call', [
    lambda token: router.embed(EmbeddingRequest(texts=['원고'], kind='passage'), token),
    lambda token: router.answer(AnswerRequest(question='누구?', excerpts=[Excerpt(id='a', episode=1, quote='원문')]), token),
])
def test_internal_token_is_required(monkeypatch, call):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    with pytest.raises(HTTPException) as error:
        call('wrong')
    assert error.value.status_code == 403


def test_feature_failure_becomes_http_status(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    data = AnswerRequest(question='누구?', excerpts=[Excerpt(id='a', episode=1, quote='원문')])
    with pytest.raises(HTTPException) as error:
        router.answer(data, 'test-token')
    assert error.value.status_code == 503
