"""원고 임베딩·Q&A 내부 API. 검색 범위·원문 재대조·인가는 Content가 확정한다."""

import os
import secrets

from fastapi import APIRouter, Header, HTTPException

from app.manuscript import agent, service
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest, AnswerResponse, EmbeddingRequest, EmbeddingResponse

router = APIRouter()


def _authorize(x_internal_token: str) -> None:
    token = os.environ.get('INTERNAL_TOKEN', '')
    if not token or not secrets.compare_digest(token, x_internal_token):
        raise HTTPException(403, '내부 인증이 필요합니다.')


@router.post('/internal/v1/manuscript/embeddings')
def embed(data: EmbeddingRequest, x_internal_token: str = Header(default='')) -> EmbeddingResponse:
    """Content가 전달한 문단 또는 질문을 동일한 E5 리비전으로 변환한다."""
    _authorize(x_internal_token)
    try:
        return service.embed(data)
    except ManuscriptFailure as error:
        raise HTTPException(error.status, str(error)) from None


@router.post('/internal/v1/manuscript/qa')
def answer(data: AnswerRequest, x_internal_token: str = Header(default='')) -> AnswerResponse:
    """검증된 발췌에 근거한 주장과 답할 수 없는 부분을 반환한다."""
    _authorize(x_internal_token)
    try:
        return agent.answer(data)
    except ManuscriptFailure as error:
        raise HTTPException(error.status, str(error)) from None
