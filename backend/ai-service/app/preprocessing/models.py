"""회차 원고 전처리 DTO(DEC-50, docs/design/manuscript-preprocessing-contract.md): 접수 요청, Content 회차 원문, 적재 payload.

추출·정체 정리의 중간 결과와 모델 structured output DTO는 전처리 로직 작업자가 이 파일에 더한다(service.py 참고).
"""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DOC_LIMIT = 3000     # 카드 본문·인물 문서마다의 글자 한도(DEC-47)
EpisodeNumber = Annotated[int, Field(strict=True, ge=1)]
Doc = Annotated[str, Field(max_length=DOC_LIMIT)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


# ── 접수 ──

class JobRequest(Model):
    """Content가 접수하는 전처리 작업. 실패 회차 재시도는 성공 결과 보존 계약 구현 전까지 비활성이다."""
    jobId: UUID
    workId: UUID
    episodes: list[EpisodeNumber] = Field(min_length=1)

    @field_validator('episodes')
    @classmethod
    def unique(cls, episodes: list[int]) -> list[int]:
        if len(set(episodes)) != len(episodes):
            raise ValueError('DUPLICATE_EPISODE')
        return episodes


class Accepted(Model):
    jobId: UUID


class EpisodeText(BaseModel):
    """Content `preprocessing_episode_read`의 결과. 모르는 필드는 무시한다."""
    number: EpisodeNumber
    title: str
    body: str


# ── 적재 payload (계약의 cards[]·relations[]) ──

class CharacterDocs(Model):
    soul: Doc
    goal: Doc
    episodes: dict[str, Doc]


class Card(Model):
    key: str
    cardType: Literal['character', 'location', 'organization', 'object', 'event']
    title: str
    aliases: list[str]
    body: Doc
    revealFromEpisode: EpisodeNumber
    characterDocs: CharacterDocs | None = None


class Relation(Model):
    fromKey: str
    toKey: str
    label: str
    fromEpisode: EpisodeNumber
    ended: bool | None = None


class LoadPayload(Model):
    cards: list[Card]
    relations: list[Relation]


# ── 모델 출력과 검증된 중간 결과 (#344). 정본 UUID는 생성하지 않는다. ──
LocalId = Annotated[str, Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')]
Quote = Annotated[str, Field(min_length=1, max_length=3000)]
EntityKind = Literal['character', 'location', 'organization', 'object']


class Mention(Model):
    id: LocalId
    name: Annotated[str, Field(min_length=1, max_length=120)]
    kind: EntityKind
    quote: Quote


class Statement(Model):
    id: LocalId
    kind: Literal['event', 'description', 'rule', 'fact', 'conjecture', 'goal', 'plan']
    certainty: Literal['asserted', 'uncertain', 'intended']
    subjects: list[LocalId] = Field(min_length=1)
    knowers: list[LocalId]
    document: Literal['identity', 'soul', 'goal', 'memory']
    occurredEpisode: Annotated[int, Field(strict=True, ge=0)] | None
    knownFromEpisode: Annotated[int, Field(strict=True, ge=0)]
    quote: Quote


class ExtractedRelation(Model):
    id: LocalId
    source: LocalId
    target: LocalId
    label: Annotated[str, Field(min_length=1, max_length=100)]
    fromEpisode: EpisodeNumber
    ended: bool
    change: Literal["started", "changed", "ended", "learned"]
    quote: Quote


class ProposedExtraction(Model):
    mentions: list[Mention]
    statements: list[Statement]
    relationships: list[ExtractedRelation]


class Evidence(Model):
    quote: str
    start: int
    end: int
    quoteHash: str


class EpisodeExtraction(ProposedExtraction):
    schemaVersion: Literal['manuscript-extraction.v1'] = 'manuscript-extraction.v1'
    number: EpisodeNumber
    title: str
    source: str
    sourceHash: str
    evidence: list[Evidence]


class IdentityLink(Model):
    left: str
    right: str
    basis: Literal['explicit_alias', 'explicit_coreference', 'name_only', 'uncertain', 'distinct']
    confirmedAt: EpisodeNumber
    evidenceEpisode: EpisodeNumber
    quote: Quote


class ProposedResolution(Model):
    links: list[IdentityLink]


class IdentityDecision(Model):
    link: IdentityLink
    status: Literal['merged', 'deferred', 'distinct']
    reason: str


class IdentityResolution(Model):
    schemaVersion: Literal['manuscript-identity.v1'] = 'manuscript-identity.v1'
    inputHashes: dict[int, str]
    mapping: dict[str, str]
    decisions: list[IdentityDecision]
