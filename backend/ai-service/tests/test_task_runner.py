"""실행·취소·예산·병합의 합성 비동기 단위 계약."""
import asyncio
from unittest.mock import AsyncMock

import pytest

from test_task_graph import scope, manifest, task
from app.runs.orchestrator import Budget, ConditionFacts, InputRef, PlanError, PlanLimits
from app.runs import runner as r


def outcome(slice, **kwargs):
    return r.TaskOutput(output_schema=slice.output_schema, output_ref=f"ref-{slice.task_id}", is_mock=True, **kwargs)


def make(scope, manifest, tasks, handlers, **kwargs):
    return r.TaskRunner("run1", tasks, scope=scope, manifest=manifest,
                        allowed_operations=("context", "mechanical", "review", "simulation", "writing", "qa"),
                        handlers=handlers, **kwargs)


def test_cancel_during_checkpoint_reservation_prevents_model_call(scope, manifest):
    async def scenario():
        root=task(scope,"root","context")
        review=task(scope,"review","review",(root,))
        invoke=AsyncMock(return_value=r.ModelReply(output_ref="candidate",usage=review.budget))
        run=None
        async def persist(state):
            if state.accounted.model_calls:
                run.cancel()
        async def generate(slice,ctx):
            await ctx.call_model(review.budget,invoke)
            return outcome(slice)
        run=make(scope,manifest,(root,review),{"context":AsyncMock(side_effect=lambda s,c:outcome(s)),"review":generate},persist=persist)
        result=await run.run()
        invoke.assert_not_awaited()
        assert result.status=="cancelled"
    asyncio.run(scenario())


def test_dependencies_parallel_limit_slices_and_stable_order(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        children = tuple(task(scope, id, "mechanical", (root,)) for id in ("a", "b", "c"))
        active = peak = 0
        both = asyncio.Event()
        async def handler(slice, ctx):
            nonlocal active, peak
            assert not hasattr(slice, "scope") and not hasattr(slice, "messages")
            assert tuple(x.task_id for x in slice.inputs) == ("root",)
            active += 1
            peak = max(peak, active)
            if active == 2:
                both.set()
            await both.wait()
            await asyncio.sleep(0)
            active -= 1
            return outcome(slice, message_refs=(f"message-{slice.task_id}",))
        root_handler = AsyncMock(side_effect=lambda s, c: outcome(s))
        run = make(scope, manifest, (root, *reversed(children)), {"context": root_handler, "mechanical": handler})
        result = await run.run()
        assert peak == 2 and result.status == "succeeded"
        assert tuple(x.task_id for x in result.results) == ("root", "a", "b", "c")
        assert result.message_refs == ("message-a", "message-b", "message-c")
        assert [(x.task_id, x.status) for x in result.transitions][:2] == [("root", "running"), ("root", "succeeded")]
    asyncio.run(scenario())


@pytest.mark.parametrize("confirmed", [False, True])
def test_conditional_writing_is_zero_calls_without_confirmed_findings(scope, manifest, confirmed):
    root = task(scope, "root", "context")
    review = task(scope, "review", "review", (root,))
    writing = task(scope, "write", "writing", (root, review), "has_confirmed_findings")
    async def read(s, c):
        return outcome(s, facts=ConditionFacts(has_confirmed_findings=confirmed))
    write = AsyncMock(side_effect=lambda s, c: outcome(s))
    result = asyncio.run(make(scope, manifest, (writing, root, review),
        {"context": read, "review": read, "writing": write}, wants_change=True).run())
    assert write.await_count == int(confirmed)
    assert result.results[-1].status == ("succeeded" if confirmed else "skipped")


def test_failed_required_dependency_blocks_writing_and_keeps_independent_success(scope, manifest):
    root = task(scope, "root", "context")
    review = task(scope, "review", "review", (root,))
    qa = task(scope, "answer", "qa", (root,))
    writing = task(scope, "write", "writing", (root, review), "has_confirmed_findings")
    async def good(s, c):
        return outcome(s)
    async def bad(s, c):
        raise RuntimeError("private draft must not appear")
    write = AsyncMock()
    result = asyncio.run(make(scope, manifest, (root, review, qa, writing),
        {"context": good, "review": bad, "qa": good, "writing": write}, wants_change=True).run())
    assert result.status == "partial" and not write.called
    assert {x.task_id: x.status for x in result.results} == dict(root="succeeded", answer="succeeded", review="failed", write="skipped")
    assert "private draft" not in result.model_dump_json()


def test_reducer_ignores_duplicates_and_stale_leases(scope):
    reducer = r.ResultReducer("run1", ("a", "b"))
    reducer.activate("a", 1, "lease1")
    event = r.TaskResult(run_id="run1", task_id="a", attempt=1, lease="lease1", status="succeeded",
                         output_schema="ContextPacket.v1", output_ref="ref", is_mock=True)
    assert reducer.add(event) and not reducer.add(event)
    assert not reducer.add(event.model_copy(update={"run_id": "other"}))
    reducer.activate("b", 2, "new")
    assert not reducer.add(event.model_copy(update={"task_id": "b", "lease": "old"}))
    assert tuple(x.task_id for x in reducer.ordered()) == ("a",)


@pytest.mark.parametrize("mode", ["unknown", "timeout", "error"])
def test_model_reservation_unknown_usage_is_not_free_or_retried(scope, manifest, mode):
    root = task(scope, "root", "context")
    review = task(scope, "r", "review", (root,), timeout_ms=20 if mode == "timeout" else 1000,
                  retry_policy={"max_extra_attempts": 1})
    calls = 0
    async def handler(s, ctx):
        nonlocal calls
        if s.operation == "context":
            return outcome(s)
        async def invoke(reservation):
            nonlocal calls
            calls += 1
            assert reservation.output_tokens == 100
            if mode == "timeout":
                await asyncio.Event().wait()
            if mode == "error":
                raise r.RetryableTaskError()
            return r.ModelReply(output_ref="model-ref", usage=None)
        await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), invoke)
        return outcome(s)
    result = asyncio.run(make(scope, manifest, (root, review), {"context": handler, "review": handler}).run())
    assert calls == 1 and result.usage_unknown
    assert result.accounted == Budget(model_calls=1, input_tokens=100, output_tokens=100)


