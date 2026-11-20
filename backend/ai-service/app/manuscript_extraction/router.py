"""Content가 실행권·저장본을 고정한 최초 구축의 순수 추출/구조화 내부 창구."""
from fastapi import APIRouter, Header, HTTPException
from pydantic import Field
from app.internal_auth import require_internal_token
from app.manuscript_extraction import service
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import Model, EpisodeText, EpisodeExtraction, IdentityResolution, LoadPayload

router=APIRouter()

class StructureRequest(Model):
    extractions:list[EpisodeExtraction]=Field(min_length=1)

class StructureResponse(Model):
    identity:IdentityResolution
    payload:LoadPayload

@router.post('/internal/v1/manuscript-build/extractions',response_model=EpisodeExtraction)
def extraction(data:EpisodeText,x_internal_token:str=Header(default='')):
    """한 회차만 반환한다. Content가 성공 결과를 영속화한 뒤 다음 회차를 실행한다."""
    require_internal_token(x_internal_token)
    try:
        return service.extract(data)
    except PreprocessingFailure as error:
        raise HTTPException(error.status,str(error)) from None

@router.post('/internal/v1/manuscript-build/structure',response_model=StructureResponse)
def structure(data:StructureRequest,x_internal_token:str=Header(default='')):
    """전 회차 결과를 재검증해 정체와 적재 데이터를 반환하며 정본에는 쓰지 않는다."""
    require_internal_token(x_internal_token)
    if len({row.number for row in data.extractions})!=len(data.extractions):
        raise HTTPException(422,'DUPLICATE_EPISODE')
    rows={row.number:row for row in data.extractions}
    try:
        identity=service.resolve(rows)
        return StructureResponse(identity=identity,payload=service.organize(identity,rows))
    except PreprocessingFailure as error:
        raise HTTPException(error.status,str(error)) from None
