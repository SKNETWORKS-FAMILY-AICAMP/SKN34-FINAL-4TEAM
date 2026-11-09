"""고정 작업 명세와 실행 전 DAG 검증. Agent·모델·저장 실행은 하지 않는다."""
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
from types import MappingProxyType
from typing import Annotated, Callable, Literal

from pydantic import Field, StrictBool, ValidationError

from app.retrieval.content_client import Manifest, Scope, SourceVersion
from app.retrieval.contracts import Contract, PositiveInt, Span
from .routing import Capability


Schema = Literal["ContextPacket.v1", "Answer.v1", "Findings.v1", "SimulationReport.v1",
                 "BeatPlan.v1", "GeneratedText.v1", "ChangeSet.v1", "Recommendations.v1"]
RunIf = Literal["always", "has_confirmed_findings", "simulation_required", "draft_requested"]
TaskId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
Count = Annotated[int, Field(strict=True, ge=0)]


class Budget(Contract):
    model_calls: Count = 0
    input_tokens: Count = 0
    output_tokens: Count = 0


class RetryPolicy(Contract):
    max_extra_attempts: Annotated[int, Field(strict=True, ge=0, le=1)] = 0


class InputRef(Contract):
    task_id: TaskId
    output_schema: Schema
    optional: StrictBool = False


class PatchTarget(Contract):
    version: SourceVersion
    span: Span


class Task(Contract):
    task_id: TaskId
    operation: Capability
    scope_digest: str = Field(min_length=1)
    depends_on: tuple[TaskId, ...] = ()
    input_refs: tuple[InputRef, ...] = ()
    run_if: RunIf = "always"
    output_schema: Schema
    retry_policy: RetryPolicy = RetryPolicy()
    timeout_ms: PositiveInt
    budget: Budget
    status: Literal["pending"] = "pending"
    patches: tuple[PatchTarget, ...] = ()


class PlanLimits(Contract):
    """설계 02의 실험 상한. 호출자는 더 작은 작업별 한도를 전달할 수 있다."""

    tasks: PositiveInt = 12
    model_calls: Count = 20
    input_tokens: Count = 48000
    output_tokens: Count = 12000
    timeout_ms: PositiveInt = 120000


class ConditionFacts(Contract):
    has_confirmed_findings: StrictBool = False
    simulation_required: StrictBool = False
    draft_requested: StrictBool = False


def condition_satisfied(condition: RunIf, facts: ConditionFacts) -> bool:
    """서버가 검증한 사실만으로 분기하며 임의 식을 평가하지 않는다."""
    values = {"always": True, "has_confirmed_findings": facts.has_confirmed_findings,
              "simulation_required": facts.simulation_required, "draft_requested": facts.draft_requested}
    if condition not in values:
        raise PlanError("unregistered_condition")
    return values[condition]


def _unavailable_handler():
    """후속 TASK에서 구현할 고정 핸들러의 미연결 경계."""
    raise NotImplementedError("capability handler is not connected")


@dataclass(frozen=True)
class CapabilitySpec:
    handler: Callable
    reads: tuple[str, ...]
    input_schema: tuple[Schema, ...]
    output_schema: Schema
    allowed_successors: tuple[Capability, ...]
    model_cap: int


# input_schema는 허용 참조 타입이며 context 이외 작업에는 ContextPacket이 필수다.
REGISTRY = MappingProxyType({
    "context": CapabilitySpec(_unavailable_handler, ("canonical", "wiki", "manuscript", "relationship"),
                              ("ContextPacket.v1",), "ContextPacket.v1",
                              ("qa", "mechanical", "review", "simulation", "development", "writing", "editing", "world_plot", "template"), 0),
    "qa": CapabilitySpec(_unavailable_handler, ("context",), ("ContextPacket.v1",), "Answer.v1", (), 1),
    "mechanical": CapabilitySpec(_unavailable_handler, ("canonical",),
                                 ("ContextPacket.v1", "GeneratedText.v1"), "Findings.v1",
                                 ("review", "simulation", "editing", "writing"), 0),
    "review": CapabilitySpec(_unavailable_handler, ("context", "canonical"),
                             ("ContextPacket.v1", "Findings.v1", "SimulationReport.v1", "GeneratedText.v1"),
                             "Findings.v1", ("simulation", "editing", "writing"), 1),
    "simulation": CapabilitySpec(_unavailable_handler, ("actor_context",),
                                 ("ContextPacket.v1", "Findings.v1"), "SimulationReport.v1",
                                 ("review", "development", "writing", "world_plot"), 14),
    "development": CapabilitySpec(_unavailable_handler, ("context",),
                                  ("ContextPacket.v1", "SimulationReport.v1"), "BeatPlan.v1", ("writing",), 1),
    "writing": CapabilitySpec(_unavailable_handler, ("context", "canonical"),
                              ("ContextPacket.v1", "Findings.v1", "BeatPlan.v1", "SimulationReport.v1", "ChangeSet.v1"),
                              "GeneratedText.v1", ("mechanical", "review"), 1),
    "editing": CapabilitySpec(_unavailable_handler, ("context", "canonical"),
                              ("ContextPacket.v1", "Findings.v1", "ChangeSet.v1"), "ChangeSet.v1", (), 1),
    "world_plot": CapabilitySpec(_unavailable_handler, ("context", "canonical"),
                                 ("ContextPacket.v1", "SimulationReport.v1"), "ChangeSet.v1", ("writing", "editing"), 1),
    "template": CapabilitySpec(_unavailable_handler, ("catalogue",),
                               ("ContextPacket.v1",), "Recommendations.v1", (), 1),
})


