"""Coordinator 선택·정규화·전체 Coverage의 단위 계약."""
import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from test_mock_retrievers import content, story, manuscripts, wiki, graph, templates, query, candidate
from app.retrieval.episode_wiki import EpisodeWikiRetriever
from app.retrieval.manuscript import ManuscriptVectorRetriever
from app.retrieval.contracts import RetrievalResult
from app.retrieval.coordinator import RetrievalCoordinator
from app.retrieval.relationships import RelationshipGraphRetriever
from app.retrieval.templates import TemplateVectorRetriever


def coordinator(content, wiki, manuscripts):
    return RetrievalCoordinator(content, {"wiki": EpisodeWikiRetriever(content, wiki),
                                         "manuscript": ManuscriptVectorRetriever(content, manuscripts)}, "fixture-v1")


def run(port, request):
    return asyncio.run(port.retrieve(request))


def test_full_coverage_is_independent_of_top_k(content, wiki, manuscripts):
    packet = run(coordinator(content, wiki, manuscripts), query(content, operation="review", top_k=1))
    assert packet.result.coverage.expected_count == packet.result.coverage.verified_count == 3
    assert packet.can_conclude and packet.complete
    assert len(packet.context) <= 1


def test_missing_wiki_is_two_of_three_and_blocks_conclusion(content, wiki, manuscripts):
    packet = run(coordinator(content, (wiki[0], wiki[2]), manuscripts), query(content, operation="review"))
    assert packet.result.coverage.verified_count == 2
    assert packet.result.coverage.missing_ranges == ((2, 2),)
    assert packet.result.coverage.critical_gaps and not packet.can_conclude


def test_top_k_without_inventory_cannot_claim_complete(content, wiki, manuscripts):
    packet = run(coordinator(content, wiki, manuscripts), query(content, operation="search", top_k=1))
    assert packet.result.coverage is None and not packet.complete


def test_exact_quote_and_projection(content, manuscripts):
    port = coordinator(content, (), manuscripts)
    packet = run(port, query(content, operation="quote", document_ids=("m2",), required_fields=("content", "source_span")))
    assert packet.result.status == "ok" and packet.result.evidence[0].source_span == (0, 12)
    assert packet.context[0].content == "리나만 암호를 들었다."
    assert packet.context[0].fact_or_relation is None
    assert "synthetic-grant" not in packet.model_dump_json()


@pytest.mark.parametrize("bad", ["other", "future", "private"])
def test_bad_adapter_is_quarantined_without_payload(content, bad):
    content.scope = replace(content.scope, audience="reader")
    malicious = AsyncMock()
    malicious.search.return_value = RetrievalResult(status="ok", is_mock=True,
                                                   evidence=(candidate(content, "m1"), candidate(content, bad)))
    packet = run(RetrievalCoordinator(content, {"manuscript": malicious}, "v1"), query(content, operation="quote"))
    assert packet.result.status == "denied" and not packet.result.evidence and not packet.context


def test_scores_are_not_averaged_and_same_span_is_deduplicated(content):
    a = candidate(content, "m1", retrieval_score=0.9, score_kind="cosine")
    b = a.model_copy(update={"id": "second", "retrieval_score": 4, "score_kind": "rank"})
    mock = AsyncMock()
    mock.search.return_value = RetrievalResult(status="ok", is_mock=True, evidence=(a, b))
    packet = run(RetrievalCoordinator(content, {"manuscript": mock}, "v1"), query(content, operation="quote"))
    assert len(packet.result.evidence) == 1
    assert (packet.result.evidence[0].retrieval_score, packet.result.evidence[0].score_kind) == (0.9, "cosine")


def test_disputed_evidence_blocks_conclusion(content, wiki, manuscripts):
    changed = tuple(e.model_copy(update={"canonical_status": "disputed"}) for e in wiki)
    packet = run(coordinator(content, changed, manuscripts), query(content, operation="review"))
    assert not packet.can_conclude
    assert any(e.canonical_status == "disputed" for e in packet.result.evidence)


def test_timeout_is_not_empty_success(content, manuscripts):
    mock = AsyncMock()
    mock.search.side_effect = TimeoutError()
    result = run(RetrievalCoordinator(content, {"manuscript": mock}, "v1"), query(content, operation="quote"))
    assert result.result.status == "unavailable" and not result.can_conclude


def test_zero_hit_remains_ok(content):
    packet = run(coordinator(content, (), ()), query(content, operation="quote"))
    assert packet.result.status == "ok" and not packet.result.evidence and not packet.can_conclude


def test_budget_omissions_are_visible(content, wiki, manuscripts):
    packet = run(coordinator(content, wiki, manuscripts), query(content, operation="review", token_budget=1))
    assert not packet.context and (packet.omitted_refs or packet.omitted_ranges) and packet.result.status == "partial"
    assert not packet.can_conclude


