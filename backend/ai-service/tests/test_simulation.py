"""합성 시뮬레이션의 순차 실행·지식 격리·중단과 예산 계약."""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from test_mock_retrievers import content, story, query, candidate
from app.agents.simulation import (
    Action, CharacterReply, CharacterState, Constraints, Goal, MoveRule, Scenario,
    SimulationHandler, SimulationInput, build_scenario,
    reduce_world, simulation, validate_action,
)
from app.retrieval.coordinator import ContextItem, ContextPacket
from app.retrieval.contracts import RetrievalResult
from app.retrieval.content_client import CanonicalAdapter
from app.runs.orchestrator import Budget, REGISTRY


@pytest.fixture
def packet(content):
    # 정보 분류는 Evidence가 주장한 known_by가 아니라 Content 행을 따른다.
    content.rows = tuple(replace(r, text="암호는 달빛이다.") if r.version.document_id == "m2" else r for r in content.rows)
    evidence = tuple(candidate(content, doc, id=doc) for doc in ("m1", "m2", "m3"))
    return ContextPacket(scope_ref=content.scope.digest(), manifest_ref=content.scope.manifest_ref,
        basis_episode=3, viewpoint="owner", can_conclude=True,
        result=RetrievalResult(status="ok", is_mock=True, evidence=evidence),
        context=tuple(ContextItem(evidence_ref=e.id, source_revision=e.source_revision,
            source_hash=e.source_hash, canonical_status=e.canonical_status, retrieval_type=e.retrieval_type,
            content=e.content) for e in evidence))


def request(content, **changes):
    data = dict(query=query(content, operation="context"), snapshot_ref=content.scope.manifest_ref,
        characters=(CharacterState(id="kai", location="hall", resources=2),
                    CharacterState(id="lina", location="hall", resources=2)),
        scenarios=(Scenario(id="base"),),
        constraints=Constraints(locations=("hall", "garden"),
            moves=(MoveRule(origin="hall", destination="garden", cost=1),),
            source_refs=("m1",), disclosable_fact_ids=("m1", "m3")))
    return SimulationInput(**(data | changes))


def action(actor="kai", turn=1, kind="speak", **changes):
    return Action(**(dict(actor_id=actor, turn=turn, kind=kind,
        target_ids=("lina" if actor == "kai" else "kai",) if kind == "speak" else (),
        text="카이는 문을 닫았다." if kind == "speak" else "",
        used_fact_ids=("m1",) if kind == "speak" else (),
        disclosed_fact_ids=("m1",) if kind == "speak" else ()) | changes))


class Actor:
    def __init__(self, actions):
        self.act = AsyncMock(side_effect=[CharacterReply(action=a, input_tokens=2, output_tokens=3) for a in actions])


def run(content, packet, model, **changes):
    return asyncio.run(simulation(request(content, **changes), content=content, packet=packet, model=model))


def three_actions():
    return (action(), action("lina", 2, "observe"), action("kai", 3, "move", target_ids=("garden",)))


def test_registry_and_three_sequential_mock_turns_leave_canonical_unchanged(content, packet):
    assert REGISTRY["simulation"].handler is simulation
    before = (content.rows, content.pinned, content.active, packet.model_dump_json())
    model = Actor(three_actions())
    report, = run(content, packet, model)
    assert report.hypothetical and report.is_mock and not report.partial_result
    assert report.stop_reason == "turn_limit" and report.last_successful_turn == 3
    assert report.turns == three_actions() and report.budget_usage.model_calls == 3
    assert report.source_refs and all(s.source_hash and s.span for s in report.source_refs)
    assert report.outcomes[0].location_after == "garden" and report.outcomes[0].resources_delta == -1
    assert (content.rows, content.pinned, content.active, packet.model_dump_json()) == before
    payloads = [call.args[0] for call in model.act.call_args_list]
    assert [p.actor_id for p in payloads] == ["kai", "lina", "kai"]
    assert any(o.turn == 1 for o in payloads[1].observations)
    kai = payloads[0].model_dump_json() + payloads[2].model_dump_json()
    assert all(s not in kai for s in ("달빛", '"m2"', "synthetic-grant", "query_text", "fact_or_relation"))
    assert "달빛" not in report.model_dump_json()


