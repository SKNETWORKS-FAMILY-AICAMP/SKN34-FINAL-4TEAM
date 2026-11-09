"""Main graph의 참조 전용 체크포인트 상태와 별도 사용자 응답 DTO."""
from typing import Annotated, Literal

from pydantic import Field, StrictBool

from app.retrieval.content_client import Scope, SourceVersion
from app.retrieval.contracts import Contract, Coverage, Id, Query, Span
from .orchestrator import Budget, Task
from .routing import Classification, Intent, OPERATIONS
from .runner import TaskResult


Ref = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$")]
Status = Literal["pending", "running", "succeeded", "partial", "failed", "denied", "clarification", "cancelled", "proposal"]


class MainRequest(Contract):
    thread_id: Ref
    run_id: Ref
    request_ref: Ref
    scope: Scope = Field(repr=False)
    query: Query = Field(repr=False)
    prompt: str = Field(default="", max_length=2000, repr=False)
    ui_mode: Intent = "auto"
    allowed_operations: tuple[Intent, ...] = tuple(OPERATIONS)
    messages: tuple[Ref, ...] = ()
    summary_ref: Ref | None = None


class ScopeRef(Contract):
    digest: Id
    manifest_ref: Id
    basis_episode: int


class MainState(Contract):
    thread_id: Ref
    run_id: Ref
    request_ref: Ref
    messages: tuple[Ref, ...] = ()
    summary_ref: Ref | None = None
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


class GraphResult(Contract):
    state: MainState
    response: GraphResponse
