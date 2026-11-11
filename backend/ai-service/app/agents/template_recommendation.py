"""공개 허용 설정과 권리 확인된 카탈로그로 만드는 읽기 전용 추천."""
import asyncio
from datetime import datetime, timezone
from hashlib import sha256
from typing import Literal

from pydantic import Field, StrictBool, ValidationError, model_validator

from app.retrieval.content_client import CanonicalAdapter, ContentReadError
from app.retrieval.contracts import Contract, Evidence, Gap, Id, PositiveInt, Query
from app.retrieval.mock_content import MockContentReadPort
from app.agents.template_catalog import TemplateCatalog, CatalogEntry, CatalogResult
from .story_context import ExactSource, StoryContextRequest, story_context


class ExistingTemplate(Contract):
    template_id: ExactSource
    version: ExactSource


class CatalogContext(Contract):
    language: ExactSource
    genre: ExactSource
    tags: tuple[ExactSource, ...] = ()
    summary: ExactSource | None = None
    existing_tags: tuple[ExactSource, ...] = ()
    existing: tuple[ExistingTemplate, ...] = ()


class TemplateRecommendationRequest(Contract):
    query: Query = Field(repr=False)
    context: CatalogContext = Field(repr=False)
    customize: StrictBool = False

    @model_validator(mode="after")
    def settings_only(self):
        context = self.context
        refs = [context.language, context.genre, *context.tags, *context.existing_tags]
        if context.summary:
            refs.append(context.summary)
        refs.extend(ref for item in context.existing for ref in (item.template_id, item.version))
        if any(ref.version.kind != "setting" for ref in refs):
            raise ValueError("catalog input requires selected setting values, never manuscript text")
        return self


class RecommendationItem(Contract):
    template_id: Id
    version: Id
    name: Id
    purpose: Id
    reason: Id
    relevance: tuple[Id, ...]
    expected_change: Id
    conflicts: tuple[Id, ...] = ()
    duplicate: StrictBool = False
    existing_version: Id | None = None
    license_ref: Id
    evidence_refs: tuple[Id, ...]
    custom_explanation: str | None = Field(default=None, repr=False)


class Recommendations(Contract):
    status: Literal["ok", "empty", "partial", "denied", "timeout", "unsupported"]
    reason: Id
    items: tuple[RecommendationItem, ...] = ()
    sources: tuple[Evidence | CatalogEntry, ...] = Field(default=(), repr=False)
    gaps: tuple[Gap, ...] = ()
    is_mock: StrictBool


class CatalogBrief(Contract):
    language: Id
    genre: Id
    tags: tuple[Id, ...]
    summary: str | None = Field(default=None, repr=False)


class ImpactRequest(Contract):
    context: CatalogBrief = Field(repr=False)
    items: tuple[RecommendationItem, ...]


class ImpactExplanation(Contract):
    template_id: Id
    version: Id
    explanation: Id = Field(repr=False)


class ImpactResult(Contract):
    items: tuple[ImpactExplanation, ...]
    input_tokens: PositiveInt
    output_tokens: PositiveInt


