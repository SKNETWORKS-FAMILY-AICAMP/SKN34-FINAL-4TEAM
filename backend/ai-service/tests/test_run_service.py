"""내부 Run의 위임·중복 실행·종료 상태 단위 계약."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from test_mock_retrievers import story, content, query
from app.runs.state import GraphResponse, GraphResult, MainRequest, MainState
from app.runs.schemas import RunRequest
from app.runs.service import FixtureContent, FixtureGrant, RunError, RunService


def binding(content, timeout_ms=20000):
    target = content.manifest(content.scope).source_versions[0]
    request = RunRequest(runId="run1", threadRef="thread1", grantRef=content.scope.grant_ref,
        workId=content.scope.work_id, forkId=content.scope.fork_id, basisEpisode=3,
        operation="ask", targetRefs=[target],
        budget={"modelCalls": 1, "inputTokens": 4000, "outputTokens": 1000, "timeoutMs": timeout_ms})
    main = MainRequest(thread_id="thread1", run_id="run1", request_ref="request1", scope=content.scope,
        query=query(content, document_ids=(target.document_id,), source_kinds=(target.kind,)),
        ui_mode="ask", allowed_operations=("ask",))
    result = GraphResult(state=MainState(thread_id="thread1", run_id="run1", request_ref="request1",
        execution_status="succeeded"), response=GraphResponse(status="succeeded", text="합성 응답"))
    graph = type("Graph", (), {"content": content, "run": AsyncMock(return_value=result)})()
    grant = FixtureGrant(request, main, graph)
    return request, grant, RunService(FixtureContent((grant,)))


def test_duplicate_is_rejected_before_second_dispatch(content):
    async def scenario():
        req, grant, service = binding(content)
        assert service.start(req).status == "pending"
        with pytest.raises(RunError, match="duplicate_run"):
            service.start(req)
        await service.records[req.run_id].task
        assert service.status(req.run_id, req.grant_ref, req.thread_ref).status == "succeeded"
        assert grant.graph.run.await_count == 1
        assert grant.graph.run.call_args.kwargs["limits"].plan.model_calls == req.budget.model_calls
        await service.close()
    asyncio.run(scenario())


def test_approval_wait_cannot_be_cancelled_without_content_decision(content):
    async def scenario():
        req, grant, service = binding(content)
        result=grant.graph.run.return_value
        grant.graph.run.return_value=result.model_copy(update={"state":result.state.model_copy(update={"execution_status":"awaiting_approval"}),
            "response":result.response.model_copy(update={"status":"awaiting_approval"})})
        service.start(req)
        await service.records[req.run_id].task
        with pytest.raises(RunError,match="decision_requires_content"):
            service.cancel(req.run_id,req.grant_ref,req.thread_ref)
        assert service.status(req.run_id,req.grant_ref,req.thread_ref).status == "awaiting_approval"
    asyncio.run(scenario())


def test_resume_forwards_only_authorized_decision_and_preserves_previous_status_on_conflict(content):
    from app.runs.approval import DecisionSignal, ApprovalError
    async def scenario():
        req, grant, service = binding(content)
        service.start(req)
        await service.records[req.run_id].task
        signal=DecisionSignal(decision_ref="decision",interrupt_ref="interrupt")
        result=await service.resume(req.run_id,req.grant_ref,req.thread_ref,signal)
        assert result.status == "succeeded" and grant.graph.run.call_args.kwargs["resume"] is True
        assert grant.graph.run.call_args.kwargs["decision_ref"] == "decision"
        assert grant.graph.run.call_args.kwargs["interrupt_ref"] == "interrupt"
        grant.graph.run.side_effect=ApprovalError("decision_not_committed")
        with pytest.raises(RunError,match="invalid_approval_signal"):
            await service.resume(req.run_id,req.grant_ref,req.thread_ref,signal)
        assert service.status(req.run_id,req.grant_ref,req.thread_ref).status == "succeeded"
    asyncio.run(scenario())


def test_resume_keeps_existing_result_when_receipt_lookup_times_out(content):
    from app.runs.approval import DecisionSignal
    async def scenario():
        req, grant, service = binding(content,timeout_ms=20)
        service.start(req)
        await service.records[req.run_id].task
        async def slow(*args,**kwargs):
            await asyncio.Event().wait()
        grant.graph.run.side_effect=slow
        with pytest.raises(RunError,match="execution_unavailable"):
            await asyncio.wait_for(service.resume(req.run_id,req.grant_ref,req.thread_ref,DecisionSignal(decision_ref="decision")),1)
        assert service.status(req.run_id,req.grant_ref,req.thread_ref).status=="succeeded"
    asyncio.run(scenario())


@pytest.mark.parametrize("exists", [False, True])
def test_lifespan_saver_is_used_for_authorized_fixture_dispatch_or_recovery(content, exists):
    async def scenario():
        req, grant, service = binding(content)
        saver = type("Saver", (), {"aget_tuple": AsyncMock(return_value=object() if exists else None)})()
        service.checkpointer = saver
        service.start(req)
        await service.records[req.run_id].task
        saver.aget_tuple.assert_awaited_once()
        assert grant.graph.checkpointer is saver
        assert grant.graph.run.call_args.kwargs["resume"] is exists
        assert service.status(req.run_id, req.grant_ref, req.thread_ref).status == "succeeded"
        await service.close()
    asyncio.run(scenario())


@pytest.mark.parametrize("change", [{"grant_ref": "forged"}, {"work_id": "other"},
    {"fork_id": "other"}, {"basis_episode": 4}, {"thread_ref": "other"},
    {"operation": "edit"}, {"target_refs": ()}, {"run_id": "other"}])
def test_substituted_delegation_is_denied_before_content_lookup(content, change):
    req, grant, service = binding(content)
    original = content.manifest
    content.manifest = AsyncMock()  # 조회 전 차단을 검사한다.
    with pytest.raises(RunError, match="invalid_scope"):
        service.start(req.model_copy(update=change))
    content.manifest.assert_not_called()
    grant.graph.run.assert_not_called()
    content.manifest = original


def test_expiry_and_revocation_prevent_status_disclosure(content):
    async def scenario():
        req, grant, service = binding(content)
        service.start(req)
        await service.records[req.run_id].task
        content.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        with pytest.raises(RunError, match="invalid_scope"):
            service.status(req.run_id, req.grant_ref, req.thread_ref)
        await service.close()
    asyncio.run(scenario())


@pytest.mark.parametrize("failure,expected", [("timeout", "timeout"), ("error", "execution_failed")])
def test_failures_are_terminal_and_sanitized(content, failure, expected):
    async def scenario():
        req, grant, service = binding(content, timeout_ms=20)
        async def fail(*args, **kwargs):
            if failure == "timeout":
                await asyncio.sleep(10)
            raise RuntimeError("secret manuscript and grant")
        grant.graph.run.side_effect = fail
        service.start(req)
        await service.records[req.run_id].task
        status = service.status(req.run_id, req.grant_ref, req.thread_ref)
        assert status.status == "failed" and status.error.code == expected
        assert "secret" not in status.model_dump_json()
        await service.close()
    asyncio.run(scenario())


def test_real_content_adapter_is_never_called(content):
    req, grant, service = binding(content)
    grant.graph.content = type("RealContent", (), {"manifest": AsyncMock()})()
    with pytest.raises(RunError, match="invalid_scope"):
        service.start(req)
    grant.graph.content.manifest.assert_not_called()


def test_cancel_is_terminal_and_idempotent(content):
    async def scenario():
        req, grant, service = binding(content)
        async def wait(*args, **kwargs):
            await asyncio.sleep(10)
        grant.graph.run.side_effect = wait
        service.start(req)
        await asyncio.sleep(0)
        service.cancel(req.run_id, req.grant_ref, req.thread_ref)
        await service.records[req.run_id].task
        assert service.cancel(req.run_id, req.grant_ref, req.thread_ref).status == "cancelled"
        await service.close()
    asyncio.run(scenario())
