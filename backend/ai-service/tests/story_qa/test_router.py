import pytest
from fastapi import HTTPException

from app.story_qa import router
from app.story_qa.models import EmbeddingRequest


def test_internal_token_is_required(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    with pytest.raises(HTTPException) as error:
        router.embed(EmbeddingRequest(texts=['원고'], kind='passage'), 'wrong')
    assert error.value.status_code == 403


def test_work_qa_route_is_removed():
    # 작품 Q&A 화면 제거(#525): Content가 부르던 답변 라우트가 없다. 채팅 Q&A는 오케스트레이션이 service.answer를 직접 쓴다.
    assert '/internal/v1/manuscript/qa' not in {r.path for r in router.router.routes}
