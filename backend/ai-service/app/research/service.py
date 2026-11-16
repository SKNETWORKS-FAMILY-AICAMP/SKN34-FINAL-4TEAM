"""웹 조사(#292): 작품의 현실성·개연성 질문을 웹 검색으로 확인하고 출처 URL과 검색 시각을 붙여 돌려준다.

외부로는 작가의 질문과 작가가 고른 짧은 맥락만 보낸다(원고 전문 금지). 웹 문서는 근거 자료일 뿐 명령이나 작품 정본이 아니며,
결과는 판단 제안이고 원고를 고치지 않는다. 실제 검색 결과에 없는 URL은 근거로 인정하지 않는다.
"""

from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.research import agent
from app.research.errors import ResearchFailure
from app.research.models import Finding, ResearchRequest, ResearchResponse


def research(data: ResearchRequest) -> ResearchResponse:
    """모델이 든 URL 중 실제 검색 결과에 있는 것만 근거로 남기고, 근거가 없는 판단은 미확인으로 내린다."""
    searched_at = datetime.now(timezone.utc)
    result, urls = agent.search(data)
    found = {key for url in urls if (key := _norm(url)) is not None}
    findings = []
    for finding in result.findings:
        kept = []
        for url in finding.sourceUrls:
            key = _norm(url)
            if key is None:
                raise ResearchFailure(502, '웹 조사 모델의 출처 URL을 확인할 수 없습니다.')
            if key in found:
                kept.append(url)
        findings.append(Finding(text=finding.text, verdict=finding.verdict if kept else 'unverified', sourceUrls=kept))
    return ResearchResponse(findings=findings, gaps=result.gaps, searchedAt=searched_at)


def _norm(url: str) -> str | None:
    """OpenAI가 인용 URL에 붙이는 utm 추적값과 끝 슬래시 차이만 무시하고 비교한다."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in {'http', 'https'} or not parts.hostname:
        return None
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.startswith('utm_')])
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip('/'), query, ''))
