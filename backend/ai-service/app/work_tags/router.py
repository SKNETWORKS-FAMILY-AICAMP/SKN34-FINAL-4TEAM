"""작품 장르·키워드 추천 내부 API(#372). 후보만 반환하고 작품 정보를 바꾸지 않는다."""

from fastapi import APIRouter, Header, HTTPException

from app.internal_auth import require_internal_token
from app.work_tags.errors import SuggestionFailure
from app.work_tags.models import Input, Output
from app.work_tags.service import suggest

router = APIRouter()


@router.post('/internal/v1/work-tags/suggestions', response_model=Output)
def suggest_work_tags(data: Input, x_internal_token: str = Header(default='')) -> Output:
    """Content가 고른 작품 문맥에서 장르·키워드 후보만 만든다. 저장은 작가가 고른 값으로 Content가 한다."""
    require_internal_token(x_internal_token)
    try:
        return suggest(data)
    except SuggestionFailure as error:
        raise HTTPException(error.status, str(error)) from None
