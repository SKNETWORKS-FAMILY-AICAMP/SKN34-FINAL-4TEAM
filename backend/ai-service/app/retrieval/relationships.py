"""명시적으로 주입한 합성 Studio 연결의 현재 관계만 재현한다."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from pydantic import StrictBool

from ._mock import begin, failed, finish
from .content_client import ContentReadError, Scope, SourceVersion
from .contracts import Contract, Evidence, Id, Query, RetrievalResult
from .mock_content import MockContentReadPort


class Relationship(Contract):
    id: Id
    source: Id
    target: Id
    label: Id
    directed: StrictBool


@dataclass
class MockRelationshipGraph:
    """테스트의 Content 발급자가 부여한 연결·허용 카드·현재 CAS token 대역."""

    scope: Scope = field(repr=False)
    graph_version: str
    allowed_entity_ids: frozenset[str] = field(repr=False)
    relationships: tuple[Relationship, ...] = field(repr=False)
    complete: bool = True


@dataclass
class RelationshipGraphRetriever:
    content: MockContentReadPort = field(repr=False)
    graph: MockRelationshipGraph | None = field(repr=False)
    failure: Literal["timeout"] | None = None
    retrieval_type: Literal["relationship"] = field(default="relationship", init=False)

    async def search(self, query: Query) -> RetrievalResult:
        """개인 작가 보기의 현재 관계만 반환하며 과거 상태를 추측하지 않는다."""
        try:
            manifest = begin(query, self.content, self.failure, ("search", "current"))
            if query.episode_range is not None or self.graph is None or query.scope.world_id is None:
                raise ContentReadError("unsupported")
            graph = self.graph
            if graph.scope != query.scope or query.scope.audience != "owner":
                raise ContentReadError("denied")
            if not graph.complete:
                raise ContentReadError("unavailable")
            version = graph.graph_version
            evidence = []
            for relation in graph.relationships:
                if not {relation.source, relation.target} <= graph.allowed_entity_ids:
                    raise ContentReadError("denied")
                evidence.append(Evidence(
                    id=relation.id, retrieval_type="relationship", source_backend="mock_relationship",
                    is_mock=True, retrieved_at=datetime.now(timezone.utc), work_id=query.scope.work_id,
                    fork_id=query.scope.fork_id, document_id=relation.id,
                    source_revision=SourceVersion(query.scope.work_id, "relationship", relation.id, version),
                    content=relation.label, fact_or_relation=relation.model_dump_json(),
                    canonical_status="verified_source", entity_ids=(relation.source, relation.target),
                    evidence_refs=(relation.id,), retrieval_score=1, score_kind="rank"))
            result = finish(query, self.content, manifest, evidence, [])
            if graph.graph_version != version or not graph.complete or graph.scope != query.scope:
                raise ContentReadError("denied")
            return result
        except ContentReadError as error:
            return failed(error)
