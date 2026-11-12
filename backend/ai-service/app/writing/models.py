"""새 원고·부분 수정 내부 API 계약."""

from pydantic import BaseModel, Field


class DraftRequest(BaseModel):
    episodeNumber: int = Field(ge=1)
    plan: str = Field(min_length=1, max_length=4000)
    # Content의 허용 문맥 JSON(작성 중 초안 ≤40,000자 포함). 기존 이어쓰기 문맥 한도와 같다.
    context: str = Field(default='', max_length=60000)
    instruction: str = Field(default='', max_length=2000)


class PatchRequest(BaseModel):
    selection: str = Field(min_length=1, max_length=5000)
    instruction: str = Field(min_length=1, max_length=2000)
    precedingText: str = Field(default='', max_length=2000)
    followingText: str = Field(default='', max_length=2000)
    context: str = Field(default='', max_length=60000)


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class DraftResponse(BaseModel):
    text: str
    model: str
    providerResponseId: str
    usage: Usage | None


class PatchResponse(BaseModel):
    before: str
    after: str
    model: str
    providerResponseId: str
    usage: Usage | None
