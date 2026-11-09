"""Content가 위임한 범위와 정본 재검증의 단위 계약."""

from dataclasses import asdict, replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import Mock

import pytest

from app.retrieval.content_client import (
    CanonicalAdapter, ContentReadError, Scope, SourceVersion,
    VerifiedSource,
)
from app.retrieval.mock_content import MockContentReadPort, MockRow


def source(work="original", kind="manuscript", doc="chapter", revision="r1"):
    return SourceVersion(work_id=work, kind=kind, document_id=doc, revision=revision)


CHAPTER = source()
DRAFT = source(kind="draft")
SECRET = source(kind="setting", doc="password")
FUTURE = source(doc="later")
OTHER_FORK = source(work="fork-b")
NEW_EDITION = source(revision="r2")
RELATION = source(kind="relationship")


def fake_content(audience="reader", fork=None):
    scope = Scope(grant_ref="grant", subject_ref="member", work_id=fork or "original",
                  fork_id=fork, basis_episode=2, audience=audience,
                  character_id="kai" if audience == "character" else None,
                  purpose="quote", manifest_ref="manifest")
    rows = (MockRow(CHAPTER, "가🌙나", 1, public=True, known_by=("kai",)),
            MockRow(DRAFT, "초안", 2), MockRow(SECRET, "암호", 2, public=True, known_by=("lina",)),
            MockRow(FUTURE, "미래", 3, public=True), MockRow(OTHER_FORK, "다른 분기", 1, public=True),
            MockRow(NEW_EDITION, "다른 판", 1, public=True))
    return MockContentReadPort(scope, rows, expected_episodes=(1, 2),
                               pinned=frozenset({CHAPTER, DRAFT, SECRET, FUTURE, OTHER_FORK}),
                               inherited=frozenset({CHAPTER}) if fork else frozenset(),
                               expires_at=datetime.now(timezone.utc) + timedelta(minutes=1))


@pytest.mark.parametrize(("audience", "allowed"), [
    ("owner", {CHAPTER, DRAFT, SECRET}), ("reader", {CHAPTER, SECRET}), ("character", {CHAPTER}),
])
def test_only_scoped_versions_reach_search_and_model(audience, allowed):
    content = fake_content(audience)
    adapter = CanonicalAdapter(content)
    search_input = adapter.manifest(content.scope)
    assert set(search_input.source_versions) == allowed
    model_input = [adapter.read(content.scope, version) for version in search_input.source_versions]
    assert {result.version for result in model_input} == allowed
    assert all(result.is_mock for result in model_input)
    for result in model_input:
        assert set(asdict(result)) == {"version", "span", "text", "is_mock"}
    for forbidden in {CHAPTER, DRAFT, SECRET, FUTURE, OTHER_FORK, NEW_EDITION} - allowed:
        with pytest.raises(ContentReadError, match="^denied$"):
            adapter.read(content.scope, forbidden)


@pytest.mark.parametrize("change", [
    {"subject_ref": "other"}, {"grant_ref": "unknown"}, {"grant_ref": ""},
    {"manifest_ref": "old"}, {"basis_episode": 3}, {"audience": "owner"},
    {"character_id": "lina"}, {"purpose": "edit"}, {"world_id": "studio"},
    {"work_id": "fork-b", "fork_id": "fork-b"}, {"fork_id": "fork-b"},
])
def test_scope_substitution_fails_before_lookup(change):
    content = fake_content()
    adapter = CanonicalAdapter(content)
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.manifest(replace(content.scope, **change))


def test_fork_only_inherits_its_checkpoint_revision():
    content = fake_content(fork="fork-a")
    content.pinned |= {NEW_EDITION}
    assert CanonicalAdapter(content).manifest(content.scope).source_versions == (CHAPTER,)


def test_recheck_after_search_and_before_returning_text():
    content = fake_content()
    adapter = CanonicalAdapter(content)
    version = adapter.manifest(content.scope).source_versions[0]
    content.active = False
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.read(content.scope, version)


