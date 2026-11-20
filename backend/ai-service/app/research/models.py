"""웹 조사 내부 API 계약."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ResearchRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    context: str = Field(default='', max_length=500)


class Finding(BaseModel):
    model_config = ConfigDict(extra='forbid')  # OpenAI strict 구조화 출력은 additionalProperties=false 스키마만 받는다
    text: str
    verdict: Literal['confirmed', 'conflicting', 'unverified']
    sourceUrls: list[str]


class ResearchResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    findings: list[Finding]
    gaps: list[str]


class ResearchResponse(ResearchResult):
    searchedAt: datetime


# --- platform(#547): 다른 작가의 공개 세계관에서 참고 설정 찾기 ---


class PlatformPick(BaseModel):
    """1회차 모델 출력: 요청에 맞는 공개 세계관 id. service가 후보 목록에 있는 id인지 다시 확인한다."""
    model_config = ConfigDict(extra='forbid')
    worldIds: list[str]


class Reference(BaseModel):
    """2회차 모델이 인용한 카드와 참고 이유. 이름·제목·작가는 모델이 아니라 읽은 값으로 채운다."""
    model_config = ConfigDict(extra='forbid')
    worldId: str
    cardId: str
    note: str


class PlatformDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    references: list[Reference]
    gaps: list[str]


class PlatformReference(BaseModel):
    """참고안 하나. worldId·cardId는 카드 링크(`/worlds/:id/cards/:cardId`)용이다."""
    worldId: str
    worldName: str
    cardId: str
    cardTitle: str
    authorNickname: str
    note: str


class PlatformResult(BaseModel):
    references: list[PlatformReference]
    gaps: list[str]
