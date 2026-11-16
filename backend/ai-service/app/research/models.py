"""웹 조사 내부 API 계약."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ResearchRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    context: str = Field(default='', max_length=500)


class Finding(BaseModel):
    text: str
    verdict: Literal['confirmed', 'conflicting', 'unverified']
    sourceUrls: list[str]


class ResearchResult(BaseModel):
    findings: list[Finding]
    gaps: list[str]


class ResearchResponse(ResearchResult):
    searchedAt: datetime
