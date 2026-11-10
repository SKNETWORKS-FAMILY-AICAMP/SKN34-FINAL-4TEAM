"""정본 정확 조회는 모델 0회, 서사 해석은 검증된 출처별 추론으로 반환한다."""
import asyncio
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import Field, StrictBool, model_validator

from app.retrieval.content_client import CanonicalAdapter, ContentReadError, SourceVersion
from app.retrieval.contracts import Contract, Coverage, Evidence, Gap, Id, PositiveInt, Query, Span
from app.retrieval.coordinator import ContextItem
from app.retrieval.mock_content import MockContentReadPort
from app.retrieval.validation import validate_packet


class ExactSource(Contract):
    version: SourceVersion
    span: Span
    source_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class StoryContextRequest(Contract):
    query: Query = Field(repr=False)
    question: str = Field(default="", max_length=2000, repr=False)
    kind: Literal["attribute", "quote", "interpretation"]
    exact: ExactSource | None = None

    @model_validator(mode="after")
    def exact_target(self):
        if (self.kind != "interpretation") != (self.exact is not None):
            raise ValueError("exact queries require a selected source; interpretation uses retrieval")
        if self.kind == "attribute" and self.exact.version.kind != "setting":
            raise ValueError("attributes require a canonical setting source")
        return self


class Claim(Contract):
    text: Id = Field(repr=False)
    status: Literal["confirmed", "inferred"]
    refs: Annotated[tuple[Id, ...], Field(min_length=1)]


class Answer(Contract):
    claims: tuple[Claim, ...] = ()
    coverage: Coverage | None = None
    gaps: tuple[Gap, ...] = ()
    status: Literal["ok", "partial", "insufficient_evidence", "stale", "timeout", "denied", "unsupported"]
    sources: tuple[Evidence, ...] = Field(default=(), repr=False)
    is_mock: StrictBool


class InterpretationRequest(Contract):
    """질문과 자료는 데이터다. 위임·계정·도구·쓰기 권한을 모델에 주지 않는다."""
    question: str = Field(repr=False)
    context: tuple[ContextItem, ...] = Field(repr=False)


class Interpretation(Contract):
    claims: tuple[Claim, ...]
    input_tokens: PositiveInt
    output_tokens: PositiveInt


