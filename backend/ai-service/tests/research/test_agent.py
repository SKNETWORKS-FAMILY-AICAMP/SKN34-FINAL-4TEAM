import pytest

from app.research import agent
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest, ResearchResult
from .stubs import REAL, fake_openai, search_call

EMPTY = ResearchResult(findings=[], gaps=[])


def test_search_forces_web_search_and_returns_searched_urls(monkeypatch):
    seen = fake_openai(monkeypatch, [search_call()], EMPTY)
    result, urls = agent.search(ResearchRequest(question='한양에서 부산까지 이틀?', context='주인공이 말을 타고 이동한다.'))
    assert seen['store'] is False
    assert seen['tools'] == [{'type': 'web_search'}]
    assert seen['tool_choice'] == 'required'
    assert '주인공이 말을 타고' in seen['input']
    assert result == EMPTY and urls == [REAL]


def test_failed_search_is_503(monkeypatch):
    fake_openai(monkeypatch, [search_call(status='failed', urls=())], EMPTY)
    with pytest.raises(ResearchFailure) as error:
        agent.search(ResearchRequest(question='증기기관차는 1890년에 있었나?'))
    assert error.value.status == 503


def test_incomplete_response_is_502(monkeypatch):
    fake_openai(monkeypatch, [search_call()], None, status='incomplete')
    with pytest.raises(ResearchFailure) as error:
        agent.search(ResearchRequest(question='증기기관차는 1890년에 있었나?'))
    assert error.value.status == 502
