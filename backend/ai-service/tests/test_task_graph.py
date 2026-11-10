"""고정 계획의 타입·인가·참조·예산 검증. 외부 실행 없음."""
from dataclasses import replace

import pytest
from pydantic import ValidationError

from app.retrieval.content_client import Manifest, Scope, SourceVersion
from app.runs import orchestrator as o


SCHEMAS = dict(context="ContextPacket.v1", qa="Answer.v1", mechanical="Findings.v1",
               review="Findings.v1", simulation="SimulationReport.v1", development="BeatPlan.v1",
               writing="GeneratedText.v1", editing="ChangeSet.v1", world_plot="ChangeSet.v1",
               template="Recommendations.v1")


@pytest.fixture
def scope():
    return Scope("grant", "author", "w1", None, 10, "owner", None, "planning", "manifest")


@pytest.fixture
def manifest(scope):
    return Manifest(scope.manifest_ref, scope.digest(), tuple(range(1, 11)),
                    (SourceVersion("w1", "manuscript", "m3", "r1"),))


def task(scope, id, op, parents=(), condition="always", **updates):
    data = dict(task_id=id, operation=op, scope_digest=scope.digest(),
                depends_on=tuple(t.task_id for t in parents),
                input_refs=tuple(dict(task_id=t.task_id, output_schema=SCHEMAS[t.operation]) for t in parents),
                output_schema=SCHEMAS[op], run_if=condition,
                budget=dict(model_calls=0 if op in ("context", "mechanical", "template") else 1,
                            input_tokens=100, output_tokens=100), timeout_ms=1000)
    data.update(updates)
    return o.Task(**data)


def validate(scope, manifest, tasks, **kwargs):
    return o.validate_plan(tasks, scope=scope, manifest=manifest,
                           allowed_operations=tuple(SCHEMAS), **kwargs)


# 설계 05의 A~G를 실행하지 않고 표현하는 고정 합성 계획.
@pytest.fixture(params=list("ABCDEFG"))
def pattern(request, scope):
    c = task(scope, "context", "context")
    if request.param == "A":
        m = task(scope, "mechanical", "mechanical", (c,))
        s = task(scope, "simulation", "simulation", (c, m), "simulation_required")
        r = task(scope, "review", "review", (c, m, s))
        return (c, m, s, r, task(scope, "edit", "editing", (c, r), "has_confirmed_findings"))
    if request.param == "B":
        s = task(scope, "simulation", "simulation", (c,))
        d = task(scope, "plan", "development", (c, s))
        w = task(scope, "draft", "writing", (c, d), "draft_requested")
        return (c, s, d, w, task(scope, "continuity", "mechanical", (c, w)))
    if request.param == "C":
        return (c, task(scope, "impact", "world_plot", (c,)))
    if request.param == "D":
        return (c, task(scope, "style_and_voice", "editing", (c,)))
    if request.param == "E":
        return (c, task(scope, "recommend", "template", (c,)))
    if request.param == "F":
        return (c, task(scope, "numbers_names", "mechanical", (c,)))
    s = task(scope, "simulation", "simulation", (c,))
    return (c, s, task(scope, "insights", "development", (c, s)))


def test_patterns_have_exact_stable_topological_order(scope, manifest, pattern):
    assert validate(scope, manifest, tuple(reversed(pattern))) == tuple(t.task_id for t in pattern)


def test_registry_is_fixed_and_unimplemented_handlers_are_explicit_stubs():
    assert set(o.REGISTRY) == set(SCHEMAS)
    with pytest.raises(TypeError):
        o.REGISTRY["exec"] = o.REGISTRY["context"]
    for operation, spec in o.REGISTRY.items():
        if operation not in ("qa", "mechanical", "template", "simulation", "review", "development", "writing", "editing", "world_plot"):
            with pytest.raises(NotImplementedError):
                spec.handler()
        assert spec.reads and spec.input_schema and spec.output_schema


@pytest.mark.parametrize("field,value", [("operation", "os.system"), ("operation", "https://bad.invalid"),
    ("operation", "db_write"), ("run_if", "eval('x')"), ("status", "succeeded"),
    ("handler", "/tmp/run"), ("sql", "DELETE FROM manuscript"), ("timeout_ms", -1)])
def test_malicious_and_invalid_task_fields_fail_at_boundary(scope, field, value):
    with pytest.raises(ValidationError):
        task(scope, "c", "context", **{field: value})


