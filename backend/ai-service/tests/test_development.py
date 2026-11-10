"""전개 계획의 개수·근거·가상 표시·무저장 단위 계약."""
import asyncio
from unittest.mock import AsyncMock
import pytest
from test_mock_retrievers import content, story, query, wiki, manuscripts
from test_retrieval_coordinator import coordinator
from app.agents.development import DevelopmentRequest, DevelopmentReply, Insight, Beat, development

def idea(n=0, **updates):
    return Insight(**(dict(idea=f"대안 {n}", character_reaction="망설인다", scene="문 앞", impact="갈등", risk="성급한 해결",
        unresolved_hook="암호의 출처", refs=("e3",)) | updates))

def run(content, wiki, manuscripts, reply, **changes):
    model = AsyncMock(develop=AsyncMock(return_value=reply))
    req = DevelopmentRequest(**(dict(query=query(content), mode="next_insights", count=3, hook_refs=("e3",)) | changes))
    result = asyncio.run(development(req, content=content, coordinator=coordinator(content, wiki, manuscripts), model=model))
    return result, model

def reply(items=None, beats=()):
    return DevelopmentReply(insights=tuple(idea(n) for n in range(3)) if items is None else items,
        beats=beats, input_tokens=10, output_tokens=5)

def test_g_three_distinct_ideas_have_risks_hooks_refs_and_no_writes(content, wiki, manuscripts):
    before = content.rows
    result, model = run(content, wiki, manuscripts, reply())
    assert result.status == "ok" and len(result.insights) == 3 and result.hypothetical and result.is_mock
    assert all(i.risk and i.unresolved_hook and i.refs for i in result.insights)
    assert content.rows == before and result.coverage.verified_count == 3
    assert "synthetic-grant" not in model.develop.call_args.args[0].model_dump_json()

@pytest.mark.parametrize("mode", ["next_episode_planning", "expand_conti"])
def test_beats_are_plans_only(content, wiki, manuscripts, mode):
    beats = tuple(Beat(goal=f"목표{n}", action="문을 확인", dialogue="질문한다", cause="직전 사건", refs=("e3",)) for n in range(3))
    result, _ = run(content, wiki, manuscripts, reply(items=(), beats=beats), mode=mode,
        conti_refs=("e3",) if mode == "expand_conti" else ())
    assert result.status == "ok" and len(result.beats) == 3 and not result.insights

@pytest.mark.parametrize("bad", ["count", "duplicate", "refs", "extra"])
def test_invalid_model_results_are_blocked(content, wiki, manuscripts, bad):
    r = reply()
    if bad == "count": r = reply(items=(idea(),))
    if bad == "duplicate": r = reply(items=(idea(),)*3)
    if bad == "refs": r = reply(items=(idea(refs=("foreign",)), idea(1), idea(2)))
    if bad == "extra": r = r.model_dump() | {"patch": "write"}
    result, _ = run(content, wiki, manuscripts, r)
    assert result.status == "blocked" and not result.insights

def test_missing_coverage_is_partial_without_generation(content, wiki, manuscripts):
    result, model = run(content, wiki[:1], manuscripts, reply())
    assert result.status == "partial" and not result.insights
    model.develop.assert_not_called()

def test_requested_count_and_alternative_plot(content, wiki, manuscripts):
    result, _ = run(content, wiki, manuscripts, reply(items=(idea(),)), count=1, mode="alternative_plot")
    assert result.status == "ok" and len(result.insights) == 1

def test_required_hook_missing_is_blocked(content, wiki, manuscripts):
    result, model = run(content, wiki, manuscripts, reply(), hook_refs=("unknown",))
    assert result.status == "blocked"
    model.develop.assert_not_called()

@pytest.mark.parametrize("simulate", [False, True, "missing_consent", "zero_budget"])
def test_runner_optional_simulation_usage_refs_and_zero_writing(content, wiki, manuscripts, simulate):
    from test_task_graph import task
    from test_semantic_review import simulation_request, actor_model
    from app.agents.development import DevelopmentHandler, development_tasks
    from app.agents.simulation import SimulationHandler
    from app.retrieval.content_client import CanonicalAdapter
    from app.runs.runner import TaskRunner, TaskOutput
    blocked = simulate in ("missing_consent", "zero_budget")
    sim_request = simulation_request(content) if simulate is True or simulate == "zero_budget" else None
    if simulate == "zero_budget":
        sim_request = sim_request.model_copy(update={"remaining_model_calls": 0})
    req = DevelopmentRequest(query=query(content), mode="next_insights", count=3, hook_refs=("e3",),
        reaction_required=bool(simulate), simulation_input=sim_request)
    port = coordinator(content, wiki, manuscripts)
    packet = asyncio.run(port.retrieve(req.query.model_copy(update={"operation": "full_context"})))
    actor = actor_model()
    sim = SimulationHandler(req.simulation_input, content=content, packet=packet, model=actor) if simulate is True else None
    model = AsyncMock(develop=AsyncMock(return_value=reply()))
    handler = DevelopmentHandler(req, content=content, coordinator=port, model=model, simulation_handler=sim)
    root = task(content.scope, "context", "context")
    async def context_handler(slice, ctx):
        return TaskOutput(output_schema="ContextPacket.v1", output_ref="context:fixture", is_mock=True)
    handlers = {"context": context_handler, "development": handler}
    if simulate is True: handlers["simulation"] = sim
    runner = TaskRunner("run1", (root, *development_tasks(req, context_task=root)), scope=content.scope,
        manifest=CanonicalAdapter(content).manifest(content.scope), allowed_operations=("context", "simulation", "development"),
        handlers=handlers)
    result = asyncio.run(runner.run())
    if blocked:
        assert handler.plan is not None and handler.plan.status == "blocked"
        assert result.status == "partial" and result.accounted.model_calls == 0
        assert all(t.error_code is None for t in result.results)
        model.develop.assert_not_called()
        actor.act.assert_not_called()
        return
    assert result.status == "succeeded" and handler.plan.status == "ok"
    assert result.accounted.model_calls == (3 if simulate else 1)
    assert all(t.operation not in ("editing", "writing") for t in runner.tasks)
    assert "대안" not in result.model_dump_json()
    assert bool(model.develop.call_args.args[0].simulations) == simulate

@pytest.mark.parametrize("failure", ["revoke", "provider", "timeout"])
def test_failure_is_not_success(content, wiki, manuscripts, failure):
    model = AsyncMock()
    async def invoke(payload):
        if failure == "revoke": content.active = False
        if failure == "provider": raise RuntimeError("private detail")
        if failure == "timeout": raise TimeoutError()
        return reply()
    model.develop.side_effect = invoke
    req = DevelopmentRequest(query=query(content), mode="next_insights", count=3)
    result = asyncio.run(development(req, content=content, coordinator=coordinator(content, wiki, manuscripts), model=model))
    assert result.status == {"revoke": "denied", "provider": "blocked", "timeout": "timeout"}[failure]
    assert not result.insights and "private detail" not in result.model_dump_json()
