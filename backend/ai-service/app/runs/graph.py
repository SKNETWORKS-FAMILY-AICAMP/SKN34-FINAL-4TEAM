"""참조 전용 Main StateGraph와 선택적인 Content 영수증 기반 HITL 조립."""
import asyncio
from dataclasses import asdict
from hashlib import sha256
import inspect
import json

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.errors import GraphInterrupt
from langgraph.types import Command
from pydantic_core import to_jsonable_python

from app.retrieval.content_client import CanonicalAdapter, ContentReadError
from app.retrieval.validation import validate_packet
from .orchestrator import REGISTRY, Budget, PlanError, Task, validate_plan
from .routing import OPERATIONS, RoutingRequest, RuleBasedRouter
from .runner import ExecutionLimits, TaskOutput, TaskResult, TaskRunner
from .checkpoints import RunnerJournal, run_lease, serializer
from .approval import ApprovalError, DecisionSignal, PreparedProposal, validated
from .state import Citation, GraphResponse, GraphResult, MainRequest, MainState, ScopeRef


def checkpoint_binding(request, limits):
    return sha256((request.model_dump_json() + limits.model_dump_json()).encode()).hexdigest()


def checkpoint_config(request):
    return {"configurable": {"thread_id": f"{request.thread_id}:{request.scope.digest()}:{request.run_id}",
                             "checkpoint_ns": ""}, "recursion_limit": 16}


def manifest_digest(manifest):
    return sha256(json.dumps(asdict(manifest), sort_keys=True).encode()).hexdigest()


def packet_ref(packet):
    data = packet.model_dump(mode="json", exclude={"result": {
        "evidence": {"__all__": {"retrieved_at"}}, "coverage": {"checked_at"}}})
    return "context:" + sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def result_state(value):
    # __interrupt__는 LangGraph 반환 envelope이며 업무 상태 채널이 아니다.
    return MainState.model_validate({k:v for k,v in value.items() if k != "__interrupt__"})


def build_plan(classification, scope):
    """분류된 고정 capability만 연결한다. 모델 planner·임의 실행기는 없다."""
    tasks = []
    for op in ("context", *(c for c in classification.capabilities if c != "context")):
        spec = REGISTRY[op]
        parents = tasks[:1] if tasks else []
        if len(tasks) > 1 and tasks[-1].output_schema in spec.input_schema and op in REGISTRY[tasks[-1].operation].allowed_successors:
            parents = [tasks[0], tasks[-1]]
        condition = ("has_confirmed_findings" if op == "editing" and classification.task_pattern == "review_then_edit"
                     else "draft_requested" if op == "writing" and classification.primary_intent == "next_draft" else "always")
        calls = 0 if op in ("context", "mechanical", "template") else 1
        tasks.append(Task(task_id=op, operation=op, scope_digest=scope.digest(),
            depends_on=tuple(t.task_id for t in parents), input_refs=tuple(
                {"task_id": t.task_id, "output_schema": t.output_schema} for t in parents),
            run_if=condition, output_schema=spec.output_schema, timeout_ms=10000,
            budget=Budget(model_calls=calls, input_tokens=2000 if calls else 0, output_tokens=1000 if calls else 0)))
    return tuple(tasks)


