"""Content의 불변 제안/영수증만 사용하는 HITL 경계. AI는 승인·원고 저장을 하지 않는다."""
from hashlib import sha256
from typing import Annotated, Literal

from langgraph.types import interrupt
from pydantic import AwareDatetime, Field, StrictBool, ValidationError

from app.retrieval.contracts import Contract


Reference = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$")]
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Revision = Annotated[int, Field(strict=True, ge=0)]
Decision = Literal["approved", "rejected", "revision_requested", "cancelled"]


class ApprovalError(ValueError):
    pass


class BaseVersion(Contract):
    target_id: Reference
    base_version: Revision | None


class PreparedProposal(Contract):
    proposal_id: Reference
    proposal_version: Annotated[int, Field(strict=True, ge=1)]
    proposal_hash: Digest
    thread_id: Reference
    run_id: Reference
    task_id: Reference
    scope_digest: Digest
    output_ref: Reference
    base_versions: tuple[BaseVersion, ...] = Field(min_length=1, max_length=20)
    is_mock: StrictBool


class ResultVersion(Contract):
    target_id: Reference
    before: Revision | None
    after: Annotated[int, Field(strict=True, ge=1)]
    version_id: Reference


class DecisionReceipt(Contract):
    decision_id: Reference
    proposal_id: Reference
    proposal_version: Annotated[int, Field(strict=True, ge=1)]
    proposal_hash: Digest
    actor_ref: Reference
    decision: Decision
    application_id: Reference | None = None
    outcome: Literal["applied", "rejected", "revision_requested", "cancelled"]
    result_versions: tuple[ResultVersion, ...] = Field(default=(), max_length=20)
    committed_at: AwareDatetime


class DecisionSignal(Contract):
    decision_ref: Reference
    interrupt_ref: Reference | None = None


def validated(kind, value):
    try:
        return kind.model_validate(value.model_dump(mode="json", warnings=False) if isinstance(value, Contract) else value)
    except (ValidationError, TypeError, ValueError):
        raise ApprovalError("invalid_approval_contract") from None


class ApprovalCoordinator:
    """신뢰된 서버가 Content 준비/조회 함수를 주입한다. 모델이나 공개 입력에서 조립하지 않는다."""
    def __init__(self, *, prepare, read, receipt):
        self.prepare_content, self.read_content, self.receipt_content = prepare, read, receipt

    async def prepare(self, request, task):
        if task.status != "succeeded" or task.output_schema not in ("ChangeSet.v1", "GeneratedText.v1") or not task.output_ref:
            raise ApprovalError("invalid_approval_task")
        key = sha256(f"{request.run_id}:{task.task_id}".encode()).hexdigest()
        proposal = validated(PreparedProposal, await self.prepare_content(scope=request.scope,
            run_id=request.run_id, thread_id=request.thread_id, task_id=task.task_id,
            output_ref=task.output_ref, is_mock=task.is_mock, key=key))
        if (proposal.thread_id != request.thread_id or proposal.run_id != request.run_id
                or proposal.task_id != task.task_id or proposal.scope_digest != request.scope.digest()
                or proposal.output_ref != task.output_ref or proposal.is_mock != task.is_mock
                or len({v.target_id for v in proposal.base_versions}) != len(proposal.base_versions)):
            raise ApprovalError("proposal_binding_mismatch")
        return proposal

    async def current(self, request, proposal):
        proposal = validated(PreparedProposal, proposal)
        if (proposal.thread_id != request.thread_id or proposal.run_id != request.run_id
                or proposal.scope_digest != request.scope.digest()):
            raise ApprovalError("proposal_binding_mismatch")
        current = validated(PreparedProposal, await self.read_content(scope=request.scope, proposal=proposal))
        if current != proposal:
            raise ApprovalError("proposal_version_conflict")
        return current

    async def resolve(self, request, proposal, decision_ref=None):
        proposal = await self.current(request, proposal)
        receipt = await self.receipt_content(scope=request.scope, proposal=proposal)
        if receipt is None:
            if decision_ref is not None:
                raise ApprovalError("decision_not_committed")
            return None
        receipt = validated(DecisionReceipt, receipt)
        if ((receipt.proposal_id, receipt.proposal_version, receipt.proposal_hash)
                != (proposal.proposal_id, proposal.proposal_version, proposal.proposal_hash)
                or receipt.actor_ref != request.scope.subject_ref
                or decision_ref is not None and receipt.decision_id != decision_ref):
            raise ApprovalError("receipt_binding_mismatch")
        if receipt.decision == "approved":
            expected = {v.target_id: v.base_version for v in proposal.base_versions}
            results = receipt.result_versions
            if (proposal.is_mock or receipt.outcome != "applied" or receipt.application_id is None
                    or len(results) != len(expected) or {v.target_id for v in results} != set(expected)
                    or any(v.before != expected[v.target_id] or v.after <= (v.before if v.before is not None else -1) for v in results)):
                raise ApprovalError("invalid_application_receipt")
        elif receipt.outcome != receipt.decision or receipt.application_id is not None or receipt.result_versions:
            raise ApprovalError("invalid_decision_receipt")
        return receipt

    async def wait(self, request, proposal):
        """이 노드는 다시 실행돼도 조회만 한다. prepare/모델/원고 쓰기는 이전 노드에 둔다."""
        proposal = await self.current(request, proposal)
        decision_ref = interrupt({"proposal_id": proposal.proposal_id, "proposal_version": proposal.proposal_version,
                                  "proposal_hash": proposal.proposal_hash})
        signal = validated(DecisionSignal, {"decision_ref": decision_ref})
        return await self.resolve(request, proposal, signal.decision_ref)
