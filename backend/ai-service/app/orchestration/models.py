"""집필 AI 오케스트레이션 내부 API 계약. 단계 입력은 Content가 권한·대상·판본을 확인해 기능별로 채운다."""

import base64
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.intent.models import Feature
from app.story_qa.models import AnswerRequest, AnswerResponse, Excerpt
from app.rating.models import RatingResponse
from app.research.models import PlatformResult, ResearchRequest, ResearchResponse
from app.retrieval.models import Coverage, RetrievalScope
from app.manuscript_review.models import ReviewResponse, Scope
from app.simulation.models import SceneAction, SimulationPlan, SimulationResult
from app.world_review.models import EnrichResponse, ImpactResponse, WorldReviewResponse
from app.writing.models import DraftRequest, DraftResponse, PatchRequest, PatchResponse, PlanResponse, PlanRevision

# 이전 체크포인트는 기록 당시의 단계 식별자를 보존한다(#387·#499). #387 전 대화 기록에는 Writing & Editing으로 합쳐진 story_development가, #499 전에는 review가,
# World Agent(#546) 전에는 옛 설정집 검토 world_review와 미구현 판정 world_plot이, Research(#545) 전에는 web_research가 남아 있다.
# 이력을 다시 읽을 때 형식 오류가 되지 않게 읽기만 받는다.
RecordedFeature = Feature | Literal['story_development', 'review', 'world_review', 'world_plot', 'web_research', 'content_action']
RENAMED_FEATURES = {'review': 'manuscript_review', 'web_research': 'research'}
CONTENT_ACTION = 'content_action'  # 메인 에이전트가 승인 뒤 직접 실행한 Content MCP 쓰기 도구(#554)의 단계·승인 대기 이름
AwaitingApproval = Feature | Literal['content_action']


def current_feature(feature: str) -> str:
    """옛 기능 키를 지금 키로 바꾼다. 선택 기능·입력 대기 목록·체크포인트의 판정 기능을 읽을 때 쓴다."""
    return RENAMED_FEATURES.get(feature, feature)


CurrentFeature = Annotated[Feature, BeforeValidator(current_feature)]


class WritingInput(BaseModel):
    """Writing & Editing은 한 기능이며 새 원고(draft)·선택 구간 수정(patch)·조건부 수정에서 고른 검수 지적 번호(fix) 중 하나만 받는다.

    전개 기획과 계획 없는 바로 집필은 입력 없이 요청 문장과 반영 대상(target)으로 실행한다(#387).
    """
    model_config = ConfigDict(extra='forbid')
    draft: DraftRequest | None = None
    patch: PatchRequest | None = None
    fix: int | None = Field(default=None, ge=0)  # 직전 Manuscript Review 결과 findings의 번호(#370)

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
    research: ResearchRequest | None = Field(default=None, validation_alias=AliasChoices('research', 'web_research'))
    manuscript_review: ReviewInput | None = Field(default=None, validation_alias=AliasChoices('manuscript_review', 'review'))


class Conversation(BaseModel):
    """Content가 발급한 대화 id와 Content가 확인한 사용자·작품 scope(예: user:1/work:2)."""
    model_config = ConfigDict(extra='forbid')
    threadId: str = Field(min_length=1, max_length=100)
    scope: str = Field(min_length=1, max_length=200)


class WritingTarget(BaseModel):
    """Content가 권한을 확인한 Writing 반영 대상. 작가가 승인하면 AI가 그 작가 권한으로 이 회차 초안에만 쓴다.

    baseEpisode는 근거 회차(시뮬레이션이 세계관을 읽는 지식 상한)다. 작가가 발행 전 초안을 열어 둬 반영 회차(episode)가 근거 회차와
    다를 때만 오고, 없으면 episode와 같다. fork는 Fork 작품이면 Content가 true로 보내며 추적 metadata에만 쓴다(DEC-55 누설 표본 검사).
    episodeVersionId는 Content가 확정한 근거 회차의 판본이다. AI는 해석하지 않고 저장했다가 멈춘 응답의 basis로 돌려준다(#668).
    """
    model_config = ConfigDict(extra='forbid')
    workId: str = Field(min_length=1, max_length=100)
    episode: int = Field(ge=1)
    baseEpisode: int | None = Field(default=None, ge=1)
    episodeVersionId: str | None = Field(default=None, min_length=1, max_length=100)  # #668 전에 멈춘 턴에는 없다
    fork: bool | None = None


