"""집필 AI 오케스트레이션 내부 API 계약. 단계 입력은 Content가 권한·대상·판본을 확인해 기능별로 채운다."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.intent.models import Feature
from app.manuscript.models import AnswerRequest, AnswerResponse, Excerpt
from app.research.models import ResearchRequest, ResearchResponse
from app.retrieval.models import Coverage, RetrievalScope
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


class Conversation(BaseModel):
    """Content가 발급한 대화 id와 Content가 확인한 사용자·작품 scope(예: user:1/work:2)."""
    model_config = ConfigDict(extra='forbid')
    threadId: str = Field(min_length=1, max_length=100)
    scope: str = Field(min_length=1, max_length=200)


class WritingTarget(BaseModel):
    """Content가 권한을 확인한 Writing 반영 대상. 작가가 승인하면 AI가 그 작가 권한으로 이 회차 초안에만 쓴다."""
    model_config = ConfigDict(extra='forbid')
    workId: str = Field(min_length=1, max_length=100)
    episode: int = Field(ge=1)


class Resume(BaseModel):
    """interrupt로 멈춘 실행에 대한 작가·Content의 답. 입력 대기면 빠진 단계 입력을, 반영 승인 대기면 승인 여부만 보낸다."""
    model_config = ConfigDict(extra='forbid')
    approved: bool
    inputs: StepInputs = StepInputs()
    scope: RetrievalScope | None = None  # Content가 resume 때 새로 서명한 Q&A 조회 토큰


class OrchestrationRequest(BaseModel):
    """새 턴은 request, 멈춘 실행을 이어갈 때는 같은 conversation의 resume 하나만 보낸다."""
    model_config = ConfigDict(extra='forbid')
    conversation: Conversation | None = None
    scope: RetrievalScope | None = None  # 있으면 Q&A가 inputs 없이 Retrieval 도구로 근거를 받는다.
    request: str | None = Field(default=None, min_length=1, max_length=2000)
    resume: Resume | None = None
    target: WritingTarget | None = None  # 있고 대화 안이면 Writing 결과를 승인받아 Content MCP로 초안에 반영한다.
    operation: Feature | None = None
    materials: list[Annotated[str, Field(max_length=2000)]] = Field(default=[], max_length=8)
    inputs: StepInputs = StepInputs()

    @model_validator(mode='after')
    def turn_or_resume(self):
        if (self.request is None) == (self.resume is None):
            raise ValueError('request와 resume 중 하나만 보내야 합니다.')
        if self.resume is not None and self.conversation is None:
            raise ValueError('resume은 conversation이 필요합니다.')
        return self


class QaStepResult(AnswerResponse):
    """Q&A 단계 결과. sources는 답변이 인용한 근거, gaps에는 검색 단계의 누락도 담긴다. coverage는 Retrieval을 쓴 경우만."""
    sources: list[Excerpt] = []
    coverage: Coverage | None = None


class AppliedDraft(BaseModel):
    """Content MCP가 저장한 회차 초안의 새 revision."""
    episode: int
    revision: int


class StepResult(BaseModel):
    feature: Feature
    when: Literal['always', 'if_issues_found']
    status: Literal['completed', 'failed', 'not_started']
    result: QaStepResult | DraftResponse | PatchResponse | ResearchResponse | None = None
    error: str | None = None
    approval: Literal['approved', 'declined'] | None = None  # Writing 결과 반영에 대한 작가의 답
    applied: AppliedDraft | None = None


class OrchestrationResponse(BaseModel):
    """steps는 계획 순서다. clarify·rejected·unsupported·needs_input·cancelled면 아무 Agent도 실행하지 않았다.

    waiting은 대화 안에서 멈춘 상태이며 같은 conversation의 resume으로 이어간다. 입력 대기면 missingInputs,
    Writing 결과 반영 승인 대기면 awaitingApproval이 있다.
    """
    status: Literal['completed', 'failed', 'clarify', 'rejected', 'unsupported', 'needs_input', 'waiting', 'cancelled']
    runId: str | None = None  # Langfuse trace id. 추적이 꺼져 있으면 없다.
    message: str | None = None
    steps: list[StepResult] = []
    missingInputs: list[Feature] = []
    unsupported: list[Feature] = []
    awaitingApproval: Feature | None = None
