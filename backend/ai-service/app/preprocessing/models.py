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
    """Content가 접수하는 전처리 작업. 실패 회차만 다시 보낼 때도 같은 jobId를 쓴다."""
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
    memory: Doc
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
