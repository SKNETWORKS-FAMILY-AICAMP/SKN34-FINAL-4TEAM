"""검증된 DAG 실행·Send slice·예산 예약과 선택적 참조 상태 저장."""
import asyncio
import time
from types import MappingProxyType
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field, StrictBool

from app.retrieval.contracts import Contract, Id, PositiveInt
from .orchestrator import (
    REGISTRY, Budget, ConditionFacts, PlanError, PlanLimits, Schema, Task,
    TaskId, condition_satisfied, validate_plan,
)
from .routing import Capability
from .progress import task_event


class ExecutionLimits(Contract):
    plan: PlanLimits = PlanLimits()
    concurrency: Annotated[int, Field(strict=True, ge=1, le=2)] = 2
    dynamic_expansions: Annotated[int, Field(strict=True, ge=0, le=1)] = 1


class TaskOutput(Contract):
    output_schema: Schema
    output_ref: Id
    status: Literal["succeeded", "partial"] = "succeeded"
    facts: ConditionFacts = ConditionFacts()
    message_refs: tuple[Id, ...] = ()
    is_mock: StrictBool


class TaskResult(Contract):
    run_id: Id
    task_id: TaskId
    attempt: PositiveInt
    lease: Id
    status: Literal["succeeded", "partial", "failed", "cancelled", "skipped"]
    output_schema: Schema
    output_ref: Id | None = None
    facts: ConditionFacts = ConditionFacts()
    message_refs: tuple[Id, ...] = ()
    error_code: str | None = None
    is_mock: StrictBool = True


class TaskSlice(Contract):
    """Send의 arg로 직렬화할 읽기 전용 참조. 전체 상태·원고·messages는 전달하지 않는다."""
    run_id: Id
    task_id: TaskId
    operation: Capability
    attempt: PositiveInt
    lease: Id
    output_schema: Schema
    inputs: tuple[TaskResult, ...] = ()


class RunnerState(Contract):
    run_id: Id
    tasks: tuple[Task, ...]
    results: tuple[TaskResult, ...] = ()
    active: tuple[TaskSlice, ...] = ()
    attempts: dict[TaskId, PositiveInt] = {}
    accounted: Budget = Budget()
    usage_unknown: StrictBool = False
    deadline: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    expansions: Annotated[int, Field(strict=True, ge=0, le=1)] = 0


class CheckpointError(PlanError):
    pass


class Transition(Contract):
    task_id: TaskId
    attempt: PositiveInt
    status: Literal["running", "succeeded", "partial", "failed", "cancelled", "skipped"]


class RunResult(Contract):
    status: Literal["succeeded", "partial", "failed", "cancelled"]
    results: tuple[TaskResult, ...]
    message_refs: tuple[Id, ...]
    transitions: tuple[Transition, ...]
    accounted: Budget
    usage_unknown: StrictBool


class ModelReply(Contract):
    output_ref: Id
    usage: Budget | None = None


class BudgetExceeded(PlanError):
    pass


class RetryableTaskError(Exception):
    """제공사가 요청을 받지 않았음이 확인된 읽기 작업만 명시적으로 재시도한다."""


class ResultReducer:
    def __init__(self, run_id: str, order: tuple[str, ...]):
        self.run_id, self.order = run_id, order
        self.live = {}
        self.history = {}
        self.results = {}

    def activate(self, task_id: str, attempt: int, lease: str):
        if task_id not in self.order or task_id in self.live or task_id in self.results:
            raise PlanError("invalid_lease")
        self.live[task_id] = (attempt, lease)

    def add(self, event: TaskResult) -> bool:
        event = TaskResult.model_validate(event.model_dump())
        key = (event.run_id, event.task_id, event.attempt)
        if event.run_id != self.run_id or event.task_id not in self.order:
            return False
        if key in self.history:
            return False
        if self.live.get(event.task_id) != (event.attempt, event.lease):
            return False
        self.history[key] = event
        self.results[event.task_id] = event
        del self.live[event.task_id]
        return True

    def ordered(self) -> tuple[TaskResult, ...]:
        return tuple(self.results[id] for id in self.order if id in self.results)


