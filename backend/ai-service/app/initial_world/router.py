"""초기 세계관 추출 전용 내부 API. 기존 이어쓰기 API와 분리한다."""
import os
import secrets

from fastapi import APIRouter, Header, HTTPException
from app.initial_world.models import Input, Output
from app.initial_world.service import ExtractionFailure, extract

router = APIRouter()


@router.post('/internal/v1/initial-world/extractions', response_model=Output)
def extract_initial_world(data: Input, x_internal_token: str = Header(default='')) -> Output:
    """Content가 고정한 입력에서 후보만 생성하며 정본을 변경하지 않는다."""
    token = os.environ.get('INTERNAL_TOKEN', '')
    if not token or not secrets.compare_digest(token, x_internal_token):
        raise HTTPException(403, '내부 인증이 필요합니다.')
    try:
        return extract(data)
    except ExtractionFailure as error:
        raise HTTPException(error.status, str(error)) from None
