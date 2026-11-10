"""Content 위임과 Run 접수. 명시 주입 그래프의 선택적 영속 재개를 연결한다."""
import asyncio
from dataclasses import dataclass, field
from hashlib import sha256

from app.retrieval.content_client import CanonicalAdapter, ContentReadError
from app.retrieval.mock_content import MockContentReadPort
from .graph import MainGraph, checkpoint_config
from .orchestrator import PlanLimits
from .runner import ExecutionLimits
from .schemas import RunError, RunFailure, RunRequest, RunResponse
from .remote_content import RemoteContent, RemoteGrant
from .state import MainRequest
from .approval import ApprovalError, DecisionSignal


@dataclass(frozen=True)
class FixtureGrant:
    request: RunRequest = field(repr=False)
    main: MainRequest = field(repr=False)
    graph: MainGraph = field(repr=False)


class FixtureContent:
    """서버가 주입한 합성 작업만 복원한다. HTTP 발급·실제 grant 검증 기능은 없다."""

    def __init__(self, grants: tuple[FixtureGrant, ...] = ()):
        self.grants = {g.request.grant_ref: g for g in grants}
        if len(self.grants) != len(grants):
            raise ValueError("duplicate_fixture_grant")

    def authorize(self, request: RunRequest) -> FixtureGrant:
        grant = self.grants.get(request.grant_ref)
        if grant is None or request != grant.request:
            raise RunError(403, "invalid_scope")
        main, scope = grant.main, grant.main.scope
        targets = set(request.target_refs)
        if (not isinstance(grant.graph.content, MockContentReadPort)
                or main.run_id != request.run_id or main.thread_id != request.thread_ref
                or scope.grant_ref != request.grant_ref or scope.work_id != request.work_id
                or scope.fork_id != request.fork_id or scope.basis_episode != request.basis_episode
                or main.query.scope != scope or main.ui_mode != request.operation
                or (request.operation != "auto" and main.allowed_operations != (request.operation,))
                or set(main.query.document_ids) != {t.document_id for t in targets}
                or set(main.query.source_kinds) != {t.kind for t in targets}
                or len(targets) != len(request.target_refs)):
            raise RunError(403, "invalid_scope")
        try:
            manifest = CanonicalAdapter(grant.graph.content).manifest(scope)
        except ContentReadError as error:
            raise RunError(403 if error.status == "denied" else 503,
                           "invalid_scope" if error.status == "denied" else "content_unavailable") from None
        selected = {v for v in manifest.source_versions if v.document_id in main.query.document_ids
                    and v.kind in main.query.source_kinds}
        if selected != targets:
            raise RunError(403, "invalid_scope")
        return grant

    def restore(self, run_id: str, grant_ref: str, thread_ref: str) -> FixtureGrant:
        grant = self.grants.get(grant_ref)
        if grant is None or grant.request.run_id != run_id or grant.request.thread_ref != thread_ref:
            raise RunError(403, "invalid_scope")
        return self.authorize(grant.request)


@dataclass
class RunRecord:
    fingerprint: str
    response: RunResponse
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None


def fingerprint(request: RunRequest) -> str:
    return sha256(request.model_dump_json().encode()).hexdigest()


