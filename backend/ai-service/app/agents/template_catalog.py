"""작품 원고와 분리된 합성 공개 카탈로그. 실제 추천 모델을 호출하지 않는다."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from pydantic import AwareDatetime, Field, StrictBool

from app.retrieval.content_client import CanonicalAdapter
from app.retrieval.content_client import ContentReadError
from app.retrieval.contracts import Contract, Gap, Id, PositiveInt, Query
from app.retrieval.mock_content import MockContentReadPort


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


class CatalogEntry(Contract):
    id: Id
    retrieval_type: Literal["template"] = "template"
    template_id: Id
    catalog_revision: Id
    license_ref: Id
    content: str = Field(repr=False)
    evidence_refs: tuple[Id, ...] = ()
    is_mock: Literal[True] = True


class CatalogResult(Contract):
    status: Literal["ok","partial","denied","unsupported","unavailable"]
    evidence: tuple[CatalogEntry,...] = ()
    gaps: tuple[Gap,...] = ()
    is_mock: Literal[True] = True


@dataclass
class TemplateCatalog:
    content: MockContentReadPort = field(repr=False)
    templates: tuple[Template, ...] = field(repr=False)
    allowed_licenses: frozenset[str] = field(repr=False)
    failure: Literal["timeout"] | None = None
    retrieval_type: Literal["template"] = field(default="template", init=False)

    async def search(self, query: Query, *, tags: tuple[str, ...] = ()) -> CatalogResult:
        """서버가 허용한 공개 라이선스·언어·장르의 카탈로그만 반환한다."""
        try:
            canonical = CanonicalAdapter(self.content)
            manifest = canonical.manifest(query.scope)
            if self.failure or datetime.now(timezone.utc) >= query.deadline:
                raise ContentReadError("unavailable")
            if query.operation != "search":
                raise ContentReadError("unsupported")
            snapshot = self.templates
            licenses = self.allowed_licenses
            evidence = []
            remaining = query.token_budget
            gaps = []
            for item in sorted(snapshot,key=lambda t:(t.rank,t.id)):
                if (not item.public or not item.license_active or item.license_ref not in self.allowed_licenses
                        or (item.expires_at is not None and datetime.now(timezone.utc) >= item.expires_at)
                        or (query.language is not None and item.language != query.language)
                        or (query.genre is not None and item.genre != query.genre)
                        or (tags and not set(tags).intersection(item.tags))):
                    continue
                description=item.name + " " + " ".join(item.tags)
                size=len(description.encode())
                if size>remaining:
                    gaps.append(Gap(code="unverified"))
                    continue
                remaining-=size
                evidence.append(CatalogEntry(id=item.id,template_id=item.id,catalog_revision=item.revision,
                    license_ref=item.license_ref,content=description,evidence_refs=(item.id,)))
                if len(evidence)==query.top_k:
                    break
            if canonical.manifest(query.scope)!=manifest:
                raise ContentReadError("denied")
            if datetime.now(timezone.utc)>=query.deadline:
                raise ContentReadError("unavailable")
            result=CatalogResult(status="partial" if gaps else "ok",evidence=tuple(evidence),gaps=tuple(gaps))
            selected_ids = {e.template_id for e in result.evidence}
            if self.templates != snapshot or self.allowed_licenses != licenses or any(
                    item.expires_at is not None and datetime.now(timezone.utc) >= item.expires_at
                    for item in snapshot if item.id in selected_ids):
                raise ContentReadError("denied")
            return result
        except ContentReadError as error:
            return CatalogResult(status=error.status)
