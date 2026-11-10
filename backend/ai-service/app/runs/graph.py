"""참조 전용 Main StateGraph. 실제 모델·승인·쓰기·공개 HTTP 경로는 연결하지 않는다."""
import asyncio

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from app.retrieval.content_client import CanonicalAdapter, ContentReadError
from app.retrieval.validation import validate_packet
from .orchestrator import REGISTRY, Budget, PlanError, Task, validate_plan
from .routing import OPERATIONS, RoutingRequest, RuleBasedRouter
from .runner import ExecutionLimits, TaskOutput, TaskRunner
from .state import Citation, GraphResponse, GraphResult, MainRequest, MainState, ScopeRef


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
                 checkpointer=None, limits=ExecutionLimits()):
        self.content, self.coordinator = content, coordinator
        self.handlers, self.router = dict(handlers or {}), router or RuleBasedRouter()
        if "context" in self.handlers or any(op not in REGISTRY for op in self.handlers):
            raise PlanError("unregistered_or_reserved_handler")
        self.plan_factory, self.limits = plan_factory, limits
        self.checkpointer = checkpointer if checkpointer is not None else InMemorySaver()
        self._sessions = {}

    async def run(self, request: MainRequest, *, cancel=None, limits=None) -> GraphResult:
        limits = limits if limits is not None else self.limits
        request = MainRequest.model_validate(request.model_dump())
        if request.run_id in self._sessions:
            raise PlanError("run_already_started")
        cancel = cancel if cancel is not None else asyncio.Event()
        assets = {"packet": None, "denied": False}
        manifest = None
        compiled = None
        config = {"configurable": {"thread_id": f"{request.thread_id}:{request.scope.digest()}:{request.run_id}"},
                  "recursion_limit": 16}
        if self.checkpointer.get_tuple(config) is not None:
            raise PlanError("run_already_checkpointed")
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
                    basis_episode=request.scope.basis_episode), "security_ref": "content-verified", "execution_status": "running"}
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
                    packet = validate_packet(await self.coordinator.retrieve(request.query), request.query, self.content)
                    if packet.result.status == "denied":
                        raise ContentReadError("denied")
                    if packet.result.status in ("unavailable", "unsupported"):
                        raise ContentReadError(packet.result.status)
                    assets["packet"] = packet
                except ContentReadError as error:
                    assets["denied"] = error.status == "denied"
                    raise
                return TaskOutput(output_schema="ContextPacket.v1", output_ref=f"context:{request.run_id}",
                                  status="succeeded" if packet.can_conclude else "partial", is_mock=True)
            runner = TaskRunner(request.run_id, state.task_plan, scope=request.scope, manifest=manifest,
                allowed_operations=tuple(REGISTRY), handlers={**self.handlers, "context": context_handler}, limits=limits,
                wants_change=state.classification.wants_change,
                draft_requested=state.classification.primary_intent == "next_draft")
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

        def proposal(state):
            if state.execution_status == "succeeded" and (state.change_set_ref or state.generated_content_ref):
                return {"execution_status": "proposal"}
            return {}

        def respond(state):
            return {"execution_status": "cancelled" if cancel.is_set() else state.execution_status,
                    "response_ref": f"response:{request.run_id}"}

        builder = StateGraph(MainState)
        nodes = (("restore", restore), ("route", route), ("plan", plan), ("dispatch", dispatch),
                 ("merge", merge), ("validate_output", validate_output), ("proposal", proposal), ("respond", respond))
        for name, fn in nodes:
            builder.add_node(name, fn)
        builder.add_edge(START, "restore")
        builder.add_conditional_edges("restore", lambda s: "route" if not halted(s) else "respond", ["route", "respond"])
        builder.add_conditional_edges("route", lambda s: "plan" if not halted(s) else "respond", ["plan", "respond"])
        builder.add_conditional_edges("plan", lambda s: "dispatch" if not halted(s) else "respond", ["dispatch", "respond"])
        builder.add_edge("dispatch", "merge")
        builder.add_edge("merge", "validate_output")
        builder.add_conditional_edges("validate_output", lambda s: "proposal" if s.execution_status == "succeeded" else "respond",
                                      ["proposal", "respond"])
        builder.add_edge("proposal", "respond")
        builder.add_edge("respond", END)
        compiled = builder.compile(checkpointer=self.checkpointer)
        self._sessions[request.run_id] = (request.thread_id, request.scope.digest(), compiled, config)
        initial = MainState(thread_id=request.thread_id, run_id=request.run_id, request_ref=request.request_ref,
                            messages=request.messages, summary_ref=request.summary_ref)
        try:
            final = MainState.model_validate(await compiled.ainvoke(initial.model_dump(), config))
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
        text = labels[final.execution_status] + "".join(f"\n[{c.evidence_ref}] {c.quote}" for c in citations)
        return GraphResult(state=final, response=GraphResponse(status=final.execution_status, text=text, citations=tuple(citations)))

    def history(self, request: MainRequest) -> tuple[MainState, ...]:
        """현재 권한·scope를 확인한 뒤 참조 전용 체크포인트만 반환한다."""
        CanonicalAdapter(self.content).manifest(request.scope)
        thread, digest, compiled, config = self._sessions[request.run_id]
        if thread != request.thread_id or digest != request.scope.digest() or compiled is None:
            raise ContentReadError("denied")
        return tuple(MainState.model_validate(snapshot.values) for snapshot in compiled.get_state_history(config)
                     if snapshot.values and "thread_id" in snapshot.values)
