import json

import httpx
import pytest

from app.retrieval import service
from app.retrieval.errors import RetrievalFailure, RetrievalUnavailable
from app.retrieval.models import RetrievalScope

SCOPE = RetrievalScope(scopeToken='signed.token')
BODY = {
    'status': 'found',
    'excerpts': [{'id': 'chunk', 'episode': 2, 'quote': '용이 나타났다.', 'kind': 'manuscript', 'title': ''}],
    'gaps': [{'code': 'LIMITED_COVERAGE', 'detail': '일부 회차에서는 근거를 찾지 못했어요.'}],
    'coverage': {'expected': [{'number': 1, 'versionId': 'r1'}, {'number': 2, 'versionId': 'r2'}],
                 'withVerifiedExcerpt': [{'number': 2, 'versionId': 'r2'}],
                 'withoutVerifiedExcerpt': [{'number': 1, 'versionId': 'r1'}]},
    'steps': [{'provider': 'embedding', 'ms': 20, 'hits': 1}, {'provider': 'elasticsearch', 'ms': 84, 'hits': 2},
              {'provider': 'postgres_verify', 'ms': 12, 'hits': 1}],
    'sources': [{'kind': 'manuscript', 'id': 'chunk'}],
}


def content(monkeypatch, status=200, body=BODY, error=None):
    monkeypatch.setenv('CONTENT_SERVICE_BASE_URL', 'http://content.test')
    monkeypatch.setenv('INTERNAL_TOKEN', 't' * 32)
    seen = {}

    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        if error:
            raise error
        return httpx.Response(status, json=body, request=httpx.Request('POST', url))

    monkeypatch.setattr(service.httpx, 'post', post)
    return seen


def test_calls_content_with_scope_and_returns_verified_evidence(monkeypatch):
    seen = content(monkeypatch)
    result = service.retrieve(SCOPE, '용은 언제 왔나?')
    assert seen['url'] == 'http://content.test/internal/v1/ai/qa/retrieval'
    assert seen['headers'] == {'X-Internal-Token': 't' * 32}
    assert seen['json'] == {'scopeToken': 'signed.token', 'question': '용은 언제 왔나?'}
    assert result.status == 'found' and result.excerpts[0].id == 'chunk'
    assert [s.provider for s in result.steps] == ['embedding', 'elasticsearch', 'postgres_verify']


def test_retrieval_trace_has_one_child_per_content_step_and_manuscript_quotes(monkeypatch, spans):
    content(monkeypatch)
    service.retrieve(SCOPE, '용은 언제 왔나?')
    found = {s.name: s for s in spans()}
    root = found['retrieval']
    for provider, ms in (('embedding', 20), ('elasticsearch', 84), ('postgres_verify', 12)):
        child = found[f'retrieval.{provider}']
        assert child.parent.span_id == root.context.span_id
        assert child.attributes['langfuse.observation.metadata.ms'] == ms
    # 팀 결정(2026-11-13): 질문과 원고 인용 본문은 추적한다.
    assert json.loads(root.attributes['langfuse.observation.input']) == {'question': '용은 언제 왔나?'}
    assert json.loads(root.attributes['langfuse.observation.output'])[0]['quote'] == '용이 나타났다.'


@pytest.mark.parametrize('kwargs, status', [
    ({'status': 409, 'body': {'detail': '공개 원고 범위가 변경됐어요.'}}, 409),
    ({'status': 500, 'body': {}}, 502),
    ({'body': {'status': 'found'}}, 502),
    ({'error': httpx.ConnectError('down')}, 503),
])
def test_content_failures_are_explicit(monkeypatch, kwargs, status):
    content(monkeypatch, **kwargs)
    with pytest.raises(RetrievalFailure) as error:
        service.retrieve(SCOPE, '질문')
    assert error.value.status == status


def test_missing_content_settings_is_503(monkeypatch):
    monkeypatch.delenv('CONTENT_SERVICE_BASE_URL', raising=False)
    with pytest.raises(RetrievalFailure) as error:
        service.retrieve(SCOPE, '질문')
    assert error.value.status == 503


def test_only_a_503_the_content_service_returned_says_the_manuscript_search_is_unavailable(monkeypatch):
    content(monkeypatch, status=503, body={'detail': '원고 Q&A를 사용할 수 없어요.'})
    with pytest.raises(RetrievalUnavailable) as error:
        service.retrieve(SCOPE, '질문')
    assert (error.value.status, str(error.value)) == (503, '원고 Q&A를 사용할 수 없어요.')
    content(monkeypatch, error=httpx.ConnectError('down'))  # 우리 쪽 연결 실패·설정 누락은 같은 503이어도 해당 없다
    with pytest.raises(RetrievalFailure) as error:
        service.retrieve(SCOPE, '질문')
    assert error.value.status == 503 and not isinstance(error.value, RetrievalUnavailable)
    monkeypatch.delenv('CONTENT_SERVICE_BASE_URL')
    with pytest.raises(RetrievalFailure) as error:
        service.retrieve(SCOPE, '질문')
    assert error.value.status == 503 and not isinstance(error.value, RetrievalUnavailable)


def test_scope_only_accepts_the_content_signed_token():
    import pytest as _pytest
    from pydantic import ValidationError
    with _pytest.raises(ValidationError):
        RetrievalScope.model_validate({'scopeToken': 'x', 'owner': 'someone-else'})
