"""인물 지식을 분리하는 메모리 전용 LangGraph. 합성 자료·명시 주입한 Actor만 사용한다."""
import asyncio
from datetime import datetime, timezone
from typing import Annotated, Literal, Protocol
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from pydantic import Field, StrictBool, ValidationError, model_validator

from app.retrieval.content_client import ContentReadError
from app.retrieval.contracts import Contract, Id, PositiveInt, Query
from app.retrieval.validation import validate_packet
from app.retrieval.mock_content import MockContentReadPort
from .story_context import ExactSource


Count = Annotated[int, Field(strict=True, ge=0)]
Kind = Literal["speak", "move", "observe", "wait"]
StopReason = Literal["turn_limit", "goal_reached", "repeated_wait", "characters_exhausted",
    "budget_exhausted", "timeout", "cancelled", "validation_failed", "unsupported_evidence",
    "denied", "dependency_unavailable", "provider_failed"]


class Action(Contract):
    actor_id: Id
    turn: PositiveInt
    kind: Kind
    target_ids: tuple[Id, ...]
    text: str = Field(max_length=800, repr=False)
    used_fact_ids: tuple[Id, ...]
    disclosed_fact_ids: tuple[Id, ...]

    @model_validator(mode="after")
    def unique_ids(self):
        if any(len(v) != len(set(v)) for v in (self.target_ids, self.used_fact_ids, self.disclosed_fact_ids)):
            raise ValueError("action IDs must be unique")
        return self


class Belief(Contract):
    fact_id: Id
    learned_at: Count = 0
    source_ref: Id
    status: Literal["source", "claim"] = "source"
    speaker_id: Id | None = None


class Observation(Contract):
    actor_id: Id
    turn: PositiveInt
    text: str = Field(repr=False)
    source_refs: tuple[Id, ...]


class CharacterState(Contract):
    id: Id
    profile_refs: tuple[Id, ...] = ()
    goal_refs: tuple[Id, ...] = ()
    voice_refs: tuple[Id, ...] = ()
    emotion_refs: tuple[Id, ...] = ()
    location: Id
    resources: Count
    beliefs: tuple[Belief, ...] = ()
    observations: tuple[Observation, ...] = Field(default=(), repr=False)


class MoveRule(Contract):
    origin: Id
    destination: Id
    cost: Count = 1


class Constraints(Contract):
    locations: Annotated[tuple[Id, ...], Field(min_length=1)]
    moves: tuple[MoveRule, ...] = ()
    source_refs: Annotated[tuple[Id, ...], Field(min_length=1)]
    disclosable_fact_ids: tuple[Id, ...] = ()
    blocked_kinds: tuple[Kind, ...] = ()


class Position(Contract):
    actor_id: Id
    location: Id


class Scenario(Contract):
    id: Id
    initial_positions: tuple[Position, ...] = ()


class Goal(Contract):
    actor_id: Id
    fact_id: Id


class SimulationInput(Contract):
    query: Query = Field(repr=False)
    snapshot_ref: Id
    characters: Annotated[tuple[CharacterState, ...], Field(min_length=1, max_length=2)]
    active_ids: tuple[Id, ...] = ()
    scenarios: Annotated[tuple[Scenario, ...], Field(min_length=1, max_length=2)]
    goal: Goal | None = None
    constraints: Constraints
    turn_limit: Annotated[int, Field(strict=True, ge=1, le=14)] = 3
    remaining_model_calls: Annotated[int, Field(strict=True, ge=0, le=14)] = 14
    call_timeout_ms: PositiveInt = 10000
    input_token_cap: PositiveInt = 2000
    output_token_cap: PositiveInt = 1000

    @model_validator(mode="after")
    def fixed_initial_state(self):
        ids = tuple(c.id for c in self.characters)
        active = self.active_ids or ids
        if (len(set(ids)) != len(ids) or len(set(active)) != len(active) or not set(active) <= set(ids)
                or len({s.id for s in self.scenarios}) != len(self.scenarios)
                or any(c.beliefs or c.observations for c in self.characters)
                or any(c.location not in self.constraints.locations for c in self.characters)
                or self.goal and self.goal.actor_id not in active):
            raise ValueError("invalid initial simulation state")
        for s in self.scenarios:
            if (len({p.actor_id for p in s.initial_positions}) != len(s.initial_positions)
                    or any(p.actor_id not in active or p.location not in self.constraints.locations for p in s.initial_positions)):
                raise ValueError("invalid scenario positions")
        edges = [(m.origin, m.destination) for m in self.constraints.moves]
        if len(edges) != len(set(edges)) or any(a not in self.constraints.locations or b not in self.constraints.locations for a, b in edges):
            raise ValueError("invalid movement rules")
        return self


