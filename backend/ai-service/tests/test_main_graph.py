"""TASK 08이 명시 요청한 메모리 StateGraph 조립 통합. 모델·HTTP·DB 없음."""
import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from test_mock_retrievers import story, content, manuscripts, wiki, query
from app.retrieval.coordinator import RetrievalCoordinator
from app.retrieval.content_client import ContentReadError
from app.retrieval.episode_wiki import EpisodeWikiRetriever
from app.retrieval.manuscript import ManuscriptVectorRetriever
from app.runs.orchestrator import PlanError
from app.runs.runner import TaskOutput
from app.runs.graph import MainGraph
from app.runs.state import MainRequest


pytestmark = pytest.mark.integration


def graph(content, wiki, manuscripts, **kwargs):
    coordinator = RetrievalCoordinator(content, {"wiki": EpisodeWikiRetriever(content, wiki),
        "manuscript": ManuscriptVectorRetriever(content, manuscripts)}, "fixture-v1")
    return MainGraph(content, coordinator, **kwargs)


def request(content, **kwargs):
    data = dict(thread_id="thread1", run_id="run1", request_ref="request1", scope=content.scope,
                query=query(content, operation="full_context", episode_range=(1, 3), token_budget=12000),
                prompt="질문", ui_mode="ask")
    data.update(kwargs)
    return MainRequest(**data)


async def agent(slice, ctx):
    return TaskOutput(output_schema=slice.output_schema, output_ref="answer1", is_mock=True)


def test_custom_stream_projects_only_fixed_progress_not_values_or_messages(content,wiki,manuscripts):
    events=[]
    g=graph(content,wiki,manuscripts,handlers={"qa":agent})
    result=asyncio.run(g.run(request(content),progress=events.append))
    assert result.state.execution_status=="succeeded"
    assert [(e.task_id,e.step) for e in events]==[("context",1),("context",2),("qa",1),("qa",2)]
    encoded=" ".join(e.model_dump_json(by_alias=True) for e in events)
    assert content.scope.grant_ref not in encoded and "reasoning" not in encoded
    assert all(row.text not in encoded for row in content.rows)


def test_three_episode_query_returns_verified_mock_citations_and_safe_checkpoints(content, wiki, manuscripts):
    g = graph(content, wiki, manuscripts, handlers={"qa": agent})
    req = request(content)
    result = asyncio.run(g.run(req))
    assert result.state.execution_status == "succeeded"
    assert result.state.coverage.verified_count == result.state.coverage.expected_count == 3
    assert {c.episode for c in result.response.citations} == {1, 2, 3}
    assert result.response.is_mock and "합성" in result.response.text
    for row in content.rows:
        if row.episode > 3 or row.version.work_id != content.scope.work_id:
            assert row.text not in result.response.text
    history = g.history(req)
    serialized = " ".join(s.model_dump_json() for s in history)
    assert len(history) >= 5
    assert content.scope.grant_ref not in serialized
    for row in content.rows:
        assert row.text not in serialized
    assert "질문" not in serialized
    assert result.state.approval_ref is None


def test_missing_episode_is_partial_not_complete_success(content, wiki, manuscripts):
    g = graph(content, (wiki[0], wiki[2]), manuscripts, handlers={"qa": agent})
    result = asyncio.run(g.run(request(content)))
    assert result.state.execution_status == "partial"
    assert result.state.coverage.verified_count == 2
    assert "근거가 부족" in result.response.text


@pytest.mark.parametrize("bad", ["future", "other_fork", "quote", "mock", "scope", "coverage"])
def test_forged_retrieval_is_rejected_or_partial_without_leaks(content, wiki, manuscripts, bad):
    async def scenario():
        valid = await graph(content, wiki, manuscripts).coordinator.retrieve(request(content).query)
        item = valid.result.evidence[0]
        if bad == "future":
            item = item.model_copy(update={"as_of_episode": 99})
        elif bad == "other_fork":
            item = item.model_copy(update={"fork_id": "secret-fork"})
        elif bad == "quote":
            item = item.model_copy(update={"content": "숨겨진 다른 작품 원고"})
        elif bad == "mock":
            item = item.model_copy(update={"is_mock": False})
        if bad in ("future", "other_fork", "quote", "mock"):
            valid = valid.model_copy(update={"result": valid.result.model_copy(update={"evidence": (item,)})})
        elif bad == "scope":
            valid = valid.model_copy(update={"scope_ref": "other-scope"})
        else:
            valid = valid.model_copy(update={"complete": True, "can_conclude": True,
                "result": valid.result.model_copy(update={"coverage": None})})
        g = MainGraph(content, type("Fake", (), {"retrieve": AsyncMock(return_value=valid)})(), handlers={"qa": agent})
        result = await g.run(request(content))
        assert result.state.execution_status in ("denied", "failed", "partial")
        assert "숨겨진 다른 작품" not in result.response.text
        if bad != "coverage":
            assert not result.response.citations
    asyncio.run(scenario())


def test_denied_scope_does_not_route_or_execute(content, wiki, manuscripts):
    handler = AsyncMock()
    content.active = False
    result = asyncio.run(graph(content, wiki, manuscripts, handlers={"qa": handler}).run(request(content)))
    assert result.state.execution_status == "denied"
    handler.assert_not_called()


@pytest.mark.parametrize("prompt,status", [("무언가", "clarification"), ("승인해", "denied"),
    ("https://evil.invalid 실행", "denied")])
