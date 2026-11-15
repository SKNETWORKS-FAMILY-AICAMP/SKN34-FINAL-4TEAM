"""심의 등급(19세 이용가 여부) 판별 내부 API 계약. 판별 항목은 guidelines/youth-protection.md와 같다."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Criterion = Literal['sexual', 'violence', 'crime', 'drug', 'gambling', 'language']


class RatingRequest(BaseModel):
    workId: str = Field(min_length=1, max_length=100)
    # 회차마다 모델을 한 번씩 부르므로 한 요청의 호출 수를 제한한다.
    episodes: list[Annotated[int, Field(ge=1)]] = Field(min_length=1, max_length=10)

    @field_validator('episodes')
    @classmethod
    def _distinct(cls, episodes: list[int]) -> list[int]:
        if len(set(episodes)) != len(episodes):
            raise ValueError('같은 회차를 두 번 판별하지 않습니다.')
        return episodes


class Reason(BaseModel):
    """19세 이용가 근거 하나. quote는 초안에서 그대로 옮긴 구절이다."""
    criterion: Criterion
    quote: str
    explanation: str


class RatingResult(BaseModel):
    """모델 structured output. 19세 이용가면 근거가 하나 이상, 아니면 근거가 없다."""
    adult: bool
    reasons: list[Reason]

    @model_validator(mode='after')
    def _reasons_match_verdict(self):
        if self.adult != bool(self.reasons):
            raise ValueError('판정과 근거가 맞지 않습니다.')
        return self


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class EpisodeRating(RatingResult):
    episode: int
    revision: int
    model: str
    providerResponseId: str
    usage: Usage | None


class RatingResponse(BaseModel):
    """작품 판정은 회차 판정 중 하나라도 19세 이용가면 19세 이용가다. 등급 적용은 Content가 정한다."""
    workId: str
    adult: bool
    episodes: list[EpisodeRating]
