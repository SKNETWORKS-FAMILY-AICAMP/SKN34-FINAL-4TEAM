"""AI 자율 연재 계약(#659): 다음 전개 선택지, 회차 요약, 시뮬레이션 장면 미리보기, 다음 회차 생성·검수. 요청 한도는 docs/design/ai-serial-contract.md와 같다."""

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

Beat = Annotated[str, Field(min_length=1, max_length=200)]


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class Run(BaseModel):
    """네 요청이 공유하는 필드: 작품·대상 회차·크레딧 상한."""
    workId: str = Field(min_length=1, max_length=100)
    episodeNumber: int = Field(ge=1)
    creditLimit: float = Field(gt=0, allow_inf_nan=False)  # Content가 예약한 상한(크레딧)
    creditReservationId: str | None = Field(default=None, max_length=100)  # 선택: 추적 metadata credit_reservation_id에만 쓴다


class ContextRun(Run):
    """모델에 문맥 JSON을 주는 요청(선택지·시뮬레이션·회차 실행). Content의 serialContext: 작품 제목·소개(title·summary), 최근 회차 원문(episodes),
    그 이전 회차의 요약(summaries), 설정 카드(cards), 회차 실행만 관련 장면 인용(related). 시뮬레이션은 독자에게 공개된 범위다."""
    context: str = Field(min_length=1, max_length=60000)


class ChoicesRequest(ContextRun):
    direction: str = Field(default='', max_length=2000)  # 소유자가 정한 연재 방향(소유자만 본다)


class SummaryRequest(Run):
    """발행된 회차 하나의 요약 요청. 문맥 없이 제목·본문만 모델에 간다."""
    title: str = Field(min_length=1, max_length=120)  # Content 회차 제목 한도
    body: str = Field(min_length=1, max_length=40000)  # Content 회차 본문 한도


class SimulationRequest(ContextRun):
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


class EpisodeRequest(ContextRun):
    direction: str = Field(default='', max_length=2000)
    choice: TopChoice | None = None  # 선택지가 없으면 null
    proposals: list[Proposal] = Field(default=[], max_length=3)
    # 인물 시뮬레이션의 입력: Content가 읽은 연결 세계관(없으면 Fork가 이어받는 원작 세계관)의 MCP world_studio_read(id, 직전 발행 회차) 응답 모양에
    # 「동일 인물」 관계를 최신 시점으로 읽은 identity를 더한 것. 일정 실행에는 사용자 토큰이 없어 AI가 Content MCP를 부르지 않는다. 모양 검사는 엔진(world_from)이 한다.
    world: dict[str, Any]


class ChoiceList(BaseModel):
    """선택지 생성의 모델 구조화 출력. 개수·길이 한도는 strict 스키마가 표현하지 못해 service가 확인한다."""
    model_config = ConfigDict(extra='forbid')
    choices: list[str]


class Summary(BaseModel):
    """요약·종합(투표·제안 종합, 회차 요약)의 모델 구조화 출력. 길이 한도는 strict 스키마가 표현하지 못해 service가 확인한다."""
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


class SummaryResponse(BaseModel):
    summary: str
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
