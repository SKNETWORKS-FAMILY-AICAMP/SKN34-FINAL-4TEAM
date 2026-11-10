"""Agent 입력·응답에 공통으로 사용하는 정본 문맥 재검증."""
from .content_client import CanonicalAdapter, ContentReadError
from .coordinator import ContextPacket


def validate_packet(packet, query, content):
    """모델/Agent 입력 및 응답 직전에 정본·citation·시점·mock 태그를 확인한다."""
    packet = ContextPacket.model_validate(packet.model_dump())
    canonical = CanonicalAdapter(content)
    manifest = canonical.manifest(query.scope)
    if (packet.scope_ref != query.scope.digest() or packet.manifest_ref != manifest.manifest_ref
            or packet.basis_episode != query.scope.basis_episode or packet.viewpoint != query.scope.audience
            or not packet.result.is_mock):
        raise ContentReadError("denied")
    evidence = {item.id: item for item in packet.result.evidence}
    if len(evidence) != len(packet.result.evidence):
        raise ContentReadError("denied")
    for item in evidence.values():
        row = next((row for row in content.rows if row.version == item.source_revision), None)
        if (not item.is_mock or item.retrieval_type not in ("wiki", "manuscript", "canonical")
                or row is None or item.as_of_episode != row.episode
                or item.source_revision not in manifest.source_versions or item.source_span is None or item.source_hash is None
                or item.work_id != item.source_revision.work_id or item.document_id != item.source_revision.document_id
                or item.fork_id not in (None, query.scope.fork_id) or item.as_of_episode is None
                or not 1 <= item.as_of_episode <= query.scope.basis_episode
                or (query.episode_range and not query.episode_range[0] <= item.as_of_episode <= query.episode_range[1])
                or (query.document_ids and item.document_id not in query.document_ids)
                or (query.source_kinds and item.source_revision.kind not in query.source_kinds)
                or (item.visible_from is not None and item.visible_from > query.scope.basis_episode)
                or (item.visible_to is not None and item.visible_to < query.scope.basis_episode)
                or (query.scope.audience == "character" and query.scope.character_id not in (item.known_by or ())
                    and "*" not in (item.known_by or ()))):
            raise ContentReadError("denied")
        source = canonical.read(query.scope, item.source_revision, item.source_span, item.source_hash)
        if source.text != item.content or not source.is_mock:
            raise ContentReadError("denied")
    for projected in packet.context:
        item = evidence.get(projected.evidence_ref)
        if item is None or projected.source_revision != item.source_revision or projected.source_hash != item.source_hash or (
                projected.content is not None and projected.content != item.content):
            raise ContentReadError("denied")
    coverage = packet.result.coverage
    if coverage is not None and not coverage.is_mock:
        raise ContentReadError("denied")
    full = query.operation in ("review", "full_context")
    start, end = query.episode_range or (1, query.scope.basis_episode)
    expected = {n for n in manifest.expected_episodes if start <= n <= end}
    complete = bool(coverage and coverage.is_mock and coverage.manifest_ref == manifest.manifest_ref
                    and coverage.requested_range == (start, end) and expected
                    and {e.number for e in coverage.episodes} == expected
                    and coverage.verified_count == coverage.expected_count and not coverage.critical_gaps)
    conclude = bool(packet.context) and packet.can_conclude and packet.result.status == "ok" and (
        complete if full else True) and not packet.result.conflicts and not packet.result.gaps and not packet.omitted_refs and all(
            item.canonical_status == "verified_source" for item in evidence.values())
    return packet.model_copy(update={"complete": complete, "can_conclude": conclude})
