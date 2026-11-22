"""최초 원고 구축의 추출·정체·적재 DTO. 작업 접수와 영속 상태는 Content가 소유한다."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

DOC_LIMIT = 3000     # 카드 본문·인물 문서마다의 글자 한도(DEC-47)
EpisodeNumber = Annotated[int, Field(strict=True, ge=1)]
Doc = Annotated[str, Field(max_length=DOC_LIMIT)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


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
    """최초 일괄 적재 카드. 첫 등장 회차는 독자 공개 승인이나 공개 회차가 아니다."""
    key: str
    cardType: Literal['character', 'location', 'organization', 'object', 'rule', 'event']
    title: str
    aliases: list[str]
    body: Doc
    firstEpisode: EpisodeNumber
    characterDocs: CharacterDocs | None = None


class Relation(Model):
    fromKey: str
    toKey: str
    label: str
    fromEpisode: EpisodeNumber
    ended: bool | None = None


class IdentityCandidate(Model):
    fromKey: str
    toKey: str
    episode: EpisodeNumber
    quote: str


class LoadPayload(Model):
    cards: list[Card]
    relations: list[Relation]
    identityCandidates: list[IdentityCandidate] = Field(default_factory=list)


# ── 모델 출력과 검증된 중간 결과 (#344). 정본 UUID는 생성하지 않는다. ──
LocalId = Annotated[str, Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')]
Quote = Annotated[str, Field(min_length=1, max_length=3000)]
EntityKind = Literal['character', 'location', 'organization', 'object', 'rule']


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


class ProposedRelation(Model):
    """모델이 내는 관계. 회차는 묻지 않는다: 시작 회차는 현재 회차, 종료 여부는 change에서 프로그램이 채운다."""
    id: LocalId
    source: LocalId
    target: LocalId
    label: Annotated[str, Field(min_length=1, max_length=100)]
    change: Literal['started', 'ended']
    quote: Quote


class ExtractedRelation(ProposedRelation):
    """저장되는 관계. Content가 이 모양(fromEpisode·ended)으로 다시 검증한다."""
    fromEpisode: EpisodeNumber
    ended: bool


class ProposedExtraction(Model):
    mentions: list[Mention]
    statements: list[Statement]
    relationships: list[ProposedRelation]


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
    relationships: list[ExtractedRelation]
    evidence: list[Evidence]
    skipped: dict[str, int] = Field(default_factory=dict)  # 근거를 확인하지 못해 뺀 항목의 코드별 건수


class IdentityLink(Model):
    left: str
    right: str
    basis: Literal['explicit_alias', 'explicit_coreference', 'same_name', 'name_only', 'uncertain', 'distinct']
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