@pytest.mark.parametrize("bad", [
    dict(used_fact_ids=("m2",)), dict(disclosed_fact_ids=("m2",), used_fact_ids=("m2",), text="암호는 달빛이다."),
    dict(text="암호는 달빛이다."), dict(text="근거 없는 새 사실"), dict(actor_id="lina"),
    dict(turn=9), dict(target_ids=("stranger",)),
])
def test_invalid_action_retries_once_without_exposing_rejected_text(content, packet, bad):
    model = Actor((action(**bad), *three_actions()))
    report, = run(content, packet, model)
    assert report.stop_reason == "turn_limit" and report.budget_usage.model_calls == 4
    assert report.turns == three_actions()
    assert model.act.call_args_list[1].args[0].validation_error
    assert "달빛" not in model.act.call_args_list[1].args[0].model_dump_json()
    assert "근거 없는" not in report.model_dump_json()


def test_two_invalid_attempts_produce_safe_partial_stop(content, packet):
    model = Actor((action(text="누설"), action(text="누설")))
    report, = run(content, packet, model)
    assert report.stop_reason == "validation_failed" and report.partial_result
    assert not report.turns and report.last_successful_turn == 0
    assert report.budget_usage.model_calls == 2 and "누설" not in report.model_dump_json()


@pytest.mark.parametrize("updates", [dict(extra="bad"), dict(turn=True), dict(text="x"*801),
    dict(target_ids=("lina", "lina")), dict(kind="attack")])
def test_action_schema_is_closed(updates):
    with pytest.raises(ValidationError):
        action(**updates)


def test_comparison_resets_world_and_uses_shared_twelve_attempt_ceiling(content, packet):
    actions = (*three_actions(), *three_actions())
    model = Actor(actions)
    reports = run(content, packet, model, scenarios=(Scenario(id="a"), Scenario(id="b")))
    assert len(reports) == 2 and sum(r.budget_usage.model_calls for r in reports) == 6
    assert all(r.outcomes[0].location_before == "hall" for r in reports)
    assert all(r.outcomes[0].location_after == "garden" for r in reports)
    assert not model.act.call_args_list[3].args[0].observations


@pytest.mark.parametrize("calls", [0, 1, 2])
def test_remaining_run_budget_stops_before_next_call(content, packet, calls):
    model = Actor(three_actions())
    report, = run(content, packet, model, remaining_model_calls=calls)
    assert report.stop_reason == "budget_exhausted" and report.partial_result
    assert model.act.await_count == calls and report.budget_usage.model_calls == calls


@pytest.mark.parametrize("mode", ["timeout", "cancelled", "provider_failed"])
def test_failed_call_keeps_reservation_and_previous_turn(content, packet, mode):
    model = Actor((action(),))
    async def invoke(payload):
        if payload.turn == 1:
            return CharacterReply(action=action(), input_tokens=2, output_tokens=3)
        if mode == "timeout":
            await asyncio.sleep(1)
        if mode == "cancelled":
            raise asyncio.CancelledError()
        raise OSError("private provider detail")
    model.act.side_effect = invoke
    report, = run(content, packet, model, call_timeout_ms=10)
    assert report.stop_reason == mode and report.partial_result
    assert report.last_successful_turn == 1 and report.budget_usage.model_calls == 2
    assert report.usage_unknown and "private provider" not in report.model_dump_json()


def test_cancellation_wakes_blocked_actor(content, packet):
    async def scenario():
        cancel, started = asyncio.Event(), asyncio.Event()
        model = Actor(())
        async def block(payload):
            started.set()
            await asyncio.Event().wait()
        model.act.side_effect = block
        future = asyncio.create_task(simulation(request(content), content=content, packet=packet, model=model, cancel=cancel))
        await started.wait()
        cancel.set()
        reports = await asyncio.wait_for(future, .5)
        assert reports[0].stop_reason == "cancelled" and reports[0].usage_unknown
    asyncio.run(scenario())


