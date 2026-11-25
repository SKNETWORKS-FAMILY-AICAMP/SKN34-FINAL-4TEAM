"""프롬프트별 기본 모델 조회 내부 API(#868). 운영이 프롬프트 화면의 effectiveModel을 채우려고 읽는다."""
from fastapi import APIRouter, Header

from app.internal_auth import require_internal_token
from app.prompt_models import service
from app.prompt_models.models import DefaultModels

router = APIRouter()


@router.get('/internal/v1/prompts/default-models')
def default_models(x_internal_token: str = Header(default='')) -> DefaultModels:
    """프롬프트 버전이 모델을 고르지 않았을 때 각 프롬프트가 실제로 쓰는 모델(환경 변수·코드 상수)을 돌려준다."""
    require_internal_token(x_internal_token)
    return service.default_models()
