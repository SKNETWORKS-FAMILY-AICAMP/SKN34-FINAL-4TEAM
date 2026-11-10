"""TASK 22 요청: 격리 PG Saver의 실제 interrupt 재연결. Content는 인가된 합성 대역이다."""
import asyncio
from typing import TypedDict
from unittest.mock import AsyncMock

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
import pytest

from test_checkpoint_integration import checkpoint_db
from test_mock_retrievers import story, content, wiki, manuscripts
from test_approval_resume import setup, ApprovalFixture
from test_main_graph import graph, request
from app.runs.approval import PreparedProposal
from app.runs.checkpoints import postgres_saver
from app.runs.runner import TaskResult


pytestmark = pytest.mark.integration


def test_main_restart_after_content_decision_does_not_repeat_completed_task(checkpoint_db, content, wiki, manuscripts):
    _, runtime, schema, _ = checkpoint_db
    async def scenario():
        async with postgres_saver(runtime,schema=schema) as saver:
            first, req, approvals, agent = setup(content,wiki,manuscripts,saver=saver)
            waiting=await first.run(req)
            assert waiting.state.execution_status=="awaiting_approval"
        approvals.decide("revision_requested")
        async with postgres_saver(runtime,schema=schema) as saver:
            spy=AsyncMock()
            second=graph(content,wiki,manuscripts,handlers={"editing":spy},checkpointer=saver,approval=approvals.coordinator)
            result=await second.run(req,resume=True,decision_ref="decision1",interrupt_ref=waiting.response.interrupt_ref)
            duplicate=await second.run(req,resume=True,decision_ref="decision1",interrupt_ref=waiting.response.interrupt_ref)
            assert result.state==duplicate.state and result.state.execution_status=="revision_requested"
            assert result.state.approval_receipt==approvals.receipt
            assert approvals.prepares==1 and len(approvals.rows)==1 and agent.await_count==1 and not spy.called
            history=await second.ahistory(req)
            raw=" ".join(s.model_dump_json() for s in history)
            assert req.prompt not in raw and req.scope.grant_ref not in raw
    asyncio.run(scenario())


class ApprovalState(TypedDict, total=False):
    proposal: dict
    receipt: dict
    status: str


def test_readonly_approval_node_replays_committed_application_receipt_on_pg_restart(checkpoint_db, content):
    """비 Mock 판은 Content 내부 준비 seam의 합성 정본 계약 자료다. AI flag 승격은 없다."""
    _, runtime, schema, _ = checkpoint_db
    approvals=ApprovalFixture(content)
    req=request(content)
    task=TaskResult(run_id=req.run_id,task_id="editing",attempt=1,lease="lease",status="succeeded",
        output_schema="ChangeSet.v1",output_ref="content-owned-candidate",is_mock=False)
    config={"configurable":{"thread_id":"approval-contract","checkpoint_ns":""}}
    def compile_graph(saver):
        async def prepare(state):
            proposal=await approvals.coordinator.prepare(req,task)
            return {"proposal":proposal.model_dump(mode="json"),"status":"awaiting_approval"}
        async def wait(state):
            receipt=await approvals.coordinator.wait(req,PreparedProposal.model_validate(state["proposal"]))
            return {"receipt":receipt.model_dump(mode="json"),"status":receipt.outcome}
        builder=StateGraph(ApprovalState)
        builder.add_node("prepare",prepare);builder.add_node("wait",wait)
        builder.add_edge(START,"prepare");builder.add_edge("prepare","wait");builder.add_edge("wait",END)
        return builder.compile(checkpointer=saver)
    async def scenario():
        async with postgres_saver(runtime,schema=schema) as saver:
            first=compile_graph(saver)
            await first.ainvoke({},config,durability="sync")
            assert (await first.aget_state(config)).interrupts
        receipt=approvals.decide("approved")
        assert approvals.decide("approved")==receipt and approvals.applications==1
        async with postgres_saver(runtime,schema=schema) as saver:
            second=compile_graph(saver)
            snapshot=await second.aget_state(config)
            final=await second.ainvoke(Command(resume={snapshot.interrupts[0].id:receipt.decision_id}),config,durability="sync")
            duplicate=await second.ainvoke(None,config,durability="sync")
            assert final==duplicate and final["status"]=="applied"
            assert final["receipt"]["application_id"]==receipt.application_id and approvals.applications==1
            assert approvals.prepares==1
    asyncio.run(scenario())