async def template_recommendation(request: TemplateRecommendationRequest, *, content, retriever,
                                  model=None, call_context=None) -> Recommendations:
    """권리·판본은 Python에서 재검증하고 맞춤 설명 요청에만 모델 대역을 호출한다."""
    request = TemplateRecommendationRequest.model_validate(request.model_dump())
    if not isinstance(content, MockContentReadPort) or not isinstance(retriever, TemplateCatalog):
        return Recommendations(status="unsupported", reason="실제 Content·카탈로그 연결은 지원하지 않습니다.", is_mock=False)
    if retriever.content is not content:
        return Recommendations(status="denied", reason="검색의 승인 범위를 확인할 수 없습니다.", is_mock=True)
    canonical = CanonicalAdapter(content)
    sources = {}

    async def read(ref):
        # 원래 query의 자유문·문서 선택은 외부 검색용 입력으로 재사용하지 않는다.
        query = request.query.model_copy(update={"document_ids": (ref.version.document_id,),
            "source_kinds": ("setting",), "episode_range": None})
        try:
            result = await story_context(StoryContextRequest(query=query, kind="attribute", exact=ref), content=content)
        except ValidationError:
            raise ContentReadError("denied") from None
        if result.status == "timeout":
            raise TimeoutError()
        if result.status != "ok":
            raise ContentReadError("denied")
        evidence = result.sources[0]
        row = next((r for r in content.rows if r.version == evidence.source_revision), None)
        if row is None or not row.public:
            # 현행 Content 읽기에는 외부 전송 승인 필드가 없어 공개 설정만 허용한다.
            raise ContentReadError("denied")
        identity = evidence.model_dump_json(include={"source_revision", "source_span", "source_hash"})
        evidence = evidence.model_copy(update={"id": "approved:" + sha256(identity.encode()).hexdigest()})
        sources[evidence.id] = evidence
        return evidence.content

    try:
        manifest = canonical.manifest(request.query.scope)
        language, genre = await read(request.context.language), await read(request.context.genre)
        tags = tuple(dict.fromkeys([await read(ref) for ref in request.context.tags]))
        summary = await read(request.context.summary) if request.context.summary else None
        existing_tags = {await read(ref) for ref in request.context.existing_tags}
        existing = {}
        for entry in request.context.existing:
            id, version = await read(entry.template_id), await read(entry.version)
            if id in existing and existing[id] != version:
                raise ContentReadError("denied")
            existing[id] = version
        brief = CatalogBrief(language=language, genre=genre, tags=tags, summary=summary)
        # 새 Query를 만들어 원고·검색 자유문·entity·문서 필터가 경계를 넘지 않게 한다.
        query = Query(scope=request.query.scope, operation="search", language=language, genre=genre,
            top_k=request.query.top_k, token_budget=request.query.token_budget, deadline=request.query.deadline)
        snapshot, licenses = retriever.templates, retriever.allowed_licenses
        catalog = {item.id: item for item in snapshot}
        if len(catalog) != len(snapshot):
            raise ContentReadError("denied")
        result = CatalogResult.model_validate((await retriever.search(query, tags=tags)).model_dump())
        if result.status == "unavailable":
            raise TimeoutError()
        if result.status in ("denied", "unsupported"):
            raise ContentReadError(result.status)
        if not result.is_mock:
            raise ContentReadError("denied")
        if retriever.templates != snapshot or retriever.allowed_licenses != licenses:
            raise ContentReadError("denied")
        items = []
        approved_refs = tuple(sources)
        seen = set()
        for evidence in result.evidence:
            item = catalog.get(evidence.template_id)
            if (item is None or item.id in seen or not item.public or not item.license_active
                    or item.license_ref not in licenses or item.language != language or item.genre != genre
                    or item.expires_at is not None and datetime.now(timezone.utc) >= item.expires_at
                    or tags and not set(tags).intersection(item.tags)
                    or not evidence.is_mock or evidence.retrieval_type != "template"
                    or evidence.catalog_revision != item.revision or evidence.license_ref != item.license_ref
                    or evidence.content != item.name + " " + " ".join(item.tags)):
                raise ContentReadError("denied")
            seen.add(item.id)
            identity = evidence.model_dump_json(include={"template_id", "catalog_revision"})
            catalog_ref = "catalog:" + sha256(identity.encode()).hexdigest()
            sources[catalog_ref] = evidence.model_copy(update={"id": catalog_ref, "evidence_refs": (catalog_ref,)})
            conflicts = tuple(sorted(existing_tags.intersection(item.conflicts_with)))
            duplicate = item.id in existing
            reason = f"허용한 {genre} 장르·{language} 언어와 일치하는 공개 템플릿입니다."
            if duplicate:
                reason += " 기존 적용 항목과 ID가 같습니다."
            if conflicts:
                reason += " 카탈로그에 명시된 충돌 조건을 확인해야 합니다."
            items.append(RecommendationItem(template_id=item.id, version=item.revision, name=item.name,
                purpose=item.purpose or "요청한 장르의 세계관 설정 보완",
                reason=reason, relevance=tuple(tag for tag in tags if tag in item.tags),
                expected_change=item.expected_change or "별도 적용 요청에서 설정 추가·변경안을 검토합니다.",
                conflicts=conflicts, duplicate=duplicate, existing_version=existing.get(item.id),
                license_ref=item.license_ref, evidence_refs=(catalog_ref, *approved_refs)))
        gaps = list(result.gaps)
        if request.customize and items:
            if datetime.now(timezone.utc) >= query.deadline:
                raise TimeoutError()
            if model is None:
                gaps.append(Gap(code="unsupported"))
            else:
                payload = ImpactRequest(context=brief, items=tuple(items))
                remaining = (query.deadline - datetime.now(timezone.utc)).total_seconds()
                reply = None

                async def invoke(reservation):
                    nonlocal reply
                    from app.runs.orchestrator import Budget
                    from app.runs.runner import ModelReply
                    reply = ImpactResult.model_validate((await asyncio.wait_for(model.explain(payload), remaining)).model_dump())
                    return ModelReply(output_ref="recommendations:impact", usage=Budget(model_calls=1,
                        input_tokens=reply.input_tokens, output_tokens=reply.output_tokens))

                try:
                    if call_context is None:
                        reply = ImpactResult.model_validate((await asyncio.wait_for(model.explain(payload), remaining)).model_dump())
                    else:
                        await call_context.call_model(call_context.task.budget, invoke)
                    explanations = {(item.template_id, item.version): item.explanation for item in reply.items}
                    if (len(explanations) != len(reply.items)
                            or set(explanations) != {(item.template_id, item.version) for item in items}):
                        gaps.append(Gap(code="unverified"))
                    else:
                        items = [item.model_copy(update={"custom_explanation": explanations[item.template_id, item.version]}) for item in items]
                except ValidationError:
                    gaps.append(Gap(code="unverified"))
        # 설명 대기 중 철회·갱신·만료된 항목은 출처를 포함한 전체 응답에서 닫는다.
        if retriever.templates != snapshot or retriever.allowed_licenses != licenses or any(
                catalog[item.template_id].expires_at is not None and
                datetime.now(timezone.utc) >= catalog[item.template_id].expires_at for item in items):
            raise ContentReadError("denied")
        for evidence in sources.values():
            if evidence.retrieval_type == "canonical":
                fresh = canonical.read(query.scope, evidence.source_revision, evidence.source_span, evidence.source_hash)
                row = next((r for r in content.rows if r.version == evidence.source_revision), None)
                if not fresh.is_mock or fresh.text != evidence.content or row is None or not row.public:
                    raise ContentReadError("denied")
        if canonical.manifest(query.scope) != manifest:
            raise ContentReadError("denied")
        if datetime.now(timezone.utc) >= query.deadline:
            raise TimeoutError()
        partial = bool(gaps) or result.status == "partial"
        status = "partial" if partial else "ok" if items else "empty"
        return Recommendations(status=status, reason="일부 확인·맞춤 설명이 완료되지 않았습니다." if partial else
            "권리·판본과 허용 조건을 확인한 읽기 전용 추천입니다." if items else "허용한 조건과 이용권에 맞는 공개 템플릿이 없습니다.",
            items=tuple(items), sources=tuple(sources.values()), gaps=tuple(dict.fromkeys(gaps)), is_mock=True)
    except (TimeoutError, OSError):
        return Recommendations(status="timeout", reason="조회·설명 기한 또는 읽기 장애로 완료하지 못했습니다.",
                               gaps=(Gap(code="timeout"),), is_mock=True)
    except ContentReadError as error:
        return Recommendations(status="timeout" if error.status == "unavailable" else error.status,
            reason="현재 권한·카탈로그·공개 범위를 확인할 수 없습니다.", is_mock=True)


