"""파이프라인 평가의 ①→② 연결(평가 전용): 전처리 결과(LoadPayload)를 Content가 적재하고 MCP world_studio_read가 돌려주는 모양으로 바꿔
시뮬레이션의 service.world_from에 넣고, 평가 문항의 인물을 그 카드에 이름으로 잇는다. Content·Neo4j는 부르지 않는다.

Content와 같은 것(ManuscriptBuildMapper·WorldStudioMcpTools·DEC-51·DEC-53): 카드 body = 인물 IDENTITY·그 밖의 본문, 인물 문서는 semanticMetadata.characterDocs(episodes 키는 정수 글자
'00'이 아니라 '0'), 공개 회차(revealFromEpisode)와 공개 설정은 없다(자동 적재는 작가 전용), 카드는 회차와 상관없이 모두 읽히고 관계만 기준 회차 시점이며
(structural·directed·asserted, 본문 = 근거 인용), 「동일 인물」 관계(identity)는 없다(후보는 작가가 승인해야 관계가 된다).
다른 것: 카드·관계 id는 세계관 id와 key에서 만든 uuid5(Content는 작업 id에서 만든다), 시뮬레이션이 읽지 않는 필드(areaCode·classification·tags, semanticMetadata의 studio·manuscriptBuild·preprocessing)는 뺐다,
관계의 기준 회차 상태는 Content가 회차마다 저장한 것을 읽는 대신 시작·종료를 순서대로 따라 계산한다(같은 규칙), reveal='first'는 작가가 제안값(firstEpisode)을 그대로 공개 회차로 정한 경우를 따로 본다(기본 none = Content 그대로).
"""

import re
import threading
import unicodedata
import uuid

from app.manuscript_extraction.models import Card, LoadPayload, Relation
from app.simulation import service
from app.simulation.errors import SimulationFailure

NAMESPACE = uuid.UUID('7d1f5f0e-3c2b-4a58-9d64-5e0b7a9b2c11')


def card_id(world_id: str, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f'{world_id}:card:{key}'))


def relation_id(world_id: str, relation: Relation) -> str:
    return str(uuid.uuid5(NAMESPACE, f'{world_id}:relation:{relation.fromKey}:{relation.toKey}:{relation.label}'))   # 시작·종료·재시작이 같은 관계 하나다(Content도 key에서 만든다)


def active_relations(relations: list[Relation], episode: int) -> list[Relation]:
    """episode화에 이어져 있는 관계. ManuscriptBuildMapper처럼 시작·종료를 회차 순으로 따라가, 이미 이어진 관계의 재시작과 시작이 없던 종료는 건너뛴다."""
    live: dict[tuple, Relation] = {}
    for r in sorted(relations, key=lambda r: r.fromEpisode):
        if r.fromEpisode > episode:
            break
        if r.ended:
            live.pop((r.fromKey, r.toKey, r.label), None)
        else:
            live.setdefault((r.fromKey, r.toKey, r.label), r)
    return list(live.values())


def read_at(world_id: str, payload: LoadPayload, quotes: dict, episode: int, reveal: str = 'none') -> dict:
    """episode화 시점의 world_studio_read 응답(시뮬레이션의 read_world가 만드는 identity 포함). quotes는 (시작 key, 끝 key, 관계 이름, 시작 회차) → 근거 인용이다."""
    cards = []
    for c in payload.cards:
        meta = {}
        if c.characterDocs:
            meta['characterDocs'] = {'soul': c.characterDocs.soul, 'goal': c.characterDocs.goal,
                                     'episodes': {str(int(number)): text for number, text in c.characterDocs.episodes.items()}}
        if reveal == 'first':
            meta['revealFromEpisode'] = c.firstEpisode
        cards.append({'id': card_id(world_id, c.key), 'title': c.title, 'body': c.body, 'cardType': c.cardType, 'aliases': list(c.aliases), 'semanticMetadata': meta,
                      'visibility': 'private', 'lifecycle': 'active'})
    relationships = [{'id': relation_id(world_id, r), 'sourceCardId': card_id(world_id, r.fromKey), 'targetCardId': card_id(world_id, r.toKey), 'category': 'structural',
                      'body': quotes.get((r.fromKey, r.toKey, r.label, r.fromEpisode), r.label), 'label': r.label, 'direction': 'directed', 'polarity': 'asserted',
                      'lifecycle': 'active'} for r in active_relations(payload.relations, episode)]
    return {'worldId': world_id, 'cards': cards, 'relationships': relationships, 'identity': []}


