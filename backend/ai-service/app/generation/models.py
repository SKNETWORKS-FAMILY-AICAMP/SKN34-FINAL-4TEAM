"""이어쓰기 제안 내부 API 계약."""

from pydantic import BaseModel, Field


class GenerationInput(BaseModel):
    context: dict
    prompt: str = Field(min_length=1, max_length=2000)


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class GenerationResponse(BaseModel):
    text: str
    model: str
    providerResponseId: str
    usage: Usage | None
