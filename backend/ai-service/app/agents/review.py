"""선택된 원문·정본 기준으로 실행하는 모델 없는 Mechanical 검사."""
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import re
from typing import Annotated, Literal

from pydantic import AliasChoices, Field, StrictBool, model_validator

from app.retrieval.content_client import CanonicalAdapter, ContentReadError, SourceVersion, utf16_quote
from app.retrieval.contracts import Contract, Evidence, Gap, Id, PositiveInt, Query, Span
from app.retrieval.mock_content import MockContentReadPort
from .story_context import ExactSource, StoryContextRequest, story_context


CheckType = Literal["names", "numbers", "repetition", "spelling"]


class NameCheck(Contract):
    span: Span
    canonical: ExactSource | None = None
    aliases: tuple[ExactSource, ...] = ()


class NumberCheck(Contract):
    span: Span
    expected: ExactSource | None = None
    basis_episode: PositiveInt | None = None


class SpellingRule(Contract):
    wrong: Id
    correction: Id


class ReviewRequest(Contract):
    query: Query = Field(repr=False)
    target: ExactSource
    check_types: Annotated[tuple[CheckType, ...], Field(min_length=1,
        validation_alias=AliasChoices("check_types", "checkTypes"))]
    names: tuple[NameCheck, ...] = ()
    numbers: tuple[NumberCheck, ...] = ()
    spelling_rules: tuple[SpellingRule, ...] = ()

    @model_validator(mode="after")
    def selected_scope(self):
        if len(set(self.check_types)) != len(self.check_types):
            raise ValueError("check types must be unique")
        for check in (*self.names, *self.numbers):
            if not self.target.span[0] <= check.span[0] < check.span[1] <= self.target.span[1]:
                raise ValueError("check span must be inside selected target")
        references = [c.canonical for c in self.names if c.canonical is not None]
        references += [alias for c in self.names for alias in c.aliases]
        references += [c.expected for c in self.numbers if c.expected is not None]
        if any(ref.version.kind != "setting" for ref in references):
            raise ValueError("mechanical standards require selected canonical setting values")
        return self


class ReviewLocation(Contract):
    version: SourceVersion
    span: Span
    source_hash: str
    quote: str = Field(repr=False)


class Finding(Contract):
    issue_id: Id
    issue_type: Literal["name_variant", "number_mismatch", "repeated_word", "spelling_candidate"]
    severity: Literal["warning", "error"]
    target_location: ReviewLocation
    description: str
    evidence_refs: Annotated[tuple[Id, ...], Field(min_length=1)]
    confirmed_or_suspected: Literal["confirmed", "suspected"]
    explanation: str
    suggested_fix: str | None = Field(default=None, repr=False)


class Findings(Contract):
    status: Literal["ok", "partial", "denied", "timeout", "unsupported"]
    findings: tuple[Finding, ...] = ()
    checked_types: tuple[CheckType, ...] = ()
    sources: tuple[Evidence, ...] = Field(default=(), repr=False)
    gaps: tuple[Gap, ...] = ()
    is_mock: StrictBool


def _number(text: str) -> Decimal | None:
    # 단위 변환·생일 추론은 하지 않고 선택된 숫자 표기만 비교한다.
    if re.fullmatch(r"[-+]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?", text):
        return Decimal(text.replace(",", ""))
    return None