def test_expired_deadline_and_pre_cancel_do_not_call_model(content, packet):
    model = Actor(())
    req = request(content, query=query(content, deadline=datetime.now(timezone.utc)-timedelta(seconds=1)))
    report, = asyncio.run(simulation(req, content=content, packet=packet, model=model))
    assert report.stop_reason == "timeout" and report.budget_usage.model_calls == 0
    model.act.assert_not_called()


def test_repeated_wait_and_goal_stop_are_explicit(content, packet):
    report, = run(content, packet, Actor((action(kind="wait"), action("lina", 2, "wait"))))
    assert report.stop_reason == "repeated_wait" and report.last_successful_turn == 2
    # 리나가 m1을 실제 들은 경우에만 목표 달성.
    content.rows = tuple(replace(r, known_by=("kai",)) if r.version.document_id == "m1" else r for r in content.rows)
    constraints = request(content).constraints.model_copy(update={"source_refs": ("m3",)})
    report, = run(content, packet, Actor((action(),)), goal=Goal(actor_id="lina", fact_id="m1"), constraints=constraints)
    assert report.stop_reason == "goal_reached" and not report.partial_result
    assert report.outcomes[1].gained_beliefs == ("m1",)


def test_world_reducer_is_idempotent_and_only_actual_hearers_learn(content, packet):
    req = request(content)
    state = build_scenario(req, req.scenarios[0], packet, content)
    once = reduce_world(state, action(), req, packet)
    twice = reduce_world(once, action(), req, packet)
    assert once == twice and len(once.characters[1].observations) == 1
    moved = state.characters[1].model_copy(update={"location": "garden"})
    state = state.model_copy(update={"characters": (state.characters[0], moved)})
    assert validate_action(action(), state, req, packet) == "target_unavailable"
    with pytest.raises(ValueError, match="target_unavailable"):
        reduce_world(state, action(), req, packet)


@pytest.mark.parametrize("change", ["unknown", "stale", "hash", "future", "fork", "known_by"])
def test_snapshot_validation_rejects_forbidden_or_unsupported_evidence(content, packet, change):
    items = list(packet.result.evidence)
    e = items[0]
    if change == "unknown":
        items[0] = e.model_copy(update={"canonical_status": "inferred"})
    elif change == "stale":
        items[0] = e.model_copy(update={"source_revision": replace(e.source_revision, revision="old")})
    elif change == "hash":
        items[0] = e.model_copy(update={"source_hash": "0"*64})
    elif change in ("future", "fork"):
        items.append(candidate(content, "future" if change == "future" else "f3"))
    else:
        # 변조한 Evidence 메타데이터로 리나의 비밀을 카이에게 승격할 수 없다.
        items[1] = items[1].model_copy(update={"known_by": ("kai", "lina")})
    changed = packet.model_copy(update={"result": packet.result.model_copy(update={"evidence": tuple(items)})})
    model = Actor(three_actions())
    report, = run(content, changed, model)
    if change == "known_by":
        assert report.stop_reason == "turn_limit"
        assert "달빛" not in model.act.call_args_list[0].args[0].model_dump_json()
    else:
        assert report.partial_result and report.stop_reason in ("denied", "unsupported_evidence")
        model.act.assert_not_called()


