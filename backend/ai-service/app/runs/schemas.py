"""Content가 호출하는 내부 Run 요청·상태 계약. 원고와 Scope는 입력받지 않는다."""
from typing import Annotated, Literal

from pydantic import Field

from app.retrieval.content_client import SourceVersion
from app.retrieval.contracts import Contract, Coverage
from .routing import Intent
from .runner import TaskResult
from .state import GraphResponse, Ref, Status


class RunBudget(Contract):
    model_calls: Annotated[int, Field(strict=True, ge=0, le=20, alias="modelCalls")]
    input_tokens: Annotated[int, Field(strict=True, ge=0, le=48000, alias="inputTokens")]
    output_tokens: Annotated[int, Field(strict=True, ge=0, le=12000, alias="outputTokens")]
    timeout_ms: Annotated[int, Field(strict=True, ge=1, le=120000, alias="timeoutMs")]


class RunRequest(Contract):
    run_id: Ref = Field(alias="runId")
    thread_ref: Ref = Field(alias="threadRef")
    grant_ref: Ref = Field(alias="grantRef", repr=False)
    work_id: Ref = Field(alias="workId")
    fork_id: Ref | None = Field(alias="forkId")
    basis_episode: Annotated[int, Field(strict=True, ge=1, alias="basisEpisode")]
    operation: Intent
    target_refs: Annotated[tuple[SourceVersion, ...], Field(min_length=1, max_length=100, alias="targetRefs")]
    budget: RunBudget


class RunFailure(Contract):
    code: Literal["timeout", "refused", "execution_failed", "dependency_unavailable"]
    retryable: bool = False


class RunResponse(Contract):
    run_id: Ref = Field(serialization_alias="runId")
    thread_ref: Ref = Field(serialization_alias="threadRef")
    status: Status
    is_mock: Literal[True] = Field(default=True, serialization_alias="isMock")
    tasks: tuple[TaskResult, ...] = ()
    coverage: Coverage | None = None
    result: GraphResponse | None = None
    error: RunFailure | None = None
