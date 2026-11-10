"""Story Context의 정본 무호출 경로·근거별 해석·읽기 전용 계약."""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import AsyncMock

import pytest

from test_mock_retrievers import content, story, manuscripts, wiki, query
from test_retrieval_coordinator import coordinator
from app.agents.story_context import Claim, ExactSource, Interpretation, StoryContextHandler, StoryContextRequest, story_context
from app.retrieval.content_client import SourceVersion
from app.retrieval.mock_content import MockRow
from app.runs.orchestrator import REGISTRY


class FakeLLM:
    def __init__(self, claims):
        self.interpret = AsyncMock(return_value=Interpretation(claims=claims, input_tokens=20, output_tokens=10))


def exact(content, document="m2", kind="quote", **changes):
    row = next(r for r in content.rows if r.version.document_id == document)
    target = ExactSource(version=row.version, span=(0, len(row.text.encode("utf-16-le")) // 2),
                         source_hash=sha256(row.text.encode()).hexdigest())
    return StoryContextRequest(query=query(content), kind=kind, exact=target, **changes)


def answer(request, content, **kwargs):
    return asyncio.run(REGISTRY["qa"].handler(request, content=content, **kwargs))


def test_registry_connects_typed_handler():
    assert REGISTRY["qa"].handler is story_context
    assert REGISTRY["qa"].output_schema == "Answer.v1"


@pytest.mark.parametrize("kind,text", [("quote", "😀카이는 문을 닫았다."), ("attribute", "17세")])
def test_exact_source_has_zero_model_and_search_calls(content, kind, text):
    version = SourceVersion("w1", "setting" if kind == "attribute" else "manuscript", "selected", "r1")
    content.rows += (MockRow(version, text, 1, True, ("kai",)),)
    content.pinned |= {version}
    llm, search = FakeLLM(()), AsyncMock()
    result = answer(exact(content, "selected", kind), content, model=llm, coordinator=search)
    assert result.status == "ok" and result.claims[0].text == text
    assert result.claims[0].status == "confirmed" and result.is_mock
    source = result.sources[0]
    assert source.source_revision == version and source.source_hash == sha256(text.encode()).hexdigest()
    assert source.source_span == (0, len(text.encode("utf-16-le")) // 2)
    llm.interpret.assert_not_called()
    search.retrieve.assert_not_called()


@pytest.mark.parametrize("change", ["hash", "revision", "span", "future", "other", "f3", "private", "knowledge"])
def test_exact_rejects_invalid_or_forbidden_source_without_model(content, change):
    content.scope = replace(content.scope, audience="character", character_id="kai")
    request = exact(content, "m1")
    if change in ("future", "other", "f3", "private"):
        request = exact(content, change)
    elif change == "knowledge":
        request = exact(content, "m2")
    else:
        target = request.exact
        updates = {"hash": {"source_hash": "0" * 64}, "revision": {
            "version": replace(target.version, revision="old")}, "span": {"span": (0, 999)}}[change]
        request = request.model_copy(update={"exact": target.model_copy(update=updates)})
    llm = FakeLLM(())
    result = answer(request, content, model=llm)
    assert result.status == "denied" and not result.claims and not result.sources
    llm.interpret.assert_not_called()


def test_betrayal_interpretation_uses_scoped_wiki_paths_and_spans(content, wiki, manuscripts):
    from test_mock_retrievers import candidate
    texts = {"m1": "리나는 인질로 잡혔다.", "m2": "카이는 리나를 구하기로 결심했다.",
             "m3": "카이는 리나를 구하려고 동료를 배신했다."}
    content.rows = tuple(replace(r, text=texts.get(r.version.document_id, r.text)) for r in content.rows)
    wiki = tuple(candidate(content, "m" + str(i), "wiki", id="e" + str(i),
                           evidence_refs=("e2",) if i == 3 else ()) for i in (1, 2, 3))
    manuscripts = tuple(candidate(content, doc) for doc in texts)
    llm = FakeLLM((Claim(text="리나를 구하려는 결심이 배신의 원인으로 해석됩니다.", status="inferred", refs=("e3", "e2")),))
    request = StoryContextRequest(query=query(content, operation="full_context"), question="왜 배신했나?", kind="interpretation")
    result = answer(request, content, coordinator=coordinator(content, wiki, manuscripts), model=llm)
    assert result.status == "ok" and result.claims[0].status == "inferred"
    assert result.coverage.verified_count == 3 and result.claims[0].refs == ("e3", "e2")
    payload = llm.interpret.call_args.args[0]
    assert "synthetic-grant" not in payload.model_dump_json()
    assert all(s.source_span and s.source_hash for s in result.sources)
    assert any(item.evidence_refs for item in payload.context)
    assert payload.question == "왜 배신했나?"


def test_unknown_model_refs_are_rejected(content, wiki, manuscripts):
    llm = FakeLLM((Claim(text="미래의 비밀", status="inferred", refs=("future",)),))
    result = answer(StoryContextRequest(query=query(content, operation="full_context"), kind="interpretation"),
                    content, coordinator=coordinator(content, wiki, manuscripts), model=llm)
    assert result.status == "insufficient_evidence" and not result.claims


def test_missing_episode_returns_only_verified_facts_and_no_interpretation(content, wiki, manuscripts):
    llm = FakeLLM(())
    result = answer(StoryContextRequest(query=query(content, operation="full_context"), kind="interpretation"),
                    content, coordinator=coordinator(content, (wiki[0], wiki[2]), manuscripts), model=llm)
    assert result.status == "partial" and result.coverage.verified_count == 2
    assert result.gaps and all(c.status == "confirmed" for c in result.claims)
    llm.interpret.assert_not_called()


def test_empty_is_insufficient_evidence(content):
    result = answer(StoryContextRequest(query=query(content, operation="full_context"), kind="interpretation"),
                    content, coordinator=coordinator(content, (), ()))
    assert result.status == "insufficient_evidence" and not result.claims


def test_exact_read_has_no_write_approval_or_provider_effects(content):
    before = (content.rows, content.pinned, content.active)
    result = answer(exact(content), content)
    assert result.claims and (content.rows, content.pinned, content.active) == before
    assert "grant" not in result.model_dump_json()


@pytest.mark.parametrize("mode", ["stale", "timeout", "partial"])
def test_retrieval_failure_states_stay_distinct(content, wiki, manuscripts, mode):
    from app.retrieval.episode_wiki import EpisodeWikiRetriever
    port = coordinator(content, wiki, manuscripts)
    if mode == "stale":
        stale = wiki[1].model_copy(update={"source_revision": replace(wiki[1].source_revision, revision="old")})
        port.ports["wiki"] = EpisodeWikiRetriever(content, (wiki[0], stale, wiki[2]))
    elif mode == "timeout":
        port.ports["wiki"].failure = "timeout"
    else:
        port = coordinator(content, (wiki[0], wiki[2]), manuscripts)
    llm = FakeLLM(())
    result = answer(StoryContextRequest(query=query(content), kind="interpretation"), content, coordinator=port, model=llm)
    assert result.status == mode and result.gaps
    llm.interpret.assert_not_called()


def test_model_completion_rechecks_revoked_scope(content, wiki, manuscripts):
    llm = FakeLLM(())
    async def revoke(payload):
        content.active = False
        return Interpretation(claims=(Claim(text="해석", status="inferred", refs=("e1",)),), input_tokens=1, output_tokens=1)
    llm.interpret.side_effect = revoke
    result = answer(StoryContextRequest(query=query(content), kind="interpretation"), content,
                    coordinator=coordinator(content, wiki, manuscripts), model=llm)
    assert result.status == "denied" and not result.claims and not result.sources


@pytest.mark.parametrize("kind", ["quote", "interpretation"])
def test_registered_handler_runs_with_taskrunner_budget_and_reference_only_output(content, wiki, manuscripts, kind):
    from test_task_graph import task
    from app.retrieval.content_client import CanonicalAdapter
    from app.runs.runner import TaskOutput, TaskRunner
    root = task(content.scope, "context", "context")
    qa = task(content.scope, "qa", "qa", (root,))
    request = exact(content) if kind == "quote" else StoryContextRequest(query=query(content), kind="interpretation")
    llm = FakeLLM((Claim(text="해석", status="inferred", refs=("e1",)),))
    handler = StoryContextHandler(request, content=content, coordinator=coordinator(content, wiki, manuscripts), model=llm)
    async def context_handler(slice, ctx):
        return TaskOutput(output_schema="ContextPacket.v1", output_ref="context:fixture", is_mock=True)
    runner = TaskRunner("run1", (root, qa), scope=content.scope, manifest=CanonicalAdapter(content).manifest(content.scope),
                        allowed_operations=("context", "qa"), handlers={"context": context_handler, "qa": handler})
    result = asyncio.run(runner.run())
    assert result.status == "succeeded" and handler.answer.status == "ok"
    assert result.accounted.model_calls == (0 if kind == "quote" else 1)
    assert result.results[-1].output_ref == "answer:run1:qa"
    assert "해석" not in result.model_dump_json() and "리나만" not in result.model_dump_json()


def test_exact_source_cannot_escape_requested_episode_range(content):
    request = exact(content, "m1")
    request = request.model_copy(update={"query": query(content, episode_range=(2, 3))})
    result = answer(request, content)
    assert result.status == "denied" and not result.sources


def test_narrative_character_scope_never_sends_unknown_private_or_future_to_model(content, wiki, manuscripts):
    content.scope = replace(content.scope, audience="character", character_id="kai")
    llm = FakeLLM((Claim(text="문을 닫았습니다.", status="inferred", refs=("e1",)),))
    result = answer(StoryContextRequest(query=query(content), kind="interpretation"), content,
                    coordinator=coordinator(content, wiki, manuscripts), model=llm)
    serialized = result.model_dump_json()
    assert all(secret not in serialized for secret in ("리나만 암호", "달빛이다", "나중에", "떠났다", "다른 작품"))
    if llm.interpret.called:
        payload = llm.interpret.call_args.args[0].model_dump_json()
        assert all(secret not in payload for secret in ("리나만 암호", "달빛이다", "나중에", "떠났다", "다른 작품"))


def test_model_timeout_does_not_become_success(content, wiki, manuscripts):
    llm = FakeLLM(())
    llm.interpret.side_effect = TimeoutError("provider detail must stay private")
    result = answer(StoryContextRequest(query=query(content), kind="interpretation"), content,
                    coordinator=coordinator(content, wiki, manuscripts), model=llm)
    assert result.status == "timeout" and not result.claims
    assert "provider detail" not in result.model_dump_json()


def test_model_wait_is_bounded_by_query_deadline(content, wiki, manuscripts):
    llm = FakeLLM(())
    completed = []
    async def slow(payload):
        await asyncio.sleep(1)
        completed.append(True)
        return Interpretation(claims=(Claim(text="늦은 결과", status="inferred", refs=("e1",)),), input_tokens=1, output_tokens=1)
    llm.interpret.side_effect = slow
    request = StoryContextRequest(query=query(content, deadline=datetime.now(timezone.utc) + timedelta(milliseconds=100)), kind="interpretation")
    result = answer(request, content, coordinator=coordinator(content, wiki, manuscripts), model=llm)
    assert result.status == "timeout" and not result.claims and not completed


def test_taskrunner_preserves_timeout_code(content):
    from test_task_graph import task
    from app.retrieval.content_client import CanonicalAdapter
    from app.runs.runner import TaskOutput, TaskRunner
    root = task(content.scope, "context", "context")
    qa = task(content.scope, "qa", "qa", (root,))
    request = exact(content).model_copy(update={"query": query(content, deadline=datetime.now(timezone.utc) - timedelta(seconds=1))})
    handler = StoryContextHandler(request, content=content)
    async def context_handler(slice, ctx):
        return TaskOutput(output_schema="ContextPacket.v1", output_ref="context:fixture", is_mock=True)
    runner = TaskRunner("run1", (root, qa), scope=content.scope, manifest=CanonicalAdapter(content).manifest(content.scope),
                        allowed_operations=("context", "qa"), handlers={"context": context_handler, "qa": handler})
    result = asyncio.run(runner.run())
    assert result.results[-1].error_code == "timeout"
