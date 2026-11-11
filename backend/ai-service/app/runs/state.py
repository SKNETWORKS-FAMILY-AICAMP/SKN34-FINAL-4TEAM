"""Main graph의 참조 전용 체크포인트 상태와 별도 사용자 응답 DTO."""
from typing import Annotated, Literal

from pydantic import Field, StrictBool

from app.retrieval.content_client import Scope, SourceVersion
from app.retrieval.contracts import Contract, Coverage, Id, Query, Span
from .orchestrator import Budget, Task
from .routing import Classification, Intent, OPERATIONS
from .runner import TaskResult
from .approval import PreparedProposal, DecisionReceipt
from .selection import RunSelection


Ref = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$")]
Status = Literal["pending", "running", "succeeded", "partial", "failed", "denied", "clarification", "cancelled", "proposal",
                 "awaiting_approval", "applied", "rejected", "revision_requested"]


class MainRequest(Contract):
    thread_id: Ref
    run_id: Ref
    request_ref: Ref
    scope: Scope = Field(repr=False)
    query: Query = Field(repr=False)
    prompt: str = Field(default="", max_length=2000, repr=False)
    selection: RunSelection | None = None
    ui_mode: Intent = "auto"
    allowed_operations: tuple[Intent, ...] = tuple(OPERATIONS)
    messages: tuple[Ref, ...] = Field(default=(), max_length=20)
    summary_ref: Ref | None = None


class ScopeRef(Contract):
    digest: Id
    manifest_ref: Id
    basis_episode: int


class MainState(Contract):
    thread_id: Ref
    run_id: Ref
    request_ref: Ref
    messages: tuple[Ref, ...] = Field(default=(), max_length=20)
    summary_ref: Ref | None = None
    request_digest: str | None = None
    manifest_digest: str | None = None
    scope: ScopeRef | None = None
    security_ref: Id | None = None
    classification: Classification | None = None
    task_plan: tuple[Task, ...] = ()
    task_results: tuple[TaskResult, ...] = ()
    evidence_refs: tuple[Id, ...] = ()
    coverage: Coverage | None = None
    simulation_ref: Id | None = None
    generated_content_ref: Id | None = None
    change_set_ref: Id | None = None
    approval_ref: Id | None = None
    prepared_proposal: PreparedProposal | None = None
    approval_receipt: DecisionReceipt | None = None
    approval_interrupt_ref: Ref | None = None
    response_ref: Id | None = None
    execution_status: Status = "pending"
    budget_usage: Budget = Budget()
    usage_unknown: StrictBool = False
    errors: tuple[Id, ...] = ()


class Citation(Contract):
    evidence_ref: Id
    source_revision: SourceVersion
    span: Span
    source_hash: str
    episode: int
    quote: str = Field(repr=False)
    is_mock: StrictBool


class GraphResponse(Contract):
    status: Status
    text: str = Field(repr=False)
    citations: tuple[Citation, ...] = ()
    is_mock: StrictBool = True
    context_digest: str | None = None
    proposal_id: Ref | None = None
    proposal_version: int | None = None
    proposal_hash: str | None = None
    interrupt_ref: Ref | None = None
    receipt: DecisionReceipt | None = None


class GraphResult(Contract):
    state: MainState
    response: GraphResponse
