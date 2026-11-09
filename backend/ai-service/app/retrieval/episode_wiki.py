"""합성 회차·장면·사건·지식·복선과 인과 참조를 인용 판본에 연결한다."""

from dataclasses import dataclass, field
from typing import Literal

from ._mock import search_sources
from .contracts import Evidence, Query, RetrievalResult
from .mock_content import MockContentReadPort


@dataclass
class EpisodeWikiRetriever:
    content: MockContentReadPort = field(repr=False)
    candidates: tuple[Evidence, ...] = field(repr=False)
    failure: Literal["timeout"] | None = None
    retrieval_type: Literal["wiki"] = field(default="wiki", init=False)

    async def search(self, query: Query) -> RetrievalResult:
        """정본과 모든 파생 근거가 허용된 Wiki 행만 반환한다."""
        return search_sources(query, self.content, self.candidates, self.retrieval_type, self.failure)

    async def coverage(self, query: Query) -> RetrievalResult:
        """top-k와 별개로 유한한 합성 색인의 회차별 원문 근거를 전부 확인한다."""
        inventory = query.model_copy(update={
            "operation": "search", "query_text": None, "entity_ids": (), "required_fields": (),
            "top_k": max(1, len(self.candidates)),
            "token_budget": max(1, sum(len(e.model_dump_json().encode("utf-8")) for e in self.candidates)),
        })
        return search_sources(inventory, self.content, self.candidates, self.retrieval_type, self.failure, inventory=True)