class RunService:
    def __init__(self, content: FixtureContent | RemoteContent):
        self.content = content
        self.checkpointer = None
        # shortcut: 접수 상태는 프로세스 메모리, Content 영속 lease/자동 재전달을 연결할 때 교체한다.
        self.records: dict[str, RunRecord] = {}

    def start(self, request: RunRequest) -> RunResponse:
        grant = self.content.authorize(request)
        if request.run_id in self.records:
            raise RunError(409, "duplicate_run")
        if any(r.response.thread_ref == request.thread_ref and r.response.status in ("pending", "running", "awaiting_approval")
               for r in self.records.values()):
            raise RunError(409, "thread_busy")
        response = RunResponse(run_id=request.run_id, thread_ref=request.thread_ref, status="pending",
                               is_mock=not isinstance(grant, RemoteGrant))
        record = RunRecord(fingerprint(request), response)
        self.records[request.run_id] = record
        record.task = asyncio.create_task(self._execute(grant, record))
        return response

    async def _execute(self, grant: FixtureGrant | RemoteGrant, record: RunRecord):
        if isinstance(grant, RemoteGrant):
            # 실제 전문 Agent/검색 실행은 미연결이다. 합성 자료로 성공 대체하거나 모델을 호출하지 않는다.
            record.response = record.response.model_copy(update={"status": "failed",
                "error": RunFailure(code="dependency_unavailable")})
            return
        record.response = record.response.model_copy(update={"status": "running"})
        budget = grant.request.budget
        limits = ExecutionLimits(plan=PlanLimits(**budget.model_dump()))
        try:
            resume = False
            if self.checkpointer is not None:
                grant.graph.checkpointer = self.checkpointer
                resume = await self.checkpointer.aget_tuple(checkpoint_config(grant.main)) is not None
            result = await asyncio.wait_for(grant.graph.run(grant.main, cancel=record.cancel, limits=limits, resume=resume),
                                            timeout=budget.timeout_ms / 1000)
            self._complete(record, result)
        except TimeoutError:
            record.response = record.response.model_copy(update={"status": "failed", "error": RunFailure(code="timeout")})
        except asyncio.CancelledError:
            record.cancel.set()
            record.response = record.response.model_copy(update={"status": "cancelled"})
        except Exception:
            record.response = record.response.model_copy(update={"status": "failed", "error": RunFailure(code="execution_failed")})

    def _complete(self, record, result):
        error = None
        if result.state.execution_status == "denied":
            error = RunFailure(code="refused")
        elif result.state.execution_status == "failed":
            timed_out = any(t.error_code in ("timeout", "deadline") for t in result.state.task_results)
            code = ("timeout" if timed_out else "dependency_unavailable"
                    if "scope_unavailable" in result.state.errors else "execution_failed")
            error = RunFailure(code=code)
        record.response = record.response.model_copy(update={"status": result.state.execution_status,
            "tasks": result.state.task_results, "coverage": result.state.coverage, "result": result.response, "error": error})

    async def resume(self, run_id: str, grant_ref: str, thread_ref: str, signal: DecisionSignal) -> RunResponse:
        """현재 Content 위임과 정확한 interrupt/영수증을 대조한다. 승인·원고 쓰기는 호출하지 않는다."""
        grant = self.content.restore(run_id, grant_ref, thread_ref)
        if isinstance(grant, RemoteGrant):
            raise RunError(503, "dependency_unavailable")
        record = self.records.get(run_id)
        if record is not None:
            if record.fingerprint != fingerprint(grant.request):
                raise RunError(403, "invalid_scope")
            if record.task is not None and not record.task.done():
                raise RunError(409, "thread_busy")
        else:
            record = RunRecord(fingerprint(grant.request), RunResponse(run_id=run_id,thread_ref=thread_ref,status="pending"))
        if self.checkpointer is not None:
            grant.graph.checkpointer = self.checkpointer
        limits = ExecutionLimits(plan=PlanLimits(**grant.request.budget.model_dump()))
        try:
            result = await asyncio.wait_for(grant.graph.run(grant.main, limits=limits, resume=True,
                decision_ref=signal.decision_ref, interrupt_ref=signal.interrupt_ref),
                timeout=grant.request.budget.timeout_ms / 1000)
        except ApprovalError:
            raise RunError(409, "invalid_approval_signal") from None
        except ContentReadError as error:
            raise RunError(403 if error.status == "denied" else 503,
                           "invalid_scope" if error.status == "denied" else "content_unavailable") from None
        except Exception:
            raise RunError(503, "execution_unavailable") from None
        self._complete(record, result)
        self.records[run_id] = record
        return record.response

    def status(self, run_id: str, grant_ref: str, thread_ref: str) -> RunResponse:
        grant = self.content.restore(run_id, grant_ref, thread_ref)
        record = self.records.get(run_id)
        if record is None:
            raise RunError(404, "run_not_found")
        if record.fingerprint != fingerprint(grant.request):
            raise RunError(403, "invalid_scope")
        return record.response

    def cancel(self, run_id: str, grant_ref: str, thread_ref: str) -> RunResponse:
        response = self.status(run_id, grant_ref, thread_ref)
        if response.status == "awaiting_approval":
            raise RunError(409, "decision_requires_content")
        if response.status in ("pending", "running"):
            grant = self.content.restore(run_id, grant_ref, thread_ref)
            if isinstance(grant, FixtureGrant) and run_id in getattr(grant.graph, "_approval_runs", ()):
                raise RunError(409, "decision_requires_content")
            record = self.records[run_id]
            record.cancel.set()
            record.task.cancel()
            record.response = response.model_copy(update={"status": "cancelled"})
        return self.records[run_id].response

    async def close(self):
        tasks = [r.task for r in self.records.values() if r.task is not None]
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
