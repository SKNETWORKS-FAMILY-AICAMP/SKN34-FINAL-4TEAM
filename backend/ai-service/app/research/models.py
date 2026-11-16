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
