"""네 검색 공급자가 공유하는 내부 DTO·Port. 인가는 Content에서 재확인한다."""

from typing import Annotated, Literal, Protocol, Self

from pydantic import (
    AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, model_validator,
)

from .content_client import CanonicalAdapter, Scope, SourceVersion


Id = Annotated[str, Field(min_length=1, pattern=r"\S")]
PositiveInt = Annotated[int, Field(strict=True, ge=1)]


def _span(value: tuple[int, int]) -> tuple[int, int]:
    if not 0 <= value[0] < value[1]:
        raise ValueError("span must be UTF-16 [start,end)")
    return value


def _range(value: tuple[int, int]) -> tuple[int, int]:
    if not 1 <= value[0] <= value[1]:
        raise ValueError("episode range must be inclusive and ordered")
    return value


Span = Annotated[tuple[Annotated[int, Field(strict=True)], Annotated[int, Field(strict=True)]],
                 AfterValidator(_span)]
EpisodeRange = Annotated[tuple[PositiveInt, PositiveInt], AfterValidator(_range)]
RetrievalType = Literal["relationship", "wiki", "manuscript", "template", "canonical"]
GapCode = Literal["missing", "stale", "unsupported", "timeout", "unverified"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Query(Contract):
    """서버가 받은 Content Scope와 검색 작업. grant를 모델 입력으로 보내지 않는다."""

    scope: Scope = Field(repr=False)
    operation: Id
    query_text: str | None = Field(default=None, repr=False)
    entity_ids: tuple[Id, ...] = ()
    episode_range: EpisodeRange | None = None
    document_ids: tuple[Id, ...] = ()
    top_k: PositiveInt
    token_budget: PositiveInt
    deadline: AwareDatetime
    required_fields: tuple[Id, ...] = ()
    source_kinds: tuple[Id, ...] = ()
    language: Id | None = None
    genre: Id | None = None

    @model_validator(mode="after")
    def within_scope(self) -> Self:
        if self.episode_range is not None and self.episode_range[1] > self.scope.basis_episode:
            raise ValueError("episode range exceeds scope")
        return self


class Evidence(Contract):
    """검색 후보 근거. verified_source 표시는 Content 검증을 대신하지 않는다."""

    id: Id
    retrieval_type: RetrievalType
    source_backend: Id
    is_mock: StrictBool
    retrieved_at: AwareDatetime
    source_revision: SourceVersion
    content: str = Field(repr=False)
    canonical_status: Literal["verified_source", "inferred", "disputed", "hypothetical"]
    work_id: Id | None = None
    fork_id: Id | None = None
    episode_id: Id | None = None
    scene_id: Id | None = None
    document_id: Id | None = None
    entity_ids: tuple[Id, ...] = ()
    source_span: Span | None = None
    as_of_episode: PositiveInt | None = None
    evidence_refs: tuple[Id, ...] = ()
    fact_or_relation: str | None = Field(default=None, repr=False)
    known_by: tuple[Id, ...] | None = None
    visible_from: PositiveInt | None = None
    visible_to: PositiveInt | None = None
    retrieval_score: Annotated[float, Field(allow_inf_nan=False)] | None = None
    score_kind: Id | None = None
    confidence_basis: str | None = None
    source_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] | None = None
    template_id: Id | None = None
    catalog_revision: Id | None = None
    license_ref: Id | None = None

    @model_validator(mode="after")
    def consistent_metadata(self) -> Self:
        if (self.retrieval_score is None) != (self.score_kind is None):
            raise ValueError("score and score_kind must be supplied together")
        if self.visible_from is not None and self.visible_to is not None and self.visible_to < self.visible_from:
            raise ValueError("visibility range is reversed")
        if self.retrieval_type == "template":
            if self.work_id is not None or self.fork_id is not None:
                raise ValueError("catalog templates have no work or fork")
            if not all((self.template_id, self.catalog_revision, self.license_ref)):
                raise ValueError("template id, catalog revision and license are required")
        return self


class Gap(Contract):
    source_ref: Id | None = None
    episode_number: PositiveInt | None = None
    code: GapCode


class Conflict(Contract):
    evidence_refs: Annotated[tuple[Id, ...], Field(min_length=2)]


class EpisodeCoverage(Contract):
    number: PositiveInt
    episode_id: Id | None = None
    expected_rev: Id | None = None
    indexed_rev: Id | None = None
    state: Literal["verified", "missing", "stale", "unsupported", "timeout", "unverified"]
    refs: tuple[Id, ...] = ()


class Coverage(Contract):
    """허용 manifest 전체의 검증 현황. top-k 개수와 구분한다."""

    manifest_ref: Id
    requested_range: EpisodeRange
    expected_count: Annotated[int, Field(strict=True, ge=0)]
    verified_count: Annotated[int, Field(strict=True, ge=0)]
    episodes: tuple[EpisodeCoverage, ...]
    missing_ranges: tuple[EpisodeRange, ...] = ()
    critical_gaps: tuple[Gap, ...] = ()
    checked_at: AwareDatetime
    is_mock: StrictBool

    @model_validator(mode="after")
    def consistent_counts(self) -> Self:
        numbers = [episode.number for episode in self.episodes]
        if len(set(numbers)) != len(numbers) or len(numbers) != self.expected_count:
            raise ValueError("expected_count must match unique episode entries")
        if self.verified_count != sum(episode.state == "verified" for episode in self.episodes):
            raise ValueError("verified_count must match verified episode entries")
        start, end = self.requested_range
        if any(not start <= number <= end for number in numbers):
            raise ValueError("episode outside requested range")
        if any(not start <= left <= right <= end for left, right in self.missing_ranges):
            raise ValueError("missing range outside requested range")
        return self


class RetrievalResult(Contract):
    status: Literal["ok", "partial", "unavailable", "unsupported", "denied"]
    is_mock: StrictBool
    evidence: tuple[Evidence, ...] = ()
    gaps: tuple[Gap, ...] = ()
    conflicts: tuple[Conflict, ...] = ()
    coverage: Coverage | None = None
    next_cursor: str | None = None

    @model_validator(mode="after")
    def consistent_result(self) -> Self:
        if self.status == "ok" and (self.gaps or (self.coverage is not None
                                                and self.coverage.verified_count < self.coverage.expected_count)):
            raise ValueError("incomplete retrieval cannot be ok")
        if self.status in ("unavailable", "unsupported", "denied") and self.evidence:
            raise ValueError("failed retrieval cannot return evidence")
        if not self.is_mock and (any(item.is_mock for item in self.evidence)
                                 or (self.coverage is not None and self.coverage.is_mock)):
            raise ValueError("mock evidence or coverage must be marked as mock")
        return self


class RetrievalPort(Protocol):
    async def search(self, query: Query) -> RetrievalResult:
        """승인 범위에서 검색하고 정상 0건과 실패를 구분한다."""
        ...


class RelationshipGraphPort(RetrievalPort, Protocol):
    retrieval_type: Literal["relationship"]


class EpisodeWikiPort(RetrievalPort, Protocol):
    retrieval_type: Literal["wiki"]


class ManuscriptVectorPort(RetrievalPort, Protocol):
    retrieval_type: Literal["manuscript"]


class TemplateVectorPort(RetrievalPort, Protocol):
    retrieval_type: Literal["template"]
