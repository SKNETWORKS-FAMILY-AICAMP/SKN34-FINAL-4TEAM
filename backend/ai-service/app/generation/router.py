"""이어쓰기 제안 내부 API. 문맥·권한·기준 버전과 제안 저장은 Content가 확정한다."""

import json

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token

from app.generation import agent
from app.generation.errors import ProviderFailure
from app.generation.models import GenerationInput, GenerationResponse

router = APIRouter()


@router.post('/internal/v1/proposals')
def propose(data: GenerationInput, x_internal_token: str = Header(default='')) -> GenerationResponse:
    """허용 문맥 한도를 확인하고 이어쓰기 제안을 반환한다."""
    require_internal_token(x_internal_token)
    if len(json.dumps(data.context, ensure_ascii=False)) > 60000:
        raise HTTPException(422, '문맥 한도 초과')
    try:
        return agent.generate(data.context, data.prompt)
    except ProviderFailure:
        raise HTTPException(503, 'OpenAI 요청 실패 또는 설정 누락') from None
