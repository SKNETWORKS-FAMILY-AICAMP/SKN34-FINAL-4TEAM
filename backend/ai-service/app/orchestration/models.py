"""집필 AI 오케스트레이션 내부 API 계약. 단계 입력은 Content가 권한·대상·판본을 확인해 기능별로 채운다."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.intent.models import Feature
from app.story_qa.models import AnswerRequest, AnswerResponse, Excerpt
from app.rating.models import RatingResponse
from app.research.models import ResearchRequest, ResearchResponse
from app.retrieval.models import Coverage, RetrievalScope
from app.review.models import ReviewResponse, Scope
from app.simulation.models import SceneAction, SimulationPlan, SimulationResult
from app.world_review.models import WorldReviewResponse
from app.writing.models import DraftRequest, DraftResponse, PatchRequest, PatchResponse, PlanResponse

# 저장된 응답의 기능 이름. #387 전 대화 기록에는 Writing & Editing으로 합쳐진 story_development가 남아 있다.
RecordedFeature = Feature | Literal['story_development']


class WritingInput(BaseModel):
    """Writing & Editing은 한 기능이며 새 원고(draft)·선택 구간 수정(patch)·조건부 수정에서 고른 검수 지적 번호(fix) 중 하나만 받는다.

    전개 기획과 계획 없는 바로 집필은 입력 없이 요청 문장과 반영 대상(target)으로 실행한다(#387).
    """
    model_config = ConfigDict(extra='forbid')
    draft: DraftRequest | None = None
    patch: PatchRequest | None = None
    fix: int | None = Field(default=None, ge=0)  # 직전 Review 결과 findings의 번호(#370)

    @model_validator(mode='after')
    def one(self):
        if [self.draft, self.patch, self.fix].count(None) != 2:
            raise ValueError('draft·patch·fix 중 하나만 보내야 합니다.')
        return self


class ReviewInput(BaseModel):
    """원고 검수의 검사 종류. 대상 초안은 Content가 확인한 반영 대상(target) 회차라 입력으로 받지 않는다."""
    model_config = ConfigDict(extra='forbid')
    check: Scope


class StepInputs(BaseModel):
    """구현된 업무 Agent별 입력. 선행 결과 전달 연결이 없어 각 단계는 자기 입력으로만 실행한다.

    인물 시뮬레이션은 입력이 없다. 요청 문장과 연결 세계관으로 계획을 정하고 모자라면 채팅으로 되묻는다.
    """
    model_config = ConfigDict(extra='forbid')
    story_context: AnswerRequest | None = None
    writing_editing: WritingInput | None = None
    web_research: ResearchRequest | None = None
    review: ReviewInput | None = None


class Conversation(BaseModel):
    """Content가 발급한 대화 id와 Content가 확인한 사용자·작품 scope(예: user:1/work:2)."""
    model_config = ConfigDict(extra='forbid')
    threadId: str = Field(min_length=1, max_length=100)
    scope: str = Field(min_length=1, max_length=200)


class WritingTarget(BaseModel):
    """Content가 권한을 확인한 Writing 반영 대상. 작가가 승인하면 AI가 그 작가 권한으로 이 회차 초안에만 쓴다.

    baseEpisode는 근거 회차(시뮬레이션이 세계관을 읽는 지식 상한)다. 작가가 발행 전 초안을 열어 둬 반영 회차(episode)가 근거 회차와
    다를 때만 오고, 없으면 episode와 같다.
    """
    model_config = ConfigDict(extra='forbid')
    workId: str = Field(min_length=1, max_length=100)
    episode: int = Field(ge=1)
    baseEpisode: int | None = Field(default=None, ge=1)


class Resume(BaseModel):
    """interrupt로 멈춘 실행에 대한 작가·Content의 답. 입력 대기면 빠진 단계 입력을, 반영 승인 대기면 승인 여부만 보낸다.

    scene은 시뮬레이션 무대의 장면 조작(next·edit·redo·stop)이다. scene이 있으면 approved는 적용하지 않고 장면을 처리한 뒤 다시 멈춘다
    (승인·거절은 scene 없는 resume으로만 한다).
    """
    model_config = ConfigDict(extra='forbid')
    approved: bool
    inputs: StepInputs = StepInputs()
    scope: RetrievalScope | None = None  # Content가 resume 때 새로 서명한 Q&A 조회 토큰
    scene: SceneAction | None = None


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
    fromTurn: int | None = Field(default=None, ge=0)  # 있으면 그 턴부터 지우고 이 request로 다시 실행한다(메시지 수정).
    # [시뮬레이션] 버튼의 시작 양식(계약 '버튼 진입'). character_simulation 새 요청에서만 받고 길이·개수 한도는 SimulationPlan이 지킨다.
    # ask_character_simulation이 모델 없이 이 값을 계획으로 쓰고 연결 세계관으로 확인한다.
    simulation: SimulationPlan | None = None

    @model_validator(mode='after')
    def turn_or_resume(self):
        if (self.request is None) == (self.resume is None):
            raise ValueError('request와 resume 중 하나만 보내야 합니다.')
        if (self.resume is not None or self.fromTurn is not None) and self.conversation is None:
            raise ValueError('resume·fromTurn은 conversation이 필요합니다.')
        if self.simulation is not None and (self.operation != 'character_simulation' or self.request is None):
            raise ValueError('simulation은 character_simulation 새 요청에서만 보낼 수 있습니다.')
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
    feature: RecordedFeature
    when: Literal['always', 'if_issues_found']
    task: Literal['plan', 'draft', 'patch'] | None = None  # Writing & Editing 단계에 메인 에이전트가 정한 작업 종류(#387·#473)
    # 끝까지 가지 못한 시뮬레이션 장면은 부분 result와 함께 failed다. skipped는 조건부 수정이 고칠 확정 지적이 없어 건너뛴 단계다(#370).
    status: Literal['completed', 'failed', 'not_started', 'skipped']
    result: QaStepResult | PlanResponse | DraftResponse | PatchResponse | ResearchResponse | SimulationResult | ReviewResponse | WorldReviewResponse | RatingResponse | None = None
    error: str | None = None  # 실패 사유, skipped면 건너뛴 이유
    approval: Literal['approved', 'declined'] | None = None  # Writing 결과·시뮬레이션 장면 반영에 대한 작가의 답
    applied: AppliedDraft | None = None


class OrchestrationResponse(BaseModel):
    """steps는 메인 에이전트가 서브 에이전트를 부른 순서다. message는 메인 에이전트의 종합 답변이거나 실행하지 않은 턴의 고정 문구다.

    rejected·unsupported와 고정 확인 질문의 clarify면 아무 Agent도 실행하지 않았다. needs_input·cancelled는 그 앞에서 끝낸 단계만 있다.

    waiting은 대화 안에서 멈춘 상태이며 같은 conversation의 resume으로 이어간다. 입력 대기면 missingInputs,
    Writing 결과·시뮬레이션 장면 반영 승인 대기면 awaitingApproval, 시뮬레이션 장면의 턴 사이 대기면 awaitingScene이 있다.
    """
    status: Literal['completed', 'failed', 'clarify', 'rejected', 'unsupported', 'needs_input', 'waiting', 'cancelled']
    runId: str | None = None  # Langfuse trace id. 추적이 꺼져 있으면 없다.
    message: str | None = None
    steps: list[StepResult] = []
    missingInputs: list[Feature] = []
    unsupported: list[RecordedFeature] = []
    awaitingApproval: Feature | None = None
    awaitingScene: Feature | None = None  # 시뮬레이션 장면이 턴 사이에서 작가의 조작(resume.scene)을 기다린다
    approvalEpisode: int | None = None


class ChatSession(BaseModel):
    """체크포인터에 남은 대화 하나. 제목은 첫 요청 앞부분이며 rename으로 바꾼다."""
    threadId: str
    title: str
    updatedAt: datetime


class ChatTurn(BaseModel):
    """한 턴의 요청과 그 턴의 최종 응답. 멈춘 턴은 reply.status가 waiting이다."""
    request: str
    reply: OrchestrationResponse | None = None  # 응답 기록 이전에 저장된 턴은 없다.


class ChatHistory(BaseModel):
    threadId: str
    title: str
    turns: list[ChatTurn]


class RenameRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    scope: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=100)
