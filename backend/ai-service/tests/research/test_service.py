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
