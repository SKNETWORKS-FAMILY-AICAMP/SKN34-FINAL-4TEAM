"""TASK 22가 요청한 LangGraph HITL 조립 회귀. HTTP/모델/실 DB 없이 Content 대역만 쓴다."""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from test_mock_retrievers import story, content, wiki, manuscripts
from test_main_graph import graph, request
from app.retrieval.content_client import ContentReadError
from app.runs.approval import ApprovalCoordinator, ApprovalError, PreparedProposal, DecisionReceipt
from app.runs.runner import TaskOutput


pytestmark = pytest.mark.integration


class ApprovalFixture:
    def __init__(self, content):
        self.content = content
        self.proposal = None
        self.receipt = None
        self.rows = {}
        self.prepares = 0
        self.early = None
        self.applications = 0
        self.coordinator = ApprovalCoordinator(prepare=self.prepare, read=self.read, receipt=self.lookup)

    def authorized(self, scope):
        if not self.content.active or scope != self.content.scope:
            raise ContentReadError("denied")

    async def prepare(self, *, scope, key, **kwargs):
        self.authorized(scope)
        self.prepares += 1
        proposal = PreparedProposal(proposal_id="proposal1", proposal_version=1, proposal_hash="a"*64,
            scope_digest=scope.digest(), base_versions=({"target_id":"m1","base_version":0},), **kwargs)
        if key in self.rows and self.rows[key] != proposal:
            raise ApprovalError("prepare_key_conflict")
        self.rows[key] = proposal
        self.proposal = proposal
        if self.early:
            self.decide(self.early)
        return proposal

    async def read(self, *, scope, proposal):
        self.authorized(scope)
        return self.proposal

    async def lookup(self, *, scope, proposal):
        self.authorized(scope)
        return self.receipt

    def decide(self, action):
        if self.receipt:
            if self.receipt.decision != action:
                raise ApprovalError("decision_conflict")
            return self.receipt
        if action == "approved" and self.proposal.is_mock:
            raise ApprovalError("mock_application_forbidden")
        self.receipt = DecisionReceipt(decision_id="decision1", proposal_id=self.proposal.proposal_id,
            proposal_version=self.proposal.proposal_version, proposal_hash=self.proposal.proposal_hash,
            actor_ref=self.content.scope.subject_ref, decision=action, outcome="applied" if action=="approved" else action,
            application_id="application1" if action=="approved" else None,
            result_versions=tuple({"target_id":v.target_id,"before":v.base_version,
                "after":(v.base_version if v.base_version is not None else 0)+1,"version_id":"version1"}
                for v in self.proposal.base_versions) if action=="approved" else (),
            committed_at=datetime.now(timezone.utc))
        if action=="approved":
            self.applications += 1
        return self.receipt


def setup(content, wiki, manuscripts, *, saver=None):
    approvals = ApprovalFixture(content)
    agent = AsyncMock(side_effect=lambda s, c: TaskOutput(output_schema=s.output_schema, output_ref="changes:run1", is_mock=True))
    g = graph(content, wiki, manuscripts, handlers={"editing":agent}, checkpointer=saver, approval=approvals.coordinator)
    req = request(content, ui_mode="edit", prompt="문장을 수정해줘")
    return g, req, approvals, agent


@pytest.mark.parametrize("action", ["rejected","revision_requested","cancelled"])
def test_wait_then_exact_content_receipt_and_duplicate_resume_never_rerun_task(content, wiki, manuscripts, action):
    async def scenario():
        g, req, approvals, agent = setup(content, wiki, manuscripts)
        waiting = await g.run(req)
        assert waiting.state.execution_status == "awaiting_approval" and waiting.response.interrupt_ref
        assert approvals.prepares == 1 and agent.await_count == 1
        approvals.decide(action)
        final = await g.run(req, resume=True, decision_ref="decision1", interrupt_ref=waiting.response.interrupt_ref)
        assert final.state.execution_status == action and final.state.approval_receipt == approvals.receipt
        duplicate = await g.run(req, resume=True, decision_ref="decision1", interrupt_ref=waiting.response.interrupt_ref)
        assert duplicate.state == final.state and approvals.prepares == 1 and agent.await_count == 1
        raw = repr(g.checkpointer.storage) + repr(g.checkpointer.writes)
        assert req.prompt not in raw and req.scope.grant_ref not in raw
        assert all(row.text not in raw for row in content.rows)
    asyncio.run(scenario())


def test_decision_before_interrupt_checkpoint_is_found_by_post_registration_lookup(content, wiki, manuscripts):
    async def scenario():
        g, req, approvals, agent = setup(content, wiki, manuscripts)
        approvals.early = "revision_requested"
        result = await g.run(req)
        assert result.state.execution_status == "revision_requested"
        assert result.state.approval_receipt == approvals.receipt and agent.await_count == 1 and approvals.prepares == 1
    asyncio.run(scenario())


