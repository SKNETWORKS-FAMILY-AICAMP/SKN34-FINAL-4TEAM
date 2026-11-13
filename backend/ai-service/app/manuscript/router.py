"""원고 임베딩·Q&A 내부 API. 검색 범위·원문 재대조·인가는 Content가 확정한다."""

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.manuscript import agent, service
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest, AnswerResponse, EmbeddingRequest, EmbeddingResponse

router = APIRouter()


@router.post('/internal/v1/manuscript/embeddings')
def embed(data: EmbeddingRequest, x_internal_token: str = Header(default='')) -> EmbeddingResponse:
    """Content가 전달한 문단 또는 질문을 동일한 E5 리비전으로 변환한다."""
    require_internal_token(x_internal_token)
    try:
        return service.embed(data)
    except ManuscriptFailure as error:
        raise HTTPException(error.status, str(error)) from None


@router.post('/internal/v1/manuscript/qa')
def answer(data: AnswerRequest, x_internal_token: str = Header(default='')) -> AnswerResponse:
    """검증된 발췌에 근거한 주장과 답할 수 없는 부분을 반환한다."""
    require_internal_token(x_internal_token)
    try:
        return agent.answer(data)
    except ManuscriptFailure as error:
        raise HTTPException(error.status, str(error)) from None