class PlanError(ValueError):
    """원문·권한 토큰을 포함하지 않는 계획 거부 코드."""


def validate_plan(tasks: tuple[Task, ...], *, scope: Scope, manifest: Manifest,
                  allowed_operations: tuple[Capability, ...], limits: PlanLimits = PlanLimits(),
                  used: Budget = Budget()) -> tuple[str, ...]:
    """신뢰된 Content Scope·manifest·허용 작업과 대조한 결정적 위상 순서만 반환한다."""
    try:
        # model_copy/model_construct로 우회한 DTO도 외부 계획 경계에서 재검증한다.
        tasks = tuple(Task.model_validate(t.model_dump()) for t in tasks)
        limits = PlanLimits.model_validate(limits.model_dump())
        used = Budget.model_validate(used.model_dump())
    except (ValidationError, AttributeError, TypeError, ValueError):
        raise PlanError("invalid_task_contract") from None
    if manifest.scope_digest != scope.digest() or manifest.manifest_ref != scope.manifest_ref:
        raise PlanError("scope_mismatch")
    if not tasks or len(tasks) > limits.tasks:
        raise PlanError("task_limit")
    by_id = {t.task_id: t for t in tasks}
    if len(by_id) != len(tasks):
        raise PlanError("duplicate_task")
    reserved = dict(model_calls=used.model_calls, input_tokens=used.input_tokens, output_tokens=used.output_tokens)
    duration = 0
    patches: list[PatchTarget] = []
    for task in tasks:
        spec = REGISTRY[task.operation]
        if task.scope_digest != scope.digest() or task.operation not in allowed_operations:
            raise PlanError("operation_or_scope_denied")
        if task.output_schema != spec.output_schema:
            raise PlanError("output_schema_mismatch")
        if len(set(task.depends_on)) != len(task.depends_on) or any(dep not in by_id for dep in task.depends_on):
            raise PlanError("invalid_dependency")
        for dep in task.depends_on:
            if task.operation not in REGISTRY[by_id[dep].operation].allowed_successors:
                raise PlanError("successor_denied")
        schemas = set()
        for ref in task.input_refs:
            if ref.optional and ref.output_schema != "SimulationReport.v1":
                raise PlanError("required_reference_cannot_be_optional")
            if ref.task_id not in task.depends_on:
                raise PlanError("undeclared_output_access")
            if ref.output_schema != by_id[ref.task_id].output_schema or ref.output_schema not in spec.input_schema:
                raise PlanError("input_schema_mismatch")
            schemas.add(ref.output_schema)
        if task.operation != "context" and "ContextPacket.v1" not in schemas:
            raise PlanError("missing_context")
        if task.run_if in ("has_confirmed_findings", "simulation_required") and "Findings.v1" not in schemas:
            raise PlanError("missing_condition_source")
        if task.run_if == "has_confirmed_findings" and task.operation not in ("writing", "editing"):
            raise PlanError("invalid_condition_target")
        if task.run_if == "simulation_required" and task.operation != "simulation":
            raise PlanError("invalid_condition_target")
        if task.run_if == "draft_requested" and task.operation != "writing":
            raise PlanError("invalid_condition_target")
        attempts = 1 + task.retry_policy.max_extra_attempts
        if task.operation in ("review", "simulation", "development", "writing", "editing", "world_plot") and not task.budget.model_calls:
            raise PlanError("missing_model_reservation")
        if task.budget.model_calls and (not task.budget.input_tokens or not task.budget.output_tokens):
            raise PlanError("missing_token_reservation")
        if task.budget.model_calls > spec.model_cap or (task.operation == "simulation" and task.budget.model_calls * attempts > 14):
            raise PlanError("model_cap")
        for name in reserved:
            reserved[name] += getattr(task.budget, name) * attempts
        duration += task.timeout_ms * attempts
        if task.patches and task.operation not in ("editing", "writing", "world_plot"):
            raise PlanError("patch_operation_denied")
        for patch in task.patches:
            if patch.version not in manifest.source_versions or not patch.version.readable():
                raise PlanError("patch_revision_denied")
            for previous in patches:
                same_document = (patch.version.work_id, patch.version.kind, patch.version.document_id) == (
                    previous.version.work_id, previous.version.kind, previous.version.document_id)
                if same_document and (patch.version.revision != previous.version.revision or
                                      max(patch.span[0], previous.span[0]) < min(patch.span[1], previous.span[1])):
                    raise PlanError("patch_selection_required")
            patches.append(patch)
    if duration > limits.timeout_ms or any(value > getattr(limits, name) for name, value in reserved.items()):
        raise PlanError("budget_exceeded")
    try:
        return tuple(TopologicalSorter({id: tuple(sorted(by_id[id].depends_on)) for id in sorted(by_id)}).static_order())
    except CycleError:
        raise PlanError("cycle") from None