class PageContent(BaseModel):
    """저장하지 않은 편집 내용. 카드 본문은 3,000자 이하라 통째로, 회차 원고는 10,000자까지 보내고 넘치면 잘라 truncated를 붙인다."""
    model_config = ConfigDict(extra='forbid')
    title: str | None = Field(default=None, max_length=300)
    body: str = Field(max_length=10000)
    unsaved: Literal[True]
    truncated: bool = False


class PageContext(BaseModel):
    """작가가 지금 보고 있는 화면(#554, Content가 사용자 권한으로 확인한 값). 표시·맥락용이며 인가 근거가 아니다. 그 턴에만 쓰고 대화 기록에 남기지 않는다."""
    model_config = ConfigDict(extra='forbid')
    path: str = Field(max_length=300)
    kind: Literal['studio', 'world']
    episode: int | None = Field(default=None, ge=1)  # studio: 지금 연 회차
    worldId: str | None = Field(default=None, max_length=100)  # world
    cardId: str | None = Field(default=None, max_length=100)
    view: str | None = Field(default=None, max_length=40)
    selection: str | None = Field(default=None, min_length=1, max_length=5000)  # 편집기에서 선택한 글(PatchRequest.selection 상한과 같다)
    content: PageContent | None = None


IMAGE_TYPES = ('image/png', 'image/jpeg', 'image/webp')  # GIF는 받지 않는다(gpt-6-luna가 움직이는 GIF를 거절한다)
IMAGE_MAX_BYTES = 5 * 1024 * 1024
TEXT_MAX_CHARS = 20000
ATTACHMENT_MAX = 3


class Attachment(BaseModel):
    """채팅 첨부 하나(#617). 이번 새 요청에서만 오고 그 턴의 메인 에이전트만 원본을 본다. 형식·크기·인코딩은 Content가 대충 거른 뒤 여기서 다시 확인한다.

    이미지(PNG·JPEG·WEBP)는 5MB 이하, 텍스트(.txt·.md)는 UTF-8이고 20,000자 이하다. data는 Base64다(5MB의 Base64 길이가 상한, Content `WritingAiAttachment`와 같다).
    """
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=200)
    mediaType: Literal['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown']
    data: str = Field(min_length=1, max_length=6_990_508)

    @model_validator(mode='after')
    def decodable(self):
        raw = base64.b64decode(self.data, validate=True)  # 잘못된 Base64는 ValueError라 검증 실패가 된다
        if self.mediaType in IMAGE_TYPES:
            if len(raw) > IMAGE_MAX_BYTES:
                raise ValueError('이미지는 5MB 이하여야 합니다.')
        elif len(raw.decode('utf-8')) > TEXT_MAX_CHARS:  # UnicodeDecodeError도 ValueError다
            raise ValueError('텍스트 파일은 20,000자 이하여야 합니다.')
        return self


class AttachmentRef(BaseModel):
    """대화 기록에 남는 첨부 표시. 원본은 남기지 않고 이름과 종류만 둔다."""
    name: str
    kind: Literal['image', 'text']


class Resume(BaseModel):
    """interrupt로 멈춘 실행에 대한 작가·Content의 답. 입력 대기면 빠진 단계 입력을, 반영 승인 대기면 승인 여부만 보낸다.

    scene은 시뮬레이션 무대의 장면 조작(next·edit·redo·stop)이다. scene이 있으면 approved는 적용하지 않고 장면을 처리한 뒤 다시 멈춘다
    (승인·거절은 scene 없는 resume으로만 한다).
    refresh는 Content 쓰기 승인 대기에서 오래된 제안을 실행하지 않고 멈춘 자리에서 새 제안을 받는 답이다(#662, approved=false).
    """
    model_config = ConfigDict(extra='forbid')
    approved: bool
    inputs: StepInputs = StepInputs()
    scope: RetrievalScope | None = None  # Content가 resume 때 새로 서명한 Q&A 조회 토큰
    scene: SceneAction | None = None
    refresh: bool = False

    @model_validator(mode='after')
    def refresh_never_approves(self):
        if self.refresh and self.approved:
            raise ValueError('refresh는 approved=false로만 보낼 수 있습니다.')
        return self