def test_actual_usage_settles_reservation_and_second_call_is_blocked(scope, manifest):
    root = task(scope, "root", "context")
    review = task(scope, "r", "review", (root,))
    invoke = AsyncMock(return_value=r.ModelReply(output_ref="ref", usage=Budget(model_calls=1, input_tokens=20, output_tokens=5)))
    async def handler(s, ctx):
        if s.operation == "review":
            await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), invoke)
            with pytest.raises(r.BudgetExceeded):
                await ctx.call_model(Budget(model_calls=1, input_tokens=1, output_tokens=1), invoke)
        return outcome(s)
    result = asyncio.run(make(scope, manifest, (root, review), {"context": handler, "review": handler}).run())
    assert result.accounted == Budget(model_calls=1, input_tokens=20, output_tokens=5)
    assert invoke.await_count == 1 and not result.usage_unknown


def test_cancel_wakes_running_work_and_blocks_next_call(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        review = task(scope, "r", "review", (root,))
        started = asyncio.Event()
        async def handler(s, ctx):
            if s.operation == "review":
                async def invoke(res):
                    started.set()
                    await asyncio.Event().wait()
                await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), invoke)
            return outcome(s)
        runner = make(scope, manifest, (root, review), {"context": handler, "review": handler})
        work = asyncio.create_task(runner.run())
        await asyncio.wait_for(started.wait(), 1)
        runner.cancel()
        result = await asyncio.wait_for(work, 1)
        assert result.status == "cancelled" and result.usage_unknown
        assert result.accounted.model_calls == 1
    asyncio.run(scenario())


