"""다음 화·콘티의 run별 합성 DAG. 검증 전 후보와 승인·실제 저장을 분리한다."""
from datetime import datetime, timezone
from hashlib import sha256
from typing import Literal

from pydantic import StrictBool, model_validator

from app.retrieval.content_client import CanonicalAdapter, ContentReadError
from app.retrieval.contracts import Contract, Gap
from app.retrieval.validation import validate_packet
from .development import DevelopmentRequest, development, development_tasks
from .semantic_review import _simulation_context
from .simulation import SimulationHandler
from .story_context import ExactSource
from .writing import WritingRequest, WritingResult, writing, writing_tasks


class NextDraftRequest(Contract):
    development: DevelopmentRequest
    writing: WritingRequest
    draft_requested: StrictBool = True
    current_relationships_required: StrictBool = False

    @model_validator(mode="after")
    def matching_context(self):
        if (self.development.query != self.writing.query or self.writing.mode != "draft"
                or self.development.mode not in ("next_episode_planning", "expand_conti")
                or not self.draft_requested and self.writing.save_requested):
            raise ValueError("draft_request_mismatch")
        return self


class ContinuityResult(Contract):
    complete: StrictBool
    is_mock: Literal[True] = True
    # shortcut: 명시 문구의 보수적 일치 검사, 자유 의역·서사 품질은 별도 의미 평가가 필요하다.
    method: Literal["literal_plan_and_source_checks"] = "literal_plan_and_source_checks"
    semantic_quality_verified: Literal[False] = False
    gaps: tuple[Gap, ...] = ()


def next_draft_tasks(request, *, context_task):
    """Context→선택 Simulation→BeatPlan→Writing→모델 0회 연속성 검사."""
    from app.runs.orchestrator import Budget, InputRef, Task
    request = NextDraftRequest.model_validate(request.model_dump())
    tasks = development_tasks(request.development, context_task=context_task)
    if not request.draft_requested:
        return tasks
    draft, = writing_tasks(request.writing, context_task=context_task)
    draft = draft.model_copy(update={"depends_on": (context_task.task_id, tasks[-1].task_id),
        "input_refs": (*draft.input_refs, InputRef(task_id=tasks[-1].task_id, output_schema="BeatPlan.v1"))})
    # model_copy로 추가한 참조도 공용 validator와 동일한 DTO로 고정한다.
    draft = Task.model_validate(draft.model_dump())
    continuity = Task(task_id="draft-continuity", operation="mechanical", scope_digest=context_task.scope_digest,
        depends_on=(context_task.task_id, draft.task_id), input_refs=(
            {"task_id": context_task.task_id, "output_schema": "ContextPacket.v1"},
            {"task_id": draft.task_id, "output_schema": "GeneratedText.v1"}),
        output_schema="Findings.v1", timeout_ms=10000, budget=Budget())
    return (*tasks, draft, continuity)