@pytest.mark.parametrize("variant", ["duplicate", "cycle", "missing", "undeclared", "schema", "output", "scope", "successor", "required"])
def test_bad_graphs_fail_before_any_handler(scope, manifest, variant):
    c = task(scope, "c", "context")
    r = task(scope, "r", "review", (c,))
    if variant == "duplicate":
        tasks = (c, c)
    elif variant == "cycle":
        tasks = (c.model_copy(update={"depends_on": ("r",)}), r)
    elif variant == "missing":
        tasks = (r,)
    elif variant == "undeclared":
        tasks = (c, r.model_copy(update={"depends_on": ()}))
    elif variant == "schema":
        tasks = (c, r.model_copy(update={"input_refs": (o.InputRef(task_id="c", output_schema="Answer.v1"),)}))
    elif variant == "output":
        tasks = (c.model_copy(update={"output_schema": "Answer.v1"}),)
    elif variant == "scope":
        tasks = (c, r.model_copy(update={"scope_digest": "other-fork"}))
    elif variant == "successor":
        q = task(scope, "q", "qa", (c,))
        tasks = (c, q, task(scope, "r", "review", (c, q)))
    else:
        tasks = (task(scope, "r", "review"),)
    with pytest.raises(o.PlanError):
        validate(scope, manifest, tasks)


def test_validator_revalidates_untrusted_model_copy(scope, manifest):
    c = task(scope, "c", "context").model_copy(update={"operation": "exec"})
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c,))


def test_unauthorized_operation_and_manifest_fail(scope, manifest):
    c = task(scope, "c", "context")
    with pytest.raises(o.PlanError):
        o.validate_plan((c,), scope=scope, manifest=manifest, allowed_operations=())
    with pytest.raises(o.PlanError):
        validate(scope, replace(manifest, scope_digest="other"), (c,))


@pytest.mark.parametrize("limit", ["model_calls", "input_tokens", "output_tokens", "timeout_ms", "tasks"])
def test_retry_and_used_budget_are_reserved(scope, manifest, limit):
    c = task(scope, "c", "context")
    r = task(scope, "r", "review", (c,), retry_policy={"max_extra_attempts": 1})
    limits = o.PlanLimits(**{limit: 1})
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c, r), limits=limits)
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c, r), used=o.Budget(model_calls=20))


def test_review_confirmed_writing_branch_is_typed(scope, manifest):
    c = task(scope, "c", "context")
    r = task(scope, "r", "review", (c,))
    w = task(scope, "w", "writing", (c, r), "has_confirmed_findings")
    assert validate(scope, manifest, (w, r, c)) == ("c", "r", "w")
    assert not o.condition_satisfied(w.run_if, o.ConditionFacts())
    assert o.condition_satisfied(w.run_if, o.ConditionFacts(has_confirmed_findings=True))
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c, task(scope, "w", "writing", (c,), "has_confirmed_findings")))


def test_patch_overlap_requires_selection_even_when_sequential(scope, manifest):
    c = task(scope, "c", "context")
    p = dict(version=manifest.source_versions[0], span=(0, 10))
    a = task(scope, "a", "editing", (c,), patches=(p,))
    b = task(scope, "b", "editing", (c,), patches=(dict(p, span=(5, 15)),))
    with pytest.raises(o.PlanError, match="patch_selection_required"):
        validate(scope, manifest, (c, a, b))
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c, a, b.model_copy(update={"depends_on": ("c", "a")})))
    adjacent = task(scope, "b", "editing", (c,), patches=(dict(p, span=(10, 15)),))
    assert validate(scope, manifest, (c, a, adjacent)) == ("c", "a", "b")


def test_patch_revision_and_model_caps_are_verified(scope, manifest):
    c = task(scope, "c", "context")
    invalid = dict(version=replace(manifest.source_versions[0], revision="stale"), span=(0, 5))
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c, task(scope, "e", "editing", (c,), patches=(invalid,))))
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c.model_copy(update={"budget": o.Budget(model_calls=1)}),))


@pytest.mark.parametrize("budget", [dict(model_calls=0), dict(model_calls=1),
    dict(model_calls=1, input_tokens=100), dict(model_calls=1, output_tokens=100)])
def test_model_work_cannot_underreserve_its_budget(scope, manifest, budget):
    c = task(scope, "c", "context")
    with pytest.raises(o.PlanError):
        validate(scope, manifest, (c, task(scope, "r", "review", (c,), budget=budget)))


def test_real_cycle_and_retries_at_exact_limit(scope, manifest):
    c = task(scope, "c", "context")
    r = task(scope, "r", "review", (c,))
    s = task(scope, "s", "simulation", (c, r))
    r = task(scope, "r", "review", (c, s))
    with pytest.raises(o.PlanError, match="cycle"):
        validate(scope, manifest, (c, r, s))
    r = task(scope, "r", "review", (c,), retry_policy={"max_extra_attempts": 1})
    assert validate(scope, manifest, (r, c), limits=o.PlanLimits(
        model_calls=2, input_tokens=300, output_tokens=300, timeout_ms=3000)) == ("c", "r")


def test_condition_enum_never_evaluates_code():
    with pytest.raises(o.PlanError):
        o.condition_satisfied("__import__('os')", o.ConditionFacts())
    with pytest.raises(ValidationError):
        o.ConditionFacts(has_confirmed_findings="true")
