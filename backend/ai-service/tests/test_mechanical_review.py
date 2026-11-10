"""수치·명칭·중복·제한 맞춤법의 읽기 전용 Mechanical 수용 단위 테스트."""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.agents.review import (MechanicalReviewHandler, NameCheck, NumberCheck, ReviewRequest,
                               SpellingRule, mechanical_review)
from app.agents.story_context import ExactSource
from app.retrieval.content_client import CanonicalAdapter, Scope, SourceVersion, utf16_quote
from app.retrieval.mock_content import MockContentReadPort, MockRow
from app.runs.orchestrator import REGISTRY
from test_mock_retrievers import query


@pytest.fixture
def review_content():
    scope = Scope("fixture-grant", "author", "w1", None, 5, "owner", None, "review", "manifest-5")
    values = (("m5", "manuscript", "😀카의 나이는 18세. 아주 아주 됬다."),
              ("name", "setting", "카이"), ("alias", "setting", "카"), ("age", "setting", "17"))
    rows = tuple(MockRow(SourceVersion("w1", kind, id, "r5"), text, 5, True, ("kai",))
                 for id, kind, text in values)
    return MockContentReadPort(scope, rows, (5,), frozenset(r.version for r in rows), frozenset(),
                               datetime.now(timezone.utc) + timedelta(minutes=5))


