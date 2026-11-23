"""원고 임베딩 내부 API(Content 색인·검색용). Q&A 답변은 집필 AI 오케스트레이션이 `service.answer`를 직접 부른다(작품 Q&A 화면 제거, #525)."""

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.story_qa import service
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import EmbeddingRequest, EmbeddingResponse

router = APIRouter()


@router.post('/internal/v1/manuscript/embeddings')
def embed(data: EmbeddingRequest, x_internal_token: str = Header(default='')) -> EmbeddingResponse:
    """Content가 전달한 문단 또는 질문을 동일한 E5 리비전으로 변환한다."""
    require_internal_token(x_internal_token)
    try:
        return service.embed(data)
    except StoryQaFailure as error:
        raise HTTPException(error.status, str(error)) from None
