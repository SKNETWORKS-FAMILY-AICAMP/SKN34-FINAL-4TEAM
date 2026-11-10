"""모델 텍스트를 받지 않는 고정 진행 이벤트 계약."""
from typing import Annotated, Literal

from pydantic import Field

from app.retrieval.contracts import Contract
from .orchestrator import TaskId


Code = Literal["ANALYZING", "CONTEXT_LOADING", "RELATIONS_LOADING", "TEXT_LOADING", "TEMPLATE_SEARCH",
               "SIMULATING", "REVIEWING", "DRAFTING", "EDITING", "PROPOSAL_PENDING", "RESULT_READY",
               "APPLIED", "PARTIAL", "FAILED", "CANCELLED"]
TASK_CODES = dict(context="CONTEXT_LOADING", qa="TEXT_LOADING", mechanical="REVIEWING", review="REVIEWING",
                  simulation="SIMULATING", development="DRAFTING", writing="DRAFTING", editing="EDITING",
                  world_plot="REVIEWING", template="TEMPLATE_SEARCH")
STATUS_CODES = dict(pending="ANALYZING", running="ANALYZING", succeeded="RESULT_READY", partial="PARTIAL",
    failed="FAILED", denied="FAILED", clarification="RESULT_READY", cancelled="CANCELLED", proposal="PROPOSAL_PENDING",
    awaiting_approval="PROPOSAL_PENDING", applied="APPLIED", rejected="RESULT_READY", revision_requested="RESULT_READY")


class ProgressEvent(Contract):
    task_id: TaskId = Field(alias="taskId")
    attempt: Annotated[int, Field(strict=True, ge=1, le=3)] = 1
    phase: Literal["run", "task"]
    step: Annotated[int, Field(strict=True, ge=1, le=2147483647)]
    code: Code
    status: Literal["pending", "running", "succeeded", "partial", "failed", "denied", "clarification", "cancelled",
                    "proposal", "awaiting_approval", "applied", "rejected", "revision_requested", "skipped"]


def task_event(task_id, operation, attempt, status):
    return ProgressEvent(taskId=task_id, attempt=attempt, phase="task", step=1 if status == "running" else 2,
                         code=TASK_CODES[operation], status=status)
