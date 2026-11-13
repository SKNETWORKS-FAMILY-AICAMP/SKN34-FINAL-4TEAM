import pytest
from fastapi import HTTPException

from app.writing import router
from app.writing.models import DraftRequest, PatchRequest

from .stubs import fake_openai


def test_wrong_token_is_403(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'writing-token')
    with pytest.raises(HTTPException) as error:
        router.patch(PatchRequest(selection='문장', instruction='고쳐줘'), 'wrong-token')
    assert error.value.status_code == 403


def test_feature_failure_becomes_http_status(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'writing-token')
    fake_openai(monkeypatch, status='incomplete')
    with pytest.raises(HTTPException) as error:
        router.draft(DraftRequest(episodeNumber=1, plan='계획'), 'writing-token')
    assert error.value.status_code == 502