def test_runner_adapter_reserves_each_call_and_returns_only_reference(content, packet):
    from test_task_graph import task
    from app.runs.runner import TaskOutput, TaskRunner
    root = task(content.scope, "context", "context")
    sim = task(content.scope, "sim", "simulation", (root,),
        budget=Budget(model_calls=6, input_tokens=600, output_tokens=600))
    model = Actor(three_actions())
    handler = SimulationHandler(request(content, input_token_cap=100, output_token_cap=100),
        content=content, packet=packet, model=model)
    async def context_handler(slice, ctx):
        return TaskOutput(output_schema="ContextPacket.v1", output_ref="context:fixture", is_mock=True)
    runner = TaskRunner("run1", (root, sim), scope=content.scope,
        manifest=CanonicalAdapter(content).manifest(content.scope), allowed_operations=("context", "simulation"),
        handlers={"context": context_handler, "simulation": handler})
    result = asyncio.run(runner.run())
    assert result.status == "succeeded" and result.accounted.model_calls == 3
    assert result.accounted.input_tokens == 6 and result.accounted.output_tokens == 9
    assert result.results[-1].output_ref == "simulation:run1:sim"
    assert handler.reports[0].last_successful_turn == 3
    assert "문을 닫았다" not in result.model_dump_json()


@pytest.mark.parametrize("scenarios,expected", [(1, 6), (2, 12)])
def test_invalid_valid_pairs_fit_default_and_comparison_caps(content, packet, scenarios, expected):
    pairs = tuple(a for valid in three_actions() for a in (valid.model_copy(update={"text": "미확인"}), valid))
    model = Actor(pairs * scenarios)
    reports = run(content, packet, model, scenarios=tuple(Scenario(id=str(i)) for i in range(scenarios)))
    assert all(r.last_successful_turn == 3 for r in reports)
    assert model.act.await_count == sum(r.budget_usage.model_calls for r in reports) == expected


def test_absolute_fourteen_attempt_ceiling(content, packet):
    from hashlib import sha256
    # 같은 원문의 검증된 개별 span으로 반복이 아닌 발화 14개를 준비한다.
    text = "ABCDEFGHIJKLMN"
    content.rows = tuple(replace(r, text=text) if r.version.document_id == "m3" else r for r in content.rows)
    base = candidate(content, "m3")
    evidence = tuple(base.model_copy(update={"id": f"f{i}", "content": ch, "source_span": (i, i+1),
        "source_hash": sha256(ch.encode()).hexdigest()}) for i, ch in enumerate(text))
    packet = packet.model_copy(update={"result": packet.result.model_copy(update={"evidence": (packet.result.evidence[0], *evidence)}),
        "context": tuple(ContextItem(evidence_ref=e.id, source_revision=e.source_revision,
            source_hash=e.source_hash, canonical_status=e.canonical_status, retrieval_type=e.retrieval_type,
            content=e.content) for e in (packet.result.evidence[0], *evidence))})
    constraints = request(content).constraints.model_copy(update={"disclosable_fact_ids": tuple(e.id for e in evidence)})
    model = Actor(())
    async def next_action(p):
        if model.act.await_count == 1:
            a = action(text="미확인")
        else:
            ref = f"f{p.turn-1}"
            a = action(p.actor_id, p.turn, text=text[p.turn-1], used_fact_ids=(ref,), disclosed_fact_ids=(ref,))
        return CharacterReply(action=a, input_tokens=2, output_tokens=3)
    model.act.side_effect = next_action
    report, = run(content, packet, model, turn_limit=14, constraints=constraints)
    assert report.stop_reason == "budget_exhausted" and report.last_successful_turn == 13
    assert report.budget_usage.model_calls == model.act.await_count == 14


@pytest.mark.parametrize("change,error", [
    (dict(kind="move", target_ids=("unknown",), text="", used_fact_ids=(), disclosed_fact_ids=()), "movement_or_resources"),
    (dict(kind="move", target_ids=("garden",), text="", used_fact_ids=(), disclosed_fact_ids=()), "movement_or_resources"),
    (dict(kind="observe", text="", disclosed_fact_ids=()), "blocked_action"),
])
def test_physical_constraints_and_rules_reject_actions(content, packet, change, error):
    req = request(content)
    req = req.model_copy(update={"characters": tuple(c.model_copy(update={"resources": 0}) for c in req.characters),
        "constraints": req.constraints.model_copy(update={"blocked_kinds": ("observe",)})})
    state = build_scenario(req, req.scenarios[0], packet, content)
    assert validate_action(action(**change), state, req, packet) == error