def test_pre_cancel_and_duplicate_plan_have_zero_handlers(scope, manifest):
    root = task(scope, "root", "context")
    handler = AsyncMock()
    runner = make(scope, manifest, (root,), {"context": handler})
    runner.cancel()
    assert asyncio.run(runner.run()).status == "cancelled"
    with pytest.raises(PlanError):
        make(scope, manifest, (root, root), {"context": handler})
    handler.assert_not_called()


def test_dynamic_expansion_is_validated_once_and_run_cannot_repeat(scope, manifest):
    root = task(scope, "root", "context")
    async def handler(s, ctx):
        return outcome(s)
    runner = make(scope, manifest, (root,), {"context": handler, "mechanical": handler})
    runner.extend((task(scope, "m", "mechanical", (root,)),))
    with pytest.raises(PlanError):
        runner.extend((task(scope, "n", "mechanical", (root,)),))
    assert asyncio.run(runner.run()).status == "succeeded"
    with pytest.raises(PlanError):
        asyncio.run(runner.run())


def test_read_retry_is_bounded_and_bad_output_schema_fails(scope, manifest):
    root = task(scope, "root", "context", retry_policy={"max_extra_attempts": 1})
    calls = 0
    async def handler(s, ctx):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise r.RetryableTaskError()
        return r.TaskOutput(output_schema="Answer.v1", output_ref="bad", is_mock=True)
    result = asyncio.run(make(scope, manifest, (root,), {"context": handler}).run())
    assert calls == 2 and result.results[0].attempt == 2 and result.status == "failed"


def test_optional_condition_skipped_simulation_does_not_skip_review(scope, manifest):
    root = task(scope, "root", "context")
    mechanical = task(scope, "check", "mechanical", (root,))
    sim = task(scope, "sim", "simulation", (root, mechanical), "simulation_required")
    review = task(scope, "review", "review", (root, mechanical, sim))
    review = review.model_copy(update={"input_refs": tuple(
        InputRef(task_id=ref.task_id, output_schema=ref.output_schema, optional=ref.task_id == "sim")
        for ref in review.input_refs)})
    async def handler(s, ctx):
        assert s.operation != "simulation"
        if s.operation == "review":
            assert {x.task_id for x in s.inputs} == {"root", "check"}
        return outcome(s)
    result = asyncio.run(make(scope, manifest, (root, mechanical, sim, review),
        {op: handler for op in ("context", "mechanical", "simulation", "review")}).run())
    assert result.results[-1].status == "succeeded"


def test_deadline_and_missing_handler_are_explicit_failures(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context", timeout_ms=20)
        async def slow(s, ctx):
            await asyncio.Event().wait()
        result = await make(scope, manifest, (root,), {"context": slow},
                            limits=r.ExecutionLimits(plan=PlanLimits(timeout_ms=20))).run()
        assert result.status == "failed" and result.results[0].error_code in ("timeout", "deadline")
        assert (await make(scope, manifest, (root,), {}).run()).status == "failed"
    asyncio.run(scenario())


def test_in_run_expansion_and_invalid_expansion_do_not_mutate_plan(scope, manifest):
    root = task(scope, "root", "context")
    async def handler(s, ctx):
        if s.task_id == "root":
            with pytest.raises(PlanError):
                runner.extend((root,))
            runner.extend((task(scope, "check", "mechanical", (root,)),))
        return outcome(s)
    runner = make(scope, manifest, (root,), {"context": handler, "mechanical": handler})
    result = asyncio.run(runner.run())
    assert tuple(x.task_id for x in result.results) == ("root", "check")


def test_late_model_completion_cannot_start_another_call_or_merge(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        review = task(scope, "review", "review", (root,))
        started, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
        captured = []
        async def handler(s, ctx):
            if s.operation == "review":
                captured.append(ctx)
                async def model(res):
                    started.set()
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        await release.wait()
                    return r.ModelReply(output_ref="late", usage=Budget(model_calls=1, input_tokens=1, output_tokens=1))
                try:
                    await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), model)
                finally:
                    finished.set()
            return outcome(s)
        runner = make(scope, manifest, (root, review), {"context": handler, "review": handler})
        run = asyncio.create_task(runner.run())
        await asyncio.wait_for(started.wait(), 1)
        runner.cancel()
        result = await asyncio.wait_for(run, 1)
        release.set()
        await asyncio.wait_for(finished.wait(), 1)
        with pytest.raises(asyncio.CancelledError):
            captured[0].checkpoint()
        assert result.results[-1].status == "cancelled"
        assert result.accounted == Budget(model_calls=1, input_tokens=100, output_tokens=100)
        assert result.usage_unknown
    asyncio.run(scenario())


