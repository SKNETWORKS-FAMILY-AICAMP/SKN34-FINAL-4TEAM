import pytest
from fastapi import HTTPException

from app.research import router
from app.research.models import ResearchRequest, ResearchResult

from .stubs import fake_openai, search_call


def test_wrong_token_is_403(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'research-token')
    with pytest.raises(HTTPException) as error:
        router.research(ResearchRequest(question='증기기관차는 1890년에 있었나?'), 'wrong-token')
    assert error.value.status_code == 403


def test_failed_search_becomes_503(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'research-token')
    fake_openai(monkeypatch, [search_call(status='failed', urls=())], ResearchResult(findings=[], gaps=[]))
    with pytest.raises(HTTPException) as error:
        router.research(ResearchRequest(question='증기기관차는 1890년에 있었나?'), 'research-token')
    assert error.value.status_code == 503
