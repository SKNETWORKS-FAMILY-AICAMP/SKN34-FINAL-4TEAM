"""미리 나눈 합성 원고 문단을 정본 판본·UTF-16 span으로 검증한다."""

from dataclasses import dataclass, field
from typing import Literal

from ._mock import search_sources
from .contracts import Evidence, Query, RetrievalResult
from .mock_content import MockContentReadPort


@dataclass
class ManuscriptVectorRetriever:
    content: MockContentReadPort = field(repr=False)
    candidates: tuple[Evidence, ...] = field(repr=False)
    failure: Literal["timeout"] | None = None
    retrieval_type: Literal["manuscript"] = field(default="manuscript", init=False)

    async def search(self, query: Query) -> RetrievalResult:
        """실제 임베딩 없이 고정 순위의 합성 chunk만 검색한다."""
        return search_sources(query, self.content, self.candidates, self.retrieval_type, self.failure)