class OrchestrationRequest(BaseModel):
    """새 턴은 request(와 작가가 보는 화면 page), 멈춘 실행을 이어갈 때는 같은 conversation의 resume 하나만 보낸다."""
    model_config = ConfigDict(extra='forbid')
    conversation: Conversation | None = None
    scope: RetrievalScope | None = None  # 있으면 Q&A가 inputs 없이 Retrieval 도구로 근거를 받는다.
    request: str | None = Field(default=None, min_length=1, max_length=2000)
    resume: Resume | None = None
    target: WritingTarget | None = None  # 있고 대화 안이면 Writing 결과를 승인받아 Content MCP로 초안에 반영한다.
    operation: CurrentFeature | None = None
    materials: list[Annotated[str, Field(max_length=2000)]] = Field(default=[], max_length=8)
    inputs: StepInputs = StepInputs()
    fromTurn: int | None = Field(default=None, ge=0)  # 있으면 그 턴부터 지우고 이 request로 다시 실행한다(메시지 수정).
    # [시뮬레이션] 버튼의 시작 양식(계약 '버튼 진입'). character_simulation 새 요청에서만 받고 길이·개수 한도는 SimulationPlan이 지킨다.
    # ask_character_simulation이 모델 없이 이 값을 계획으로 쓰고 연결 세계관으로 확인한다.
    simulation: SimulationPlan | None = None
    page: PageContext | None = None  # 새 요청에서만: 작가가 지금 보는 화면(메인 에이전트와 Decision Guard가 그 턴에만 본다)
    attachments: list[Attachment] = Field(default=[], max_length=ATTACHMENT_MAX)  # 새 요청에서만: 이번 턴의 메인 에이전트만 보는 참고 자료(#617)

    @model_validator(mode='after')
    def turn_or_resume(self):
        if self.attachments and self.resume is not None:
            raise ValueError('attachments는 새 요청에서만 보낼 수 있습니다.')
        if (self.request is None) == (self.resume is None):
            raise ValueError('request와 resume 중 하나만 보내야 합니다.')
        if (self.resume is not None or self.fromTurn is not None) and self.conversation is None:
            raise ValueError('resume·fromTurn은 conversation이 필요합니다.')
        if self.page is not None and self.request is None:
            raise ValueError('page는 새 요청에서만 보낼 수 있습니다.')
        if self.simulation is not None and (self.operation != 'character_simulation' or self.request is None):
            raise ValueError('simulation은 character_simulation 새 요청에서만 보낼 수 있습니다.')
        return self


class QaStepResult(AnswerResponse):
    """Q&A 단계 결과. sources는 답변이 인용한 근거, gaps에는 검색 단계의 누락도 담긴다. coverage는 Retrieval을 쓴 경우만."""
    sources: list[Excerpt] = []
    coverage: Coverage | None = None


class AppliedDraft(BaseModel):
    """Content MCP가 저장한 초안의 새 revision. Writing·시뮬레이션은 회차 초안, World 보강 제안은 세계관 초안, 계획 수정은 그 계획이다(episode는 뜻 없이 채팅 대상 회차)."""
    episode: int
    revision: int


class ActionResult(BaseModel):
    """승인 뒤 실행한 Content MCP 쓰기 도구(content_action 단계). 수정한 내용 자체는 Content가 정본이라 도구 이름과 고정 문구만 남긴다."""
    tool: str
    label: str


class PendingAction(BaseModel):
    """작가의 승인을 기다리는 Content MCP 쓰기 도구. 모델의 요약이 아니라 실제로 실행할 도구와 인자다(label은 도구별 고정 한국어 문구)."""
    tool: str
    label: str
    args: dict


