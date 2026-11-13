from types import SimpleNamespace

from app.research import service
from app.research.models import Finding, ResearchRequest, ResearchResult

from .stubs import REAL, fake_openai, search_call


def test_research_keeps_only_urls_the_search_actually_returned(monkeypatch):
    parsed = ResearchResult(findings=[
        Finding(text='한양-부산은 도보로 보름 남짓 걸렸다.', verdict='confirmed', sourceUrls=[REAL + '/?utm_source=openai']),
        Finding(text='하루 만에 갈 수 있었다.', verdict='confirmed', sourceUrls=['https://made-up.example/page']),
    ], gaps=['말의 하루 이동 거리'])
    fake_openai(monkeypatch, [search_call()], parsed)

    result = service.research(ResearchRequest(question='조선 시대에 한양에서 부산까지 이틀에 갈 수 있나?'))

    assert result.searchedAt.tzinfo is not None
    assert result.findings[0].verdict == 'confirmed'
    assert result.findings[0].sourceUrls == [REAL + '/?utm_source=openai']
    # 검색 결과에 없는 URL은 근거가 아니므로 지우고, 근거가 남지 않은 판단은 미확인으로 내린다.
    assert result.findings[1].verdict == 'unverified'
    assert result.findings[1].sourceUrls == []
    assert result.gaps == ['말의 하루 이동 거리']


def test_host_case_and_open_page_urls_count_as_searched(monkeypatch):
    page = SimpleNamespace(type='web_search_call', status='completed',
                           action=SimpleNamespace(type='open_page', url='https://Example.org/page'))
    parsed = ResearchResult(findings=[
        Finding(text='확인', verdict='confirmed', sourceUrls=['https://example.org/page']),
    ], gaps=[])
    fake_openai(monkeypatch, [page], parsed)
    assert service.research(ResearchRequest(question='질문')).findings[0].verdict == 'confirmed'


def test_research_drops_malformed_and_distinct_blank_query_urls(monkeypatch):
    page = 'https://example.org/article'
    findings = [Finding(text='확인', verdict='confirmed', sourceUrls=[page, page + '?preview=', 'https://['])]
    monkeypatch.setattr(service.agent, 'search', lambda _: (ResearchResult(findings=findings, gaps=[]), [page, 'https://[']))

    result = service.research(ResearchRequest(question='질문'))

    assert result.findings[0].sourceUrls == [page]
