"""설정집 AI 검토(world review) 내부 API 계약(docs/design/world-review-contract.md).

요청은 설정집 스냅샷(활성 카드·관계)이고 지적은 모델이 카드 id로 가리킨다. 인물 카드의 body는 IDENTITY.md이고 characterDocs가
SOUL·GOAL·회차 문서(DEC-47)다. 옛 memory(DEC-47 이전)는 novelbrain과 같은 규칙으로 00회차 앞에 이어 붙여 읽는다.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.novelbrain.models import with_memory

# 한 번에 보내는 양(계약 'ponytail 한계'). 넘는 카드는 보내는 쪽이 빼고 reviewedCards로 알린다.
MAX_CARDS = 300
MAX_CARD_CHARS = 4000  # 카드 하나의 본문과 모든 인물 문서의 글자 수 합

CardType = Literal['character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other']
AreaCode = Literal['basic', 'space', 'history', 'society', 'culture', 'special', 'conflict']
MAX_FIXES = 5  # enrich가 한 번에 제안하는 칸 수의 상한(하한은 1)
MAX_FILL_CHARS = 12000  # fill이 한 번에 받는 원고 발췌의 글자 수 합(Content가 보내는 상한과 같다)

Kind = Literal['contradiction', 'doc_role', 'missing_info', 'other']
Target = Literal['body', 'soul', 'goal', 'episode']
AffectedKind = Literal['card', 'relationship', 'episode', 'scene']
Certainty = Literal['confirmed', 'inferred']


class CharacterDocs(BaseModel):
    """인물 문서. episodes의 키는 회차 순번(0 = 00회차)이다. memory는 DEC-47 이전의 옛 MEMORY.md이며 읽을 때 episodes[0]으로 옮긴다."""
    soul: str = ''
    goal: str = ''
    memory: str = Field(default='', exclude=True)
    episodes: dict[int, str] = {}

    @model_validator(mode='after')
    def move_memory(self):
        self.episodes, self.memory = with_memory(self.memory, self.episodes), ''
        return self


class RequestCard(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    cardType: CardType
    areaCode: AreaCode
    title: str
    body: str
    characterDocs: CharacterDocs | None = None  # 인물 카드에만 있다

    def chars(self) -> int:
        """본문과 모든 인물 문서의 글자 수 합. 카드당 한도(MAX_CARD_CHARS)의 기준이다."""
        docs = self.characterDocs
        return len(self.body) + (len(docs.soul) + len(docs.goal) + sum(map(len, docs.episodes.values())) if docs else 0)


class Relationship(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    sourceCardId: str
    targetCardId: str
    label: str
    polarity: Literal['asserted', 'denied']  # denied는 '그런 관계가 아님'을 작가가 적은 부정 관계다


class WorldReviewRequest(BaseModel):
    worldName: str
    worldDescription: str
    cards: list[RequestCard] = Field(max_length=MAX_CARDS)
    relationships: list[Relationship]

    @field_validator('cards')
    @classmethod
    def within_card_chars(cls, cards):
        if any(card.chars() > MAX_CARD_CHARS for card in cards):
            raise ValueError(f'카드 하나의 본문과 문서 합계는 {MAX_CARD_CHARS}자 이하여야 합니다.')
        return cards

    def refs(self) -> dict:
        """추적에 남기는 참조. 설정 본문은 추적 결정 범위 밖이라 카드·관계 id만 남긴다."""
        return {'cards': [c.id for c in self.cards], 'relationships': [r.id for r in self.relationships]}


class Fix(BaseModel):
    """카드 하나의 한 칸을 바꿀 새 글. text는 그 칸의 바꾼 뒤 전체 글(3,000자 이하)이다. body는 카드 본문(인물은 IDENTITY)이고, episode는 target이 episode일 때만 회차 순번(0 이상)이다."""
    model_config = ConfigDict(extra='forbid')  # OpenAI strict 구조화 출력은 additionalProperties=false 스키마만 받는다
    cardId: str
    target: Target
    episode: int | None
    text: str


class Finding(BaseModel):
    """지적 하나. cardIds는 관련 카드의 id 1~3개(입력에 있는 id만), message는 300자 이하, fix는 고칠 칸을 정할 수 있을 때만이다. 스키마에는 개수·길이 제약을 못 둬 service가 다시 검증한다."""
    model_config = ConfigDict(extra='forbid')
    cardIds: list[str]
    kind: Kind
    message: str
    fix: Fix | None


class WorldReviewResult(BaseModel):
    """모델 structured output."""
    model_config = ConfigDict(extra='forbid')
    findings: list[Finding]


class WorldReviewResponse(BaseModel):
    """reviewedCards는 검토한 카드 수다. model은 응답한 모델이며 검토할 카드가 없어 모델을 부르지 않았으면 빈 글이다."""
    findings: list[Finding]
    reviewedCards: int
    model: str


class EnrichResult(BaseModel):
    """enrich 모델 structured output: 카드 칸 수정안 1~5개와 설명. 스키마에는 개수·길이 제약을 못 둬 service가 다시 검증한다."""
    model_config = ConfigDict(extra='forbid')
    fixes: list[Fix]
    note: str


class CardFix(Fix):
    """제안 하나: 수정안(Fix)에 카드 제목을 더한 것. cardTitle은 모델이 쓰지 않고 service가 입력에서 채운다."""
    cardTitle: str


class EnrichResponse(BaseModel):
    """worldId·revision은 제안의 기준이 된 세계관과 읽은 초안 revision이며, 반영은 그 revision이 그대로일 때만 한다."""
    worldId: str
    revision: int
    fixes: list[CardFix]
    note: str
    model: str


FillTarget = Literal['body', 'soul']  # 채우는 필수 문서: IDENTITY(카드 본문)·SOUL. GOAL은 선택 문서라 채우지 않는다


class Passage(BaseModel):
    """원고 발췌 하나. episode는 회차 번호(1 이상), text는 그 회차 원고에서 인물 이름이 나온 곳의 앞뒤 글이다."""
    episode: int = Field(ge=1)
    text: str = Field(min_length=1)


class FillRequest(BaseModel):
    """인물 카드 하나의 비어 있는 문서(targets)를 채울 근거를 찾기 위한 요청(Content가 만든다). aliases는 카드의 다른 호칭이다."""
    cardId: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1)
    aliases: list[str] = []
    targets: list[FillTarget] = Field(min_length=1, max_length=2)
    passages: list[Passage] = Field(min_length=1)

    @field_validator('passages')
    @classmethod
    def within_chars(cls, passages):
        if sum(len(p.text) for p in passages) > MAX_FILL_CHARS:
            raise ValueError(f'원고 발췌 합계는 {MAX_FILL_CHARS}자 이하여야 합니다.')
        return passages

    def refs(self) -> dict:
        """추적에 남기는 참조. 원고 발췌와 인물 이름은 추적 결정 범위 밖이라 카드 id·대상·회차 번호만 남긴다."""
        return {'cardId': self.cardId, 'targets': self.targets, 'episodes': sorted({p.episode for p in self.passages})}


class FillLine(BaseModel):
    """채울 문서의 줄 하나: 원고 발췌의 문장(quote)과 그 회차. kind는 인물을 단정한 서술(fact)인지 겉모습·말투를 보여 주는 묘사·대사(description)인지다."""
    model_config = ConfigDict(extra='forbid')
    target: FillTarget
    kind: Literal['fact', 'description']
    episode: int
    quote: str


class FillResult(BaseModel):
    """fill 모델 structured output. 줄이 발췌에 있는 문장인지·문서별 줄 수는 service가 다시 검증한다."""
    model_config = ConfigDict(extra='forbid')
    lines: list[FillLine]


class FillResponse(BaseModel):
    """검증을 통과한 줄만 담는다. skipped는 원고에서 확인하지 못해 뺀 줄 수이고, 근거가 없어 줄이 하나도 없는 것은 오류가 아니라 빈 목록이다."""
    lines: list[FillLine]
    skipped: int
    model: str


class Affected(BaseModel):
    """영향받는 곳 하나. ref는 kind가 card면 카드 id, relationship이면 관계 id, episode면 회차 번호(숫자 글), scene이면 계획 id다. 입력에 있던 것만 허용한다."""
    model_config = ConfigDict(extra='forbid')
    kind: AffectedKind
    ref: str
    title: str
    reason: str
    certainty: Certainty


class ImpactResult(BaseModel):
    """impact 모델 structured output. ref 대조·문장 길이는 service가 다시 검증한다."""
    model_config = ConfigDict(extra='forbid')
    affected: list[Affected]
    conflicts: list[str]
    gaps: list[str]


class ImpactResponse(ImpactResult):
    """분석 결과와 응답한 모델. 읽기만 하는 분석이라 반영 단계가 없다."""
    model: str