class SimulationUsage(Contract):
    model_calls: Count = 0
    input_tokens: Count = 0
    output_tokens: Count = 0


class SimulationState(Contract):
    simulation_id: Id
    scenario_id: Id
    snapshot_ref: Id
    active_ids: tuple[Id, ...]
    turn_index: PositiveInt = 1
    characters: tuple[CharacterState, ...]
    action_history: tuple[Action, ...] = Field(default=(), repr=False)
    applied_turns: tuple[tuple[Id, PositiveInt], ...] = ()
    budget_usage: SimulationUsage = SimulationUsage()
    usage_unknown: StrictBool = False
    retry: Count = 0
    pending: Action | None = Field(default=None, repr=False)
    validation_error: Id | None = None
    contradictions: tuple[Id, ...] = ()
    stop_reason: StopReason | None = None


class ActorFact(Contract):
    id: Id
    text: str = Field(repr=False)
    status: Literal["source", "claim"]
    learned_at: Count
    speaker_id: Id | None = None


class ActorProjection(Contract):
    """단일 배우 데이터만 전달한다. 고정 시스템 지시는 Character port가 소유한다."""
    actor_id: Id
    turn: PositiveInt
    beliefs: tuple[ActorFact, ...] = Field(repr=False)
    profile_refs: tuple[Id, ...]
    goal_refs: tuple[Id, ...]
    voice_refs: tuple[Id, ...]
    emotion_refs: tuple[Id, ...]
    observations: tuple[Observation, ...] = Field(repr=False)
    location: Id
    resources: Count
    nearby_ids: tuple[Id, ...]
    moves: tuple[MoveRule, ...]
    blocked_kinds: tuple[Kind, ...]
    disclosable_fact_ids: tuple[Id, ...]
    validation_error: Id | None = None


class CharacterReply(Contract):
    action: Action
    input_tokens: PositiveInt
    output_tokens: PositiveInt


class CharacterAgentPort(Protocol):
    async def act(self, projection: ActorProjection) -> CharacterReply:
        """단일 배우로 관찰·믿음·물리 제약 안에서 다음 행동 하나만 제안한다."""
        ...


class SimulationSource(ExactSource):
    id: Id


class CharacterOutcome(Contract):
    actor_id: Id
    location_before: Id
    location_after: Id
    resources_delta: int
    gained_beliefs: tuple[Id, ...]


class CausalLink(Contract):
    cause_turn: PositiveInt
    effect_turn: PositiveInt
    fact_id: Id


class SimulationReport(Contract):
    simulation_id: Id
    scenario_id: Id
    source_refs: tuple[SimulationSource, ...] = ()
    hypothetical: Literal[True] = True
    is_mock: Literal[True] = True
    turns: tuple[Action, ...] = Field(default=(), repr=False)
    outcomes: tuple[CharacterOutcome, ...] = ()
    causal_links: tuple[CausalLink, ...] = ()
    contradictions: tuple[Id, ...] = ()
    limitations: tuple[Id, ...] = ("합성 자료 기반 가설이며 정본 사실을 확정하지 않습니다.",
        "발화는 허용 근거의 원문 조합만 지원합니다. 자유로운 의역·새 사실은 폐기합니다.")
    stop_reason: StopReason
    last_successful_turn: Count
    budget_usage: SimulationUsage
    usage_unknown: StrictBool
    partial_result: StrictBool