def relation_quotes(extractions: dict, identity) -> dict:
    """organize가 Relation으로 옮긴 관계마다 근거 인용(Content는 저장한 추출의 evidence에서 꺼낸다). 같은 키에 둘이면 먼저 나온 것이다."""
    quotes = {}
    for n, row in sorted(extractions.items()):
        for r in row.relationships:
            quotes.setdefault((identity.mapping[f'{n}:{r.source}'], identity.mapping[f'{n}:{r.target}'], r.label, r.fromEpisode), r.quote)
    return quotes


def _fold(text: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFC', text)).lower()


def find_character(cards: list[Card], name: str) -> Card | None:
    """이름으로 인물 카드를 찾는다: 제목·별칭과 공백을 무시한 완전 일치이고, 같은 이름 카드가 둘(동명이인)이면 어느 쪽인지 몰라 None이다.
    ponytail: 표기가 다른 같은 인물(치삼 ↔ 치삼이)은 '인물 없음'으로 센다. 실데이터에서 놓침이 보이면 규칙을 더한다."""
    want = _fold(name)
    hits = [c for c in cards if c.cardType == 'character' and want in {_fold(n) for n in (c.title, *c.aliases)}]
    return hits[0] if len(hits) == 1 else None


class PipelineWorld:
    """한 작품의 파이프라인 세계관(작품 전체 회차로 한 번 만든 것). 기준 회차마다 운영의 world_from으로 service.World를 읽는다."""

    def __init__(self, world_id: str, payload: LoadPayload, quotes: dict, reveal: str = 'none'):
        self.world_id, self.payload, self.quotes, self.reveal = world_id, payload, quotes, reveal
        self._worlds, self._lock = {}, threading.Lock()

    def world(self, base: int) -> service.World:
        with self._lock:   # 공개 세트 작품은 회차가 12개 이하라 기준 회차마다 만든 World를 모두 둔다
            if base not in self._worlds:
                self._worlds[base] = service.world_from(read_at(self.world_id, self.payload, self.quotes, base, self.reveal), base)
            return self._worlds[base]


class PipelineCorpus:
    """orig_run이 문항 입력을 만들 때 읽는 Corpus에서 세계관만 파이프라인 것으로 바꾼다. 회차·금지 사실(정답표)은 손라벨 코퍼스(hand) 그대로다.
    worlds: 작품 id → PipelineWorld(그 작품의 파이프라인이 실패했으면 None)."""
    name = 'public'

    def __init__(self, hand, worlds: dict[str, PipelineWorld | None]):
        self.hand, self.worlds = hand, worlds

    def world(self, wid: str, base: int):
        """(기준 회차 시점 World, 손라벨 인물 id → 파이프라인 카드 id). 이름으로 잇지 못한 인물은 빠진다."""
        pw = self.worlds[wid]
        ids = {p['id']: card_id(pw.world_id, c.key) for p in self.hand.people(wid) if (c := find_character(pw.payload.cards, p['title']))}
        return pw.world(base), ids

    def facts(self, wid: str, person: dict | None, ep: dict) -> list[dict]:
        return self.hand.facts(wid, person, ep)

    def status(self, item: dict) -> str:
        """이 문항을 파이프라인 세계관으로 돌릴 수 있는가: ok, 아니면 이유 — world_failed(작품의 ①이 실패), no_character(화자 카드를 못 이음),
        late_card(카드의 첫 등장 회차가 기준 회차보다 늦어 인물 문서에 뒤 회차 글이 든다), docs_missing(필수 인물 문서가 비어 운영 시뮬레이션이 시작을 거절한다)."""
        pw = self.worlds.get(item['work'])
        if pw is None:
            return 'world_failed'
        if item['kind'] == 'narration':
            return 'ok'
        card = find_character(pw.payload.cards, item['speaker'])
        if card is None:
            return 'no_character'
        if card.firstEpisode > item['base']:
            return 'late_card'
        world = pw.world(item['base'])
        try:
            service._filled([card_id(pw.world_id, card.key)], world.characters, world.read)   # 운영이 시작 전에 보는 필수 문서 규칙(IDENTITY·SOUL)
        except SimulationFailure:
            return 'docs_missing'
        return 'ok'
