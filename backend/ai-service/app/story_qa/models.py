"""원고 임베딩·Q&A 내부 API 계약."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class EmbeddingRequest(BaseModel):
    texts: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(min_length=1, max_length=16)
    kind: Literal['passage', 'query']


class EmbeddingResponse(BaseModel):
    model: str
    revision: str
    vectors: list[list[float]]


class Excerpt(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    episode: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=256)
    kind: Literal['manuscript', 'setting', 'relationship'] = 'manuscript'
    title: str = Field(default='', max_length=256)


class QaTurn(BaseModel):
    """같은 대화의 이전 질문과 답. 근거가 아니라 지칭 해석용 자료다."""
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(max_length=2000)


class AnswerRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    excerpts: list[Excerpt] = Field(min_length=1, max_length=8)
    history: list[QaTurn] = Field(default=[], max_length=5)


class Claim(BaseModel):
    model_config = ConfigDict(extra='forbid')  # OpenAI strict 구조화 출력은 additionalProperties=false 스키마만 받는다
    text: str
    kind: Literal['confirmed', 'inferred']
    sourceIds: list[str]


class AnswerResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    claims: list[Claim]
    gaps: list[str]
