"""AI 자율 연재 계약(#659): 시뮬레이션 장면 미리보기와 다음 회차 생성·검수. 요청 한도는 docs/design/ai-serial-contract.md와 같다."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Beat = Annotated[str, Field(min_length=1, max_length=200)]


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class SimulationRequest(BaseModel):
    workId: str = Field(min_length=1, max_length=100)
    episodeNumber: int = Field(ge=1)
    premise: str = Field(min_length=1, max_length=500)
    beats: list[Beat] = Field(default=[], max_length=5)
    context: str = Field(min_length=1, max_length=60000)  # 독자에게 공개된 회차·설정 카드 JSON
    creditLimit: float = Field(gt=0, allow_inf_nan=False)  # Content가 예약한 상한(크레딧)
    creditReservationId: str | None = Field(default=None, max_length=100)  # 선택: 추적 metadata credit_reservation_id에만 쓴다


class Opinion(BaseModel):
    """득표 상위 의견. 유형은 독자가 고르며(BR-15) general·simulation뿐이다."""
    kind: Literal['general', 'simulation']
    body: str = Field(min_length=1, max_length=1000)
    votes: int = Field(ge=0)
    scene: str | None = Field(default=None, max_length=1500)  # simulation 의견에 붙은 장면 미리보기


class EpisodeRequest(BaseModel):
    workId: str = Field(min_length=1, max_length=100)
    episodeNumber: int = Field(ge=1)
    direction: str = Field(default='', max_length=2000)  # 소유자가 정한 연재 방향(소유자만 본다)
    opinions: list[Opinion] = Field(default=[], max_length=3)
    context: str = Field(min_length=1, max_length=60000)  # 최근 발행 회차 본문과 연결 세계관 카드 JSON
    creditLimit: float = Field(gt=0, allow_inf_nan=False)
    creditReservationId: str | None = Field(default=None, max_length=100)


class Summary(BaseModel):
    """의견 종합의 모델 구조화 출력. 길이 한도는 strict 스키마가 표현하지 못해 service가 확인한다."""
    model_config = ConfigDict(extra='forbid')
    summary: str


class Review(BaseModel):
    """검수의 모델 구조화 출력이자 응답의 review. 통과하지 못했으면 고칠 문제가 하나 이상 있어야 한다."""
    model_config = ConfigDict(extra='forbid')
    passed: bool
    issues: list[str]

    @model_validator(mode='after')
    def failed_review_says_what_to_fix(self):
        if not self.passed and not self.issues:
            raise ValueError('NO_ISSUES')
        return self


class SimulationResponse(BaseModel):
    scene: str
    credits: float
    usage: Usage


class EpisodeResponse(BaseModel):
    summary: str
    title: str
    text: str
    review: Review
    credits: float
    usage: Usage