def build_scenario(request, scenario, packet, content) -> SimulationState:
    """Content의 행 단위 knownBy에서만 초기 믿음을 만든다. 비교마다 새 상태다."""
    active = request.active_ids or tuple(c.id for c in request.characters)
    positions = {p.actor_id: p.location for p in scenario.initial_positions}
    selected = {item.evidence_ref for item in packet.context}
    characters = []
    for character in request.characters:
        if character.id not in active:
            continue
        beliefs = tuple(Belief(fact_id=e.id, source_ref=e.id) for e in packet.result.evidence if e.id in selected
            and any(r.version == e.source_revision and (character.id in r.known_by or "*" in r.known_by) for r in content.rows))
        known = {b.fact_id for b in beliefs}
        if not set((*character.profile_refs, *character.goal_refs, *character.voice_refs, *character.emotion_refs,
                    *request.constraints.source_refs)) <= known:
            raise ContentReadError("denied")
        characters.append(character.model_copy(update={"beliefs": beliefs,
            "location": positions.get(character.id, character.location)}))
    characters.sort(key=lambda c: active.index(c.id))
    return SimulationState(simulation_id=uuid4().hex, scenario_id=scenario.id, snapshot_ref=request.snapshot_ref,
                           active_ids=active, characters=tuple(characters))


def project_actor(state, request, packet) -> ActorProjection:
    """상대의 내면·전역 비밀·검색 metadata·사용자 자유문은 투영하지 않는다."""
    actor = state.characters[(state.turn_index - 1) % len(state.characters)]
    evidence = {e.id: e for e in packet.result.evidence}
    known = {b.fact_id for b in actor.beliefs}
    return ActorProjection(actor_id=actor.id, turn=state.turn_index,
        beliefs=tuple(ActorFact(id=b.fact_id, text=evidence[b.fact_id].content,
            status=b.status, learned_at=b.learned_at, speaker_id=b.speaker_id) for b in actor.beliefs),
        profile_refs=actor.profile_refs, goal_refs=actor.goal_refs, voice_refs=actor.voice_refs,
        emotion_refs=actor.emotion_refs, observations=actor.observations, location=actor.location,
        resources=actor.resources, nearby_ids=tuple(c.id for c in state.characters if c.id != actor.id and c.location == actor.location),
        moves=tuple(m for m in request.constraints.moves if m.origin == actor.location),
        blocked_kinds=request.constraints.blocked_kinds,
        disclosable_fact_ids=tuple(f for f in request.constraints.disclosable_fact_ids if f in known),
        validation_error=state.validation_error)


def validate_action(action, state, request, packet) -> str | None:
    """폐기 사유는 코드만 반환한다. 비밀·잘못된 출력은 재시도 입력에 넣지 않는다."""
    projection = project_actor(state, request, packet)
    if action.actor_id != projection.actor_id or action.turn != state.turn_index:
        return "actor_or_turn"
    if not set(action.used_fact_ids) <= {b.id for b in projection.beliefs}:
        return "unsupported_knowledge"
    if action.kind in request.constraints.blocked_kinds:
        return "blocked_action"
    if action.kind == "move":
        rule = next((m for m in projection.moves if action.target_ids == (m.destination,)), None)
        if rule is None or rule.cost > projection.resources:
            return "movement_or_resources"
    elif not set(action.target_ids) <= set(projection.nearby_ids):
        return "target_unavailable"
    if action.kind == "speak":
        if (not action.target_ids or not action.disclosed_fact_ids
                or not set(action.disclosed_fact_ids) <= set(projection.disclosable_fact_ids) & set(action.used_fact_ids)):
            return "unsupported_disclosure"
        evidence = {e.id: e for e in packet.result.evidence}
        # shortcut: 원문 조합만 검증한다. 자유 의역은 별도 누출 평가기가 검증된 뒤 확장한다.
        if action.text != " ".join(evidence[f].content for f in action.disclosed_fact_ids):
            return "unsupported_text"
    elif action.text or action.disclosed_fact_ids:
        return "unsupported_text"
    if action.kind != "wait" and any(
            a.actor_id == action.actor_id and a.kind == action.kind
            and set(a.target_ids) == set(action.target_ids) and a.text == action.text
            for a in state.action_history):
        return "repeated_action"
    return None


