"""AI 자율 연재 계약(#659): 다음 전개 선택지, 시뮬레이션 장면 미리보기, 다음 회차 생성·검수. 요청 한도는 docs/design/ai-serial-contract.md와 같다."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

Beat = Annotated[str, Field(min_length=1, max_length=200)]


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class Run(BaseModel):
    """세 요청이 공유하는 필드: 작품·대상 회차·모델에 줄 문맥 JSON(요청마다 Content가 정한 범위)·크레딧 상한."""
    workId: str = Field(min_length=1, max_length=100)
    episodeNumber: int = Field(ge=1)
    context: str = Field(min_length=1, max_length=60000)
    creditLimit: float = Field(gt=0, allow_inf_nan=False)  # Content가 예약한 상한(크레딧)
    creditReservationId: str | None = Field(default=None, max_length=100)  # 선택: 추적 metadata credit_reservation_id에만 쓴다


class ChoicesRequest(Run):
    direction: str = Field(default='', max_length=2000)  # 소유자가 정한 연재 방향(소유자만 본다)


class SimulationRequest(Run):
    premise: str = Field(min_length=1, max_length=500)
    beats: list[Beat] = Field(default=[], max_length=5)


class TopChoice(BaseModel):
    """투표 1위 선택지. 표가 없으면 Content가 1번을 votes 0으로 보낸다."""
    text: str = Field(min_length=1, max_length=300)
    votes: int = Field(ge=0)


class Proposal(BaseModel):
    """추천 상위 제안 글. scene은 simulation 글에 붙은 장면 미리보기이고, simulation 글은 body가 비어 있을 수 있다."""
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(default='', max_length=2000)
    likes: int = Field(ge=0)
    scene: str | None = Field(default=None, max_length=1500)


class EpisodeRequest(Run):
    direction: str = Field(default='', max_length=2000)
    choice: TopChoice | None = None  # 선택지가 없으면 null
    proposals: list[Proposal] = Field(default=[], max_length=3)


class ChoiceList(BaseModel):
    """선택지 생성의 모델 구조화 출력. 개수·길이 한도는 strict 스키마가 표현하지 못해 service가 확인한다."""
    model_config = ConfigDict(extra='forbid')
    choices: list[str]


class Summary(BaseModel):
    """투표·제안 종합의 모델 구조화 출력. 길이 한도는 strict 스키마가 표현하지 못해 service가 확인한다."""
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


class ChoicesResponse(BaseModel):
    choices: list[str]
    credits: float
    usage: Usage


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
