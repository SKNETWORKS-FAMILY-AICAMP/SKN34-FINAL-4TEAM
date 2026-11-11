"""네 합성 검색기의 공통 반환·인가·장애 단위 계약."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.retrieval.content_client import Scope, SourceVersion
from app.retrieval.contracts import Evidence, Query, RetrievalResult
from app.retrieval.mock_content import MockContentReadPort, MockRow
from app.retrieval.relationships import MockRelationshipGraph, Relationship, RelationshipGraphRetriever
from app.retrieval.episode_wiki import EpisodeWikiRetriever
from app.retrieval.manuscript import ManuscriptVectorRetriever
from app.agents.template_catalog import Template, TemplateCatalog


def run(port, query):
    # 합성 검색은 실제 I/O가 없으므로 소켓을 여는 이벤트 루프 없이 완료한다.
    with pytest.raises(StopIteration) as completed:
        port.search(query).send(None)
    return completed.value.value


@pytest.fixture
def story():
    return json.loads((Path(__file__).parent / "fixtures/story.json").read_text(encoding="utf-8"))


@pytest.fixture
def content(story):
    scope = Scope(**(story["scope"] | {"world_id": story["relationship_binding"]["world_id"]}))
    rows = tuple(MockRow(SourceVersion(r["work_id"], r["kind"], r["id"], r["revision"]),
                         r["text"], r["episode"], r["public"], tuple(r["known_by"])) for r in story["sources"])
    return MockContentReadPort(scope, rows, (1, 2, 3), frozenset(r.version for r in rows),
                               frozenset(), datetime.now(timezone.utc) + timedelta(minutes=5))


def query(content, **changes):
    return Query(**(dict(scope=content.scope, operation="search", top_k=20, token_budget=4000,
                         deadline=datetime.now(timezone.utc) + timedelta(seconds=30)) | changes))


def candidate(content, document, kind="manuscript", **changes):
    row = next(r for r in content.rows if r.version.document_id == document)
    return Evidence(**(dict(id="hit-" + document, retrieval_type=kind, source_backend="synthetic-" + kind,
                            is_mock=True, retrieved_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                            work_id=row.version.work_id, fork_id=row.version.work_id if document == "f3" else None,
                            document_id=document, source_revision=row.version, content=row.text,
                            source_span=(0, len(row.text.encode("utf-16-le")) // 2),
                            source_hash=sha256(row.text.encode("utf-8")).hexdigest(),
                            as_of_episode=row.episode, canonical_status="verified_source",
                            known_by=row.known_by, visible_from=row.episode,
                            evidence_refs=(), retrieval_score=1, score_kind="rank") | changes))


@pytest.fixture
def manuscripts(content):
    return tuple(candidate(content, row.version.document_id) for row in content.rows)


@pytest.fixture
def wiki(content, story):
    return tuple(candidate(content, node["ref"], "wiki", id=node["id"], scene_id=node.get("scene_id"),
                           entity_ids=tuple(node.get("entity_ids", ())),
                           fact_or_relation=json.dumps({k: node[k] for k in ("kind", "fact", "actor") if k in node}, ensure_ascii=False),
                           evidence_refs=(node["caused_by"],) if "caused_by" in node else ()) for node in story["wiki"])


@pytest.fixture
def graph(content, story):
    binding = story["relationship_binding"]
    relation = story["relationship"][0]
    return MockRelationshipGraph(scope=content.scope, graph_version=binding["graph_version"],
                                 allowed_entity_ids=frozenset(binding["allowed_entity_ids"]),
                                 relationships=(Relationship(**{k: relation[k] for k in ("id", "source", "target", "label", "directed")}),
                                                Relationship(id="rel2", source="lina", target="kai", label="신뢰", directed=True)))


@pytest.fixture
def templates(story):
    item = story["template"][0]
    return (Template(**item),
            Template(id="revoked", revision="r1", name="철회된 비밀 템플릿", license_ref="demo_allowed",
                     language="ko", genre="fantasy", public=True, license_active=False),
            Template(id="private-template", revision="r1", name="비공개 템플릿", license_ref="demo_allowed",
                     language="ko", genre="fantasy", public=False, license_active=True))


def ports(content, manuscripts, wiki, graph, templates):
    return (RelationshipGraphRetriever(content, graph), EpisodeWikiRetriever(content, wiki),
            ManuscriptVectorRetriever(content, manuscripts))


def test_three_real_mock_ports_share_return_contract(content, manuscripts, wiki, graph, templates):
    for port in ports(content, manuscripts, wiki, graph, templates):
        first, second = run(port, query(content)), run(port, query(content))
        assert isinstance(first, RetrievalResult) and first.status == "ok" and first.evidence
        assert first.is_mock and all(e.is_mock for e in first.evidence)
        assert first == RetrievalResult.model_validate_json(first.model_dump_json())
        assert [(e.id, e.source_revision, e.source_span, e.content) for e in first.evidence] == [
            (e.id, e.source_revision, e.source_span, e.content) for e in second.evidence]


@pytest.mark.parametrize("failure", ["revoked", "substituted", "expired", "timeout"])
def test_all_ports_revalidate_grants_and_transport(content, manuscripts, wiki, graph, templates, failure):
    adapters = ports(content, manuscripts, wiki, graph, templates)
    request = query(content)
    if failure == "revoked":
        content.active = False
    elif failure == "substituted":
        request = query(content, scope=replace(content.scope, subject_ref="intruder"))
    elif failure == "expired":
        content.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    else:
        content.manifest = Mock(side_effect=TimeoutError("must never be logged"))
    for port in adapters:
        result = run(port, request)
        assert result.status == ("unavailable" if failure == "timeout" else "denied")
        assert result.is_mock and not result.evidence
        assert "must never be logged" not in result.model_dump_json()


def test_relationship_preserves_direction_and_labels(content, graph):
    result = run(RelationshipGraphRetriever(content, graph), query(content))
    relations = [json.loads(e.fact_or_relation) for e in result.evidence]
    assert [(r["source"], r["target"], r["label"], r["directed"]) for r in relations] == [
        ("kai", "lina", "동료", False), ("lina", "kai", "신뢰", True)]
    assert all(e.source_revision.revision == "7" and e.as_of_episode is None for e in result.evidence)


@pytest.mark.parametrize("changes", [{"operation": "history"}, {"operation": "snapshot"}, {"episode_range": (1, 2)}])
def test_relationship_history_is_unsupported(content, graph, changes):
    result = run(RelationshipGraphRetriever(content, graph), query(content, **changes))
    assert result.status == "unsupported" and not result.evidence


def test_relationship_needs_explicit_binding_and_owner(content, graph):
    assert run(RelationshipGraphRetriever(content, None), query(content)).status == "unsupported"
    content.scope = replace(content.scope, audience="reader")
    assert run(RelationshipGraphRetriever(content, graph), query(content)).status == "denied"


def test_relationship_wrong_endpoint_is_quarantined(content, graph):
    graph.relationships += (Relationship(id="bad", source="kai", target="foreign-secret", label="비밀", directed=True),)
    result = run(RelationshipGraphRetriever(content, graph), query(content))
    assert result.status == "denied" and not result.evidence
    assert "foreign-secret" not in result.model_dump_json()


def test_relationship_incomplete_or_timed_out(content, graph):
    port = RelationshipGraphRetriever(content, graph)
    graph.complete = False
    assert run(port, query(content)).status == "unavailable"
    graph.complete = True
    port.failure = "timeout"
    assert run(port, query(content)).status == "unavailable"


@pytest.mark.parametrize("port_type,kind", [(EpisodeWikiRetriever, "wiki"), (ManuscriptVectorRetriever, "manuscript")])
def test_source_prefilter_blocks_private_future_and_other_forks(content, caplog, port_type, kind):
    content.scope = replace(content.scope, audience="reader")
    hits = tuple(candidate(content, r.version.document_id, kind) for r in content.rows)
    result = run(port_type(content, hits), query(content))
    assert result.status == "ok"
    assert {e.document_id for e in result.evidence} == {"m1", "m2", "m3", "unicode"}
    payload = result.model_dump_json() + caplog.text
    for secret in ("비공개 암호는", "다른 작품의 비밀", "카이는 떠났다", "나중에 암호를 배운다"):
        assert secret not in payload


def test_wiki_character_knowledge_and_causal_path(content, wiki):
    result = run(EpisodeWikiRetriever(content, wiki), query(content))
    assert [e.id for e in result.evidence] == ["e1", "e2", "e3"]
    assert result.evidence[2].evidence_refs == ("e2",)
    assert json.loads(result.evidence[1].fact_or_relation)["kind"] == "learns"
    content.scope = replace(content.scope, audience="character", character_id="kai")
    restricted = run(EpisodeWikiRetriever(content, wiki), query(content))
    assert {e.id for e in restricted.evidence} == {"e1"}
    assert all("e2" not in e.evidence_refs for e in restricted.evidence)
    assert "password" not in restricted.model_dump_json()


def test_wiki_missing_and_stale_dependencies_do_not_survive(content, wiki):
    missing = run(EpisodeWikiRetriever(content, tuple(e for e in wiki if e.id != "e2")), query(content))
    assert missing.status == "partial" and {e.id for e in missing.evidence} == {"e1"}
    assert any(g.code == "missing" for g in missing.gaps)
    stale_e2 = wiki[1].model_copy(update={"source_revision": replace(wiki[1].source_revision, revision="old2")})
    stale = run(EpisodeWikiRetriever(content, (wiki[0], stale_e2, wiki[2])), query(content))
    assert stale.status == "partial" and {e.id for e in stale.evidence} == {"e1"}
    assert any(g.code == "stale" for g in stale.gaps)


def test_manuscript_stale_revision_and_empty_are_distinct(content):
    hit = candidate(content, "m2")
    stale = hit.model_copy(update={"source_revision": replace(hit.source_revision, revision="old2")})
    assert run(ManuscriptVectorRetriever(content, (stale,)), query(content)).gaps[0].code == "stale"
    empty = run(ManuscriptVectorRetriever(content, (hit,)), query(content, query_text="존재하지 않는 단어"))
    assert empty.status == "ok" and not empty.evidence


def test_manuscript_exact_spans_and_no_cross_episode_overlap(content):
    hit = candidate(content, "m2")
    good = run(ManuscriptVectorRetriever(content, (hit,)), query(content, episode_range=(2, 2), document_ids=("m2",)))
    assert good.evidence[0].source_span == (0, 12) and good.evidence[0].content == "리나만 암호를 들었다."
    bad = hit.model_copy(update={"source_span": (0, 20)})
    result = run(ManuscriptVectorRetriever(content, (hit, bad)), query(content))
    assert result.status == "denied" and not result.evidence


def test_manuscript_fork_checkpoint_revision(content, manuscripts):
    content.scope = replace(content.scope, work_id="f1", fork_id="f1")
    content.inherited = frozenset(r.version for r in content.rows if r.version.document_id in ("m1", "m2"))
    result = run(ManuscriptVectorRetriever(content, manuscripts), query(content))
    assert {e.document_id for e in result.evidence} == {"m1", "m2", "f3"}


@pytest.mark.parametrize("port_type", [EpisodeWikiRetriever, ManuscriptVectorRetriever])
def test_cache_contamination_and_revocation_never_reuse_old_payload(content, port_type):
    hit = candidate(content, "m1", "wiki" if port_type is EpisodeWikiRetriever else "manuscript")
    port = port_type(content, (hit,))
    assert run(port, query(content)).evidence
    poisoned = hit.model_copy(update={"content": "다른 사용자의 비밀"})
    port.candidates = (poisoned,)
    result = run(port, query(content))
    assert "다른 사용자의 비밀" not in result.model_dump_json()
    port.candidates = (hit.model_copy(update={"work_id": "other-work"}),)
    result = run(port, query(content))
    assert result.status == "denied" and not result.evidence
    content.active = False
    port.candidates = (hit,)
    assert run(port, query(content)).status == "denied"


def test_templates_filter_license_language_genre_and_catalog_scope(content, templates):
    port = TemplateCatalog(content, templates, frozenset({"demo_allowed"}))
    result = run(port, query(content, language="ko", genre="fantasy"))
    assert [e.template_id for e in result.evidence] == ["magic1"]
    item = result.evidence[0]
    assert not {"work_id", "fork_id", "document_id"}.intersection(item.model_dump())
    assert item.license_ref == "demo_allowed" and item.catalog_revision == "t2"
    assert not run(port, query(content, language="en")).evidence
    assert not run(port, query(content, genre="horror")).evidence
    assert not run(TemplateCatalog(content, templates, frozenset()), query(content)).evidence


def test_template_revocation_after_success_has_no_cache_leak(content, templates, caplog):
    port = TemplateCatalog(content, templates, frozenset({"demo_allowed"}))
    assert run(port, query(content)).evidence
    port.templates = (templates[0].model_copy(update={"license_active": False}),)
    result = run(port, query(content))
    assert result.status == "ok" and not result.evidence
    assert "대가가 있는 마법" not in result.model_dump_json() + caplog.text


@pytest.mark.parametrize("operation", ["unknown", "apply"])
def test_unsupported_operations_cannot_apply_mock_evidence(content, manuscripts, wiki, graph, templates, operation):
    for port in ports(content, manuscripts, wiki, graph, templates):
        result = run(port, query(content, operation=operation))
        assert result.status == "unsupported" and not result.evidence


def test_timeouts_and_limits_are_explicit(content, manuscripts, wiki, graph, templates):
    for port in ports(content, manuscripts, wiki, graph, templates):
        port.failure = "timeout"
        assert run(port, query(content)).status == "unavailable"
        port.failure = None
        assert run(port, query(content, deadline=datetime.now(timezone.utc) - timedelta(seconds=1))).status == "unavailable"
        assert len(run(port, query(content, top_k=1)).evidence) == 1
        small = run(port, query(content, token_budget=1))
        assert small.status == "partial" and not small.evidence


def test_manuscript_prefilters_document_kind_and_episode_before_read(content, manuscripts):
    port = ManuscriptVectorRetriever(content, manuscripts)
    original = content.read
    content.read = Mock(side_effect=original)
    result = run(port, query(content, document_ids=("m2",), episode_range=(2, 2), source_kinds=("manuscript",)))
    assert [e.document_id for e in result.evidence] == ["m2"]
    assert [call.args[1].document_id for call in content.read.call_args_list] == ["m2"]


def test_templates_recheck_revocation_during_return(content, templates):
    port = TemplateCatalog(content, templates, frozenset({"demo_allowed"}))
    original = content.manifest
    calls = 0

    def revoke(scope):
        nonlocal calls
        calls += 1
        if calls == 2:
            port.templates = (templates[0].model_copy(update={"license_active": False}),)
        return original(scope)

    content.manifest = revoke
    result = run(port, query(content))
    assert result.status == "denied" and not result.evidence


def test_all_ports_recheck_grant_at_return(content, manuscripts, wiki, graph, templates):
    for port in ports(content, manuscripts, wiki, graph, templates):
        content.active = True
        original = MockContentReadPort.manifest
        calls = 0

        def revoke(scope):
            nonlocal calls
            calls += 1
            if calls == 2:
                content.active = False
            return original(content, scope)

        content.manifest = revoke
        result = run(port, query(content))
        assert result.status == "denied" and not result.evidence


def test_wiki_scene_and_foreshadow_keep_revision_and_reference(content, wiki):
    scene = candidate(content, "m1", "wiki", id="scene1", scene_id="scene-1",
                      fact_or_relation='{"kind":"scene"}', evidence_refs=("e1",))
    plot = candidate(content, "m3", "wiki", id="plot1", scene_id="scene-3",
                     canonical_status="inferred", fact_or_relation='{"kind":"plot_point"}', evidence_refs=("e1", "e3"))
    result = run(EpisodeWikiRetriever(content, wiki + (scene, plot)), query(content))
    found = {e.id: e for e in result.evidence}
    assert found["scene1"].scene_id == "scene-1" and found["scene1"].source_revision.revision == "r1"
    assert found["plot1"].evidence_refs == ("e1", "e3") and found["plot1"].canonical_status == "inferred"


def test_expired_template_and_cross_subject_never_reuse_catalog_results(content, templates):
    expired = templates[0].model_copy(update={"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)})
    port = TemplateCatalog(content, (expired,), frozenset({"demo_allowed"}))
    assert not run(port, query(content)).evidence
    port.templates = templates
    assert run(port, query(content)).evidence
    foreign = query(content, scope=replace(content.scope, grant_ref="another-grant", subject_ref="another-author"))
    assert run(port, foreign).status == "denied"


def test_relationship_cas_change_at_return_discards_all_evidence(content, graph):
    original = content.manifest
    calls = 0

    def change(scope):
        nonlocal calls
        calls += 1
        if calls == 2:
            graph.graph_version = "8"
        return original(scope)

    content.manifest = change
    result = run(RelationshipGraphRetriever(content, graph), query(content))
    assert result.status == "denied" and not result.evidence


def test_three_ports_make_no_network_calls(content, manuscripts, wiki, graph, templates, monkeypatch):
    network = Mock(side_effect=AssertionError("외부 provider 호출 금지"))
    monkeypatch.setattr("socket.socket", network)
    monkeypatch.setattr("socket.create_connection", network)
    for port in ports(content, manuscripts, wiki, graph, templates):
        assert run(port, query(content)).status == "ok"
    network.assert_not_called()


def test_wiki_filters_entity_without_exposing_other_character(content, wiki):
    result = run(EpisodeWikiRetriever(content, wiki), query(content, entity_ids=("lina",)))
    assert [e.id for e in result.evidence] == ["e2", "e3"]
    empty = run(EpisodeWikiRetriever(content, wiki), query(content, query_text="없는 문구"))
    assert empty.status == "ok" and not empty.evidence


def test_wiki_missing_gaps_only_cover_requested_episodes(content, wiki):
    result = run(EpisodeWikiRetriever(content, (wiki[1],)), query(content, episode_range=(2, 2)))
    assert result.status == "ok" and [e.id for e in result.evidence] == ["e2"]
    assert not result.gaps


def test_required_fields_are_explicit_and_unknown_fields_unsupported(content, manuscripts):
    port = ManuscriptVectorRetriever(content, manuscripts)
    assert run(port, query(content, required_fields=("invented",))).status == "unsupported"
    missing = run(port, query(content, required_fields=("scene_id",)))
    assert missing.status == "partial" and not missing.evidence


def test_manuscript_does_not_substitute_mock_for_real_evidence(content):
    original = content.read

    def real(scope, version, span):
        return replace(original(scope, version, span), is_mock=False)

    content.read = real
    result = run(ManuscriptVectorRetriever(content, (candidate(content, "m1"),)), query(content))
    assert result.status == "denied" and not result.evidence