def reduce_world(state, action, request, packet) -> SimulationState:
    """검증 후 호출하는 임시 reducer. 같은 시나리오·턴은 한 번만 반영한다."""
    key = (state.scenario_id, action.turn)
    if key in state.applied_turns:
        return state
    error = validate_action(action, state, request, packet)
    if error:
        raise ValueError(error)
    actor = next(c for c in state.characters if c.id == action.actor_id)
    characters = []
    for character in state.characters:
        if action.kind == "move" and character.id == actor.id:
            rule = next(m for m in request.constraints.moves if m.origin == actor.location and (m.destination,) == action.target_ids)
            character = character.model_copy(update={"location": rule.destination, "resources": character.resources - rule.cost})
        elif action.kind == "speak" and character.id in action.target_ids and character.location == actor.location:
            known = {b.fact_id for b in character.beliefs}
            learned = tuple(Belief(fact_id=f, source_ref=f, learned_at=action.turn, status="claim", speaker_id=actor.id)
                for f in action.disclosed_fact_ids if f not in known)
            observation = Observation(actor_id=actor.id, turn=action.turn, text=action.text, source_refs=action.disclosed_fact_ids)
            character = character.model_copy(update={"beliefs": (*character.beliefs, *learned),
                "observations": (*character.observations, observation)})
        characters.append(character)
    return state.model_copy(update={"characters": tuple(characters), "turn_index": action.turn + 1,
        "action_history": (*state.action_history, action), "applied_turns": (*state.applied_turns, key),
        "pending": None, "retry": 0, "validation_error": None})


def analyze(initial, state, request, packet) -> SimulationReport:
    """모델 없이 전후 차이와 발화→지식 사용 인과만 요약한다."""
    refs = set(request.constraints.source_refs) if state.action_history else set()
    refs.update(f for a in state.action_history for f in (*a.used_fact_ids, *a.disclosed_fact_ids))
    outcomes, links = [], []
    for before, after in zip(initial.characters, state.characters):
        old = {b.fact_id for b in before.beliefs}
        gained = tuple(b.fact_id for b in after.beliefs if b.fact_id not in old)
        outcomes.append(CharacterOutcome(actor_id=after.id, location_before=before.location,
            location_after=after.location, resources_delta=after.resources-before.resources, gained_beliefs=gained))
        links.extend(CausalLink(cause_turn=b.learned_at, effect_turn=a.turn, fact_id=b.fact_id)
            for b in after.beliefs if b.learned_at for a in state.action_history
            if a.actor_id == after.id and a.turn > b.learned_at and b.fact_id in a.used_fact_ids)
    sources = tuple(SimulationSource(id=e.id, version=e.source_revision, span=e.source_span, source_hash=e.source_hash)
                    for e in packet.result.evidence if e.id in refs)
    return SimulationReport(simulation_id=state.simulation_id, scenario_id=state.scenario_id,
        source_refs=sources, turns=state.action_history, outcomes=tuple(outcomes), causal_links=tuple(links),
        contradictions=state.contradictions, stop_reason=state.stop_reason,
        last_successful_turn=len(state.action_history), budget_usage=state.budget_usage,
        usage_unknown=state.usage_unknown,
        partial_result=state.stop_reason not in ("turn_limit", "goal_reached", "repeated_wait", "characters_exhausted"))