class CallContext:
    """신뢰된 handler가 모델 seam을 호출하기 전 lease·취소·예산을 재확인한다."""
    def __init__(self, runner, task, attempt, lease):
        self.runner, self.task = runner, task
        self.attempt, self.lease = attempt, lease
        self.reserved = Budget()
        self.model_started = False
        self.invalid_usage = False

    def checkpoint(self):
        if self.invalid_usage:
            raise BudgetExceeded("reported_usage_exceeded")
        if self.runner.cancelled.is_set() or asyncio.get_running_loop().time() >= self.runner.deadline:
            raise asyncio.CancelledError()
        if self.runner.reducer.live.get(self.task.task_id) != (self.attempt, self.lease):
            raise asyncio.CancelledError()

    async def call_model(self, reservation: Budget, invoke) -> ModelReply:
        self.checkpoint()
        reservation = Budget.model_validate(reservation.model_dump())
        if reservation.model_calls != 1 or not reservation.input_tokens or not reservation.output_tokens:
            raise BudgetExceeded("invalid_reservation")
        own = {name: getattr(self.reserved, name) + getattr(reservation, name) for name in Budget.model_fields}
        total = {name: self.runner.accounted[name] + getattr(reservation, name) for name in Budget.model_fields}
        if any(own[name] > getattr(self.task.budget, name) or total[name] > getattr(self.runner.limits.plan, name)
               for name in own):
            raise BudgetExceeded("model_budget_exceeded")
        # 하나의 event loop에서 await 전 검사·예약을 끝내어 동시 호출의 예산 초과를 막는다.
        self.reserved = Budget(**own)
        self.runner.accounted.update(total)
        self.model_started = True
        self.runner.inflight_calls += 1
        try:
            await self.runner._save()
            self.checkpoint()
            reply = await invoke(reservation)
            self.checkpoint()
            reply = ModelReply.model_validate(reply.model_dump())
            if reply.usage is None:
                self.runner.usage_unknown = True
            else:
                if reply.usage.model_calls != 1:
                    self.invalid_usage = True
                    raise BudgetExceeded("invalid_usage")
                for name in ("input_tokens", "output_tokens"):
                    self.runner.accounted[name] += getattr(reply.usage, name) - getattr(reservation, name)
                if any(getattr(reply.usage, name) > getattr(reservation, name) for name in Budget.model_fields):
                    self.invalid_usage = True
                    raise BudgetExceeded("reported_usage_exceeded")
        except BaseException:
            self.runner.usage_unknown = True
            raise
        finally:
            self.runner.inflight_calls -= 1
        self.checkpoint()
        return reply


