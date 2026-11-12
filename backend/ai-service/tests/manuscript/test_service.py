import pytest

from app.manuscript import service
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import EmbeddingRequest


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
