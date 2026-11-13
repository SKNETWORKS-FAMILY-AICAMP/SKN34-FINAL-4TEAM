import json

import pytest

from app.manuscript import service
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest, Claim, EmbeddingRequest, Excerpt


def test_embedding_preserves_prefix_and_vector_order(monkeypatch):
    vectors = [[0.01] * 384, [0.02] * 384]

    class Encoder:
        def encode(self, texts):
            assert texts == ['passage: 첫 문단', 'passage: 둘째 문단']
            return vectors

    monkeypatch.setattr(service, 'get_encoder', Encoder)
    response = service.embed(EmbeddingRequest(texts=['첫 문단', '둘째 문단'], kind='passage'))
    assert response.model == 'intfloat/multilingual-e5-small'
    assert response.vectors == vectors


def test_embedding_input_over_token_limit_is_422(monkeypatch):
    class Encoder:
        def encode(self, texts):
            raise ValueError('E5 input exceeds 512 tokens')

    monkeypatch.setattr(service, 'get_encoder', Encoder)
    with pytest.raises(ManuscriptFailure) as error:
        service.embed(EmbeddingRequest(texts=['긴 질문'], kind='query'))
    assert error.value.status == 422


def test_embedding_model_unavailable_is_an_explicit_error(monkeypatch):
    monkeypatch.delenv('MANUSCRIPT_EMBEDDING_MODEL_DIR', raising=False)
    service.get_encoder.cache_clear()
    with pytest.raises(ManuscriptFailure) as error:
        service.embed(EmbeddingRequest(texts=['질문'], kind='query'))
    assert error.value.status == 503


def answer_with(monkeypatch, claims):
    from app.manuscript.models import AnswerResponse
    monkeypatch.setattr(service.agent, 'answer', lambda data: AnswerResponse(claims=claims, gaps=[]))
    return AnswerRequest(question='누구?', excerpts=[Excerpt(id='a', episode=1, quote='원문')])


def test_answer_keeps_claims_cited_from_given_excerpts(monkeypatch):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=['a'])])
    assert service.answer(data).claims[0].sourceIds == ['a']


@pytest.mark.parametrize('ids', [[], ['other']])
def test_answer_with_unknown_or_missing_citation_is_502(monkeypatch, ids):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=ids)])
    with pytest.raises(ManuscriptFailure) as error:
        service.answer(data)
    assert error.value.status == 502


def attrs(span):
    """span 속성. Langfuse가 JSON 문자열로 담는 input/output/metadata는 읽을 수 있게 풀어 둔다."""
    return {k: json.loads(v) if k.startswith('langfuse.observation.') and isinstance(v, str) and v[:1] in '[{"' else v
            for k, v in span.attributes.items()}


def test_answer_trace_has_question_manuscript_and_answer_bodies_but_no_setting_text(monkeypatch, spans):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=['a'])])
    data.excerpts.append(Excerpt(id='s', episode=1, quote='비공개 설정 본문', kind='setting', title='설정 제목'))
    service.answer(data)
    retrieval, check, qa = spans()
    assert (retrieval.name, check.name, qa.name) == ('retrieval', 'evidence_check', 'story_context.qa')
    assert retrieval.parent.span_id == qa.context.span_id == check.parent.span_id
    assert attrs(check)['langfuse.observation.metadata.citedIds'] == ['a']
    # 팀 결정(2026-11-13): 질문·원고·답변 본문은 추적한다. 설정·관계 본문은 결정 범위 밖이라 참조만 남긴다.
    assert attrs(retrieval)['langfuse.observation.output'] == [
        {'id': 'a', 'episode': 1, 'kind': 'manuscript', 'quote': '원문'}, {'id': 's', 'episode': 1, 'kind': 'setting'}]
    assert attrs(qa)['langfuse.observation.input'] == {'question': '누구?'}
    assert attrs(qa)['langfuse.observation.output']['claims'][0]['text'] == '홍길동'
    assert not any(text in str(attrs(s)) for s in (retrieval, check, qa) for text in ('비공개 설정 본문', '설정 제목'))


def test_invalid_citation_is_traced_as_error_and_still_fails(monkeypatch, spans):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=['other'])])
    with pytest.raises(ManuscriptFailure):
        service.answer(data)
    _, check, qa = spans()
    assert attrs(check)['langfuse.observation.level'] == 'ERROR'
    assert attrs(check)['langfuse.observation.metadata.invalidIds'] == ['other']
    assert attrs(qa)['langfuse.observation.level'] == 'ERROR'