class StepResult(BaseModel):
    feature: RecordedFeature
    when: Literal['always', 'if_issues_found']
    # 메인 에이전트가 정한 작업 종류: Writing & Editing은 plan·draft·patch·revise_plan(#387·#473·#578), World는 check·enrich·impact(#546·#291)
    task: Literal['plan', 'draft', 'patch', 'revise_plan', 'check', 'enrich', 'impact'] | None = None
    # 끝까지 가지 못한 시뮬레이션 장면은 부분 result와 함께 failed다. skipped는 조건부 수정이 고칠 확정 지적이 없어 건너뛴 단계다(#370).
    status: Literal['completed', 'failed', 'not_started', 'skipped']
    result: (QaStepResult | PlanResponse | DraftResponse | PatchResponse | PlanRevision | ResearchResponse | PlatformResult | SimulationResult | ReviewResponse | WorldReviewResponse
             | EnrichResponse | ImpactResponse | RatingResponse | ActionResult | None) = None
    error: str | None = None  # 실패 사유, skipped면 건너뛴 이유
    approval: Literal['approved', 'declined'] | None = None  # Writing 결과·시뮬레이션 장면·World 보강 제안·계획 수정안 반영에 대한 작가의 답
    applied: AppliedDraft | None = None  # World 보강 제안·계획 수정이면 episode는 채팅 대상 회차를 그대로 싣고 revision은 반영 뒤 세계관 초안·계획 revision이다


class Basis(BaseModel):
    """멈춘 턴이 시작한 근거 회차·판본. Content가 이어가기의 조회 토큰을 이 값으로 다시 서명한다(#668)."""
    episode: int
    episodeVersionId: str


class OrchestrationResponse(BaseModel):
    """steps는 메인 에이전트가 서브 에이전트를 부른 순서다. message는 메인 에이전트의 종합 답변이거나 실행하지 않은 턴의 고정 문구다.

    rejected와 고정 확인 질문의 clarify면 아무 Agent도 실행하지 않았다(status unsupported는 미구현 기능을 판정하던 때의 옛 기록에만 남는다).
    needs_input·cancelled는 그 앞에서 끝낸 단계만 있다.

    waiting은 대화 안에서 멈춘 상태이며 같은 conversation의 resume으로 이어간다. 입력 대기면 missingInputs,
    Writing 결과·시뮬레이션 장면·World 보강 제안 반영 승인 대기면 awaitingApproval, 시뮬레이션 장면의 턴 사이 대기면 awaitingScene이 있다.
    """
    status: Literal['completed', 'failed', 'clarify', 'rejected', 'unsupported', 'needs_input', 'waiting', 'cancelled']
    runId: str | None = None  # Langfuse trace id. 추적이 꺼져 있으면 없다.
    message: str | None = None
    steps: list[StepResult] = []
    missingInputs: list[CurrentFeature] = []
    awaitingApproval: AwaitingApproval | None = None
    pendingAction: PendingAction | None = None  # awaitingApproval이 content_action일 때 실행을 기다리는 도구와 인자
    awaitingScene: Feature | None = None  # 시뮬레이션 장면이 턴 사이에서 작가의 조작(resume.scene)을 기다린다
    basis: Basis | None = None  # waiting에만 있다. 판본을 저장하기 전(#668)에 멈춘 턴에는 없다
    approvalEpisode: int | None = None  # 승인 질문·장면 대기·입력 대기(#635)에서 결과를 반영할 회차(target.episode). 편집기 회차 맞춤은 입력 대기를 빼고, 구간 카드는 이 회차에 고정한다


class ChatSession(BaseModel):
    """체크포인터에 남은 대화 하나. 제목은 첫 요청 앞부분이며 rename으로 바꾼다."""
    threadId: str
    title: str
    updatedAt: datetime


class ChatTurn(BaseModel):
    """한 턴의 요청과 그 턴의 최종 응답. 멈춘 턴은 reply.status가 waiting이다."""
    request: str
    reply: OrchestrationResponse | None = None  # 응답 기록 이전에 저장된 턴은 없다.
    attachments: list[AttachmentRef] = []  # 그 턴에 보낸 첨부의 이름·종류(원본은 남기지 않는다). 첨부 기능 전의 턴은 비어 있다.


class ChatHistory(BaseModel):
    threadId: str
    title: str
    turns: list[ChatTurn]


class RenameRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    scope: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=100)
