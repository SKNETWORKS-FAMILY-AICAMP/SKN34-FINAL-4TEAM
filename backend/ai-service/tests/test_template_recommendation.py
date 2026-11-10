"""공개 허용 입력·카탈로그 권리·모델 선택 호출의 추천 수용 단위 계약."""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from test_mock_retrievers import content, story, templates, query
from app.agents.story_context import ExactSource
from app.agents.template_recommendation import (
    CatalogContext, ExistingTemplate, ImpactExplanation, ImpactResult, TemplateRecommendationHandler,
    TemplateRecommendationRequest, template_recommendation,
)
from app.retrieval.content_client import CanonicalAdapter, SourceVersion
from app.retrieval.mock_content import MockRow
from app.retrieval.templates import TemplateVectorRetriever
from app.runs.orchestrator import REGISTRY


def selected(content, document):
    row = next(r for r in content.rows if r.version.document_id == document)
    return ExactSource(version=row.version, span=(0, len(row.text.encode("utf-16-le")) // 2),
                       source_hash=sha256(row.text.encode()).hexdigest())


@pytest.fixture
def catalog_context(content):
    values = dict(language="ko", genre="fantasy", tag="마법", summary="마법 설정이 부족한 모험담",
                  existing_id="magic1", existing_version="t2", existing_tag="무대가")
    content.rows += tuple(MockRow(SourceVersion("w1", "setting", id, "p1"), text, 1, True, ("kai",))
                          for id, text in values.items())
    content.pinned = frozenset(r.version for r in content.rows)
    return CatalogContext(language=selected(content, "language"), genre=selected(content, "genre"),
                          tags=(selected(content, "tag"),), summary=selected(content, "summary"))


def port(content, templates):
    templates = tuple(t.model_copy(update={"purpose": "대가와 제약이 있는 마법 규칙 보완",
        "expected_change": "마법 사용 대가 설정 추가", "conflicts_with": ("무대가",)}) if t.id == "magic1" else t
        for t in templates)
    return TemplateVectorRetriever(content, templates, frozenset({"demo_allowed"}))


def request(content, context, **changes):
    return TemplateRecommendationRequest(**(dict(query=query(content), context=context) | changes))


def run(content, templates, context, *, req=None, retriever=None, model=None):
    return asyncio.run(REGISTRY["template"].handler(req or request(content, context), content=content,
                       retriever=retriever or port(content, templates), model=model))


def fake_model():
    return AsyncMock(explain=AsyncMock(return_value=ImpactResult(items=(ImpactExplanation(
        template_id="magic1", version="t2", explanation="마법 대가를 추가하면 기존 규칙을 다시 확인해야 합니다."),),
        input_tokens=20, output_tokens=10)))


def test_registry_connects_template_handler():
    assert REGISTRY["template"].handler is template_recommendation
    assert REGISTRY["template"].output_schema == "Recommendations.v1"


def test_scenario_e_deterministic_recommendations_have_purpose_evidence_and_version(content, templates, catalog_context):
    llm = fake_model()
    result = run(content, templates, catalog_context, model=llm)
    assert result.status == "ok" and result.is_mock and len(result.items) == 1
    item = result.items[0]
    assert (item.template_id, item.version, item.license_ref) == ("magic1", "t2", "demo_allowed")
    assert item.purpose and item.reason and item.expected_change and item.evidence_refs
    assert all(ref in {e.id for e in result.sources} for ref in item.evidence_refs)
    llm.explain.assert_not_called()


def test_private_query_and_manuscript_are_never_sent_to_catalog(content, templates, catalog_context):
    retriever = port(content, templates)
    retriever.search = AsyncMock(wraps=retriever.search)
    req = request(content, catalog_context, query=query(content, query_text="비공개 원고 전문 비밀",
        document_ids=("private",), entity_ids=("secret-character",), language="unknown", genre="unknown"))
    result = run(content, templates, catalog_context, req=req, retriever=retriever)
    assert result.status == "ok"
    sent = retriever.search.call_args.args[0]
    assert sent.query_text is None and sent.language == "ko" and sent.genre == "fantasy"
    assert not sent.document_ids and not sent.entity_ids and sent.episode_range is None
    assert retriever.search.call_args.kwargs["tags"] == ("마법",)
    assert "비공개 원고 전문" not in result.model_dump_json()


@pytest.mark.parametrize("kind", ["revoked", "expired", "license", "language", "genre", "private", "tag"])
def test_ineligible_catalog_items_never_appear(content, templates, catalog_context, kind):
    retriever = port(content, templates)
    item = retriever.templates[0]
    changes = dict(revoked={"license_active": False}, expired={"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)},
                   license={"license_ref": "not-owned"}, language={"language": "en"}, genre={"genre": "sf"},
                   private={"public": False}, tag={"tags": ("unrelated",)})[kind]
    retriever.templates = (item.model_copy(update=changes), *retriever.templates[1:])
    result = run(content, templates, catalog_context, retriever=retriever)
    assert result.status == "empty" and result.reason and not result.items
    assert not any(e.template_id for e in result.sources)


def test_duplicates_and_declared_conflicts_reference_content_evidence(content, templates, catalog_context):
    context = catalog_context.model_copy(update={"existing": (ExistingTemplate(
        template_id=selected(content, "existing_id"), version=selected(content, "existing_version")),),
        "existing_tags": (selected(content, "existing_tag"),)})
    result = run(content, templates, context)
    item = result.items[0]
    assert item.duplicate and item.conflicts == ("무대가",)
    assert item.existing_version == "t2" and len(item.evidence_refs) >= 4


def test_custom_explanation_is_opt_in_and_uses_only_public_approved_context(content, templates, catalog_context):
    llm = fake_model()
    req = request(content, catalog_context, customize=True, query=query(content, query_text="비공개 원고 전문"))
    result = run(content, templates, catalog_context, req=req, model=llm)
    assert result.status == "ok" and result.items[0].custom_explanation
    llm.explain.assert_awaited_once()
    payload = llm.explain.call_args.args[0].model_dump_json()
    assert "비공개 원고" not in payload and "synthetic-grant" not in payload
    assert "마법 설정이 부족한 모험담" in payload


def test_custom_request_without_model_is_partial_not_fake_success(content, templates, catalog_context):
    result = run(content, templates, catalog_context, req=request(content, catalog_context, customize=True))
    assert result.status == "partial" and result.gaps and result.items
    assert result.items[0].custom_explanation is None


def test_invalid_model_catalog_reference_is_not_accepted(content, templates, catalog_context):
    llm = fake_model()
    llm.explain.return_value = ImpactResult(items=(ImpactExplanation(template_id="revoked", version="r1", explanation="임의 항목"),),
                                           input_tokens=1, output_tokens=1)
    result = run(content, templates, catalog_context, req=request(content, catalog_context, customize=True), model=llm)
    assert result.status == "partial" and not result.items[0].custom_explanation
    assert "revoked" not in result.model_dump_json()


def test_revoked_during_model_call_is_removed_from_all_outputs(content, templates, catalog_context):
    retriever, llm = port(content, templates), fake_model()
    async def revoke(payload):
        retriever.templates = tuple(t.model_copy(update={"license_active": False}) for t in retriever.templates)
        return ImpactResult(items=(ImpactExplanation(template_id="magic1", version="t2", explanation="late"),), input_tokens=1, output_tokens=1)
    llm.explain.side_effect = revoke
    result = run(content, templates, catalog_context, req=request(content, catalog_context, customize=True), retriever=retriever, model=llm)
    assert result.status == "denied" and not result.items and not result.sources


@pytest.mark.parametrize("failure", ["private", "hash", "future", "fork"])
def test_unapproved_context_never_reaches_search_or_model(content, templates, catalog_context, failure):
    if failure == "private":
        content.rows = tuple(replace(r, public=False) if r.version.document_id == "summary" else r for r in content.rows)
    elif failure == "hash":
        catalog_context = catalog_context.model_copy(update={"summary": catalog_context.summary.model_copy(update={"source_hash": "0" * 64})})
    elif failure == "future":
        content.rows = tuple(replace(r, episode=4) if r.version.document_id == "summary" else r for r in content.rows)
    else:
        catalog_context = catalog_context.model_copy(update={"summary": catalog_context.summary.model_copy(update={
            "version": replace(catalog_context.summary.version, work_id="other-fork")})})
    retriever, llm = port(content, templates), fake_model()
    retriever.search = AsyncMock(wraps=retriever.search)
    result = run(content, templates, catalog_context, retriever=retriever, model=llm)
    assert result.status == "denied" and not result.items and not result.sources
    retriever.search.assert_not_called()
    llm.explain.assert_not_called()


def test_empty_catalog_is_distinct_from_search_timeout(content, catalog_context):
    empty = run(content, (), catalog_context)
    failed = run(content, (), catalog_context, retriever=TemplateVectorRetriever(content, (), frozenset(), failure="timeout"))
    assert empty.status == "empty" and empty.reason
    assert failed.status == "timeout" and not failed.items


def test_recommendations_never_apply_or_modify_settings(content, templates, catalog_context):
    before = (content.rows, content.pinned, content.active)
    result = run(content, templates, catalog_context)
    assert result.items and (content.rows, content.pinned, content.active) == before


@pytest.mark.parametrize("customize,calls,status", [(False, 0, "succeeded"), (True, 1, "succeeded"), (True, 0, "partial")])
def test_taskrunner_counts_only_requested_custom_model_calls(content, templates, catalog_context, customize, calls, status):
    from test_task_graph import task
    from app.runs.runner import TaskOutput, TaskRunner
    from app.runs.orchestrator import Budget
    root = task(content.scope, "context", "context")
    recommendation = task(content.scope, "template", "template", (root,),
                          budget=Budget(model_calls=calls, input_tokens=100 if calls else 0, output_tokens=100 if calls else 0))
    llm = fake_model()
    handler = TemplateRecommendationHandler(request(content, catalog_context, customize=customize), content=content,
                                            retriever=port(content, templates), model=llm)
    async def context_handler(slice, ctx):
        return TaskOutput(output_schema="ContextPacket.v1", output_ref="context:fixture", is_mock=True)
    runner = TaskRunner("run13", (root, recommendation), scope=content.scope, manifest=CanonicalAdapter(content).manifest(content.scope),
                        allowed_operations=("context", "template"), handlers={"context": context_handler, "template": handler})
    result = asyncio.run(runner.run())
    assert result.status == status and result.accounted.model_calls == calls
    if status == "partial":
        assert result.results[-1].status == "failed"
        llm.explain.assert_not_called()
        assert handler.recommendations is None
        return
    assert handler.recommendations.status == "ok" and result.results[-1].output_ref == "recommendations:run13:template"
    assert "마법 설정이 부족한 모험담" not in result.model_dump_json()


def test_expired_forged_search_hit_never_reaches_model(content, templates, catalog_context):
    retriever = port(content, templates)
    saved = asyncio.run(retriever.search(query(content), tags=("마법",)))
    retriever.templates = tuple(t.model_copy(update={"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)})
                                for t in retriever.templates)
    retriever.search = AsyncMock(return_value=saved)
    llm = fake_model()
    result = run(content, templates, catalog_context, req=request(content, catalog_context, customize=True), retriever=retriever, model=llm)
    assert result.status == "denied" and not result.items and not result.sources
    llm.explain.assert_not_called()


def test_catalog_reference_identity_cannot_collide_on_colons(content, templates, catalog_context):
    base = templates[0]
    candidates = (base.model_copy(update={"id": "a:b", "revision": "c"}),
                  base.model_copy(update={"id": "a", "revision": "b:c"}))
    result = run(content, candidates, catalog_context)
    assert len(result.items) == 2
    refs = [item.evidence_refs[0] for item in result.items]
    assert len(set(refs)) == 2
    evidence = {e.id: e for e in result.sources}
    assert all(evidence[item.evidence_refs[0]].template_id == item.template_id for item in result.items)


def test_tag_filter_applies_before_topk(content, templates, catalog_context):
    base = templates[0]
    other = base.model_copy(update={"id": "earlier", "tags": ("무관",), "rank": 1})
    desired = base.model_copy(update={"rank": 2})
    result = run(content, (other, desired), catalog_context, req=request(content, catalog_context, query=query(content, top_k=1)))
    assert result.status == "ok" and result.items[0].template_id == "magic1"


def test_unknown_catalog_version_is_rejected(content, templates, catalog_context):
    retriever = port(content, templates)
    saved = asyncio.run(retriever.search(query(content), tags=("마법",)))
    corrupt = saved.evidence[0].model_copy(update={"catalog_revision": "old"})
    retriever.search = AsyncMock(return_value=saved.model_copy(update={"evidence": (corrupt,)}))
    result = run(content, templates, catalog_context, retriever=retriever)
    assert result.status == "denied" and not result.items and not result.sources


def test_summary_cannot_be_a_manuscript_source(content, catalog_context):
    with pytest.raises(ValidationError):
        request(content, catalog_context.model_copy(update={"summary": selected(content, "m1")}))


def test_model_timeout_is_failure_not_empty_or_success(content, templates, catalog_context):
    llm = fake_model()
    llm.explain.side_effect = TimeoutError("must never be shown")
    result = run(content, templates, catalog_context, req=request(content, catalog_context, customize=True), model=llm)
    assert result.status == "timeout" and not result.items and not result.sources
    assert "must never" not in result.model_dump_json()


def test_scope_revoked_during_explanation_discards_every_source(content, templates, catalog_context):
    llm = fake_model()
    async def revoke(payload):
        content.active = False
        return ImpactResult(items=(ImpactExplanation(template_id="magic1", version="t2", explanation="late"),), input_tokens=1, output_tokens=1)
    llm.explain.side_effect = revoke
    result = run(content, templates, catalog_context, req=request(content, catalog_context, customize=True), model=llm)
    assert result.status == "denied" and not result.items and not result.sources


def test_empty_custom_search_does_not_call_model(content, catalog_context):
    llm = fake_model()
    result = run(content, (), catalog_context, req=request(content, catalog_context, customize=True), model=llm)
    assert result.status == "empty" and not result.items
    llm.explain.assert_not_called()


def test_model_wait_is_cancelled_at_query_deadline(content, templates, catalog_context):
    llm, completed = fake_model(), []
    async def slow(payload):
        await asyncio.sleep(1)
        completed.append(True)
        return ImpactResult(items=(), input_tokens=1, output_tokens=1)
    llm.explain.side_effect = slow
    req = request(content, catalog_context, customize=True,
                  query=query(content, deadline=datetime.now(timezone.utc) + timedelta(milliseconds=100)))
    result = run(content, templates, catalog_context, req=req, model=llm)
    assert result.status == "timeout" and not result.items and not completed
