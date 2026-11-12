"""Retrieval 도구와 Content 내부 검색 API(`/internal/v1/ai/qa/retrieval`) 계약."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.manuscript.models import Excerpt


class RetrievalScope(BaseModel):
    """Content가 서명해 오케스트레이션 요청에 넣는 조회 키 토큰. AI는 읽거나 바꾸지 않고 그대로 되돌려 준다."""
    model_config = ConfigDict(extra='forbid')
    scopeToken: str = Field(min_length=1, max_length=1000)


class Gap(BaseModel):
    code: str
    detail: str


class EpisodeRef(BaseModel):
    number: int
    versionId: str


class Coverage(BaseModel):
    expected: list[EpisodeRef]
    withVerifiedExcerpt: list[EpisodeRef]
    withoutVerifiedExcerpt: list[EpisodeRef]


class RetrievalStep(BaseModel):
    """Content 검색 단계 하나(embedding·elasticsearch·postgres_verify·postgres_settings·neo4j)의 시간·결과 수."""
    provider: str
    ms: int
    hits: int


class RetrievalResult(BaseModel):
    """Content가 권한·판본·원문을 확인한 근거. 출처 원본 참조(sources)는 Content 응답에만 두고 쓰지 않는다."""
    status: Literal['found', 'insufficient']
    excerpts: list[Excerpt] = Field(max_length=8)
    gaps: list[Gap]
    coverage: Coverage
    steps: list[RetrievalStep]