async def simulation(request: SimulationInput, *, content, packet, model: CharacterAgentPort | None = None,
                     call_context=None, cancel=None) -> tuple[SimulationReport, ...]:
    """run별 Character port의 async act(ActorProjection)만 호출한다. 외부 I/O 조립은 없다."""
    request = SimulationInput.model_validate(request.model_dump())
    cancel = cancel if cancel is not None else asyncio.Event()
    total_calls = 0
    ceiling = min(2 * request.turn_limit * len(request.scenarios), 14, request.remaining_model_calls)
    reports = []
    authority_rows = content.rows if isinstance(content, MockContentReadPort) else ()
    for scenario in request.scenarios:
        empty = SimulationState(simulation_id=uuid4().hex, scenario_id=scenario.id, snapshot_ref=request.snapshot_ref,
            active_ids=request.active_ids or tuple(c.id for c in request.characters), characters=request.characters)
        initial = latest = empty
        if reports and reports[-1].stop_reason in ("timeout", "cancelled", "budget_exhausted", "provider_failed",
                "denied", "unsupported_evidence", "dependency_unavailable"):
            latest = empty.model_copy(update={"stop_reason": reports[-1].stop_reason})
            reports.append(analyze(initial, latest, request, packet))
            continue

        def fresh():
            if not isinstance(content, MockContentReadPort):
                raise ContentReadError("unsupported")
            if content.rows != authority_rows or len({r.version for r in content.rows}) != len(content.rows):
                raise ContentReadError("denied")
            try:
                checked = validate_packet(packet, request.query, content)
            except ValidationError:
                raise ContentReadError("denied") from None
            ids = {item.evidence_ref for item in checked.context}
            if request.snapshot_ref != checked.manifest_ref:
                raise ContentReadError("denied")
            if (not checked.can_conclude or not checked.context or
                    any(e.canonical_status != "verified_source" or not e.content.strip() for e in checked.result.evidence)
                    or not set((*request.constraints.source_refs, *request.constraints.disclosable_fact_ids,
                        *((request.goal.fact_id,) if request.goal else ()))) <= ids):
                raise ContentReadError("unsupported")
            return checked

        def schedule(state):
            nonlocal latest
            latest = state
            if cancel.is_set():
                return {"stop_reason": "cancelled"}
            if datetime.now(timezone.utc) >= request.query.deadline:
                return {"stop_reason": "timeout"}
            fresh()
            if request.goal and any(c.id == request.goal.actor_id and any(b.fact_id == request.goal.fact_id for b in c.beliefs) for c in state.characters):
                return {"stop_reason": "goal_reached"}
            if len(state.action_history) >= 2 and all(a.kind == "wait" for a in state.action_history[-2:]):
                return {"stop_reason": "repeated_wait"}
            if all(c.resources == 0 for c in state.characters):
                return {"stop_reason": "characters_exhausted"}
            if state.turn_index > request.turn_limit:
                return {"stop_reason": "turn_limit"}
            if total_calls >= ceiling:
                return {"stop_reason": "budget_exhausted"}
            return {}

        projection = None

        def project(state):
            nonlocal projection
            fresh()
            projection = project_actor(state, request, packet)
            return {}

        async def act(state):
            nonlocal latest, total_calls
            from app.runs.orchestrator import Budget
            from app.runs.runner import BudgetExceeded, ModelReply
            latest = state
            if cancel.is_set():
                return {"stop_reason": "cancelled"}
            if total_calls >= ceiling:
                return {"stop_reason": "budget_exhausted"}
            remaining = min(request.call_timeout_ms/1000,
                (request.query.deadline-datetime.now(timezone.utc)).total_seconds())
            if call_context is not None:
                remaining = min(remaining, call_context.runner.deadline-asyncio.get_running_loop().time())
            if remaining <= 0:
                return {"stop_reason": "timeout"}
            if model is None:
                return {"stop_reason": "dependency_unavailable"}
            reservation = Budget(model_calls=1, input_tokens=request.input_token_cap, output_tokens=request.output_token_cap)
            reply = None
            async def invoke(reserved):
                nonlocal reply, latest, total_calls
                total_calls += 1
                usage = state.budget_usage
                latest = state.model_copy(update={"budget_usage": SimulationUsage(model_calls=usage.model_calls+1,
                    input_tokens=usage.input_tokens+reserved.input_tokens, output_tokens=usage.output_tokens+reserved.output_tokens),
                    "usage_unknown": True})
                raw = await model.act(projection)
                reply = CharacterReply.model_validate(raw.model_dump() if isinstance(raw, CharacterReply) else raw)
                return ModelReply(output_ref="simulation:action", usage=Budget(model_calls=1,
                    input_tokens=reply.input_tokens, output_tokens=reply.output_tokens))

            async def call():
                if call_context is not None:
                    await call_context.call_model(reservation, invoke)
                else:
                    await invoke(reservation)

            future = asyncio.create_task(call())
            cancelled = asyncio.create_task(cancel.wait())
            try:
                done, _ = await asyncio.wait((future, cancelled), timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
                if cancelled in done or cancel.is_set():
                    return {**latest.model_dump(), "stop_reason": "cancelled"}
                if future not in done:
                    return {**latest.model_dump(), "stop_reason": "timeout"}
                await future
                fresh()
                usage = latest.budget_usage
                updates = {"budget_usage": SimulationUsage(model_calls=usage.model_calls,
                    input_tokens=usage.input_tokens-request.input_token_cap+reply.input_tokens,
                    output_tokens=usage.output_tokens-request.output_token_cap+reply.output_tokens),
                    "usage_unknown": state.usage_unknown, "pending": reply.action, "validation_error": None}
                if reply.input_tokens > request.input_token_cap or reply.output_tokens > request.output_token_cap:
                    updates.update(stop_reason="budget_exhausted", pending=None)
                return updates
            except asyncio.CancelledError:
                return {**latest.model_dump(), "stop_reason": "cancelled"}
            except ValidationError:
                return {**latest.model_dump(), "pending": None, "validation_error": "invalid_action_schema"}
            except BudgetExceeded:
                return {**latest.model_dump(), "stop_reason": "budget_exhausted"}
            except ContentReadError:
                raise
            except TimeoutError:
                return {**latest.model_dump(), "stop_reason": "timeout"}
            except Exception:
                return {**latest.model_dump(), "stop_reason": "provider_failed"}
            finally:
                for task in (future, cancelled):
                    if not task.done():
                        task.cancel()
                    task.add_done_callback(lambda t: None if t.cancelled() else t.exception())

        def validate(state):
            error = validate_action(state.pending, state, request, packet) if state.pending is not None else state.validation_error
            if error is None:
                return {}
            return {"pending": None, "retry": state.retry+1, "validation_error": error,
                "contradictions": (*state.contradictions, error),
                "stop_reason": "validation_failed" if state.retry else None}

        def reduce(state):
            fresh()
            return reduce_world(state, state.pending, request, packet).model_dump()

        try:
            checked = fresh()
            initial = latest = build_scenario(request, scenario, checked, content)
            graph = StateGraph(SimulationState)
            for name, node in (("schedule", schedule), ("project", project), ("act", act), ("validate", validate), ("reduce", reduce)):
                graph.add_node(name, node)
            graph.add_edge(START, "schedule")
            graph.add_conditional_edges("schedule", lambda s: END if s.stop_reason else "project")
            graph.add_edge("project", "act")
            graph.add_conditional_edges("act", lambda s: END if s.stop_reason else "validate")
            graph.add_conditional_edges("validate", lambda s: END if s.stop_reason else "project" if s.pending is None else "reduce")
            graph.add_edge("reduce", "schedule")
            # 본문이 있는 이 subgraph에는 부모 checkpointer도 상속하지 않는다.
            result = await graph.compile(checkpointer=False).ainvoke(initial, {"recursion_limit": 200})
            latest = SimulationState.model_validate(result)
            if latest.stop_reason not in ("denied", "unsupported_evidence"):
                fresh()
        except ContentReadError as error:
            latest = empty.model_copy(update={"stop_reason": "denied" if error.status == "denied" else "unsupported_evidence",
                "budget_usage": latest.budget_usage, "usage_unknown": latest.usage_unknown})
            initial = empty
        except asyncio.CancelledError:
            latest = latest.model_copy(update={"stop_reason": "cancelled", "usage_unknown": True})
        reports.append(analyze(initial, latest, request, packet))
    if any(r.stop_reason == "denied" for r in reports):
        reports = [r.model_copy(update={"stop_reason": "denied", "partial_result": True, "turns": (),
            "source_refs": (), "outcomes": (), "causal_links": (), "contradictions": (), "last_successful_turn": 0}) for r in reports]
    return tuple(reports)


class SimulationHandler:
    """TaskRunner에 run별 주입하며 보고 본문 대신 참조·실제 상태만 반환한다."""
    def __init__(self, request: SimulationInput, *, content, packet, model=None):
        self.request = SimulationInput.model_validate(request.model_dump())
        self.content, self.packet, self.model = content, packet, model
        self.reports: tuple[SimulationReport, ...] = ()

    async def __call__(self, slice, ctx):
        from app.runs.orchestrator import PlanError
        from app.runs.runner import TaskOutput
        ctx.checkpoint()
        if (slice.operation != "simulation" or slice.output_schema != "SimulationReport.v1"
                or self.request.query.scope != ctx.runner.scope):
            raise PlanError("simulation_scope_mismatch")
        self.reports = await simulation(self.request, content=self.content, packet=self.packet, model=self.model,
            call_context=ctx, cancel=ctx.runner.cancelled)
        ctx.checkpoint()
        if any(r.stop_reason == "denied" for r in self.reports):
            raise ContentReadError("denied")
        return TaskOutput(output_schema="SimulationReport.v1", output_ref=f"simulation:{slice.run_id}:{slice.task_id}",
            status="partial" if any(r.partial_result for r in self.reports) else "succeeded", is_mock=True)