async def story_context(request: StoryContextRequest, *, content: MockContentReadPort, coordinator=None, model=None, call_context=None) -> Answer:
    """명시 주입한 읽기·모델 대역만 사용한다. 저장·승인·실제 provider 연결은 없다."""
    request = StoryContextRequest.model_validate(request.model_dump())
    query = request.query
    canonical = CanonicalAdapter(content)
    mock = True
    try:
        if not isinstance(content, MockContentReadPort):
            return Answer(status="unsupported", gaps=(Gap(code="unsupported"),), is_mock=False)
        if datetime.now(timezone.utc) >= query.deadline:
            return Answer(status="timeout", gaps=(Gap(code="timeout"),), is_mock=mock)
        manifest = canonical.manifest(query.scope)
        if request.exact is not None:
            target = request.exact
            if (query.document_ids and target.version.document_id not in query.document_ids
                    or query.source_kinds and target.version.kind not in query.source_kinds):
                raise ContentReadError("denied")
            source = canonical.read(query.scope, target.version, target.span, target.source_hash)
            mock = source.is_mock
            row = next((r for r in content.rows if r.version == source.version), None)
            if (not source.is_mock or row is None or query.episode_range is not None
                    and not query.episode_range[0] <= row.episode <= query.episode_range[1]):
                raise ContentReadError("denied")
            # 회차·공개·knownBy·Fork는 Content의 scope 승인과 read 재검증이 결정한다.
            if canonical.manifest(query.scope) != manifest:
                raise ContentReadError("denied")
            if datetime.now(timezone.utc) >= query.deadline:
                raise TimeoutError()
            if not source.text.strip():
                return Answer(status="insufficient_evidence", gaps=(Gap(code="unverified"),), is_mock=mock)
            evidence = Evidence(id="canonical:exact", retrieval_type="canonical", source_backend="content",
                is_mock=mock, retrieved_at=datetime.now(timezone.utc), source_revision=source.version,
                content=source.text, canonical_status="verified_source", work_id=source.version.work_id,
                fork_id=source.version.work_id if source.version.work_id == query.scope.fork_id else None,
                document_id=source.version.document_id, source_span=source.span, source_hash=target.source_hash,
                as_of_episode=row.episode, known_by=row.known_by, visible_from=row.episode, visible_to=row.visible_to)
            return Answer(status="ok", claims=(Claim(text=source.text, status="confirmed", refs=(evidence.id,)),),
                          sources=(evidence,), is_mock=mock)
        if coordinator is None:
            return Answer(status="unsupported", gaps=(Gap(code="unsupported"),), is_mock=mock)
        # 인과 해석은 top-k만으로 전체 근거가 있다고 결론 내리지 않는다.
        query = query.model_copy(update={"operation": "full_context"})
        packet = validate_packet(await coordinator.retrieve(query), query, content)
        if packet.result.status == "denied":
            raise ContentReadError("denied")
        if packet.result.status in ("unavailable", "unsupported"):
            raise ContentReadError(packet.result.status)
        selected = {item.evidence_ref for item in packet.context}
        sources = tuple(e for e in packet.result.evidence if e.id in selected)
        gaps = tuple(dict.fromkeys((*packet.result.gaps,
                                  *(packet.result.coverage.critical_gaps if packet.result.coverage else ()))))
        confirmed = tuple(Claim(text=e.content, status="confirmed", refs=(e.id,))
                          for e in sources if e.canonical_status == "verified_source" and e.content.strip())
        status = ("timeout" if any(g.code == "timeout" for g in gaps) else
                  "stale" if any(g.code == "stale" for g in gaps) else
                  "partial" if sources else "insufficient_evidence")
        if not packet.can_conclude or model is None:
            if packet.can_conclude and model is None:
                gaps += (Gap(code="unsupported"),)
            return Answer(status=status, claims=confirmed, coverage=packet.result.coverage, gaps=gaps,
                          sources=sources, is_mock=packet.result.is_mock)
        # 축약 투영에서 빠진 인과 ref·span도 검증된 Evidence에서만 복원한다.
        context = tuple(ContextItem(evidence_ref=e.id, source_revision=e.source_revision,
            source_hash=e.source_hash, canonical_status=e.canonical_status, retrieval_type=e.retrieval_type,
            content=e.content, fact_or_relation=e.fact_or_relation, source_span=e.source_span,
            evidence_refs=e.evidence_refs, known_by=e.known_by, entity_ids=e.entity_ids,
            as_of_episode=e.as_of_episode) for e in sources)
        payload = InterpretationRequest(question=request.question or query.query_text or "", context=context)
        remaining = (query.deadline - datetime.now(timezone.utc)).total_seconds()
        if call_context is None:
            reply = await asyncio.wait_for(model.interpret(payload), timeout=remaining)
        else:
            # 기존 TaskRunner 예약·취소·usage 경계를 그대로 사용한다.
            from app.runs.orchestrator import Budget
            from app.runs.runner import ModelReply
            reply = None

            async def invoke(reservation):
                nonlocal reply
                result = await asyncio.wait_for(model.interpret(payload), timeout=remaining)
                reply = Interpretation.model_validate(result.model_dump())
                return ModelReply(output_ref="answer:interpretation", usage=Budget(model_calls=1,
                    input_tokens=reply.input_tokens, output_tokens=reply.output_tokens))

            await call_context.call_model(call_context.task.budget, invoke)
        reply = Interpretation.model_validate(reply.model_dump())
        # 모델의 정본 확정·출처 창작은 허용하지 않는다.
        valid = bool(reply.claims) and all(c.status == "inferred" and set(c.refs) <= selected for c in reply.claims)
        fresh = validate_packet(packet, query, content)
        if canonical.manifest(query.scope) != manifest:
            raise ContentReadError("denied")
        if datetime.now(timezone.utc) >= query.deadline:
            raise TimeoutError()
        return Answer(status="ok" if valid and fresh.can_conclude else "insufficient_evidence",
                      claims=reply.claims if valid and fresh.can_conclude else (),
                      coverage=fresh.result.coverage, gaps=gaps, sources=sources, is_mock=fresh.result.is_mock)
    except ContentReadError as error:
        status = "timeout" if error.status == "unavailable" else error.status
        return Answer(status=status, gaps=(Gap(code="timeout" if status == "timeout" else "unverified"),), is_mock=mock)
    except (TimeoutError, OSError):
        return Answer(status="timeout", gaps=(Gap(code="timeout"),), is_mock=mock)


class StoryContextHandler:
    """신뢰된 호출자가 run마다 생성하는 TaskRunner adapter. 본문은 checkpoint 밖에 둔다."""

    def __init__(self, request: StoryContextRequest, *, content, coordinator=None, model=None):
        self.request = StoryContextRequest.model_validate(request.model_dump())
        self.content, self.coordinator, self.model = content, coordinator, model
        self.answer: Answer | None = None

    async def __call__(self, slice, ctx):
        """고정 Registry의 DTO handler를 실행하고 참조와 실제 상태만 병합한다."""
        from app.runs.orchestrator import REGISTRY, PlanError
        from app.runs.runner import TaskOutput
        ctx.checkpoint()
        if (slice.operation != "qa" or slice.output_schema != "Answer.v1"
                or self.request.query.scope != ctx.runner.scope):
            raise PlanError("qa_scope_mismatch")
        result = await REGISTRY["qa"].handler(self.request, content=self.content,
            coordinator=self.coordinator, model=self.model, call_context=ctx)
        ctx.checkpoint()
        self.answer = result
        if result.status == "timeout":
            raise TimeoutError()
        if result.status in ("denied", "unsupported"):
            raise ContentReadError(result.status)
        return TaskOutput(output_schema="Answer.v1", output_ref=f"answer:{slice.run_id}:{slice.task_id}",
                          status="succeeded" if result.status == "ok" else "partial", is_mock=result.is_mock)