def source(content, document):
    row = next(r for r in content.rows if r.version.document_id == document)
    return ExactSource(version=row.version, span=(0, len(row.text.encode("utf-16-le")) // 2),
                       source_hash=sha256(row.text.encode()).hexdigest())


@pytest.mark.parametrize("document", ["m5", "name", "age"])
def test_whitespace_target_or_standard_is_partial_not_denied(review_content, document):
    review_content.rows = tuple(replace(row, text=" " * len(row.text))
        if row.version.document_id == document else row for row in review_content.rows)
    if document == "m5":
        req = ReviewRequest(query=query(review_content), target=source(review_content, "m5"),
                            check_types=("repetition",))
    else:
        req = request(review_content)
    result = run(review_content, req)
    assert result.status == "partial" and not result.complete
    assert any(g.code == "unverified" for g in result.gaps)
    assert not any(f.confirmed_or_suspected == "confirmed" for f in result.findings)


def span(content, text):
    original = content.rows[0].text
    start = original.index(text)
    return (len(original[:start].encode("utf-16-le")) // 2,
            len(original[:start + len(text)].encode("utf-16-le")) // 2)


def request(content, **changes):
    return ReviewRequest(**(dict(query=query(content), target=source(content, "m5"),
        check_types=("names", "numbers", "repetition", "spelling"),
        names=(NameCheck(span=span(content, "카의"), canonical=source(content, "name"), aliases=(source(content, "alias"),)),),
        numbers=(NumberCheck(span=span(content, "18"), expected=source(content, "age"), basis_episode=5),),
        spelling_rules=(SpellingRule(wrong="됬다", correction="됐다"),)) | changes))


def run(content, req=None):
    return asyncio.run(REGISTRY["mechanical"].handler(req or request(content), content=content))


def test_registry_uses_mechanical_handler():
    assert REGISTRY["mechanical"].handler is mechanical_review
    assert REGISTRY["mechanical"].model_cap == 0


def test_rule_findings_have_verified_revisions_utf16_hash_and_evidence(review_content):
    result = run(review_content)
    assert result.status == "ok" and result.is_mock
    assert {f.issue_type for f in result.findings} == {"name_variant", "number_mismatch", "repeated_word", "spelling_candidate"}
    evidence = {e.id: e for e in result.sources}
    for finding in result.findings:
        location = finding.target_location
        assert location.version == review_content.rows[0].version
        quote = utf16_quote(review_content.rows[0].text, location.span)
        assert location.quote == quote and location.source_hash == sha256(quote.encode()).hexdigest()
        assert all(ref in evidence for ref in finding.evidence_refs)
    numeric = next(f for f in result.findings if f.issue_type == "number_mismatch")
    assert numeric.confirmed_or_suspected == "confirmed" and numeric.suggested_fix == "17"
    assert len(numeric.evidence_refs) == 2


def test_scenario_f_only_numbers_and_names_has_no_semantic_or_other_checks(review_content, monkeypatch):
    from app.runs import orchestrator
    model = AsyncMock(side_effect=AssertionError("model must not run"))
    simulation = AsyncMock(side_effect=AssertionError("simulation must not run"))
    monkeypatch.setattr("app.runs.runner.CallContext.call_model", model)
    monkeypatch.setattr(orchestrator, "REGISTRY", {**REGISTRY,
        "simulation": replace(REGISTRY["simulation"], handler=simulation)})
    before = review_content.rows
    result = run(review_content, request(review_content, check_types=("numbers", "names")))
    assert {f.issue_type for f in result.findings} == {"number_mismatch", "name_variant"}
    assert result.checked_types == ("numbers", "names") and review_content.rows == before
    model.assert_not_called()
    simulation.assert_not_called()


@pytest.mark.parametrize("check_type", ["names", "numbers", "repetition", "spelling"])
def test_each_requested_check_is_isolated(review_content, check_type):
    result = run(review_content, request(review_content, check_types=(check_type,)))
    expected = dict(names="name_variant", numbers="number_mismatch", repetition="repeated_word", spelling="spelling_candidate")
    assert len(result.findings) == 1 and result.findings[0].issue_type == expected[check_type]


def test_registered_name_and_alias_are_not_errors(review_content):
    for name in ("카이", "카"):
        content = replace(review_content, rows=(replace(review_content.rows[0], text=name), *review_content.rows[1:]))
        req = ReviewRequest(query=query(content), target=source(content, "m5"), check_types=("names",),
            names=(NameCheck(span=(0, len(name)), canonical=source(content, "name"), aliases=(source(content, "alias"),)),))
        result = run(content, req)
        assert result.status == "ok" and not result.findings


def test_unknown_name_dialect_and_emphasis_remain_suspected_and_do_not_edit(review_content):
    before = review_content.rows
    result = run(review_content)
    assert all(f.confirmed_or_suspected == "suspected" for f in result.findings if f.issue_type != "number_mismatch")
    assert review_content.rows == before
    req = request(review_content, check_types=("names",), names=(NameCheck(span=span(review_content, "카의")),))
    unknown = run(review_content, req).findings[0]
    assert unknown.confirmed_or_suspected == "suspected" and unknown.suggested_fix is None


def test_number_without_matching_time_basis_is_suspected(review_content):
    req = request(review_content, check_types=("numbers",), numbers=(NumberCheck(
        span=span(review_content, "18"), expected=source(review_content, "age"), basis_episode=4),))
    finding = run(review_content, req).findings[0]
    assert finding.confirmed_or_suspected == "suspected" and finding.suggested_fix is None


def test_no_findings_is_success_and_is_distinct_from_read_failure(review_content):
    row = replace(review_content.rows[0], text="안녕하세요.")
    review_content.rows = (row, *review_content.rows[1:])
    req = ReviewRequest(query=query(review_content), target=source(review_content, "m5"), check_types=("repetition", "spelling"))
    result = run(review_content, req)
    assert result.status == "ok" and not result.findings
    review_content.active = False
    failed = run(review_content, req)
    assert failed.status == "denied" and not failed.findings and not failed.sources


@pytest.mark.parametrize("failure", ["hash", "revision", "split_surrogate", "fork", "future", "private", "knowledge"])
def test_unverified_target_cannot_return_findings_or_payload(review_content, failure):
    req = request(review_content)
    if failure == "hash":
        req = req.model_copy(update={"target": req.target.model_copy(update={"source_hash": "0" * 64})})
    elif failure == "revision":
        req = req.model_copy(update={"target": req.target.model_copy(update={"version": replace(req.target.version, revision="old")})})
    elif failure == "split_surrogate":
        req = request(review_content, check_types=("names",), names=(NameCheck(span=(0, 1)),))
    elif failure in ("fork", "future", "private", "knowledge"):
        row = review_content.rows[0]
        if failure == "fork":
            changed = replace(row, version=replace(row.version, work_id="other-fork"))
        elif failure == "future":
            changed = replace(row, episode=6)
        elif failure == "private":
            changed = replace(row, public=False)
            review_content.scope = replace(review_content.scope, audience="reader")
        else:
            changed = replace(row, known_by=("lina",))
            review_content.scope = replace(review_content.scope, audience="character", character_id="kai")
        review_content.rows = (changed, *review_content.rows[1:])
        review_content.pinned = frozenset(r.version for r in review_content.rows)
        req = request(review_content)
    result = run(review_content, req)
    assert result.status == "denied" and not result.findings and not result.sources


def test_deadline_is_timeout_and_has_no_findings(review_content):
    req = request(review_content).model_copy(update={"query": query(review_content,
        deadline=datetime.now(timezone.utc) - timedelta(seconds=1))})
    result = run(review_content, req)
    assert result.status == "timeout" and not result.findings


def test_mechanical_request_rejects_semantic_checks_and_outside_spans(review_content):
    with pytest.raises(ValidationError):
        request(review_content, check_types=("semantic",))
    with pytest.raises(ValidationError):
        request(review_content, numbers=(NumberCheck(span=(999, 1000)),))


def test_finding_ids_are_stable_and_original_is_unchanged(review_content):
    assert run(review_content).findings == run(review_content).findings


@pytest.mark.parametrize("types,confirmed", [(("numbers",), True), (("repetition",), False), (("names",), False)])
def test_taskrunner_reports_confirmed_facts_without_any_model_budget(review_content, types, confirmed):
    from test_task_graph import task
    from app.runs.runner import TaskOutput, TaskRunner
    root = task(review_content.scope, "context", "context")
    mechanical = task(review_content.scope, "mechanical", "mechanical", (root,))
    handler = MechanicalReviewHandler(request(review_content, check_types=types), content=review_content)
    async def context_handler(slice, ctx):
        return TaskOutput(output_schema="ContextPacket.v1", output_ref="context:5", is_mock=True)
    runner = TaskRunner("run5", (root, mechanical), scope=review_content.scope,
        manifest=CanonicalAdapter(review_content).manifest(review_content.scope),
        allowed_operations=("context", "mechanical"), handlers={"context": context_handler, "mechanical": handler})
    result = asyncio.run(runner.run())
    assert result.status == "succeeded" and result.accounted.model_calls == 0
    assert result.results[-1].facts.has_confirmed_findings is confirmed
    assert not result.results[-1].facts.simulation_required
    assert handler.findings.status == "ok" and result.results[-1].output_ref == "findings:run5:mechanical"
    assert "나이는" not in result.model_dump_json()


def test_an_older_age_source_does_not_establish_current_age(review_content):
    review_content.rows = tuple(replace(r, episode=4) if r.version.document_id == "age" else r
                                for r in review_content.rows)
    review_content.expected_episodes = (4, 5)
    result = run(review_content, request(review_content, check_types=("numbers",)))
    assert result.status == "partial"
    assert result.findings[0].confirmed_or_suspected == "suspected"
    assert result.findings[0].suggested_fix is None


@pytest.mark.parametrize("original,standard,expected", [
    ("1,000", "1000.0", "equal"), ("-0", "0", "equal"),
    ("0.1", "0.10", "equal"), ("1,2", "12", "suspected"),
    ("열여덟", "17", "suspected"), ("18세", "17", "suspected"),
    ("100000000000000000001", "100000000000000000000", "confirmed"),
])
def test_numeric_notation_is_decimal_and_does_not_guess_units(review_content, original, standard, expected):
    review_content.rows = tuple(replace(r, text=original) if r.version.document_id == "m5" else
                                replace(r, text=standard) if r.version.document_id == "age" else r
                                for r in review_content.rows)
    req = ReviewRequest(query=query(review_content), target=source(review_content, "m5"), check_types=("numbers",),
        numbers=(NumberCheck(span=(0, len(original)), expected=source(review_content, "age"), basis_episode=5),))
    result = run(review_content, req)
    if expected == "equal":
        assert result.status == "ok" and not result.findings
    else:
        assert result.findings[0].confirmed_or_suspected == expected


def test_disabled_checks_do_not_read_their_references(review_content):
    req = request(review_content, check_types=("repetition",), numbers=(NumberCheck(
        span=span(review_content, "18"), expected=source(review_content, "age").model_copy(update={"source_hash": "0" * 64})),))
    result = run(review_content, req)
    assert result.status == "ok" and len(result.sources) == 1


def test_selected_subspan_uses_absolute_utf16_offsets_and_keeps_outside_text(review_content):
    original = "😀앞부분. 아주 아주 아주. 뒷부분."
    review_content.rows = (replace(review_content.rows[0], text=original), *review_content.rows[1:])
    selected = span(review_content, "아주 아주 아주")
    text = utf16_quote(original, selected)
    target = source(review_content, "m5").model_copy(update={"span": selected, "source_hash": sha256(text.encode()).hexdigest()})
    req = ReviewRequest(query=query(review_content), target=target, check_types=("repetition",))
    result = run(review_content, req)
    assert result.status == "ok" and len(result.findings) == 2
    assert all(f.target_location.span[0] >= selected[0] for f in result.findings)
    assert review_content.rows[0].text == original


def test_unverified_standard_never_returns_partial_payload(review_content):
    req = request(review_content, check_types=("numbers",), numbers=(NumberCheck(
        span=span(review_content, "18"), expected=source(review_content, "age").model_copy(update={"source_hash": "0" * 64}), basis_episode=5),))
    result = run(review_content, req)
    assert result.status == "denied" and not result.findings and not result.sources


def test_future_standard_cannot_be_used_for_earlier_manuscript(review_content):
    review_content.rows = (replace(review_content.rows[0], episode=4), *review_content.rows[1:])
    review_content.expected_episodes = (4, 5)
    result = run(review_content, request(review_content, check_types=("numbers",)))
    assert result.status == "denied" and not result.findings and not result.sources


def test_checktypes_camelcase_and_unknown_number_are_explicit(review_content):
    req = ReviewRequest.model_validate({"query": query(review_content), "target": source(review_content, "m5"),
                                       "checkTypes": ("numbers",), "numbers": ({"span": span(review_content, "18")},)})
    result = run(review_content, req)
    assert result.status == "partial" and result.findings[0].confirmed_or_suspected == "suspected"


def test_real_content_port_is_unsupported_instead_of_mock_success(review_content):
    result = asyncio.run(mechanical_review(request(review_content), content=object()))
    assert result.status == "unsupported" and not result.is_mock and not result.findings


def test_content_transport_failure_is_timeout_not_clean_report(review_content, monkeypatch):
    def unavailable(*args):
        raise OSError("must never be returned")
    monkeypatch.setattr(review_content, "read", unavailable)
    result = run(review_content)
    assert result.status == "timeout" and not result.findings and not result.sources
    assert "must never" not in result.model_dump_json()


def test_revocation_during_check_discards_findings_and_sources(review_content, monkeypatch):
    original = review_content.read
    def revoke(scope, version, selected_span):
        result = original(scope, version, selected_span)
        if version.document_id == "age":
            review_content.active = False
        return result
    monkeypatch.setattr(review_content, "read", revoke)
    result = run(review_content)
    assert result.status == "denied" and not result.findings and not result.sources