def test_cache_key_separates_every_scope_dimension(content):
    port = coordinator(content, (), ())
    base = query(content)
    original = port.cache_key(base)
    for changes in ({"subject_ref": "B"}, {"grant_ref": "G2"}, {"purpose": "other"},
                    {"basis_episode": 2}, {"manifest_ref": "M2"}, {"audience": "reader"},
                    {"audience": "character", "character_id": "kai"}, {"work_id": "f1", "fork_id": "f1"}):
        assert port.cache_key(base.model_copy(update={"scope": replace(base.scope, **changes)})) != original
    port.index_generation = "v2"
    assert port.cache_key(base) != original


def test_revoke_after_parallel_search_discards_packet(content):
    mock = AsyncMock()

    async def revoke(request):
        content.active = False
        return RetrievalResult(status="ok", is_mock=True, evidence=(candidate(content, "m1"),))

    mock.search.side_effect = revoke
    packet = run(RetrievalCoordinator(content, {"manuscript": mock}, "v1"), query(content, operation="quote"))
    assert packet.result.status == "denied" and not packet.context


def test_independent_paths_really_overlap(content):
    async def exercise():
        seen = set()
        ready = asyncio.Event()

        async def search(request, name):
            seen.add(name)
            if len(seen) == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), timeout=1)
            return RetrievalResult(status="ok", is_mock=True)

        a, b = AsyncMock(), AsyncMock()
        a.search.side_effect = lambda q: None
        async def first(q): return await search(q, "wiki")
        async def second(q): return await search(q, "manuscript")
        a.search.side_effect, b.search.side_effect = first, second
        packet = await RetrievalCoordinator(content, {"wiki": a, "manuscript": b}, "v1").retrieve(query(content))
        assert seen == {"wiki", "manuscript"} and packet.result.status == "ok"

    asyncio.run(exercise())


def test_stale_inventory_blocks_full_review(content, wiki, manuscripts):
    stale = wiki[1].model_copy(update={"source_revision": replace(wiki[1].source_revision, revision="old2")})
    packet = run(coordinator(content, (wiki[0], stale, wiki[2]), manuscripts), query(content, operation="review"))
    assert packet.result.coverage.verified_count == 2
    assert any(g.code == "stale" for g in packet.result.coverage.critical_gaps)
    assert not packet.can_conclude


def test_optional_provider_timeout_keeps_independent_results(content, wiki):
    bad = AsyncMock()
    bad.search.side_effect = TimeoutError()
    port = RetrievalCoordinator(content, {"wiki": EpisodeWikiRetriever(content, wiki), "manuscript": bad}, "v1")
    packet = run(port, query(content, operation="review"))
    assert packet.result.status == "partial" and packet.complete and packet.result.evidence


def test_no_coverage_capability_never_trusts_search_top_k(content, wiki):
    mock = AsyncMock(spec=["search"])
    mock.search = AsyncMock(return_value=RetrievalResult(status="ok", is_mock=True, evidence=wiki))
    packet = run(RetrievalCoordinator(content, {"wiki": mock}, "v1"), query(content, operation="review"))
    assert packet.result.coverage.verified_count == 0 and not packet.complete and not packet.can_conclude


@pytest.mark.parametrize("change", [{"source_hash": "0" * 64}, {"as_of_episode": 4},
                                    {"visible_from": 4}, {"content": "위조 인용"}])
def test_forged_citation_is_denied(content, change):
    mock = AsyncMock()
    mock.search.return_value = RetrievalResult(status="ok", is_mock=True,
        evidence=(candidate(content, "m1").model_copy(update=change),))
    packet = run(RetrievalCoordinator(content, {"manuscript": mock}, "v1"), query(content, operation="quote"))
    assert packet.result.status == "denied" and not packet.context


def test_special_sources_and_license_projection(content, graph, templates):
    port = RetrievalCoordinator(content, {"relationship": RelationshipGraphRetriever(content, graph),
        "template": TemplateVectorRetriever(content, templates, frozenset({"demo_allowed"}))}, "v1")
    current = run(port, query(content, operation="current"))
    assert current.result.status == "ok" and current.result.evidence
    catalog = run(port, query(content, operation="search", required_fields=("license_ref", "template_id")))
    assert catalog.context[0].license_ref == "demo_allowed"
    assert catalog.context[0].content is None


def test_conflicting_duplicate_cannot_hide_disputed_status(content):
    a = candidate(content, "m1")
    b = a.model_copy(update={"id": "contradiction", "canonical_status": "disputed"})
    mock = AsyncMock()
    mock.search.return_value = RetrievalResult(status="ok", is_mock=True, evidence=(a, b))
    packet = run(RetrievalCoordinator(content, {"manuscript": mock}, "v1"), query(content, operation="quote"))
    assert not packet.can_conclude and packet.result.conflicts
    assert packet.context[0].canonical_status == "disputed"
    assert {"hit-m1", "contradiction"} <= {e.id for e in packet.result.evidence}


def test_unresolved_causal_reference_blocks_conclusion_even_with_index_entries(content, wiki, manuscripts):
    broken = wiki[2].model_copy(update={"evidence_refs": ("missing-cause",)})
    packet = run(coordinator(content, (wiki[0], wiki[1], broken), manuscripts), query(content, operation="review"))
    assert packet.result.coverage.verified_count == 3
    assert packet.result.coverage.critical_gaps and not packet.can_conclude