class TaskRunner:
    def __init__(self, run_id, tasks, *, scope, manifest, allowed_operations, handlers=None,
                 limits=ExecutionLimits(), used=Budget(), wants_change=False, draft_requested=False,
                 saved: RunnerState | None = None, persist=None, progress=None):
        self.limits = ExecutionLimits.model_validate(limits.model_dump())
        if type(wants_change) is not bool or type(draft_requested) is not bool:
            raise PlanError("invalid_request_flags")
        self.scope, self.manifest, self.allowed_operations = scope, manifest, tuple(allowed_operations)
        self.used = Budget.model_validate(used.model_dump())
        self.tasks = tuple(Task.model_validate(t.model_dump()) for t in tasks)
        self.order = validate_plan(self.tasks, scope=scope, manifest=manifest,
                                   allowed_operations=self.allowed_operations, limits=self.limits.plan, used=self.used)
        if any(op not in REGISTRY for op in (handlers or {})):
            raise PlanError("unregistered_handler")
        self.handlers = MappingProxyType(dict(handlers or {}))
        self.reducer = ResultReducer(run_id, self.order)
        self.cancelled = asyncio.Event()
        self.started = False
        self.expansions = 0
        self.wants_change, self.draft_requested = wants_change, draft_requested
        self.accounted = self.used.model_dump()
        self.usage_unknown = False
        self.inflight_calls = 0
        self.transitions = []
        self.deadline = 0
        self.deadline_epoch = 0
        self.attempts = {}
        self.persist = persist
        self.progress = progress
        self._save_lock = asyncio.Lock()
        if saved is not None:
            saved = RunnerState.model_validate_json(saved.model_dump_json())
            if (saved.run_id != run_id or saved.tasks[:len(self.tasks)] != self.tasks
                    or not 0 <= saved.expansions <= self.limits.dynamic_expansions
                    or any(getattr(saved.accounted, k) > getattr(self.limits.plan, k)
                           or getattr(saved.accounted, k) < getattr(self.used, k) for k in Budget.model_fields)):
                raise PlanError("invalid_runner_checkpoint")
            self.tasks = saved.tasks
            self.order = validate_plan(self.tasks, scope=scope, manifest=manifest,
                allowed_operations=self.allowed_operations, limits=self.limits.plan, used=self.used)
            self.reducer.order = self.order
            by_id = {t.task_id: t for t in self.tasks}
            self.attempts = dict(saved.attempts)
            if any(k not in by_id or v > 1 + by_id[k].retry_policy.max_extra_attempts for k, v in self.attempts.items()):
                raise PlanError("invalid_runner_checkpoint")
            for event in (*saved.results, *saved.active):
                task = by_id.get(event.task_id)
                if (task is None or event.run_id != run_id or event.output_schema != task.output_schema
                        or event.attempt != self.attempts.get(event.task_id)):
                    raise PlanError("invalid_runner_checkpoint")
                self.reducer.activate(event.task_id, event.attempt, event.lease)
                # 호출 결과가 저장되지 않은 작업은 자동 재실행하지 않는다.
                result = event if isinstance(event, TaskResult) else self._result(
                    task, event.attempt, event.lease, "failed", error_code="interrupted_outcome_unknown")
                self.reducer.add(result)
            self.accounted = saved.accounted.model_dump()
            self.usage_unknown = saved.usage_unknown
            self.deadline_epoch, self.expansions = saved.deadline, saved.expansions

    async def _save(self):
        if self.persist is None:
            return
        async with self._save_lock:
            state = RunnerState(run_id=self.reducer.run_id, tasks=self.tasks, results=self.reducer.ordered(),
                active=tuple(TaskSlice(run_id=self.reducer.run_id, task_id=id,
                    operation=next(t.operation for t in self.tasks if t.task_id == id),
                    output_schema=next(t.output_schema for t in self.tasks if t.task_id == id),
                    attempt=attempt, lease=lease) for id, (attempt, lease) in self.reducer.live.items()),
                attempts=dict(self.attempts), accounted=Budget(**self.accounted),
                usage_unknown=self.usage_unknown or bool(self.inflight_calls),
                deadline=self.deadline_epoch, expansions=self.expansions)
            try:
                await self.persist(state)
            except Exception:
                raise CheckpointError("checkpoint_unavailable") from None

    def cancel(self):
        self.cancelled.set()

    def extend(self, additional: tuple[Task, ...]):
        if self.expansions >= self.limits.dynamic_expansions or (self.started and not self.reducer.live):
            raise PlanError("expansion_limit")
        combined = self.tasks + tuple(Task.model_validate(t.model_dump()) for t in additional)
        order = validate_plan(combined, scope=self.scope, manifest=self.manifest,
                              allowed_operations=self.allowed_operations, limits=self.limits.plan, used=self.used)
        self.tasks, self.order = combined, order
        self.reducer.order = order
        self.expansions += 1

    def _result(self, task, attempt, lease, status, **kwargs):
        return TaskResult(run_id=self.reducer.run_id, task_id=task.task_id, attempt=attempt,
                          lease=lease, status=status, output_schema=task.output_schema, **kwargs)

    def _finish(self, result):
        if self.reducer.add(result):
            self.transitions.append(Transition(task_id=result.task_id, attempt=result.attempt, status=result.status))
            self._progress(result.task_id, result.attempt, result.status)

    def _progress(self, task_id, attempt, status):
        if self.progress is not None:
            task = next(t for t in self.tasks if t.task_id == task_id)
            self.progress(task_event(task_id, task.operation, attempt, status))

    def _facts(self, task):
        parents = [self.reducer.results[ref.task_id] for ref in task.input_refs
                   if ref.output_schema == "Findings.v1" and ref.task_id in self.reducer.results]
        return ConditionFacts(has_confirmed_findings=any(p.facts.has_confirmed_findings for p in parents),
                              simulation_required=any(p.facts.simulation_required for p in parents),
                              draft_requested=self.draft_requested)

    async def _execute(self, task, attempt, lease):
        ctx = CallContext(self, task, attempt, lease)
        refs = tuple(self.reducer.results[ref.task_id] for ref in task.input_refs
                     if self.reducer.results[ref.task_id].status == "succeeded")
        slice = TaskSlice(run_id=self.reducer.run_id, task_id=task.task_id, operation=task.operation,
                          attempt=attempt, lease=lease, output_schema=task.output_schema, inputs=refs)
        try:
            ctx.checkpoint()
            async with asyncio.timeout(task.timeout_ms / 1000):
                handler = self.handlers.get(task.operation)
                if handler is None:
                    raise NotImplementedError()
                output = await handler(slice, ctx)
                output = TaskOutput.model_validate(output.model_dump())
                if output.output_schema != task.output_schema:
                    raise PlanError("output_schema_mismatch")
                ctx.checkpoint()
                return self._result(task, attempt, lease, **output.model_dump(exclude={"output_schema"})), False
        except CheckpointError:
            raise
        except RetryableTaskError:
            retry = not ctx.model_started and task.operation not in ("writing", "editing", "world_plot")
            return self._result(task, attempt, lease, "failed", error_code="read_unavailable"), retry
        except asyncio.CancelledError:
            return self._result(task, attempt, lease, "cancelled", error_code="cancelled"), False
        except TimeoutError:
            return self._result(task, attempt, lease, "failed", error_code="timeout"), False
        except Exception:
            return self._result(task, attempt, lease, "failed", error_code="task_failed"), False

    async def run(self) -> RunResult:
        """검증된 ready task만 실행하고 외부 취소·deadline에 깨어난다."""
        if self.started:
            raise PlanError("run_already_started")
        self.started = True
        if not self.deadline_epoch:
            self.deadline_epoch = time.time() + self.limits.plan.timeout_ms / 1000
        self.deadline = asyncio.get_running_loop().time() + max(0, self.deadline_epoch - time.time())
        active = {}
        cancel_wait = asyncio.create_task(self.cancelled.wait())
        try:
            await self._save()
            while len(self.reducer.results) < len(self.tasks):
                remaining = self.deadline - asyncio.get_running_loop().time()
                if self.cancelled.is_set() or remaining <= 0:
                    for future in active:
                        future.cancel()
                    await asyncio.sleep(0)
                    for task in self.tasks:
                        if task.task_id in self.reducer.results:
                            continue
                        attempt, lease = self.reducer.live.get(task.task_id, (1, uuid4().hex))
                        if task.task_id not in self.reducer.live:
                            self.reducer.activate(task.task_id, attempt, lease)
                        self.attempts[task.task_id] = attempt
                        self._finish(self._result(task, attempt, lease,
                            "cancelled" if self.cancelled.is_set() else "failed", error_code="cancelled" if self.cancelled.is_set() else "deadline"))
                    await self._save()
                    break
                for id in self.order:
                    if len(active) >= self.limits.concurrency:
                        break
                    if id in self.reducer.results or id in self.reducer.live:
                        continue
                    task = next(t for t in self.tasks if t.task_id == id)
                    if any(dep not in self.reducer.results for dep in task.depends_on):
                        continue
                    attempt = self.attempts.get(id, 0) + 1
                    lease = uuid4().hex
                    self.attempts[id] = attempt
                    self.reducer.activate(id, attempt, lease)
                    optional_skips = {ref.task_id for ref in task.input_refs if ref.optional}
                    failed = any(self.reducer.results[dep].status != "succeeded" and not (
                        dep in optional_skips and self.reducer.results[dep].status == "skipped"
                        and self.reducer.results[dep].error_code == "condition_unmet") for dep in task.depends_on)
                    change_denied = task.operation in ("writing", "editing", "world_plot") and not self.wants_change
                    if failed or change_denied or not condition_satisfied(task.run_if, self._facts(task)):
                        self._finish(self._result(task, attempt, lease, "skipped",
                            error_code="dependency_failed" if failed else "condition_unmet"))
                        await self._save()
                        continue
                    self.transitions.append(Transition(task_id=id, attempt=attempt, status="running"))
                    self._progress(id, attempt, "running")
                    await self._save()
                    future = asyncio.create_task(self._execute(task, attempt, lease))
                    active[future] = task
                if not active:
                    continue
                done, _ = await asyncio.wait((*active, cancel_wait), timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
                for future in done:
                    if future is cancel_wait:
                        continue
                    task = active.pop(future)
                    result, retry = future.result()
                    if retry and result.attempt <= task.retry_policy.max_extra_attempts:
                        del self.reducer.live[task.task_id]
                        self.transitions.append(Transition(task_id=task.task_id, attempt=result.attempt, status="failed"))
                        self._progress(task.task_id, result.attempt, "failed")
                    else:
                        self._finish(result)
                    await self._save()
        except asyncio.CancelledError:
            self.cancel()
            raise
        finally:
            cancel_wait.cancel()
            for future in active:
                if not future.cancelling():
                    future.cancel()
                # 취소를 무시한 handler의 늦은 예외도 회수하되 결과는 병합하지 않는다.
                future.add_done_callback(lambda f: None if f.cancelled() else f.exception())
        results = self.reducer.ordered()
        failures = any(x.status in ("failed", "partial", "cancelled") for x in results)
        status = "cancelled" if self.cancelled.is_set() else ("partial" if failures and any(x.status in ("succeeded", "partial") for x in results)
                  else "failed" if failures else "succeeded")
        return RunResult(status=status, results=results,
                         message_refs=tuple(ref for x in results for ref in x.message_refs),
                         transitions=tuple(self.transitions), accounted=Budget(**self.accounted),
                         usage_unknown=self.usage_unknown or bool(self.inflight_calls))
