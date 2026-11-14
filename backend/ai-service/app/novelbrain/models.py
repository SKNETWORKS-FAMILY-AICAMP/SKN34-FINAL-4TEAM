"""NovelBrain 계약: 세계관 스냅샷(Content MCP `world_studio_read` 응답에서 변환)과 `recall` 결과.

계약 문서: docs/design/character-simulation-contract.md. 카드·관계·인물 문서·회차별 기억의 출처 필드는
`semanticMetadata.characterDocs{soul, memory, episodes}`와 `semanticMetadata.revealFromEpisode`이며 화면 매핑과 같은 규칙으로 읽는다.
"""

import re
from typing import Literal

from pydantic import BaseModel

# `episodes`의 키: 0 이상의 정수를 군더더기 없이 쓴 글자(`03`·`1.5`·`-1`은 아니다). 화면의 `isEpisodeKey`와 같다.
_EPISODE_KEY = re.compile(r'0|[1-9][0-9]*')
_DIRECTIONS = ('directed', 'symmetric')


class Card(BaseModel):
    """세계관 카드. `text`는 카드 본문이고 인물 카드에서는 IDENTITY.md다. soul·memory·episodes는 인물 카드에만 있다."""
    id: str
    cardType: str
    title: str
    text: str
    soul: str = ''
    memory: str = ''
    episodes: dict[int, str] = {}
    revealFromEpisode: int | None = None


class Relation(BaseModel):
    """기준 회차 시점의 관계 하나. 끝점은 카드 id다."""
    id: str
    source: str
    target: str
    label: str
    direction: Literal['directed', 'symmetric'] | None = None


class WorldSnapshot(BaseModel):
    """한 세계관의 카드와 `episode`화 시점의 관계 목록."""
    worldId: str
    episode: int
    cards: list[Card]
    relations: list[Relation]


class RecallItem(BaseModel):
    """찾은 근거 하나. ref 형식은 service 모듈 설명을 본다. source는 처음 찾은 방식이다."""
    ref: str
    source: Literal['graph', 'manuscript', 'bm25']
    text: str
    rank: int
    score: float


class Gap(BaseModel):
    """인물이 아는지 확인할 수 없어 결과에서 뺀 항목. 사실로 채우지 않는다."""
    ref: str
    reason: str


class RecallResult(BaseModel):
    items: list[RecallItem]
    gaps: list[Gap]
    stage: Literal[0, 1, 2, 3]


def _reveal(value) -> int | None:
    # 서버(`revealFromEpisode`)와 같은 규칙: 1 이상의 정수인 JSON 숫자(3.0 포함)만 읽는다. bool은 정수가 아니다.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if 1 <= value <= 2**31 - 1 and value == int(value) else None


def _docs(raw) -> tuple[str, str, dict[int, str]]:
    # 모양이 어긋난 characterDocs는 통째로 버리고 변환은 계속한다(화면 매핑과 같은 규칙).
    if isinstance(raw, dict):
        soul, memory, episodes = raw.get('soul'), raw.get('memory'), raw.get('episodes')
        if (isinstance(soul, str) and isinstance(memory, str) and isinstance(episodes, dict)
                and all(isinstance(k, str) and _EPISODE_KEY.fullmatch(k) and isinstance(v, str) for k, v in episodes.items())):
            return soul, memory, {int(k): v for k, v in episodes.items()}
    return '', '', {}


def world_snapshot(read: dict, episode: int) -> WorldSnapshot:
    """`world_studio_read(id, episode)` 응답(dict)을 스냅샷으로 바꾼다. `episode`는 관계를 읽은 회차다.

    삭제된(`lifecycle=removed`) 카드·관계, 끝점이 없거나 삭제된 카드인 관계는 뺀다. 읽을 수 없는 응답은 입력을 담지 않은 ValueError다.
    """
    try:
        cards = []
        for c in read['cards']:
            if c.get('lifecycle') == 'removed':
                continue
            meta = c.get('semanticMetadata') or {}
            soul, memory, episodes = _docs(meta.get('characterDocs')) if c['cardType'] == 'character' else ('', '', {})
            cards.append(Card(id=c['id'], cardType=c['cardType'], title=c['title'], text=c['body'], soul=soul, memory=memory,
                              episodes=episodes, revealFromEpisode=_reveal(meta.get('revealFromEpisode'))))
        ids = {c.id for c in cards}
        relations = []
        for r in read.get('relationships') or []:
            relation_id, source, target = r['id'], r.get('sourceCardId'), r.get('targetCardId')
            if r.get('lifecycle') == 'removed' or source not in ids or target not in ids:
                continue
            direction = r.get('direction')
            relations.append(Relation(id=relation_id, source=source, target=target, label=r.get('label') or '',
                                      direction=direction if direction in _DIRECTIONS else None))
        return WorldSnapshot(worldId=read['worldId'], episode=episode, cards=cards, relations=relations)
    except (LookupError, TypeError, AttributeError, ValueError):
        raise ValueError('세계관 응답 형식을 확인할 수 없습니다.') from None
