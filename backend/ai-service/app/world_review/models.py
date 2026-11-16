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
Kind = Literal['contradiction', 'doc_role', 'missing_info', 'other']
Target = Literal['body', 'soul', 'goal', 'episode']


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
