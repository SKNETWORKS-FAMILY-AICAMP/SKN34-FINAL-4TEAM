"""합성 검색기만 사용하는 인가·정확 인용·고정 순위 처리. 캐시는 두지 않는다."""

from datetime import datetime, timezone
from hashlib import sha256

from .content_client import CanonicalAdapter, ContentReadError, Manifest
from .contracts import Evidence, Gap, Query, RetrievalResult
from .mock_content import MockContentReadPort


def begin(query: Query, content: MockContentReadPort, failure: str | None,
          operations: tuple[str, ...] = ("search",)) -> Manifest:
    manifest = CanonicalAdapter(content).manifest(query.scope)
    if failure is not None or datetime.now(timezone.utc) >= query.deadline:
        raise ContentReadError("unavailable")
    if query.operation not in operations or any(field not in Evidence.model_fields for field in query.required_fields):
        raise ContentReadError("unsupported")
    return manifest


def failed(error: ContentReadError) -> RetrievalResult:
    return RetrievalResult(status=error.status, is_mock=True)


def matches(query: Query, item: Evidence) -> bool:
    return (not query.document_ids or (item.document_id or item.template_id) in query.document_ids) and (
        not query.entity_ids or bool(set(query.entity_ids).intersection(item.entity_ids))) and (
        query.episode_range is None or (item.as_of_episode is not None
                                       and query.episode_range[0] <= item.as_of_episode <= query.episode_range[1])) and (
        not query.source_kinds or item.source_revision.kind in query.source_kinds) and (
        not query.query_text or query.query_text.casefold() in item.content.casefold())


def finish(query: Query, content: MockContentReadPort, manifest: Manifest,
           evidence: list[Evidence], gaps: list[Gap]) -> RetrievalResult:
    selected = []
    remaining = query.token_budget
    for item in sorted(evidence, key=lambda e: (e.retrieval_score or 0, e.id)):
        if not matches(query, item):
            continue
        if any(getattr(item, field) in (None, (), "") for field in query.required_fields):
            gaps.append(Gap(code="unverified"))
            continue
        if len(selected) >= query.top_k:
            break
        # shortcut: UTF-8 byte 수로 보수적으로 제한한다. 실제 모델 연결 때 tokenizer로 교체한다.
        cost = len(item.content.encode("utf-8")) + len((item.fact_or_relation or "").encode("utf-8"))
        if cost > remaining:
            gaps.append(Gap(code="unverified"))
            continue
        selected.append(item)
        remaining -= cost
    if CanonicalAdapter(content).manifest(query.scope) != manifest:
        raise ContentReadError("denied")
    if datetime.now(timezone.utc) >= query.deadline:
        raise ContentReadError("unavailable")
    return RetrievalResult(status="partial" if gaps else "ok", is_mock=True,
                           evidence=tuple(selected), gaps=tuple(gaps))


def search_sources(query: Query, content: MockContentReadPort, candidates: tuple[Evidence, ...],
                   kind: str, failure: str | None, inventory: bool = False) -> RetrievalResult:
    try:
        manifest = begin(query, content, failure)
        canonical = CanonicalAdapter(content)
        allowed = set(manifest.source_versions)
        rows = {row.version: row for row in content.rows if row.version in allowed}
        verified = {}
        gaps = []
        for item in candidates:
            version = item.source_revision
            if kind == "manuscript" and version.kind not in ("manuscript", "draft", "conti"):
                continue
            if kind == "manuscript" and ((query.document_ids and version.document_id not in query.document_ids)
                                        or (query.source_kinds and version.kind not in query.source_kinds)):
                continue
            if version not in allowed:
                current = next((v for v in allowed if (v.work_id, v.kind, v.document_id) ==
                                (version.work_id, version.kind, version.document_id)), None)
                if current is not None and (query.episode_range is None
                                           or query.episode_range[0] <= rows[current].episode <= query.episode_range[1]) and (
                        not query.document_ids or current.document_id in query.document_ids) and (
                        not query.source_kinds or current.kind in query.source_kinds):
                    gaps.append(Gap(code="stale", episode_number=rows[current].episode))
                continue
            row = rows[version]
            expected_fork = version.work_id if version.work_id == query.scope.fork_id else None
            if (item.work_id != version.work_id or item.document_id != version.document_id
                    or item.fork_id != expected_fork or item.as_of_episode != row.episode
                    or item.retrieval_type != kind or item.id in verified):
                raise ContentReadError("denied")
            if kind == "manuscript" and query.episode_range is not None and not (
                    query.episode_range[0] <= row.episode <= query.episode_range[1]):
                continue
            result = canonical.read(query.scope, version, item.source_span, item.source_hash)
            if not result.is_mock:
                raise ContentReadError("denied")
            verified[item.id] = item.model_copy(update={
                "content": result.text, "is_mock": True, "source_backend": "mock_" + kind,
                "known_by": row.known_by, "visible_from": row.episode, "visible_to": row.visible_to,
                "retrieved_at": datetime.now(timezone.utc),
                "source_hash": sha256(result.text.encode("utf-8")).hexdigest(),
            })
        if kind == "wiki":
            eligible = {r.episode for r in rows.values()
                        if (query.episode_range is None or query.episode_range[0] <= r.episode <= query.episode_range[1])
                        and (not query.document_ids or r.version.document_id in query.document_ids)
                        and (not query.source_kinds or r.version.kind in query.source_kinds)}
            present = {e.as_of_episode for e in verified.values()}
            stale = {gap.episode_number for gap in gaps}
            gaps.extend(Gap(code="missing", episode_number=n) for n in sorted(eligible - present - stale))
            # 파생 경로의 한 출처라도 없거나 비허용이면 그 경로 전체를 닫는다.
            while not inventory:
                invalid = [key for key, item in verified.items()
                           if any(ref not in verified for ref in item.evidence_refs)]
                if not invalid:
                    break
                for key in invalid:
                    del verified[key]
                    gaps.append(Gap(code="unverified"))
        return finish(query, content, manifest, list(verified.values()), gaps)
    except ContentReadError as error:
        return failed(error)