def test_exact_quote_uses_original_utf16_offsets_and_utf8_digest():
    content = fake_content()
    digest = sha256("🌙".encode()).hexdigest()
    result = CanonicalAdapter(content).read(content.scope, CHAPTER, (1, 3), digest)
    assert result.text == "🌙"
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(content).read(content.scope, CHAPTER, (1, 3), "bad-hash")


@pytest.mark.parametrize("span", [(1, 2), (2, 3), (3, 5), (-1, 1), (3, 2), (1, 1)])
def test_invalid_or_split_utf16_span_is_rejected(span):
    content = fake_content()
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(content).read(content.scope, CHAPTER, span)


def test_wrong_source_or_span_from_transport_does_not_reach_consumer():
    content = fake_content()
    adapter = CanonicalAdapter(content)
    for version, span in [(OTHER_FORK, (1, 3)), (CHAPTER, None)]:
        content.read = Mock(return_value=VerifiedSource(version=version, span=span,
                                                        text="타 문맥", is_mock=True))
        with pytest.raises(ContentReadError, match="^denied$"):
            adapter.read(content.scope, CHAPTER, (1, 3))


def test_relationship_without_mapping_and_transport_failure_are_distinct():
    content = fake_content()
    adapter = CanonicalAdapter(content)
    with pytest.raises(ContentReadError, match="^unsupported$"):
        adapter.read(content.scope, RELATION)
    content.manifest = Mock(side_effect=TimeoutError)
    with pytest.raises(ContentReadError, match="^unavailable$"):
        adapter.read(content.scope, CHAPTER)


def test_expired_grant_and_wrong_manifest_are_rejected():
    content = fake_content()
    adapter = CanonicalAdapter(content)
    manifest = adapter.manifest(content.scope)
    content.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.read(content.scope, CHAPTER)
    content.manifest = Mock(return_value=replace(manifest, scope_digest="wrong"))
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.manifest(content.scope)


def test_missing_scope_denied_before_contacting_content():
    port = Mock()
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(port).manifest(None)
    port.manifest.assert_not_called()


@pytest.mark.parametrize("change", [
    {"subject_ref": " "}, {"purpose": ""}, {"work_id": ""}, {"fork_id": "other"},
    {"basis_episode": 0}, {"audience": "unknown"}, {"audience": "character"},
    {"character_id": "kai"},
])
def test_even_issuer_cannot_use_an_incomplete_scope(change):
    content = fake_content()
    with pytest.raises(ContentReadError, match="^denied$"):
        content.scope = replace(content.scope, **change)
        CanonicalAdapter(content).manifest(content.scope)


def test_row_outside_approved_episodes_or_publication_window_is_hidden():
    content = fake_content()
    content.expected_episodes = (1,)
    assert SECRET not in CanonicalAdapter(content).manifest(content.scope).source_versions
    content.rows = (replace(content.rows[0], visible_to=1),)
    assert CanonicalAdapter(content).manifest(content.scope).source_versions == ()


def test_wrong_manifest_episode_cannot_be_sent_to_search():
    content = fake_content()
    content.expected_episodes = (1, 2, 3)
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(content).manifest(content.scope)


def test_unknown_target_kind_cannot_be_disclosed_even_if_pinned():
    content = fake_content()
    unknown = source(kind="unclassified")
    content.pinned |= {unknown}
    content.rows += (MockRow(unknown, "미분류 원문", 1, public=True),)
    adapter = CanonicalAdapter(content)
    assert unknown not in adapter.manifest(content.scope).source_versions
    with pytest.raises(ContentReadError, match="^denied$"):
        adapter.read(content.scope, unknown)


def test_private_source_is_not_inherited_by_fork_owner():
    content = fake_content("owner", "fork-a")
    content.inherited |= {DRAFT}
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(content).read(content.scope, DRAFT)


def test_bad_span_shape_denied_before_read():
    content = fake_content()
    content.read = Mock()
    with pytest.raises(ContentReadError, match="^denied$"):
        CanonicalAdapter(content).read(content.scope, CHAPTER, (0,))
    content.read.assert_not_called()
