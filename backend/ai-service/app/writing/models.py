"""전개 기획·새 원고·부분 수정·기존 계획 수정 계약."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DraftRequest(BaseModel):
    episodeNumber: int = Field(ge=1)
    plan: str = Field(min_length=1, max_length=4000)
    # Content의 허용 문맥 JSON(작성 중 초안 ≤40,000자 포함). 기존 이어쓰기 문맥 한도와 같다.
    context: str = Field(default='', max_length=60000)


class PlanRequest(BaseModel):
    """전개 기획(#387). request는 작가 요청 문장이며 그 안의 콘티·조건을 계획에 따른다."""
    episodeNumber: int = Field(ge=1)
    request: str = Field(min_length=1, max_length=2000)
    single: bool = False  # 바로 집필이면 계획 하나만, 기획만이면 대안 1~3개
    context: str = Field(default='', max_length=60000)
    # 같은 대화의 가장 최근 기획 결과. "첫 번째 안으로" 같은 지칭을 풀 때만 쓴다(대화 기록 전체는 보내지 않는다).
    previousPlans: list['BeatPlan'] = Field(default=[], max_length=3)


class BeatPlan(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str
    beats: list[str]  # 장면·사건 순서


PlanRequest.model_rebuild()


class PlanOutput(BaseModel):
    """모델 구조화 출력. 개수 한도는 strict 스키마가 표현하지 못해 agent.plan이 확인한다."""
    model_config = ConfigDict(extra='forbid')
    plans: list[BeatPlan]
    notes: list[str]  # 확정·예정 사건 구분, 근거 부족 같은 참고


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
    plan: BeatPlan | None = None  # 계획 없이 바로 집필한 경우 스스로 정해 쓴 계획
    gaps: list[str] = []  # 설정 없이 쓴 이유 같은 알림. 모델 출력이 아니라 허용 문맥을 만든 쪽(ask_writing)이 채운다


class PlanResponse(PlanOutput):
    model: str
    providerResponseId: str
    usage: Usage | None
    gaps: list[str] = []


class PatchResponse(BaseModel):
    before: str
    after: str
    model: str
    providerResponseId: str
    usage: Usage | None


# 기존 플롯·장면 계획 수정(#578). 수정 범위는 제목·내용뿐이며 Content StoryPlan의 한도와 같다.
PLAN_TITLE_MAX, PLAN_CONTENT_MAX = 120, 8000


class PlanBrief(BaseModel):
    """모델에 보내는 계획 요약. 대상을 고르는 데 필요한 것만 담고 본문은 넣지 않는다."""
    id: str
    kind: Literal['plot', 'scene']
    title: str
    episodeNumber: int | None = None
    plot: str | None = None  # 장면이 속한 플롯 제목


class PlanPickRequest(BaseModel):
    request: str = Field(min_length=1, max_length=2000)
    plans: list[PlanBrief]


class PlanPick(BaseModel):
    """모델 구조화 출력(호출 1): 요청이 가리키는 계획 하나. 하나로 정할 수 없으면 null."""
    model_config = ConfigDict(extra='forbid')
    planId: str | None


class PlanReviseRequest(BaseModel):
    """고칠 계획 하나(Content가 읽은 최신 값)와 수정 지시. revision은 제안의 기준이라 모델에 보내지 않는다."""
    request: str = Field(min_length=1, max_length=2000)
    plan: PlanBrief
    content: str
    revision: int


class PlanText(BaseModel):
    """계획의 제목·내용. 모델 구조화 출력(호출 2)이자 제안의 변경 전·후다. 한도는 strict 스키마가 표현하지 못해 agent가 확인한다."""
    model_config = ConfigDict(extra='forbid')
    title: str
    content: str


class PlanRevision(BaseModel):
    """계획 수정 제안. 저장은 작가 승인 뒤 Content MCP가 하며, revision은 제안을 만든 때의 계획 revision이다."""
    planId: str
    kind: Literal['plot', 'scene']
    revision: int
    before: PlanText
    after: PlanText
    model: str
    providerResponseId: str
    usage: Usage | None