async def mechanical_review(request: ReviewRequest, *, content: MockContentReadPort) -> Findings:
    """Content 읽기 대역만 사용한다. 의미 검수·모델·시뮬레이션·원고 쓰기는 호출하지 않는다."""
    request = ReviewRequest.model_validate(request.model_dump())
    if not isinstance(content, MockContentReadPort):
        return Findings(status="unsupported", is_mock=False)
    sources, findings, gaps = {}, {}, []
    canonical = CanonicalAdapter(content)

    async def read(exact, *, setting=False):
        selected_query = request.query if not setting else request.query.model_copy(update={
            "document_ids": (exact.version.document_id,), "source_kinds": ("setting",), "episode_range": None})
        response = await story_context(StoryContextRequest(query=selected_query,
            kind="attribute" if setting else "quote", exact=exact), content=content)
        if response.status == "timeout":
            raise TimeoutError()
        if response.status != "ok":
            raise ContentReadError("unsupported" if response.status == "unsupported" else "denied")
        evidence = response.sources[0]
        if setting and (evidence.as_of_episode > target.as_of_episode
                or evidence.visible_from is not None and evidence.visible_from > target.as_of_episode
                or evidence.visible_to is not None and evidence.visible_to < target.as_of_episode):
            raise ContentReadError("denied")
        identity = evidence.model_dump_json(include={"source_revision", "source_span", "source_hash"})
        evidence = evidence.model_copy(update={"id": "review-source:" + sha256(identity.encode()).hexdigest()})
        sources[evidence.id] = evidence
        return evidence

    def location(span):
        relative = (span[0] - target.source_span[0], span[1] - target.source_span[0])
        quote = utf16_quote(target.content, relative)
        return ReviewLocation(version=target.source_revision, span=span, quote=quote,
                              source_hash=sha256(quote.encode()).hexdigest())

    def add(kind, where, description, explanation, *, refs=(), confirmed=False, fix=None):
        evidence_refs = tuple(dict.fromkeys((target.id, *refs)))
        identity = f"{kind}:{where.model_dump_json()}:{evidence_refs}"
        id = "mechanical:" + sha256(identity.encode()).hexdigest()
        findings[id] = Finding(issue_id=id, issue_type=kind, severity="error" if confirmed else "warning",
            target_location=where, description=description, evidence_refs=evidence_refs,
            confirmed_or_suspected="confirmed" if confirmed else "suspected", explanation=explanation,
            suggested_fix=fix)

    def match_location(match, group=0):
        start, end = match.span(group)
        base = target.source_span[0]
        return location((base + len(target.content[:start].encode("utf-16-le")) // 2,
                         base + len(target.content[:end].encode("utf-16-le")) // 2))

    try:
        manifest = canonical.manifest(request.query.scope)
        target = await read(request.target)
        if "names" in request.check_types:
            for check in request.names:
                where = location(check.span)
                standards = [await read(ref, setting=True) for ref in
                             ((check.canonical,) if check.canonical is not None else ()) + check.aliases]
                if where.quote not in {e.content for e in standards}:
                    add("name_variant", where, "등록 명칭·별칭과 일치하는지 확인이 필요합니다.",
                        "사전 미등재 이름이나 의도적인 표기일 수 있어 오류로 확정하지 않습니다.",
                        refs=tuple(e.id for e in standards), fix=standards[0].content if check.canonical else None)
        if "numbers" in request.check_types:
            for check in request.numbers:
                where = location(check.span)
                expected = await read(check.expected, setting=True) if check.expected else None
                value = _number(where.quote)
                standard = _number(expected.content) if expected else None
                same_basis = expected is not None and check.basis_episode == target.as_of_episode == expected.as_of_episode
                if value is None or standard is None or not same_basis:
                    gaps.append(Gap(code="unverified"))
                    add("number_mismatch", where, "수치의 기준값·기준 시점을 확인할 수 없습니다.",
                        "숫자 표기와 같은 회차의 명시 기준이 모두 있어야 불일치를 확정합니다.",
                        refs=(expected.id,) if expected else ())
                elif value != standard:
                    add("number_mismatch", where, "선택한 기준값과 수치가 다릅니다.",
                        "동일한 기준 회차에 지정된 숫자 값만 비교한 결과입니다.", refs=(expected.id,),
                        confirmed=True, fix=expected.content)
        if "repetition" in request.check_types:
            for match in re.finditer(r"(?=(?<!\w)(?P<first>\w+)[ \t]+(?P<repeat>(?P=first))(?!\w))", target.content):
                add("repeated_word", match_location(match, "repeat"), "인접한 어절이 반복됩니다.",
                    "강조·말더듬 등 의도적인 문체일 수 있어 확인이 필요합니다.", fix="")
        if "spelling" in request.check_types:
            for rule in request.spelling_rules:
                if rule.wrong == rule.correction:
                    continue
                for match in re.finditer(r"(?<!\w)" + re.escape(rule.wrong) + r"(?!\w)", target.content):
                    add("spelling_candidate", match_location(match), "지정된 맞춤법 후보와 일치합니다.",
                        "요청에 등록한 표기 쌍만 확인하며 방언·인용·의도적 문체를 오류로 확정하지 않습니다.",
                        fix=rule.correction)
        # 반환 직전 같은 판본·구간·hash와 현재 권한을 다시 확인한다.
        for evidence in sources.values():
            fresh = canonical.read(request.query.scope, evidence.source_revision,
                                   evidence.source_span, evidence.source_hash)
            if fresh.text != evidence.content or not fresh.is_mock:
                raise ContentReadError("denied")
        if canonical.manifest(request.query.scope) != manifest:
            raise ContentReadError("denied")
        if datetime.now(timezone.utc) >= request.query.deadline:
            raise TimeoutError()
        return Findings(status="partial" if gaps else "ok", findings=tuple(findings.values()),
            checked_types=request.check_types, sources=tuple(sources.values()),
            gaps=tuple(dict.fromkeys(gaps)), is_mock=True)
    except (TimeoutError, OSError):
        return Findings(status="timeout", gaps=(Gap(code="timeout"),), is_mock=True)
    except ContentReadError as error:
        return Findings(status="timeout" if error.status == "unavailable" else error.status,
            gaps=(Gap(code="timeout" if error.status == "unavailable" else "unverified"),), is_mock=True)


class MechanicalReviewHandler:
    """run마다 명시 주입하며 Findings 본문을 checkpoint 밖에 보관하는 실행기 adapter."""

    def __init__(self, request: ReviewRequest, *, content: MockContentReadPort):
        self.request = ReviewRequest.model_validate(request.model_dump())
        self.content = content
        self.findings: Findings | None = None

    async def __call__(self, slice, ctx):
        """기존 모델 없는 capability와 조건부 후속 작업에 참조·확정 여부만 전달한다."""
        from app.runs.orchestrator import REGISTRY, ConditionFacts, PlanError
        from app.runs.runner import TaskOutput
        ctx.checkpoint()
        if (slice.operation != "mechanical" or slice.output_schema != "Findings.v1"
                or self.request.query.scope != ctx.runner.scope):
            raise PlanError("mechanical_scope_mismatch")
        result = await REGISTRY["mechanical"].handler(self.request, content=self.content)
        ctx.checkpoint()
        self.findings = result
        if result.status == "timeout":
            raise TimeoutError()
        if result.status in ("denied", "unsupported"):
            raise ContentReadError(result.status)
        confirmed = result.status == "ok" and any(f.confirmed_or_suspected == "confirmed" for f in result.findings)
        return TaskOutput(output_schema="Findings.v1", output_ref=f"findings:{slice.run_id}:{slice.task_id}",
            status="succeeded" if result.status == "ok" else "partial", is_mock=result.is_mock,
            facts=ConditionFacts(has_confirmed_findings=confirmed))
