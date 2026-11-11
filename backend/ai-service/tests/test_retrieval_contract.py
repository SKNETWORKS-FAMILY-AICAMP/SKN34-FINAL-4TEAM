"""검색 DTO와 합성 Content 경계의 단위 계약. 실제 검색 품질은 검증하지 않는다."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from inspect import iscoroutinefunction
from pathlib import Path
from typing import get_args, get_type_hints
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.retrieval.content_client import ContentReadError, Scope, SourceVersion
from app.retrieval.contracts import (
    CanonicalAdapter, Conflict, Coverage, EpisodeCoverage, Evidence, Gap, Query,
    RetrievalResult, RelationshipGraphPort, EpisodeWikiPort, ManuscriptVectorPort,
)
from app.retrieval.mock_content import MockContentReadPort, MockRow


@pytest.fixture
def story():
    return json.loads((Path(__file__).parent / "fixtures/story.json").read_text(encoding="utf-8"))


@pytest.fixture
def content(story):
    rows = tuple(MockRow(SourceVersion(r["work_id"], r["kind"], r["id"], r["revision"]),
                         r["text"], r["episode"], r["public"], tuple(r["known_by"]))
                 for r in story["sources"])
    return MockContentReadPort(Scope(**story["scope"]), rows, tuple(m["episode"] for m in story["manifest"]),
                               frozenset(r.version for r in rows), frozenset(),
                               datetime.now(timezone.utc) + timedelta(minutes=5))


def evidence(content_port, retrieval_type="manuscript", **changes):
    row = content_port.rows[0]
    values = dict(id="c1", retrieval_type=retrieval_type, source_backend="fixture-v1",
                  is_mock=True, retrieved_at=datetime.now(timezone.utc), work_id="w1",
                  document_id=row.version.document_id, source_revision=row.version,
                  source_span=(0, len(row.text.encode("utf-16-le")) // 2),
                  content=row.text, source_hash=sha256(row.text.encode("utf-8")).hexdigest(),
                  as_of_episode=1, canonical_status="verified_source", known_by=("kai", "lina"),
                  visible_from=1, evidence_refs=("m1/r1",), retrieval_score=1, score_kind="rank")
    values.update(changes)
    return Evidence(**values)


@pytest.mark.parametrize("port_type,kind", [
    (RelationshipGraphPort, "relationship"), (EpisodeWikiPort, "wiki"),
    (ManuscriptVectorPort, "manuscript"),
])
def test_three_ports_share_query_and_result(port_type, kind, content):
    # TASK 02에서는 반환 계약만 검사한다. 검색 구현은 TASK 03의 범위다.
    class Stub:
        retrieval_type = kind

        async def search(self, query: Query) -> RetrievalResult:
            assert query.scope is content.scope
            return RetrievalResult(status="ok", is_mock=True)

    assert iscoroutinefunction(port_type.search)
    assert get_type_hints(port_type.search) == {"query": Query, "return": RetrievalResult}
    assert get_args(get_type_hints(port_type)["retrieval_type"]) == (kind,)
    port = Stub()
    query = Query(scope=content.scope, operation="search", top_k=3, token_budget=100,
                  deadline=datetime.now(timezone.utc) + timedelta(seconds=10))
    # I/O 없는 반환 계약만 검사하므로 이벤트 루프나 소켓이 필요하지 않다.
    with pytest.raises(StopIteration) as completed:
        port.search(query).send(None)
    result = completed.value.value
    assert RetrievalResult.model_validate_json(result.model_dump_json()) == result
    assert result.status == "ok" and result.evidence == () and result.is_mock


@pytest.mark.parametrize("changes", [
    {"top_k": 0}, {"top_k": True}, {"token_budget": -1},
    {"episode_range": (3, 1)}, {"episode_range": (0, 2)}, {"episode_range": (1, 4)},
    {"deadline": datetime(2026, 1, 1)}, {"unexpected": "field"},
])
def test_invalid_query_rejected(content, changes):
    values = dict(scope=content.scope, operation="search", top_k=3, token_budget=100,
                  deadline=datetime.now(timezone.utc))
    values.update(changes)
    with pytest.raises(ValidationError):
        Query(**values)


def test_evidence_preserves_revision_span_hash_and_score_meaning(content):
    item = evidence(content)
    assert Evidence.model_validate_json(item.model_dump_json()) == item
    verified = CanonicalAdapter(content).read(content.scope, item.source_revision,
                                              item.source_span, item.source_hash)
    assert verified.text == item.content and verified.is_mock
    assert item.score_kind == "rank" and item.canonical_status == "verified_source"


def test_manuscript_seed_span_matches_exact_korean_quote(content, story):
    chunk = story["manuscript"][0]
    row = next(r for r in content.rows if r.version.document_id == chunk["doc"])
    assert row.version.revision == chunk["revision"]
    result = CanonicalAdapter(content).read(content.scope, row.version, tuple(chunk["span"]),
                                           sha256(row.text.encode("utf-8")).hexdigest())
    assert result.text == "리나만 암호를 들었다." and result.is_mock


@pytest.mark.parametrize("changes", [
    {"source_span": (2, 1)}, {"source_span": (0, 0)}, {"source_span": (True, 2)},
    {"source_hash": "not-sha256"}, {"retrieval_score": 0.5, "score_kind": None},
    {"retrieval_score": None, "score_kind": "cosine"}, {"canonical_status": "certain"},
    {"is_mock": "false"},
])
def test_invalid_evidence_rejected(content, changes):
    with pytest.raises(ValidationError):
        evidence(content, **changes)


def test_catalog_template_requires_revision_and_license(content, story):
    template = story["template"][0]
    values = dict(work_id=None, document_id=None, source_span=None, source_hash=None,
                  content=template["name"], known_by=None, visible_from=None, as_of_episode=None,
                  evidence_refs=(),
                  template_id=template["id"], catalog_revision=template["revision"],
                  license_ref=template["license_ref"],
                  source_revision=SourceVersion("catalog", "template", template["id"], template["revision"]))
    with pytest.raises(ValidationError):
        evidence(content, "template", **values)


def test_empty_success_failure_and_partial_are_distinct(content, story):
    empty = RetrievalResult(status="ok", is_mock=True)
    timeout = RetrievalResult(status="unavailable", gaps=(Gap(code="timeout"),), is_mock=True)
    denied = RetrievalResult(status="denied", is_mock=True)
    missing = story["variants"]["missing"]["omit_wiki_episode"]
    coverage = Coverage(manifest_ref=content.scope.manifest_ref, requested_range=(1, 3),
                        expected_count=3, verified_count=2, episodes=(
                            EpisodeCoverage(number=1, state="verified", refs=("m1/r1",)),
                            EpisodeCoverage(number=missing, state="missing"),
                            EpisodeCoverage(number=3, state="verified", refs=("m3/r3",))),
                        missing_ranges=((2, 2),), critical_gaps=(Gap(episode_number=2, code="missing"),),
                        checked_at=datetime.now(timezone.utc), is_mock=True)
    partial = RetrievalResult(status="partial", evidence=(evidence(content),),
                              gaps=coverage.critical_gaps, coverage=coverage, is_mock=True)
    assert {r.status for r in (empty, timeout, denied, partial)} == {"ok", "unavailable", "denied", "partial"}
    assert partial.coverage.verified_count == 2
    assert RetrievalResult.model_validate_json(partial.model_dump_json()) == partial


@pytest.mark.parametrize("changes", [
    {"status": "success"}, {"is_mock": False}, {"status": "denied"},
    {"status": "unavailable"}, {"status": "unsupported"},
])
def test_result_cannot_hide_mock_or_leak_evidence_on_failure(content, changes):
    values = dict(status="ok", is_mock=True, evidence=(evidence(content),))
    with pytest.raises(ValidationError):
        RetrievalResult(**(values | changes))


def test_mock_flag_is_required():
    with pytest.raises(ValidationError):
        RetrievalResult(status="ok")


def coverage(**changes):
    return Coverage(**(dict(manifest_ref="synthetic-manifest-v1", requested_range=(1, 1),
                            expected_count=1, verified_count=0,
                            episodes=(EpisodeCoverage(number=1, state="missing"),),
                            missing_ranges=((1, 1),), checked_at=datetime.now(timezone.utc),
                            is_mock=True) | changes))


@pytest.mark.parametrize("changes", [
    {"expected_count": 2}, {"verified_count": 1}, {"requested_range": (2, 3)},
    {"missing_ranges": ((1, 2),)},
    {"expected_count": 2, "episodes": (EpisodeCoverage(number=1, state="missing"),) * 2},
])
def test_coverage_rejects_wrong_counts_duplicates_and_ranges(changes):
    with pytest.raises(ValidationError):
        coverage(**changes)


def test_incomplete_coverage_or_gap_cannot_be_ok():
    for fields in ({"coverage": coverage()}, {"gaps": (Gap(code="missing"),)}):
        with pytest.raises(ValidationError):
            RetrievalResult(status="ok", is_mock=True, **fields)


def test_mock_coverage_cannot_be_reported_as_real():
    with pytest.raises(ValidationError):
        RetrievalResult(status="partial", is_mock=False, coverage=coverage())


def test_unauthorized_fixture_variant_is_quarantined_before_payload(content, story):
    injected = story["variants"]["unauthorized"]["inject_result_from"]
    row = next(r for r in content.rows if r.version.document_id == injected)
    with pytest.raises(ContentReadError) as failure:
        CanonicalAdapter(content).read(content.scope, row.version)
    assert str(failure.value) == "denied"
    assert row.text not in str(failure.value) and row.version.work_id not in str(failure.value)


def test_conflicting_claim_is_not_promoted_to_canonical(content, story):
    variant = story["variants"]["conflict"]
    row = next(r for r in content.rows if r.version.document_id == "m2")
    claim = evidence(content, "wiki", content=row.text, fact_or_relation=variant["claim"],
                     document_id="m2", source_revision=row.version, source_span=(0, 12),
                     source_hash=sha256(row.text.encode("utf-8")).hexdigest(),
                     known_by=("lina",), visible_from=2, as_of_episode=2, canonical_status="disputed",
                     evidence_refs=("e2", "claim-kai"))
    result = RetrievalResult(status="partial", evidence=(claim,),
                             conflicts=(Conflict(evidence_refs=("e2", "claim-kai")),), is_mock=True)
    assert result.evidence[0].canonical_status == "disputed"
    assert result.conflicts[0].evidence_refs == ("e2", "claim-kai")


@pytest.mark.parametrize("document", ["other", "f3", "future", "private"])
def test_fixture_blocks_other_work_fork_future_and_private(content, document):
    content.scope = replace(content.scope, audience="reader")
    adapter = CanonicalAdapter(content)
    target = next(row.version for row in content.rows if row.version.document_id == document)
    assert target not in adapter.manifest(content.scope).source_versions
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.read(content.scope, target)


def test_kai_cannot_read_linas_secret_or_unknown_knowledge(content):
    content.scope = replace(content.scope, audience="character", character_id="kai", basis_episode=2)
    content.expected_episodes = (1, 2)
    versions = CanonicalAdapter(content).manifest(content.scope).source_versions
    assert {v.document_id for v in versions} == {"m1"}
    secret = next(row.version for row in content.rows if row.version.document_id == "m2")
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(content).read(content.scope, secret)


def test_fork_preserves_only_explicit_inherited_checkpoint(content, story):
    variant = story["variants"]["fork"]
    content.scope = replace(content.scope, work_id=variant["work_id"], fork_id=variant["fork_id"])
    content.inherited = frozenset(r.version for r in content.rows if r.version.document_id in ("m1", "m2"))
    assert {v.document_id for v in CanonicalAdapter(content).manifest(content.scope).source_versions} == {"m1", "m2", "f3"}


def test_stale_revision_and_timeout_are_not_empty_success(content, story):
    adapter = CanonicalAdapter(content)
    version = next(r.version for r in content.rows if r.version.document_id == "m2")
    stale = replace(version, revision=story["variants"]["stale"]["override_chunk_revision"])
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.read(content.scope, stale)
    content.manifest = Mock(side_effect=TimeoutError(story["variants"]["timeout"]["error"]))
    with pytest.raises(ContentReadError, match="^unavailable$"):
        adapter.manifest(content.scope)


def test_korean_surrogate_and_newline_quote_boundaries(content):
    row = next(r for r in content.rows if r.version.document_id == "unicode")
    adapter = CanonicalAdapter(content)
    quote = "🌙\r\n리나"
    assert adapter.read(content.scope, row.version, (1, 7), sha256(quote.encode("utf-8")).hexdigest()).text == quote
    for span in ((1, 2), (2, 3)):
        with pytest.raises(ContentReadError, match="^denied$"):
            adapter.read(content.scope, row.version, span)
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.read(content.scope, row.version, (1, 7), sha256(quote.encode("utf-16-le")).hexdigest())


def test_relationship_remains_unsupported(content):
    target = SourceVersion("w1", "relationship", "rel1", "7")
    with pytest.raises(ContentReadError, match="^unsupported$"):
        CanonicalAdapter(content).read(content.scope, target)
