"""공통 Retrieval 도구: Content 내부 검색 API로 허용 근거를 받아 온다(정본 변경 없음).

AI는 PostgreSQL·Neo4j·Elasticsearch에 직접 접속하지 않는다. Content가 자신이 서명한 scopeToken으로만 범위·권한을 다시 확정하고
원고 벡터 검색 → 원문 재대조 또는 설정·현재 관계 조회를 실행해 근거와 단계별 측정값을 돌려준다.
Writing & Editing은 이 도구를 호출하지 않는다. 추적에는 근거 참조와 단계 측정값만 남긴다.
"""

import os

import httpx
from pydantic import ValidationError

from app import tracing
from app.retrieval.errors import RetrievalFailure
from app.retrieval.models import RetrievalResult, RetrievalScope

# Content가 사용자에게 보여 줄 고정 문구로 거절하는 상태. 그 밖의 오류는 502로 닫는다.
PASSED_STATUSES = {403, 404, 409, 422, 503}


def retrieve(scope: RetrievalScope, question: str) -> RetrievalResult:
    base, token = os.environ.get('CONTENT_SERVICE_BASE_URL'), os.environ.get('INTERNAL_TOKEN')
    if not base or not token:
        raise RetrievalFailure(503, 'Content 검색 설정이 필요합니다.')
    with tracing.observe('retrieval', as_type='retriever', metadata={'provider': 'content'}) as span:
        try:
            response = httpx.post(f'{base.rstrip("/")}/internal/v1/ai/qa/retrieval',
                                  json={'scopeToken': scope.scopeToken, 'question': question[:500]},
                                  headers={'X-Internal-Token': token}, timeout=20)
        except httpx.HTTPError:
            raise RetrievalFailure(503, 'Content 검색을 호출할 수 없습니다.') from None
        if response.status_code >= 400:
            raise _failure(response)
        try:
            result = RetrievalResult.model_validate(response.json())
        except (ValueError, ValidationError):
            raise RetrievalFailure(502, 'Content 검색 결과를 확인할 수 없습니다.') from None
        for step in result.steps:
            with tracing.observe(f'retrieval.{step.provider}', as_type='retriever',
                                 metadata={'ms': step.ms, 'hits': step.hits}):
                pass
        span.update(metadata={'status': result.status, 'gaps': [g.code for g in result.gaps],
                              'excerpts': [{'id': e.id, 'episode': e.episode, 'kind': e.kind} for e in result.excerpts],
                              'coveredEpisodes': len(result.coverage.withVerifiedExcerpt),
                              'expectedEpisodes': len(result.coverage.expected)})
        return result


def _failure(response: httpx.Response) -> RetrievalFailure:
    if response.status_code not in PASSED_STATUSES:
        return RetrievalFailure(502, 'Content 검색에 실패했습니다.')
    try:
        message = response.json().get('detail') or 'Content 검색을 완료할 수 없습니다.'
    except ValueError:
        message = 'Content 검색을 완료할 수 없습니다.'
    return RetrievalFailure(response.status_code, str(message)[:200])
