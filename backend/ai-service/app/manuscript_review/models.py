"""원고 검수(Review) 내부 API 계약."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Check = Literal['mechanical', 'semantic']
Scope = Check | Literal['both']  # both는 두 검수를 병렬로 돌려 Semantic → Mechanical 순서로 합친다(#369)
CATEGORIES: dict[str, tuple[str, ...]] = {
    'mechanical': ('number', 'name', 'date', 'repetition', 'spelling'),
    'semantic': ('setting', 'knowledge', 'emotion', 'causality', 'foreshadowing'),
}
Category = Literal[CATEGORIES['mechanical'] + CATEGORIES['semantic']]


class ReviewRequest(BaseModel):
    workId: str = Field(min_length=1, max_length=100)
    episode: int = Field(ge=1)
    check: Scope


class DraftFinding(BaseModel):
    """모델이 쓴 지적 하나. quote는 원고에서 그대로 옮긴 구절, evidenceRefs는 입력으로 받은 설정 ref다."""
    model_config = ConfigDict(extra='forbid')  # OpenAI strict 구조화 출력은 additionalProperties=false 스키마만 받는다
    category: Category
    quote: str
    reason: str
    status: Literal['confirmed', 'suspected', 'undeterminable']
    evidenceRefs: list[str]
    suggestion: str


class ReviewResult(BaseModel):
    """모델 structured output. gaps는 자료가 없어 확인하지 못한 부분이다."""
    model_config = ConfigDict(extra='forbid')
    findings: list[DraftFinding]
    gaps: list[str]


class Finding(DraftFinding):
    """위치는 초안 본문 안의 UTF-16 반열림 [start,end)다. 같은 구절이 여러 곳에 있으면 추측하지 않고 null이다."""
    start: int | None
    end: int | None


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class ReviewResponse(BaseModel):
    workId: str
    episode: int
    revision: int
    check: Scope
    findings: list[Finding]
    gaps: list[str]
    model: str
    providerResponseId: str  # both면 두 응답 ID를 Semantic, Mechanical 순서로 쉼표로 잇는다
    usage: Usage | None