class NextDraftHandler:
    """하나의 run에만 주입한다. 본문·보고는 메모리, 실행기에는 참조·상태만 남긴다."""
    def __init__(self, request, *, content, coordinator, model=None):
        self.request = NextDraftRequest.model_validate(request.model_dump())
        self.content, self.coordinator, self.model = content, coordinator, model
        self.packet = self.plan = self.result = self.continuity = self.simulation = None
        self._candidate = None
        self.relationships = ()
        self.run_id = None

    async def _read_relationships(self):
        query = self.request.development.query.model_copy(update={"operation": "current", "episode_range": None,
            "document_ids": (), "source_kinds": (), "entity_ids": (), "query_text": None,
            "required_fields": ("content", "fact_or_relation")})
        return await self.coordinator.retrieve(query)

    async def _fresh(self):
        query = self.request.development.query.model_copy(update={"operation": "full_context"})
        if datetime.now(timezone.utc) >= query.deadline:
            raise TimeoutError()
        if (CanonicalAdapter(self.content).manifest(query.scope) != self.manifest or self.content.rows != self.rows
                or not validate_packet(self.packet, query, self.content).can_conclude):
            raise ContentReadError("denied")
        if self.request.current_relationships_required:
            packet = await self._read_relationships()
            current = packet.result.evidence
            if (not packet.can_conclude or [e.model_dump(exclude={"retrieved_at"}) for e in current]
                    != [e.model_dump(exclude={"retrieved_at"}) for e in self.relationships]):
                raise ContentReadError("denied")

    async def __call__(self, slice, ctx):
        from app.runs.orchestrator import PlanError
        from app.runs.runner import TaskOutput
        ctx.checkpoint()
        req, dev = self.request, self.request.development
        if ctx.runner.scope != dev.query.scope:
            raise PlanError("draft_scope_mismatch")
        def output(ok):
            return TaskOutput(output_schema=slice.output_schema, output_ref=f"draft:{slice.run_id}:{slice.task_id}",
                status="succeeded" if ok else "partial", is_mock=True)
        if slice.operation == "context" or self.run_id is None:
            if self.run_id is not None:
                raise PlanError("draft_already_started")
            self.run_id = slice.run_id
            # Main은 context를 소유하므로 첫 전문 Task에서도 같은 준비 검증을 수행한다.
            root = next(t for t in ctx.runner.tasks if t.operation == "context")
            self.tasks = {t.task_id: t for t in next_draft_tasks(req, context_task=root)}
            self.manifest = CanonicalAdapter(self.content).manifest(dev.query.scope)
            self.rows = self.content.rows
            query = dev.query.model_copy(update={"operation": "full_context"})
            self.packet = validate_packet(await self.coordinator.retrieve(query), query, self.content)
            coverage = self.packet.result.coverage
            if (not self.packet.can_conclude or query.episode_range not in (None, (1, query.scope.basis_episode))
                    or coverage is None or {e.number for e in coverage.episodes} != set(range(1,query.scope.basis_episode+1))
                    or dev.reaction_required and (dev.simulation_input is None or not dev.simulation_input.remaining_model_calls)):
                return output(False)
            selected = {e.id for e in self.packet.result.evidence if e.as_of_episode == query.scope.basis_episode}
            selected.update((*dev.hook_refs, *dev.conti_refs, *dev.plot_refs, *dev.character_refs))
            if dev.reaction_required:
                selected.update(dev.simulation_input.constraints.source_refs)
            evidence = {e.id: e for e in self.packet.result.evidence}
            for exact in req.writing.context_refs:
                matches = {e.id for e in evidence.values() if (e.source_revision,e.source_span,e.source_hash)
                    == (exact.version,exact.span,exact.source_hash)}
                if not matches:
                    return output(False)
                selected.update(matches)
            pending = list(selected)
            while pending:
                item = evidence.get(pending.pop())
                if item is None:
                    continue
                for ref in item.evidence_refs:
                    if ref not in selected:
                        selected.add(ref)
                        pending.append(ref)
            self.packet = self.packet.model_copy(update={"context": tuple(c for c in self.packet.context if c.evidence_ref in selected)})
            if req.current_relationships_required:
                relations = await self._read_relationships()
                if not relations.can_conclude:
                    return output(False)
                self.relationships = relations.result.evidence
            if dev.reaction_required:
                self.simulation = SimulationHandler(dev.simulation_input, content=self.content, packet=self.packet, model=self.model)
            await self._fresh()
            if slice.operation == "context":
                return output(True)
        expected = self.tasks.get(slice.task_id)
        # Simulation timeout은 남은 deadline으로 계산되므로 재조립 시각의 차이는 제외한다.
        if (self.run_id != slice.run_id or expected is None
                or expected.model_dump(exclude={"timeout_ms"}) != ctx.task.model_dump(exclude={"timeout_ms"})):
            raise PlanError("draft_task_mismatch")
        await self._fresh()
        if slice.operation == "simulation":
            return await self.simulation(slice, ctx)
        reports = self.simulation.reports if self.simulation else ()
        if slice.operation == "development":
            self.plan = await development(dev, content=self.content, coordinator=self.coordinator, model=self.model,
                simulation_reports=reports, call_context=ctx, packet=self.packet, current_relationships=self.relationships)
            await self._fresh()
            return output(self.plan.status == "ok")
        if self.plan is None or self.plan.status != "ok":
            raise PlanError("missing_beat_plan")
        if slice.operation == "writing":
            sources = {e.id:e for e in self.plan.sources}
            mapping, exacts = {}, []
            speaker = req.writing.speaker_id
            for e in sources.values():
                row = next(r for r in self.rows if r.version == e.source_revision)
                if speaker is not None and speaker not in row.known_by and "*" not in row.known_by:
                    return output(False)
                exact = ExactSource(version=e.source_revision, span=e.source_span, source_hash=e.source_hash)
                mapping[e.id] = "writing-source:"+sha256(exact.model_dump_json().encode()).hexdigest()
                if exact not in exacts:
                    exacts.append(exact)
            beats = tuple(b.model_copy(update={"refs":tuple(mapping[r] for r in b.refs)}) for b in self.plan.beats)
            simulations = _simulation_context(dev, reports, sources, self.packet, self.content)
            phrases = [p for b in beats for p in (b.goal,b.action,b.dialogue,b.cause)]
            phrases.extend(e.content for e in sources.values() if e.id in (*dev.hook_refs,*dev.character_refs))
            phrases.extend(CanonicalAdapter(self.content).read(dev.query.scope,e.version,e.span,e.source_hash).text
                for e in req.writing.style_examples)
            self.required_phrases = tuple(dict.fromkeys(phrases))
            writing_request = WritingRequest.model_validate(req.writing.model_copy(update={"context_refs":tuple(exacts)}).model_dump())
            self._candidate = await writing(writing_request, content=self.content, model=self.model, call_context=ctx,
                beats=beats, simulations=simulations, current_relationships=self.relationships, required_phrases=self.required_phrases)
            await self._fresh()
            if self._candidate.status != "ok":
                self.result = self._candidate
            return output(self._candidate.status == "ok")
        if slice.operation != "mechanical" or self._candidate is None or self._candidate.status != "ok":
            raise PlanError("missing_draft")
        text = self._candidate.generated_text.text
        complete = bool(self.plan.beats) and all(p in text for p in self.required_phrases)
        self.continuity = ContinuityResult(complete=complete, gaps=() if complete else (Gap(code="unverified"),))
        self.result = self._candidate if complete else WritingResult(status="blocked", gaps=self.continuity.gaps)
        self._candidate = None
        ctx.checkpoint()
        return output(complete)
