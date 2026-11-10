"""작품 원고와 분리된 합성 공개 카탈로그. 실제 추천 모델을 호출하지 않는다."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from pydantic import AwareDatetime, StrictBool

from ._mock import begin, failed, finish
from .content_client import ContentReadError, SourceVersion
from .contracts import Contract, Evidence, Id, PositiveInt, Query, RetrievalResult
from .mock_content import MockContentReadPort


class Template(Contract):
    id: Id
    revision: Id
    name: Id
    license_ref: Id
    language: Id
    genre: Id
    public: StrictBool
    license_active: StrictBool
    tags: tuple[Id, ...] = ()
    rank: PositiveInt = 1
    expires_at: AwareDatetime | None = None
    purpose: Id | None = None
    expected_change: Id | None = None
    conflicts_with: tuple[Id, ...] = ()


@dataclass
class TemplateVectorRetriever:
    content: MockContentReadPort = field(repr=False)
    templates: tuple[Template, ...] = field(repr=False)
    allowed_licenses: frozenset[str] = field(repr=False)
    failure: Literal["timeout"] | None = None
    retrieval_type: Literal["template"] = field(default="template", init=False)

    async def search(self, query: Query, *, tags: tuple[str, ...] = ()) -> RetrievalResult:
        """서버가 허용한 공개 라이선스·언어·장르의 카탈로그만 반환한다."""
        try:
            manifest = begin(query, self.content, self.failure)
            snapshot = self.templates
            licenses = self.allowed_licenses
            evidence = []
            for item in snapshot:
                if (not item.public or not item.license_active or item.license_ref not in self.allowed_licenses
                        or (item.expires_at is not None and datetime.now(timezone.utc) >= item.expires_at)
                        or (query.language is not None and item.language != query.language)
                        or (query.genre is not None and item.genre != query.genre)
                        or (tags and not set(tags).intersection(item.tags))):
                    continue
                evidence.append(Evidence(
                    id=item.id, retrieval_type="template", source_backend="mock_template", is_mock=True,
                    retrieved_at=datetime.now(timezone.utc),
                    source_revision=SourceVersion("catalog", "template", item.id, item.revision),
                    template_id=item.id, catalog_revision=item.revision, license_ref=item.license_ref,
                    content=item.name + " " + " ".join(item.tags), canonical_status="verified_source",
                    evidence_refs=(item.id,), retrieval_score=item.rank, score_kind="rank"))
            result = finish(query, self.content, manifest, evidence, [])
            selected_ids = {e.template_id for e in result.evidence}
            if self.templates != snapshot or self.allowed_licenses != licenses or any(
                    item.expires_at is not None and datetime.now(timezone.utc) >= item.expires_at
                    for item in snapshot if item.id in selected_ids):
                raise ContentReadError("denied")
            return result
        except ContentReadError as error:
            return failed(error)
