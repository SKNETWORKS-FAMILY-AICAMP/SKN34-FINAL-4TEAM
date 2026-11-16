import json

import pytest

from app.research import agent
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest, ResearchResult
from .stubs import REAL, fake_openai, search_call

EMPTY = ResearchResult(findings=[], gaps=[])


def test_search_forces_web_search_and_returns_searched_urls(monkeypatch):
    seen = fake_openai(monkeypatch, [search_call()], EMPTY)
    result, urls = agent.search(ResearchRequest(question='한양에서 부산까지 이틀?', context='주인공이 말을 타고 이동한다.'))
    assert seen['init']['store'] is False and seen['init']['include'] == ['web_search_call.action.sources']
    assert seen['tools'] == [{'type': 'web_search'}]
    assert seen['tool_choice'] == 'required'
    assert json.loads(seen['messages'][-1].content)['context'] == '주인공이 말을 타고 이동한다.'
    assert result == EMPTY and urls == [REAL]


def test_open_page_action_url_counts_as_searched(monkeypatch):
    page = {'type': 'web_search_call', 'status': 'completed', 'action': {'type': 'open_page', 'url': REAL}}
    fake_openai(monkeypatch, [page], EMPTY)
    assert agent.search(ResearchRequest(question='질문'))[1] == [REAL]


def test_research_call_is_traced_with_question(monkeypatch, spans):
    fake_openai(monkeypatch, [search_call()], EMPTY)
    agent.search(ResearchRequest(question='증기기관차는 1890년에 있었나?'))
    [span] = [s for s in spans() if s.name == 'research.generation']
    assert json.loads(span.attributes['langfuse.observation.input'])['question'] == '증기기관차는 1890년에 있었나?'


@pytest.mark.parametrize('calls', [[search_call(status='failed', urls=())], []])
def test_failed_or_missing_search_is_503(monkeypatch, calls):
    fake_openai(monkeypatch, calls, EMPTY)
    with pytest.raises(ResearchFailure) as error:
        agent.search(ResearchRequest(question='증기기관차는 1890년에 있었나?'))
    assert error.value.status == 503


def test_incomplete_response_is_502(monkeypatch):
    fake_openai(monkeypatch, [search_call()], None, status='incomplete')
    with pytest.raises(ResearchFailure) as error:
        agent.search(ResearchRequest(question='증기기관차는 1890년에 있었나?'))
    assert error.value.status == 502