def test_repeated_action_is_invalid_and_all_exhausted_stops_without_model(content, packet):
    model = Actor((action(), action("lina", 2, "observe"), action(turn=3), action(turn=3)))
    report, = run(content, packet, model)
    assert report.stop_reason == "validation_failed" and report.contradictions[-1] == "repeated_action"
    model = Actor(())
    chars = tuple(c.model_copy(update={"resources": 0}) for c in request(content).characters)
    report, = run(content, packet, model, characters=chars)
    assert report.stop_reason == "characters_exhausted" and model.act.await_count == 0


def test_heard_claim_is_not_promoted_to_world_fact_and_causality_is_recorded(content, packet):
    content.rows = tuple(replace(r, known_by=("kai",)) if r.version.document_id == "m3" else r for r in content.rows)
    text = next(e.content for e in packet.result.evidence if e.id == "m3")
    model = Actor((action(text=text, used_fact_ids=("m3",), disclosed_fact_ids=("m3",)),
        action("lina", 2, text=text, used_fact_ids=("m3",), disclosed_fact_ids=("m3",)), action(turn=3, kind="wait")))
    report, = run(content, packet, model)
    learned = next(b for b in model.act.call_args_list[1].args[0].beliefs if b.id == "m3")
    assert (learned.status, learned.speaker_id, learned.learned_at) == ("claim", "kai", 1)
    assert any((l.cause_turn, l.effect_turn, l.fact_id) == (1, 2, "m3") for l in report.causal_links)


@pytest.mark.parametrize("change", ["revoke", "knowledge", "revision"])
def test_change_during_model_wait_discards_all_body_and_citations(content, packet, change):
    model = Actor(())
    async def mutate(payload):
        if change == "revoke":
            content.active = False
        else:
            content.rows = tuple(replace(r, known_by=("lina",)) if change == "knowledge" else
                replace(r, version=replace(r.version, revision="new")) for r in content.rows)
        return CharacterReply(action=action(), input_tokens=2, output_tokens=3)
    model.act.side_effect = mutate
    report, = run(content, packet, model)
    assert report.stop_reason == "denied" and not report.turns and not report.source_refs
    assert report.budget_usage.model_calls == 1


def test_late_result_after_timeout_never_updates_report(content, packet):
    async def scenario():
        model = Actor(())
        async def late(payload):
            try:
                await asyncio.sleep(1)
            except asyncio.CancelledError:
                return CharacterReply(action=action(text="늦은 응답"), input_tokens=2, output_tokens=3)
        model.act.side_effect = late
        reports = await simulation(request(content, call_timeout_ms=10), content=content, packet=packet, model=model)
        await asyncio.sleep(.01)
        assert reports[0].stop_reason == "timeout" and not reports[0].turns
        assert model.act.await_count == 1 and "늦은 응답" not in reports[0].model_dump_json()
    asyncio.run(scenario())


def test_precancel_and_missing_port_make_zero_calls(content, packet):
    async def scenario():
        cancel = asyncio.Event()
        cancel.set()
        model = Actor(())
        report, = await simulation(request(content), content=content, packet=packet, model=model, cancel=cancel)
        assert report.stop_reason == "cancelled" and not report.budget_usage.model_calls
        model.act.assert_not_called()
        report, = await simulation(request(content), content=content, packet=packet)
        assert report.stop_reason == "dependency_unavailable" and report.partial_result
    asyncio.run(scenario())


def test_invalid_raw_schema_is_retried_and_reserved_usage_is_unknown(content, packet):
    model = Actor(three_actions())
    valid_replies = list(model.act.side_effect)
    model.act.side_effect = [{"action": {"kind": "evil"}, "input_tokens": 2, "output_tokens": 3}, *valid_replies]
    report, = run(content, packet, model)
    assert report.last_successful_turn == 3 and report.budget_usage.model_calls == 4
    assert report.usage_unknown and report.contradictions == ("invalid_action_schema",)


