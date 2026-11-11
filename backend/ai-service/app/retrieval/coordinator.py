"""허용 검색 경로의 병렬 실행·정본 재검증·전체 회차 확인·Agent 문맥 투영."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
import json

from pydantic import Field

from .content_client import CanonicalAdapter, ContentReadError, SourceVersion
from .contracts import (Conflict, Contract, Coverage, EpisodeCoverage, EpisodeRange, Evidence, Gap, Query,
                        RetrievalPort, RetrievalResult, Span)
from .mock_content import MockContentReadPort


class ContextItem(Contract):
    evidence_ref: str
    source_revision: SourceVersion
    source_hash: str | None = None
    canonical_status: str
    retrieval_type: str
    content: str | None = Field(default=None, repr=False)
    fact_or_relation: str | None = Field(default=None, repr=False)
    source_span: Span | None = None
    scene_id: str | None = None
    known_by: tuple[str, ...] | None = None
    evidence_refs: tuple[str, ...] = ()
    entity_ids: tuple[str, ...] = ()
    as_of_episode: int | None = None


class ContextPacket(Contract):
    scope_ref: str
    manifest_ref: str
    basis_episode: int
    viewpoint: str
    result: RetrievalResult
    context: tuple[ContextItem, ...] = Field(default=(), repr=False)
    complete: bool = False
    can_conclude: bool = False
    budget_units_used: int = 0
    budget_kind: str = "utf8_bytes"
    omitted_refs: tuple[str, ...] = ()
    omitted_ranges: tuple[EpisodeRange, ...] = ()


def select_paths(query: Query) -> tuple[str, ...]:
    paths = {"quote": ("manuscript",), "current": ("relationship",),
             "review": ("wiki", "manuscript"),
             "full_context": ("wiki", "manuscript"), "context": ("wiki", "manuscript")}
    if query.operation in paths:
        return paths[query.operation]
    if query.operation != "search":
        raise ContentReadError("unsupported")
    fields = set(query.required_fields)
    if fields - Evidence.model_fields.keys():
        raise ContentReadError("unsupported")
    if fields & {"scene_id", "known_by", "evidence_refs", "fact_or_relation"}:
        return ("wiki",)
    if fields & {"source_span", "source_hash"}:
        return ("manuscript",)
    return ("wiki", "manuscript")


@dataclass
class RetrievalCoordinator:
    """현재 합성 Content 전용. 결과 캐시는 저장하지 않고 매 요청을 재검증한다."""

    content: MockContentReadPort = field(repr=False)
    ports: dict[str, RetrievalPort] = field(repr=False)
    index_generation: str

    def cache_key(self, query: Query) -> str:
        payload = {"scope": query.scope.digest(), "query": query.model_dump(mode="json", exclude={"scope"}),
                   "index_generation": self.index_generation}
        return sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()

    async def _call(self, kind: str, query: Query, inventory: bool = False) -> RetrievalResult:
        port = self.ports.get(kind)
        method = getattr(port, "coverage", None) if inventory else getattr(port, "search", None)
        if method is None:
            return RetrievalResult(status="unsupported", is_mock=True)
        remaining = (query.deadline - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            return RetrievalResult(status="unavailable", is_mock=True)
        try:
            return await asyncio.wait_for(method(query), timeout=remaining)
        except (TimeoutError, OSError):
            return RetrievalResult(status="unavailable", is_mock=True)
        except ContentReadError as error:
            return RetrievalResult(status=error.status, is_mock=True)

    def _verify(self, query: Query, kind: str, result: RetrievalResult) -> tuple[Evidence, ...]:
        canonical = CanonicalAdapter(self.content)
        manifest = canonical.manifest(query.scope)
        if result.status == "denied" or not result.is_mock:
            raise ContentReadError("denied")
        rows = {r.version: r for r in self.content.rows if r.version in manifest.source_versions}
        for item in result.evidence:
            if item.retrieval_type != kind or not item.is_mock:
                raise ContentReadError("denied")
            if kind == "relationship":
                # 해당 공급자의 현재 CAS는 retrieve 반환 직전에 다시 확인한다.
                continue
            row = rows.get(item.source_revision)
            if row is None:
                raise ContentReadError("denied")
            fork = row.version.work_id if row.version.work_id == query.scope.fork_id else None
            if (item.work_id != row.version.work_id or item.document_id != row.version.document_id
                    or item.fork_id != fork or item.as_of_episode != row.episode
                    or (query.episode_range and not query.episode_range[0] <= row.episode <= query.episode_range[1])
                    or (query.document_ids and item.document_id not in query.document_ids)
                    or (query.source_kinds and row.version.kind not in query.source_kinds)
                    or (item.visible_from is not None and item.visible_from > query.scope.basis_episode)
                    or (item.visible_to is not None and item.visible_to < query.scope.basis_episode)
                    or (query.scope.audience == "character" and (not item.known_by or
                        query.scope.character_id not in item.known_by and "*" not in item.known_by))):
                raise ContentReadError("denied")
            source = canonical.read(query.scope, row.version, item.source_span, item.source_hash)
            if not source.is_mock or source.text != item.content:
                raise ContentReadError("denied")
        return result.evidence

    def _coverage(self, query: Query, inventory: RetrievalResult) -> Coverage:
        manifest = CanonicalAdapter(self.content).manifest(query.scope)
        allowed = set(manifest.source_versions)
        start, end = query.episode_range or (1, query.scope.basis_episode)
        rows = [r for r in self.content.rows if r.version in allowed and start <= r.episode <= end
                and (not query.document_ids or r.version.document_id in query.document_ids)
                and (not query.source_kinds or r.version.kind in query.source_kinds)]
        numbers = sorted({r.episode for r in rows} & set(manifest.expected_episodes))
        evidence = self._verify(query, "wiki", inventory)
        episodes = []
        gaps = []
        ids = {e.id for e in evidence}
        gaps.extend(Gap(code="unverified", episode_number=e.as_of_episode) for e in evidence
                    if any(ref not in ids for ref in e.evidence_refs))
        for number in numbers:
            hits = [e for e in evidence if e.as_of_episode == number]
            reasons = [g.code for g in inventory.gaps if g.episode_number == number]
            state = ("timeout" if inventory.status == "unavailable" else
                     "unsupported" if inventory.status == "unsupported" else
                     "stale" if "stale" in reasons else
                     "unverified" if hits and any(e.canonical_status != "verified_source" for e in hits) else
                     "verified" if hits else "missing")
            if state != "verified":
                gaps.append(Gap(episode_number=number, code=state))
            revisions = {r.version.revision for r in rows if r.episode == number}
            revision = next(iter(revisions)) if len(revisions) == 1 else None
            episodes.append(EpisodeCoverage(number=number, expected_rev=revision,
                                            indexed_rev=revision if state == "verified" else None,
                                            state=state, refs=tuple(e.id for e in hits)))
        return Coverage(manifest_ref=manifest.manifest_ref, requested_range=(start, end),
                        expected_count=len(numbers), verified_count=sum(e.state == "verified" for e in episodes),
                        episodes=tuple(episodes), missing_ranges=tuple((e.number, e.number) for e in episodes if e.state != "verified"),
                        critical_gaps=tuple(gaps), checked_at=datetime.now(timezone.utc), is_mock=True)

    async def retrieve(self, query: Query) -> ContextPacket:
        """선택된 독립 조회만 병렬화하고 검증된 근거를 Agent 필드로 투영한다."""
        packet = dict(scope_ref=query.scope.digest(), manifest_ref=query.scope.manifest_ref,
                      basis_episode=query.scope.basis_episode, viewpoint=query.scope.audience)
        try:
            canonical = CanonicalAdapter(self.content)
            manifest = canonical.manifest(query.scope)
            paths = select_paths(query)
            full = query.operation in ("review", "full_context")
            # coverage는 top-k/질문과 별개인 한 번의 유한한 manifest 검증이다.
            jobs = [self._call(kind, query.model_copy(update={"operation": "search"})) for kind in paths]
            if full:
                jobs.append(self._call("wiki", query, inventory=True))
            responses = await asyncio.gather(*jobs)
            coverage = self._coverage(query, responses[-1]) if full else None
            results = responses[:len(paths)]
            evidence = []
            seen = set()
            gaps = []
            conflicts = []
            for kind, result in zip(paths, results):
                verified = self._verify(query, kind, result)
                if kind == "relationship" and verified:
                    latest = await self._call(kind, query.model_copy(update={"operation": "search"}))
                    if latest.status not in ("ok", "partial") or any(
                            not any(old.model_dump(exclude={"retrieved_at"}) == new.model_dump(exclude={"retrieved_at"})
                                    for new in latest.evidence) for old in verified):
                        raise ContentReadError("denied")
                gaps.extend(result.gaps)
                conflicts.extend(result.conflicts)
                if result.status not in ("ok", "partial"):
                    gaps.append(Gap(code="timeout" if result.status == "unavailable" else "unsupported"))
                for item in verified:
                    key = (item.source_revision, item.id, item.source_span)
                    # 원고 chunk의 id가 달라도 같은 원문 구간은 한 번만 넣는다.
                    if item.retrieval_type in ("manuscript", "canonical"):
                        key = (item.source_revision, item.source_span)
                    if key not in seen:
                        evidence.append(item)
                        seen.add(key)
                    else:
                        previous = next(e for e in evidence if e.source_revision == item.source_revision
                                        and e.retrieval_type == item.retrieval_type and e.source_span == item.source_span and
                                        (kind == "manuscript" or e.id == item.id))
                        if (previous.canonical_status, previous.fact_or_relation) != (item.canonical_status, item.fact_or_relation):
                            evidence[evidence.index(previous)] = previous.model_copy(update={"canonical_status": "disputed"})
                            alternative_id = item.id
                            if alternative_id == previous.id:
                                alternative_id += ":" + sha256(item.model_dump_json(exclude={"retrieved_at"}).encode("utf-8")).hexdigest()[:16]
                            evidence.append(item.model_copy(update={"id": alternative_id, "canonical_status": "disputed"}))
                            conflicts.append(Conflict(evidence_refs=(previous.id, alternative_id)))
            context, omitted = [], []
            used = 0
            fields = set(query.required_fields) or {"content"}
            projection_fields = set(ContextItem.model_fields) - {
                "evidence_ref", "source_revision", "source_hash", "canonical_status", "retrieval_type"}
            for item in evidence[:query.top_k]:
                values = {name: getattr(item, name) for name in fields & projection_fields}
                projected = ContextItem(evidence_ref=item.id, source_revision=item.source_revision,
                                        source_hash=item.source_hash, canonical_status=item.canonical_status,
                                        retrieval_type=item.retrieval_type, **values)
                # shortcut: tokenizer 도입 전에는 metadata까지 포함한 UTF-8 byte 상한을 사용한다.
                cost = len(projected.model_dump_json(exclude_none=True).encode("utf-8"))
                if used + cost > query.token_budget:
                    omitted.append(item.id)
                else:
                    context.append(projected)
                    used += cost
            if omitted:
                gaps.append(Gap(code="unverified"))
            omitted_ranges = tuple((e.number, e.number) for e in coverage.episodes) if (
                coverage and not context and any(g.code == "unverified" for g in gaps)) else ()
            if canonical.manifest(query.scope) != manifest:
                raise ContentReadError("denied")
            if datetime.now(timezone.utc) >= query.deadline:
                raise ContentReadError("unavailable")
            statuses = [r.status for r in results]
            status = "partial" if gaps or any(s == "partial" for s in statuses) else "ok"
            if not evidence and statuses and all(s == "unavailable" for s in statuses):
                status = "unavailable"
            elif not evidence and statuses and all(s == "unsupported" for s in statuses):
                status = "unsupported"
            if coverage and coverage.critical_gaps and status == "ok":
                status = "partial"
            complete = bool(coverage and coverage.expected_count > 0 and
                            coverage.verified_count == coverage.expected_count and not coverage.critical_gaps)
            disputed = any(e.canonical_status in ("disputed", "hypothetical") for e in evidence)
            can_conclude = bool(context) and not omitted and not conflicts and not disputed and (complete if full else status == "ok")
            return ContextPacket(**packet, result=RetrievalResult(status=status, is_mock=True,
                evidence=tuple(evidence), gaps=tuple(gaps), conflicts=tuple(conflicts), coverage=coverage),
                context=tuple(context), complete=complete, can_conclude=can_conclude,
                budget_units_used=used, omitted_refs=tuple(omitted), omitted_ranges=omitted_ranges)
        except ContentReadError as error:
            return ContextPacket(**packet, result=RetrievalResult(status=error.status, is_mock=True))