class MainGraph:
    def __init__(self, content, coordinator, *, handlers=None, router=None, plan_factory=build_plan,
                 checkpointer=None, limits=ExecutionLimits(), approval=None):
        self.content, self.coordinator = content, coordinator
        self.handlers, self.router = dict(handlers or {}), router or RuleBasedRouter()
        if "context" in self.handlers or any(op not in REGISTRY for op in self.handlers):
            raise PlanError("unregistered_or_reserved_handler")
        self.plan_factory, self.limits = plan_factory, limits
        self.checkpointer = checkpointer if checkpointer is not None else InMemorySaver(serde=serializer())
        self._sessions = {}
        self._approval_runs = set()
        self.approval = approval

    async def run(self, request: MainRequest, *, cancel=None, limits=None, resume=False,
                  decision_ref=None, interrupt_ref=None) -> GraphResult:
        async with run_lease(self.checkpointer, request.thread_id):
            return await self._run(request, cancel=cancel, limits=limits, resume=resume,
                                   decision_ref=decision_ref, interrupt_ref=interrupt_ref)

    async def _run(self, request: MainRequest, *, cancel=None, limits=None, resume=False,
                   decision_ref=None, interrupt_ref=None) -> GraphResult:
        limits = limits if limits is not None else self.limits
        request = MainRequest.model_validate(request.model_dump())
        signal = validated(DecisionSignal, {"decision_ref":decision_ref,"interrupt_ref":interrupt_ref}) if decision_ref is not None else None
        if interrupt_ref is not None and signal is None:
            raise ApprovalError("decision_reference_required")
        if (signal is not None or interrupt_ref is not None) and not resume:
            raise ApprovalError("resume_required")
        if not resume and request.run_id in self._sessions:
            raise PlanError("run_already_started")
        cancel = cancel if cancel is not None else asyncio.Event()
        assets = {"packet": None, "denied": False}
        manifest = None
        compiled = None
        config = checkpoint_config(request)
        if resume:
            manifest = CanonicalAdapter(self.content).manifest(request.scope)
            if request.query.scope != request.scope:
                raise ContentReadError("denied")
        saved = await self.checkpointer.aget_tuple(config)
        if saved is not None and not resume:
            raise PlanError("run_already_checkpointed")
        if resume and saved is None:
            raise PlanError("checkpoint_not_found")
        approval_phase, receipt_before = False, None
        if resume:
            values = saved.checkpoint["channel_values"]
            values = values.get("__start__", values)
            if values.get("request_digest") != checkpoint_binding(request, limits):
                raise ContentReadError("denied")
            approval_phase = values.get("prepared_proposal") is not None
            if approval_phase:
                self._approval_runs.add(request.run_id)
                if self.approval is None:
                    raise ApprovalError("approval_unconfigured")
                prepared = validated(PreparedProposal, values["prepared_proposal"])
                receipt_before = await self.approval.resolve(request, prepared, signal.decision_ref if signal else None)
                if values.get("approval_receipt") is not None and (
                        receipt_before is None or validated(type(receipt_before), values["approval_receipt"]) != receipt_before):
                    raise ApprovalError("receipt_binding_mismatch")
            elif signal is not None:
                raise ApprovalError("no_approval_interrupt")
            if receipt_before is None and values.get("manifest_digest") not in (None, manifest_digest(manifest)):
                raise ContentReadError("denied")
        journal = RunnerJournal(self.checkpointer, config)
        saved_runner = await journal.read() if resume and not approval_phase else None
        async def retrieve_context():
            packet = validate_packet(await self.coordinator.retrieve(request.query), request.query, self.content)
            if packet.result.status in ("denied", "unavailable", "unsupported"):
                raise ContentReadError(packet.result.status)
            assets["packet"] = packet
            return packet
        if resume and not approval_phase:
            completed = values.get("task_results", ()) or (saved_runner.results if saved_runner else ())
            for item in completed:
                item = TaskResult.model_validate(item) if isinstance(item, dict) else item
                if item.output_schema == "ContextPacket.v1" and item.status in ("succeeded", "partial"):
                    if packet_ref(await retrieve_context()) != item.output_ref:
                        raise ContentReadError("denied")
        self._sessions[request.run_id] = (request.thread_id, request.scope.digest(), None, config)

        def halted(state):
            return state.execution_status != "running"

        def restore(state):
            nonlocal manifest
            if cancel.is_set():
                return {"execution_status": "cancelled"}
            try:
                if request.query.scope != request.scope:
                    raise ContentReadError("denied")
                manifest = CanonicalAdapter(self.content).manifest(request.scope)
                return {"scope": ScopeRef(digest=request.scope.digest(), manifest_ref=manifest.manifest_ref,
                    basis_episode=request.scope.basis_episode), "security_ref": "content-verified", "execution_status": "running",
                    "manifest_digest": manifest_digest(manifest)}
            except ContentReadError as error:
                return {"execution_status": "denied" if error.status == "denied" else "failed", "errors": ("scope_unavailable",)}

        def route(state):
            if halted(state):
                return {}
            if cancel.is_set():
                return {"execution_status": "cancelled"}
            try:
                classification = self.router.classify(RoutingRequest(text=request.prompt), request.allowed_operations, request.ui_mode)
                if not classification.in_scope or classification.risk_flags or classification.approval_intent:
                    return {"classification": classification, "execution_status": "denied"}
                if not classification.capabilities:
                    return {"classification": classification, "execution_status": "clarification"}
                expected = OPERATIONS.get(classification.primary_intent)
                if classification.task_pattern == "review_then_edit":
                    expected = (*OPERATIONS["review"], "editing")
                if classification.capabilities != expected:
                    raise PlanError("invalid_classification")
                return {"classification": classification}
            except Exception:
                return {"execution_status": "failed", "errors": ("routing_failed",)}

        def plan(state):
            if halted(state):
                return {}
            try:
                tasks = self.plan_factory(state.classification, request.scope)
                allowed = tuple(dict.fromkeys(("context", *(c for op in request.allowed_operations for c in OPERATIONS[op]))))
                validate_plan(tasks, scope=request.scope, manifest=manifest, allowed_operations=allowed, limits=limits.plan)
                return {"task_plan": tasks}
            except Exception:
                return {"execution_status": "failed", "errors": ("invalid_plan",)}

        async def dispatch(state):
            if halted(state):
                return {}
            async def context_handler(slice, ctx):
                ctx.checkpoint()
                try:
                    packet = await retrieve_context()
                except ContentReadError as error:
                    assets["denied"] = error.status == "denied"
                    raise
                return TaskOutput(output_schema="ContextPacket.v1", output_ref=packet_ref(packet),
                                  status="succeeded" if packet.can_conclude else "partial", is_mock=True)
            runner = TaskRunner(request.run_id, state.task_plan, scope=request.scope, manifest=manifest,
                allowed_operations=tuple(REGISTRY), handlers={**self.handlers, "context": context_handler}, limits=limits,
                wants_change=state.classification.wants_change,
                draft_requested=state.classification.primary_intent == "next_draft",
                saved=saved_runner, persist=journal.write)
            async def watch_cancel():
                await cancel.wait()
                runner.cancel()
            watcher = asyncio.create_task(watch_cancel())
            try:
                if cancel.is_set():
                    runner.cancel()
                result = await runner.run()
                return {"task_results": result.results, "budget_usage": result.accounted,
                        "usage_unknown": result.usage_unknown, "execution_status": "denied" if assets["denied"] else result.status}
            finally:
                watcher.cancel()

        def merge(state):
            refs = {"SimulationReport.v1": "simulation_ref", "GeneratedText.v1": "generated_content_ref", "ChangeSet.v1": "change_set_ref"}
            return {refs[item.output_schema]: item.output_ref for item in state.task_results
                    if item.status == "succeeded" and item.output_schema in refs}

        def validate_output(state):
            if state.execution_status in ("denied", "clarification", "cancelled", "failed"):
                return {}
            try:
                packet = assets["packet"]
                if packet is None or any(not result.is_mock for result in state.task_results):
                    raise ContentReadError("denied")
                packet = validate_packet(packet, request.query, self.content)
                assets["packet"] = packet
                return {"evidence_refs": tuple(item.evidence_ref for item in packet.context), "coverage": packet.result.coverage,
                        "execution_status": state.execution_status if packet.can_conclude else "partial"}
            except Exception:
                assets["packet"] = None
                return {"execution_status": "denied", "evidence_refs": (), "coverage": None, "errors": ("output_invalid",),
                        "simulation_ref": None, "generated_content_ref": None, "change_set_ref": None}

        async def proposal(state):
            if state.execution_status == "succeeded" and (state.change_set_ref or state.generated_content_ref):
                if self.approval is not None:
                    ref = state.change_set_ref or state.generated_content_ref
                    candidates = [t for t in state.task_results if t.status == "succeeded" and t.output_ref == ref
                                  and t.output_schema in ("ChangeSet.v1","GeneratedText.v1")]
                    if len(candidates) != 1 or not state.classification.wants_change:
                        raise ApprovalError("invalid_approval_task")
                    self._approval_runs.add(request.run_id)
                    prepared = await self.approval.prepare(request, candidates[0])
                    return {"prepared_proposal":prepared,"approval_ref":prepared.proposal_id,
                            "execution_status":"awaiting_approval"}
                return {"execution_status": "proposal"}
            return {}

        async def await_decision(state):
            receipt = await self.approval.wait(request, state.prepared_proposal)
            return {"approval_receipt":receipt,"approval_ref":receipt.decision_id,
                    "execution_status":receipt.outcome}

        def respond(state):
            return {"execution_status": "cancelled" if cancel.is_set() and state.approval_receipt is None else state.execution_status,
                    "response_ref": f"response:{request.run_id}"}

        builder = StateGraph(MainState)
        nodes = (("restore", restore), ("route", route), ("plan", plan), ("dispatch", dispatch),
                 ("merge", merge), ("validate_output", validate_output), ("proposal", proposal),
                 ("await_decision", await_decision), ("respond", respond))
        for name, fn in nodes:
            async def primitive_node(state, fn=fn):
                try:
                    value = fn(state)
                    if inspect.isawaitable(value):
                        value = await value
                    return to_jsonable_python(value)
                except GraphInterrupt:
                    raise
                except Exception:
                    # LangGraph가 자동 저장하는 ERROR write에도 backend 원문을 남기지 않는다.
                    raise PlanError("graph_node_failed") from None
            builder.add_node(name, primitive_node)
        builder.add_edge(START, "restore")
        builder.add_conditional_edges("restore", lambda s: "route" if not halted(s) else "respond", ["route", "respond"])
        builder.add_conditional_edges("route", lambda s: "plan" if not halted(s) else "respond", ["plan", "respond"])
        builder.add_conditional_edges("plan", lambda s: "dispatch" if not halted(s) else "respond", ["dispatch", "respond"])
        builder.add_edge("dispatch", "merge")
        builder.add_edge("merge", "validate_output")
        builder.add_conditional_edges("validate_output", lambda s: "proposal" if s.execution_status == "succeeded" else "respond",
                                      ["proposal", "respond"])
        builder.add_conditional_edges("proposal", lambda s: "await_decision" if s.execution_status == "awaiting_approval" else "respond",
                                      ["await_decision","respond"])
        builder.add_edge("await_decision", "respond")
        builder.add_edge("respond", END)
        compiled = builder.compile(checkpointer=self.checkpointer)
        self._sessions[request.run_id] = (request.thread_id, request.scope.digest(), compiled, config)
        initial = MainState(thread_id=request.thread_id, run_id=request.run_id, request_ref=request.request_ref,
                            messages=request.messages, summary_ref=request.summary_ref,
                            request_digest=checkpoint_binding(request, limits))
        invoke_input = None if resume else initial.model_dump(mode="json")
        if approval_phase:
            snapshot = await compiled.aget_state(config)
            active = snapshot.interrupts
            if signal and signal.interrupt_ref is not None:
                expected = active[0].id if len(active) == 1 else values.get("approval_interrupt_ref")
                if signal.interrupt_ref != expected:
                    raise ApprovalError("interrupt_mismatch")
            if receipt_before is not None and active:
                if len(active) != 1:
                    raise ApprovalError("interrupt_mismatch")
                invoke_input = Command(resume={active[0].id:receipt_before.decision_id}, update={"approval_interrupt_ref":active[0].id})
        visible_interrupt = None
        try:
            final = result_state(await compiled.ainvoke(invoke_input, config, durability="sync"))
            if final.execution_status == "awaiting_approval":
                snapshot = await compiled.aget_state(config)
                if len(snapshot.interrupts) != 1:
                    raise ApprovalError("interrupt_mismatch")
                visible_interrupt = snapshot.interrupts[0].id
                # 결정이 interrupt 저장보다 먼저 커밋돼도 여기서 발견한다. 실제 적용은 Content만 한다.
                receipt = await self.approval.resolve(request, final.prepared_proposal)
                if receipt is not None:
                    command = Command(resume={visible_interrupt:receipt.decision_id}, update={"approval_interrupt_ref":visible_interrupt})
                    final = result_state(await compiled.ainvoke(command, config, durability="sync"))
        except asyncio.CancelledError:
            cancel.set()
            raise
        except Exception:
            final = initial.model_copy(update={"execution_status": "failed", "errors": ("graph_failed",)})
        citations = []
        packet = assets["packet"]
        if packet is not None and final.execution_status in ("succeeded", "partial", "proposal"):
            # 체크포인트에는 넣지 않고 최종 응답에만 검증된 인용 본문을 담는다.
            selected = set(final.evidence_refs)
            seen = set()
            for item in packet.result.evidence:
                key = (item.source_revision, item.source_span)
                if item.id in selected and key not in seen:
                    seen.add(key)
                    citations.append(Citation(evidence_ref=item.id, source_revision=item.source_revision,
                        span=item.source_span, source_hash=item.source_hash, episode=item.as_of_episode, quote=item.content, is_mock=True))
        labels = {"succeeded": "합성 자료에서 확인한 근거입니다.", "partial": "근거가 부족하거나 일부 작업이 완료되지 않았습니다. 합성 자료의 확인 범위만 표시합니다.",
                  "proposal": "합성 변경 제안입니다. 실제 적용은 차단되어 있습니다.", "clarification": "요청할 작업과 대상을 선택해 주세요.",
                  "denied": "허용 범위를 확인할 수 없거나 실행할 수 없는 요청입니다.", "failed": "작업을 완료하지 못했습니다.", "cancelled": "작업이 취소되었습니다."}
        labels.update(awaiting_approval="변경안을 검토한 뒤 명시적으로 승인·거절·재수정을 선택해 주세요.",
                      applied="Content의 적용 영수증을 확인했습니다.", rejected="변경 제안이 거절되었습니다.",
                      revision_requested="재수정 요청이 기록되었습니다.")
        text = labels[final.execution_status] + "".join(f"\n[{c.evidence_ref}] {c.quote}" for c in citations)
        prepared = final.prepared_proposal
        return GraphResult(state=final, response=GraphResponse(status=final.execution_status, text=text, citations=tuple(citations),
            proposal_id=prepared.proposal_id if prepared else None, proposal_version=prepared.proposal_version if prepared else None,
            proposal_hash=prepared.proposal_hash if prepared else None,
            interrupt_ref=visible_interrupt or final.approval_interrupt_ref, receipt=final.approval_receipt))

    def history(self, request: MainRequest) -> tuple[MainState, ...]:
        """현재 권한·scope를 확인한 뒤 참조 전용 체크포인트만 반환한다."""
        CanonicalAdapter(self.content).manifest(request.scope)
        thread, digest, compiled, config = self._sessions[request.run_id]
        if thread != request.thread_id or digest != request.scope.digest() or compiled is None:
            raise ContentReadError("denied")
        return tuple(MainState.model_validate(snapshot.values) for snapshot in compiled.get_state_history(config)
                     if snapshot.values and "thread_id" in snapshot.values)

    async def ahistory(self, request: MainRequest) -> tuple[MainState, ...]:
        """재시작한 wrapper도 현재 Content 권한을 확인한 뒤 비동기 이력만 읽는다."""
        CanonicalAdapter(self.content).manifest(request.scope)
        config = checkpoint_config(request)
        history = []
        async for saved in self.checkpointer.alist(config):
            values = saved.checkpoint["channel_values"]
            if values.get("thread_id") == request.thread_id and values.get("run_id") == request.run_id:
                history.append(MainState.model_validate({k: v for k, v in values.items() if k in MainState.model_fields}))
        return tuple(history)
