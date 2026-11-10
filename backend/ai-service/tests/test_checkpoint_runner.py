"""DB 없는 TASK 21: 저장 경계·완료 결과·불명 비용의 재개 계약."""
import asyncio
from unittest.mock import AsyncMock

import pytest

from test_task_graph import scope, manifest, task
from app.runs.orchestrator import Budget, PlanError
from app.runs.runner import ModelReply, RunnerState, TaskOutput, TaskRunner


class Crash(BaseException):
    pass


def make(scope, manifest, tasks, handlers, **kwargs):
    return TaskRunner("run1", tasks, scope=scope, manifest=manifest,
                      allowed_operations=("context", "qa", "review"), handlers=handlers, **kwargs)


def output(s):
    return TaskOutput(output_schema=s.output_schema, output_ref=f"ref-{s.task_id}", is_mock=True)


def test_completed_tasks_and_settled_usage_survive_new_runner(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        qa = task(scope, "qa", "qa", (root,))
        saved = None
        async def persist(state):
            nonlocal saved
            saved = RunnerState.model_validate_json(state.model_dump_json())
            if len(state.results) == 2:
                raise Crash()
        model = AsyncMock(return_value=ModelReply(output_ref="answer", usage=Budget(model_calls=1, input_tokens=4, output_tokens=3)))
        async def handler(s, ctx):
            if s.operation == "qa":
                await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), model)
            return output(s)
        with pytest.raises(Crash):
            await make(scope, manifest, (root, qa), {"context": handler, "qa": handler}, persist=persist).run()
        spy = AsyncMock()
        result = await make(scope, manifest, (root, qa), {"context": spy, "qa": spy}, saved=saved).run()
        assert result.status == "succeeded" and len(result.results) == 2
        assert result.accounted == Budget(model_calls=1, input_tokens=4, output_tokens=3)
        assert model.await_count == 1 and not spy.called
    asyncio.run(scenario())


def test_reservation_is_durable_before_invoke_and_unknown_call_is_never_repeated(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        qa = task(scope, "qa", "qa", (root,))
        saved = None
        async def persist(state):
            nonlocal saved
            saved = RunnerState.model_validate_json(state.model_dump_json())
        async def invoke(res):
            assert saved.accounted == res and saved.usage_unknown
            raise Crash()
        async def handler(s, ctx):
            if s.operation == "qa":
                await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), invoke)
            return output(s)
        with pytest.raises(Crash):
            await make(scope, manifest, (root, qa), {"context": handler, "qa": handler}, persist=persist).run()
        spy = AsyncMock()
        result = await make(scope, manifest, (root, qa), {"context": spy, "qa": spy}, saved=saved).run()
        assert result.usage_unknown and result.accounted.model_calls == 1
        assert result.results[-1].error_code == "interrupted_outcome_unknown" and not spy.called
    asyncio.run(scenario())


def test_checkpoint_failure_blocks_model_and_exposes_no_backend_error(scope, manifest):
    async def scenario():
        root = task(scope, "root", "context")
        qa = task(scope, "qa", "qa", (root,))
        model = AsyncMock()
        async def persist(state):
            if state.accounted.model_calls:
                raise OSError("secret-dsn")
        async def handler(s, ctx):
            if s.operation == "qa":
                await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), model)
            return output(s)
        with pytest.raises(PlanError, match="checkpoint_unavailable") as error:
            await make(scope, manifest, (root, qa), {"context": handler, "qa": handler}, persist=persist).run()
        assert "secret-dsn" not in str(error.value) and not model.called
    asyncio.run(scenario())
