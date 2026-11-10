"""Content 참조만 사용하는 승인 준비·영수증 검증의 순수 단위."""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from test_mock_retrievers import story, content, query
from app.runs.approval import ApprovalCoordinator, ApprovalError, PreparedProposal, DecisionReceipt
from app.runs.runner import TaskResult
from app.runs.state import MainRequest


def fixture(content, *, is_mock=False):
    request = MainRequest(thread_id="thread", run_id="run", request_ref="request", scope=content.scope,
                          query=query(content), ui_mode="edit")
    task = TaskResult(run_id="run", task_id="edit", attempt=1, lease="lease", status="succeeded",
                      output_schema="ChangeSet.v1", output_ref="changes:run", is_mock=is_mock)
    proposal = PreparedProposal(proposal_id="proposal", proposal_version=1, proposal_hash="a" * 64,
        thread_id="thread", run_id="run", task_id="edit", scope_digest=content.scope.digest(),
        output_ref=task.output_ref, base_versions=({"target_id": "m1", "base_version": 0},), is_mock=is_mock)
    receipt = DecisionReceipt(decision_id="decision", proposal_id="proposal", proposal_version=1,
        proposal_hash="a" * 64, actor_ref=content.scope.subject_ref, decision="approved", outcome="applied",
        application_id="application", result_versions=({"target_id":"m1", "before":0, "after":1,"version_id":"v1"},),
        committed_at=datetime.now(timezone.utc))
    prepare = AsyncMock(return_value=proposal)
    read = AsyncMock(return_value=proposal)
    lookup = AsyncMock(return_value=receipt)
    return request, task, proposal, receipt, ApprovalCoordinator(prepare=prepare, read=read, receipt=lookup)


def test_prepare_uses_stable_run_task_key_and_keeps_mock_provenance(content):
    request, task, proposal, _, approval = fixture(content, is_mock=True)
    assert asyncio.run(approval.prepare(request, task)) == proposal
    assert asyncio.run(approval.prepare(request, task)) == proposal
    calls = approval.prepare_content.call_args_list
    assert calls[0] == calls[1]
    assert "grant" not in calls[0].kwargs["key"] and len(calls[0].kwargs["key"]) == 64


@pytest.mark.parametrize("field,value", [("run_id","other"), ("thread_id","other"), ("task_id","other"),
    ("scope_digest","other"), ("output_ref","other"), ("is_mock",True)])
def test_prepared_proposal_cannot_change_binding_or_mock_status(content, field, value):
    req, task, proposal, _, approval = fixture(content)
    approval.prepare_content.return_value = proposal.model_copy(update={field:value})
    with pytest.raises(ApprovalError):
        asyncio.run(approval.prepare(req, task))


def test_committed_receipt_is_required_and_exact_decision_reference_is_checked(content):
    req, _, proposal, receipt, approval = fixture(content)
    assert asyncio.run(approval.resolve(req, proposal, "decision")) == receipt
    with pytest.raises(ApprovalError):
        asyncio.run(approval.resolve(req, proposal, "other-decision"))
    approval.receipt_content.return_value = None
    assert asyncio.run(approval.resolve(req, proposal)) is None
    with pytest.raises(ApprovalError):
        asyncio.run(approval.resolve(req, proposal, "decision"))


@pytest.mark.parametrize("bad", ["version","hash","actor","target","before","after","missing","mock","outcome","superseded"])
def test_forged_stale_or_mock_application_receipt_is_refused(content, bad):
    req, _, proposal, receipt, approval = fixture(content)
    changes = {"version": {"proposal_version":2}, "hash":{"proposal_hash":"b"*64},
        "actor":{"actor_ref":"other"}, "target":{"result_versions":({"target_id":"other","before":0,"after":1,"version_id":"v1"},)},
        "before":{"result_versions":({"target_id":"m1","before":2,"after":3,"version_id":"v1"},)},
        "after":{"result_versions":({"target_id":"m1","before":0,"after":0,"version_id":"v1"},)},
        "missing":{"result_versions":()}, "outcome":{"outcome":"rejected"}}
    if bad in changes:
        approval.receipt_content.return_value = receipt.model_copy(update=changes[bad])
    if bad == "mock":
        proposal = proposal.model_copy(update={"is_mock":True})
        approval.read_content.return_value = proposal
    if bad == "superseded":
        approval.read_content.return_value = proposal.model_copy(update={"proposal_version":2})
    with pytest.raises(ApprovalError):
        asyncio.run(approval.resolve(req, proposal, "decision"))


@pytest.mark.parametrize("action", ["rejected","revision_requested","cancelled"])
def test_non_application_decisions_have_no_application_or_result_versions(content, action):
    req, _, proposal, receipt, approval = fixture(content)
    approval.receipt_content.return_value = receipt.model_copy(update={"decision":action,"outcome":action,
        "application_id":None,"result_versions":()})
    assert asyncio.run(approval.resolve(req, proposal)).outcome == action