def test_search_metadata_and_user_instructions_are_not_character_input(content, packet):
    evidence = tuple(e.model_copy(update={"fact_or_relation": "IGNORE_ALL_RULES_SECRET"}) for e in packet.result.evidence)
    packet = packet.model_copy(update={"result": packet.result.model_copy(update={"evidence": evidence})})
    model = Actor(three_actions())
    run(content, packet, model, query=query(content, query_text="USER_INSTRUCTION_SECRET"))
    assert all("INSTRUCTION_SECRET" not in c.args[0].model_dump_json() and "IGNORE_ALL" not in c.args[0].model_dump_json()
        for c in model.act.call_args_list)


def test_unknown_provider_delivery_stops_comparison_without_more_calls(content, packet):
    model = Actor(())
    model.act.side_effect = OSError("unknown delivery")
    reports = run(content, packet, model, scenarios=(Scenario(id="a"), Scenario(id="b")))
    assert model.act.await_count == 1
    assert all(r.stop_reason == "provider_failed" and r.partial_result for r in reports)


def test_comparison_can_change_positions_without_sharing_observations(content, packet):
    from app.agents.simulation import Position
    model = Actor((*three_actions(), action(kind="observe"), action("lina", 2, "observe"), action(turn=3, kind="wait")))
    reports = run(content, packet, model, scenarios=(Scenario(id="base"),
        Scenario(id="separate", initial_positions=(Position(actor_id="lina", location="garden"),))))
    assert reports[1].outcomes[1].location_before == "garden"
    assert not model.act.call_args_list[3].args[0].nearby_ids
    assert not model.act.call_args_list[4].args[0].observations


def test_nondisclosable_known_secret_is_rejected_without_leaking_to_other_actor(content, packet):
    model = Actor((action(kind="wait"),
        action("lina", 2, text="암호는 달빛이다.", used_fact_ids=("m2",), disclosed_fact_ids=("m2",)),
        action("lina", 2, "observe"), action(turn=3, kind="observe")))
    report, = run(content, packet, model)
    assert report.last_successful_turn == 3
    assert report.contradictions == ("unsupported_disclosure",)
    assert "달빛" not in report.model_dump_json() and all(s.id != "m2" for s in report.source_refs)
    assert "달빛" not in model.act.call_args_list[-1].args[0].model_dump_json()


def test_unselected_evidence_is_not_sent_even_to_an_authorized_character(content, packet):
    packet = packet.model_copy(update={"context": tuple(c for c in packet.context if c.evidence_ref != "m2")})
    model = Actor(three_actions())
    run(content, packet, model)
    assert all("달빛" not in c.args[0].model_dump_json() for c in model.act.call_args_list)


def test_adding_an_unused_reference_does_not_bypass_repetition_check(content, packet):
    model = Actor((action(), action("lina", 2, "observe"),
        action(turn=3, used_fact_ids=("m1", "m3")), action(turn=3, used_fact_ids=("m1", "m3"))))
    report, = run(content, packet, model)
    assert report.stop_reason == "validation_failed" and report.contradictions[-1] == "repeated_action"


def test_revocation_in_second_scenario_removes_first_scenario_citations_too(content, packet):
    model = Actor(())
    async def invoke(payload):
        if model.act.await_count == 4:
            content.active = False
        return CharacterReply(action=three_actions()[(payload.turn-1) % 3], input_tokens=2, output_tokens=3)
    model.act.side_effect = invoke
    reports = run(content, packet, model, scenarios=(Scenario(id="a"), Scenario(id="b")))
    assert all(r.stop_reason == "denied" and not r.turns and not r.source_refs for r in reports)
    assert sum(r.budget_usage.model_calls for r in reports) == 4


def test_malformed_packet_returns_safe_denial_without_model(content, packet):
    malformed = packet.result.evidence[0].model_copy(update={"source_span": (5, 1)})
    packet = packet.model_copy(update={"result": packet.result.model_copy(update={"evidence": (malformed,)})})
    model = Actor(())
    report, = run(content, packet, model)
    assert report.stop_reason == "denied" and report.partial_result and not report.source_refs
    model.act.assert_not_called()
