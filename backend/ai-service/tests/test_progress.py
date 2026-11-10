"""진행 스트림은 고정 코드만 내보내고 취소 뒤 결과를 되살리지 않는다."""
import asyncio

import pytest
from pydantic import ValidationError

from test_mock_retrievers import story, content, query
from test_run_service import binding
from app.runs.progress import ProgressEvent, task_event
from app.runs.service import RunError


def test_event_rejects_model_text_and_only_projects_fixed_task_fields():
    event = task_event("simulation", "simulation", 1, "running")
    assert event.code == "SIMULATING" and event.step == 1
    assert task_event("simulation", "simulation", 1, "succeeded").step == 2
    for change in ({"reasoning": "secret"}, {"code": "private manuscript"}, {"taskId": "private manuscript"}):
        with pytest.raises(ValidationError):
            ProgressEvent.model_validate({**event.model_dump(by_alias=True), **change})


def test_progress_replay_ignores_duplicates_and_reversed_steps(content):
    async def scenario():
        req, grant, service = binding(content)
        async def run(*args, **kwargs):
            emit = kwargs["progress"]
            emit(task_event("qa", "qa", 1, "succeeded"))
            emit(task_event("qa", "qa", 1, "running"))
            emit(task_event("qa", "qa", 1, "succeeded"))
            return grant.graph.run.return_value
        grant.graph.run.side_effect = run
        service.start(req)
        await service.records[req.run_id].task
        result = service.status(req.run_id, req.grant_ref, req.thread_ref)
        events = result.progress
        assert [(e.task_id, e.step) for e in events if e.phase == "task"] == [("qa", 2)]
        assert events[-1].code == "RESULT_READY"
        assert "합성 응답" not in str(events)
    asyncio.run(scenario())


def test_cancelled_record_cannot_be_overwritten_by_handler_ignoring_cancel(content):
    async def scenario():
        req, grant, service = binding(content)
        entered = asyncio.Event()
        async def run(*args, **kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                kwargs["progress"](task_event("qa", "qa", 1, "succeeded"))
                return grant.graph.run.return_value
        grant.graph.run.side_effect = run
        service.start(req)
        await entered.wait()
        service.cancel(req.run_id, req.grant_ref, req.thread_ref)
        await service.records[req.run_id].task
        result = service.status(req.run_id, req.grant_ref, req.thread_ref)
        assert result.status == "cancelled" and result.result is None
        assert [e.code for e in result.progress].count("CANCELLED") == 1
        assert result.progress[-1].code == "CANCELLED"
        await service.close()
    asyncio.run(scenario())


def test_applied_run_rejects_cancel(content):
    async def scenario():
        req, grant, service = binding(content)
        service.start(req)
        await service.records[req.run_id].task
        record = service.records[req.run_id]
        record.response = record.response.model_copy(update={"status": "applied"})
        with pytest.raises(RunError, match="already_applied"):
            service.cancel(req.run_id, req.grant_ref, req.thread_ref)
    asyncio.run(scenario())


def test_concurrent_resume_after_memory_loss_has_one_execution(content):
    from app.runs.approval import DecisionSignal
    async def scenario():
        req,grant,service=binding(content)
        entered=asyncio.Event();release=asyncio.Event()
        async def run(*args,**kwargs):
            entered.set()
            await release.wait()
            return grant.graph.run.return_value
        grant.graph.run.side_effect=run
        signal=DecisionSignal(decision_ref="decision")
        first=asyncio.create_task(service.resume(req.run_id,req.grant_ref,req.thread_ref,signal))
        await entered.wait()
        with pytest.raises(RunError,match="thread_busy"):
            await service.resume(req.run_id,req.grant_ref,req.thread_ref,signal)
        release.set();await first
        assert grant.graph.run.await_count==1
    asyncio.run(scenario())
