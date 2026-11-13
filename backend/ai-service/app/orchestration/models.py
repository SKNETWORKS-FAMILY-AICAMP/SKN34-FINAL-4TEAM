"""집필 AI 오케스트레이션 내부 API 계약. 단계 입력은 Content가 권한·대상·판본을 확인해 기능별로 채운다."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.intent.models import Feature
from app.manuscript.models import AnswerRequest, AnswerResponse
from app.research.models import ResearchRequest, ResearchResponse
from app.writing.models import DraftRequest, DraftResponse, PatchRequest, PatchResponse


class WritingInput(BaseModel):
    """Writing & Editing은 한 기능이며 새 원고(draft)와 선택 구간 수정(patch) 중 하나만 받는다."""
    model_config = ConfigDict(extra='forbid')
    draft: DraftRequest | None = None
    patch: PatchRequest | None = None

    @model_validator(mode='after')
    def one(self):
        if (self.draft is None) == (self.patch is None):
            raise ValueError('draft와 patch 중 하나만 보내야 합니다.')
        return self


class StepInputs(BaseModel):
    """구현된 업무 Agent별 입력. 선행 결과 전달 연결이 없어 각 단계는 자기 입력으로만 실행한다."""
    model_config = ConfigDict(extra='forbid')
    story_context: AnswerRequest | None = None
    writing_editing: WritingInput | None = None
    web_research: ResearchRequest | None = None


class OrchestrationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request: str = Field(min_length=1, max_length=2000)
    operation: Feature | None = None
    materials: list[Annotated[str, Field(max_length=2000)]] = Field(default=[], max_length=8)
    inputs: StepInputs = StepInputs()


class StepResult(BaseModel):
    feature: Feature
    when: Literal['always', 'if_issues_found']
    status: Literal['completed', 'failed', 'not_started']
    result: AnswerResponse | DraftResponse | PatchResponse | ResearchResponse | None = None
    error: str | None = None


class OrchestrationResponse(BaseModel):
    """steps는 계획 순서다. clarify·rejected·unsupported·needs_input이면 아무 Agent도 실행하지 않았다."""
    status: Literal['completed', 'failed', 'clarify', 'rejected', 'unsupported', 'needs_input']
    message: str | None = None
    steps: list[StepResult] = []
    missingInputs: list[Feature] = []
    unsupported: list[Feature] = []