def test_restart_after_content_commit_uses_durable_receipt_without_callback_or_task_replay(content, wiki, manuscripts):
    async def scenario():
        first, req, approvals, agent = setup(content, wiki, manuscripts)
        await first.run(req)
        approvals.decide("rejected")
        spy = AsyncMock()
        second = graph(content, wiki, manuscripts, handlers={"editing":spy}, checkpointer=first.checkpointer, approval=approvals.coordinator)
        result = await second.run(req, resume=True)
        assert result.state.execution_status == "rejected" and result.state.approval_receipt == approvals.receipt
        assert approvals.prepares == 1 and agent.await_count == 1 and not spy.called
    asyncio.run(scenario())


@pytest.mark.parametrize("bad", ["decision","interrupt","version","revoked","missing_decision"])
def test_stale_signal_or_changed_permission_cannot_resume_or_write(content, wiki, manuscripts, bad):
    async def scenario():
        g, req, approvals, agent = setup(content, wiki, manuscripts)
        waiting = await g.run(req)
        approvals.decide("rejected")
        decision, interrupt_ref = "decision1", waiting.response.interrupt_ref
        if bad == "decision": decision = "uncommitted"
        if bad == "interrupt": interrupt_ref = "other-interrupt"
        if bad == "missing_decision": decision = None
        if bad == "version": approvals.proposal = approvals.proposal.model_copy(update={"proposal_version":2})
        if bad == "revoked": content.active = False
        with pytest.raises((ApprovalError, ContentReadError)):
            await g.run(req, resume=True, decision_ref=decision, interrupt_ref=interrupt_ref)
        assert agent.await_count == 1 and approvals.prepares == 1
    asyncio.run(scenario())


def test_mock_proposal_never_applies_even_with_explicit_approval(content, wiki, manuscripts):
    async def scenario():
        g, req, approvals, _ = setup(content, wiki, manuscripts)
        await g.run(req)
        with pytest.raises(ApprovalError, match="mock_application_forbidden"):
            approvals.decide("approved")
        with pytest.raises(ApprovalError, match="decision_not_committed"):
            await g.run(req, resume=True, decision_ref="forged")
        assert approvals.receipt is None
    asyncio.run(scenario())


def test_prepare_commit_before_graph_checkpoint_retries_same_key_without_duplicate_proposal(content, wiki, manuscripts):
    class Crash(BaseException):
        pass
    async def scenario():
        g, req, approvals, agent = setup(content, wiki, manuscripts)
        prepare = approvals.coordinator.prepare_content
        async def interrupted(**kwargs):
            await prepare(**kwargs)
            raise Crash()
        approvals.coordinator.prepare_content = interrupted
        with pytest.raises(Crash):
            await g.run(req)
        approvals.coordinator.prepare_content = prepare
        second = graph(content, wiki, manuscripts, handlers={"editing":agent}, checkpointer=g.checkpointer, approval=approvals.coordinator)
        result = await second.run(req, resume=True)
        assert result.state.execution_status == "awaiting_approval"
        assert len(approvals.rows) == 1 and approvals.prepares == 2 and agent.await_count == 1
    asyncio.run(scenario())


def test_internal_cancel_during_content_prepare_cannot_override_durable_decision(content, wiki, manuscripts):
    from dataclasses import replace
    from test_run_service import binding
    from app.runs.service import FixtureContent, RunService, RunError
    async def scenario():
        req, grant, _ = binding(content)
        req = req.model_copy(update={"operation":"edit"})
        g, _, approvals, _ = setup(content, wiki, manuscripts)
        main = grant.main.model_copy(update={"ui_mode":"edit","allowed_operations":("edit",),"prompt":"문장 수정"})
        grant = replace(grant, request=req, main=main, graph=g)
        service = RunService(FixtureContent((grant,)))
        prepared, release = asyncio.Event(), asyncio.Event()
        prepare = approvals.coordinator.prepare_content
        async def slow_prepare(**kwargs):
            value = await prepare(**kwargs)
            prepared.set()
            await release.wait()
            return value
        approvals.coordinator.prepare_content = slow_prepare
        service.start(req)
        await asyncio.wait_for(prepared.wait(), 3)
        with pytest.raises(RunError,match="decision_requires_content"):
            service.cancel(req.run_id,req.grant_ref,req.thread_ref)
        approvals.decide("rejected")
        release.set()
        await service.records[req.run_id].task
        assert service.status(req.run_id,req.grant_ref,req.thread_ref).status == "rejected"
        await service.close()
    asyncio.run(scenario())