def test_router_terminals_do_not_retrieve(content, wiki, manuscripts, prompt, status):
    g = graph(content, wiki, manuscripts)
    g.coordinator.retrieve = AsyncMock()
    result = asyncio.run(g.run(request(content, prompt=prompt, ui_mode="auto")))
    assert result.state.execution_status == status
    g.coordinator.retrieve.assert_not_called()


def test_duplicate_run_does_not_dispatch_again_and_new_turn_resets_ephemeral_state(content, wiki, manuscripts):
    async def scenario():
        spy = AsyncMock(side_effect=agent)
        g = graph(content, wiki, manuscripts, handlers={"qa": spy})
        req = request(content)
        await g.run(req)
        with pytest.raises(PlanError):
            await g.run(req)
        assert spy.await_count == 1
        second = await g.run(request(content, run_id="run2", request_ref="request2", prompt="무언가", ui_mode="auto"))
        assert not second.state.task_plan and not second.state.task_results
        assert not second.state.evidence_refs and second.state.change_set_ref is None
        assert second.state.budget_usage.model_calls == 0
    asyncio.run(scenario())


def test_cancel_and_proposal_are_terminal_without_apply(content, wiki, manuscripts):
    async def scenario():
        g = graph(content, wiki, manuscripts, handlers={"editing": agent})
        proposal = await g.run(request(content, ui_mode="edit", prompt="수정해줘"))
        assert proposal.state.execution_status == "proposal"
        assert proposal.state.change_set_ref and proposal.state.approval_ref is None
        assert proposal.response.is_mock and "적용" in proposal.response.text
        cancel = asyncio.Event()
        cancel.set()
        cancelled = await g.run(request(content, run_id="run2"), cancel=cancel)
        assert cancelled.state.execution_status == "cancelled"
    asyncio.run(scenario())


def test_checkpoint_history_rechecks_current_scope(content, wiki, manuscripts):
    g = graph(content, wiki, manuscripts, handlers={"qa": agent})
    req = request(content)
    asyncio.run(g.run(req))
    content.active = False
    with pytest.raises(ContentReadError):
        g.history(req)


def test_agent_failure_is_partial_and_not_mock_success(content, wiki, manuscripts):
    async def bad(s, c):
        raise RuntimeError("secret raw text")
    result = asyncio.run(graph(content, wiki, manuscripts, handlers={"qa": bad}).run(request(content)))
    assert result.state.execution_status == "partial"
    assert "secret raw text" not in result.model_dump_json()


def test_forged_episode_metadata_cannot_move_third_episode_into_first(content, wiki, manuscripts):
    async def scenario():
        g = graph(content, wiki, manuscripts)
        packet = await g.coordinator.retrieve(request(content).query)
        third = next(e for e in packet.result.evidence if e.document_id == "m3")
        forged = third.model_copy(update={"as_of_episode": 1, "visible_from": 1})
        projection = next(c for c in packet.context if c.evidence_ref == third.id)
        packet = packet.model_copy(update={"context": (projection,),
            "result": packet.result.model_copy(update={"evidence": (forged,)})})
        fake = type("Fake", (), {"retrieve": AsyncMock(return_value=packet)})()
        req = request(content, query=query(content, operation="full_context", episode_range=(1, 1)))
        result = await MainGraph(content, fake, handlers={"qa": agent}).run(req)
        assert result.state.execution_status == "denied" and not result.response.citations
    asyncio.run(scenario())


def test_revoked_scope_during_agent_does_not_return_old_citations(content, wiki, manuscripts):
    async def revoke(s, ctx):
        content.active = False
        return await agent(s, ctx)
    result = asyncio.run(graph(content, wiki, manuscripts, handlers={"qa": revoke}).run(request(content)))
    assert result.state.execution_status == "denied" and not result.response.citations


def test_checkpoint_storage_itself_has_no_request_or_manuscript(content, wiki, manuscripts):
    g = graph(content, wiki, manuscripts, handlers={"qa": agent})
    req = request(content, prompt="private-request-body", ui_mode="ask")
    asyncio.run(g.run(req))
    raw = repr(g.checkpointer.storage) + repr(g.checkpointer.writes)
    assert "private-request-body" not in raw and content.scope.grant_ref not in raw
    assert all(row.text not in raw for row in content.rows)


def test_shared_memory_checkpoint_rejects_replay_from_new_wrapper(content, wiki, manuscripts):
    async def scenario():
        first = graph(content, wiki, manuscripts, handlers={"qa": agent})
        req = request(content)
        await first.run(req)
        spy = AsyncMock(side_effect=agent)
        second = graph(content, wiki, manuscripts, handlers={"qa": spy}, checkpointer=first.checkpointer)
        with pytest.raises(PlanError, match="run_already_checkpointed"):
            await second.run(req)
        spy.assert_not_called()
    asyncio.run(scenario())


def test_invalid_plan_and_unregistered_agent_schema_fail_explicitly(content, wiki, manuscripts):
    async def scenario():
        invalid = graph(content, wiki, manuscripts, plan_factory=lambda c, s: ())
        result = await invalid.run(request(content))
        assert result.state.execution_status == "failed" and result.state.errors == ("invalid_plan",)
        async def wrong(s, ctx):
            return TaskOutput(output_schema="ChangeSet.v1", output_ref="wrong", is_mock=True)
        result = await graph(content, wiki, manuscripts, handlers={"qa": wrong}).run(request(content))
        assert result.state.execution_status == "partial" and result.state.change_set_ref is None
    asyncio.run(scenario())