class TemplateRecommendationHandler:
    """run별 명시 주입. 추천 본문은 checkpoint 밖에 두고 참조만 실행기에 전달한다."""

    def __init__(self, request: TemplateRecommendationRequest, *, content, retriever, model=None):
        self.request = TemplateRecommendationRequest.model_validate(request.model_dump())
        self.content, self.retriever, self.model = content, retriever, model
        self.recommendations: Recommendations | None = None

    async def __call__(self, slice, ctx):
        """단순 추천은 모델 0회, 맞춤 설명은 기존 예약·usage·취소 경계를 사용한다."""
        from app.runs.orchestrator import REGISTRY, PlanError
        from app.runs.runner import TaskOutput
        ctx.checkpoint()
        if (slice.operation != "template" or slice.output_schema != "Recommendations.v1"
                or self.request.query.scope != ctx.runner.scope):
            raise PlanError("template_scope_mismatch")
        result = await REGISTRY["template"].handler(self.request, content=self.content, retriever=self.retriever,
                                                   model=self.model, call_context=ctx)
        ctx.checkpoint()
        self.recommendations = result
        if result.status == "timeout":
            raise TimeoutError()
        if result.status in ("denied", "unsupported"):
            raise ContentReadError(result.status)
        return TaskOutput(output_schema="Recommendations.v1", output_ref=f"recommendations:{slice.run_id}:{slice.task_id}",
                          status="partial" if result.status == "partial" else "succeeded", is_mock=result.is_mock)