def test_simultaneous_reservations_reject_second_before_invoke(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        sim = task(scope, "sim", "simulation", (root,), budget=Budget(model_calls=1, input_tokens=100, output_tokens=100))
        started = asyncio.Event()
        release = asyncio.Event()
        async def handler(s, ctx):
            if s.operation == "simulation":
                async def model(res):
                    started.set()
                    await release.wait()
                    return r.ModelReply(output_ref="ref")
                first = asyncio.create_task(ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), model))
                await started.wait()
                rejected = AsyncMock()
                with pytest.raises(r.BudgetExceeded):
                    await ctx.call_model(Budget(model_calls=1, input_tokens=1, output_tokens=1), rejected)
                rejected.assert_not_called()
                release.set()
                await first
            return outcome(s)
        result = await make(scope, manifest, (root, sim), {"context": handler, "simulation": handler}).run()
        assert result.accounted.model_calls == 1
    asyncio.run(scenario())


def test_partial_root_is_partial_and_required_successors_skip(scope, manifest):
    root = task(scope, "root", "context")
    review = task(scope, "r", "review", (root,))
    async def partial(s, ctx):
        return outcome(s, status="partial")
    unused = AsyncMock()
    result = asyncio.run(make(scope, manifest, (root, review), {"context": partial, "review": unused}).run())
    assert result.status == "partial" and result.results[-1].status == "skipped"
    unused.assert_not_called()


def test_reported_overrun_cannot_be_caught_to_continue_calls(scope, manifest):
    root = task(scope, "root", "context")
    sim = task(scope, "sim", "simulation", (root,), budget=Budget(model_calls=2, input_tokens=200, output_tokens=200))
    async def handler(s, ctx):
        if s.operation == "simulation":
            invoke = AsyncMock(return_value=r.ModelReply(output_ref="ref", usage=Budget(model_calls=1, input_tokens=150, output_tokens=150)))
            with pytest.raises(r.BudgetExceeded):
                await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), invoke)
            again = AsyncMock(return_value=r.ModelReply(output_ref="ref"))
            with pytest.raises(r.BudgetExceeded):
                await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), again)
            again.assert_not_called()
        return outcome(s)
    result = asyncio.run(make(scope, manifest, (root, sim), {"context": handler, "simulation": handler}).run())
    assert result.results[-1].status == "failed"
    assert result.accounted == Budget(model_calls=1, input_tokens=150, output_tokens=150)


def test_limits_and_scope_contracts_reject_before_dispatch(scope, manifest):
    from pydantic import ValidationError
    root = task(scope, "root", "context")
    with pytest.raises(ValidationError):
        r.ExecutionLimits(concurrency=3)
    with pytest.raises(ValidationError):
        r.ExecutionLimits(dynamic_expansions=2)
    with pytest.raises(PlanError):
        make(scope, manifest, (root,), {}, used=Budget(model_calls=21))
    with pytest.raises(PlanError):
        make(scope, manifest, (root,), {"exec": AsyncMock()})
    with pytest.raises(PlanError):
        make(scope, manifest, (root,), {}, wants_change="false")
    invalid = task(scope, "r", "review", (root,)).model_copy(update={"input_refs": (
        InputRef(task_id="root", output_schema="ContextPacket.v1", optional=True),)})
    with pytest.raises(PlanError):
        make(scope, manifest, (root, invalid), {})
