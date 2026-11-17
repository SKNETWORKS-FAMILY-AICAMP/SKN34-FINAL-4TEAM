"""전개 기획·새 원고·부분 수정 계약."""

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


class PlanResponse(PlanOutput):
    model: str
    providerResponseId: str
    usage: Usage | None


class PatchResponse(BaseModel):
    before: str
    after: str
    model: str
    providerResponseId: str
    usage: Usage | None
