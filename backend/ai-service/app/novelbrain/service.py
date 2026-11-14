"""NovelBrain 조회: 세계관 그래프(PPR) → 원고 발췌 → BM25 → RRF 합산 → 인물 시점 필터를 단계별로 쌓는다.

표준 라이브러리만 쓰는 순수 함수다. 모델·네트워크·DB를 부르지 않고, 원고 발췌는 호출자가 Content Retrieval로 받아 넘긴다.
항목 ref 형식(필터가 이 형식을 읽는다):
- `card:<id>`: 인물이 아닌 카드의 본문
- `card:<id>#identity|soul|memory|ep<NN>`: 인물 카드의 IDENTITY(카드 본문)·SOUL·MEMORY·회차별 기억(NN은 두 자리로 0을 채운 회차)
- `relation:<id>`: 관계, `manuscript:<발췌 id>`: 원고 발췌
"""

import math
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Sequence
from typing import Literal

from app.manuscript.models import Excerpt
from app.novelbrain.models import Card, Gap, RecallItem, RecallResult, Relation, WorldSnapshot

# 한글 음절 덩어리 | 그 밖의 글자·숫자 덩어리(밑줄·구두점은 경계)
_RUN = re.compile(r'[가-힣]+|[^\W_가-힣]+')
_EPISODE_DOC = re.compile(r'ep([0-9]+)')
_ARROWS = {'directed': '→', 'symmetric': '↔', None: '—'}
_DENIED_ARROWS = {'directed': '↛', 'symmetric': '↮', None: '—'}
# 이 종류의 다른 카드는 그 인물과 관계로 연결돼 있어야 인물이 아는 것으로 본다(장소·규칙·조직·능력·기타는 누구나 아는 정보).
_LINKED_TYPES = ('character', 'event', 'object')
_UNKNOWN, _NOT_LINKED = '출처를 확인할 수 없음', '연결된 관계가 없어 이 인물이 아는지 확인할 수 없음'
_NOT_PARTY, _NOT_NAMED = '이 인물이 당사자가 아닌 관계라 아는지 확인할 수 없음', '발췌에 이 인물이 나오지 않아 목격 여부를 확인할 수 없음'
_NOT_REVEALED = '상대 설정이 아직 공개되지 않아 이 관계를 아는지 확인할 수 없음'
# Retrieval이 돌려주는 원고 아닌 발췌(kind)를 인물 시점에 쓰지 않는 이유: 관계는 기준 회차가 아닌 현재 Neo4j 값이고, 설정은 스냅샷 카드로 다룬다.
_EXCERPT_GAPS = {'relationship': 'relationship_current_not_episode', 'setting': 'setting_via_retrieval'}


def _fold(text: str) -> str:
    # macOS 등에서 온 풀어쓴(NFD) 한글도 같은 글자로 맞춘다.
    return unicodedata.normalize('NFC', text).lower()


def tokenize(text: str) -> list[str]:
    """영어·숫자는 소문자 단어, 한글은 단어 하나와 음절 bigram(조사가 붙어도 이름이 일치하게)을 낸다.

    ponytail: 형태소 분석기 대신 bigram이라 한 음절 낱말(왕·검)은 조사가 붙으면 일치하지 않는다. 필요하면 형태소 분석을 붙인다.
    """
    tokens: list[str] = []
    for run in _RUN.findall(_fold(text)):
        tokens.append(run)
        if '가' <= run[0] <= '힣' and len(run) > 2:
            tokens.extend(run[i:i + 2] for i in range(len(run) - 1))
    return tokens


def bm25_rank(query: str, docs: list[tuple[str, str]], k1: float = 1.5, b: float = 0.75) -> list[tuple[str, float]]:
    """Okapi BM25로 `(ref, text)` 문서를 질문에 맞춰 점수 내림차순으로 돌려준다. 질문 낱말이 하나도 없는 문서는 뺀다."""
    terms = set(tokenize(query))
    counts = [(ref, Counter(tokenize(text))) for ref, text in docs]
    total = sum(sum(tf.values()) for _, tf in counts)
    if not terms or not total:
        return []
    average, n = total / len(counts), len(counts)
    df = {t: sum(t in tf for _, tf in counts) for t in terms}
    scored = []
    for ref, tf in counts:
        length = sum(tf.values())
        score = sum(math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5)) * tf[t] * (k1 + 1)
                    / (tf[t] + k1 * (1 - b + b * length / average)) for t in terms if t in tf)
        if score > 0:
            scored.append((ref, score))
    return sorted(scored, key=lambda pair: -pair[1])


def ppr(nodes: Iterable[str], edges: Iterable[tuple[str, str]], seeds: dict[str, float], damping: float = 0.5,
        iters: int = 50, tol: float = 1e-8) -> dict[str, float]:
    """Personalized PageRank(거듭제곱 반복). `damping`은 관계를 따라 걸을 확률이고 나머지는 seed로 돌아간다(HippoRAG와 같은 0.5).

    방향 관계도 양방향으로 걷는다. 알 수 없는 노드의 seed·관계와 자기 자신으로 가는 관계는 무시하고, 갈 곳 없는 노드의 몫은 seed로 돌린다.
    쓸 수 있는 seed가 없으면 빈 결과이며, 아니면 모든 노드의 점수(합 1)를 돌려준다.
    """
    names = list(dict.fromkeys(nodes))
    known = set(names)
    restart = {n: w for n, w in seeds.items() if n in known and w > 0}
    total = sum(restart.values())
    if not total:
        return {}
    restart = {n: w / total for n, w in restart.items()}
    neighbours: dict[str, list[str]] = {n: [] for n in names}
    for a, b in edges:
        if a != b and a in known and b in known:
            neighbours[a].append(b)
            neighbours[b].append(a)
    score = {n: restart.get(n, 0.0) for n in names}
    for _ in range(iters):
        nxt = {n: (1 - damping) * restart.get(n, 0.0) for n in names}
        stranded = 0.0
        for n in names:
            if neighbours[n]:
                share = damping * score[n] / len(neighbours[n])
                for m in neighbours[n]:
                    nxt[m] += share
            else:
                stranded += score[n]
        for n, w in restart.items():
            nxt[n] += damping * stranded * w
        moved = sum(abs(nxt[n] - score[n]) for n in names)
        score = nxt
        if moved < tol:
            break
    return score


def seed_cards(query: str, cards: list[Card]) -> dict[str, float]:
    """PPR 출발점: 제목이 질문에 나오는 카드(가중치 1). 하나도 없으면 카드 BM25 상위 3개.

    ponytail: 제목을 부분 문자열로 찾아 조사가 붙어도 맞지만 한 글자 제목은 다른 낱말 속에서도 일치한다(별칭 미지원).
    """
    asked = _fold(query)
    named = {c.id: 1.0 for c in cards if c.title.strip() and _fold(c.title.strip()) in asked}
    if named:
        return named
    return {ref: 1.0 for ref, _ in bm25_rank(query, [(c.id, f'{c.title} {c.text}') for c in cards])[:3]}


def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion: ref마다 순위별 1/(k+순위)를 더해 점수 내림차순으로 돌려준다. 한 목록 안의 중복 ref는 한 번만 센다."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, ref in enumerate(dict.fromkeys(ranking), 1):
            scores[ref] = scores.get(ref, 0.0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda pair: -pair[1])


def filter_for_character(items: list[RecallItem], world: WorldSnapshot, character_id: str | None,
                         episode: int) -> tuple[list[RecallItem], list[Gap]]:
    """계약 3단계: 인물이 `episode`화까지 아는 것만 남긴다. `character_id=None`(메인 에이전트)이면 거르지 않는다.

    - 그 인물 자신의 IDENTITY·SOUL·MEMORY와 `episode` 이하 회차 기억은 허용한다.
    - 다른 인물의 SOUL·MEMORY·회차 기억과 `revealFromEpisode`가 아직 안 온 카드는 아는 것이 아님이 확인되므로 조용히 뺀다.
    - 근거를 확인할 수 없는 것은 빼고 Gap으로 남긴다: 관계로 연결되지 않은 다른 인물·사건·물건 카드(부정 관계는 연결이 아니다),
      그 인물이 끝점이 아닌 관계,
      상대 카드가 아직 공개되지 않았거나 스냅샷에 없는 관계(관계 문장에 상대 제목이 드러난다), 그 인물 이름이 나오지 않는 원고 발췌,
      형식을 알 수 없는 ref(닫힌 쪽으로 실패).

    ponytail: 발췌에 이름이 나오면 목격으로 근사한다(별칭·호칭·대명사 미지원). MEMORY.md는 회차 표시가 없어 항상 허용한다.
    """
    if character_id is None:
        return list(items), []
    cards = {c.id: c for c in world.cards}
    if character_id not in cards:
        raise ValueError('세계관에 없는 인물입니다.')
    name = _fold(cards[character_id].title.strip())
    ends = {r.id: (r.source, r.target) for r in world.relations}
    linked = {end for r in world.relations if r.polarity == 'asserted' and character_id in (r.source, r.target)
              for end in (r.source, r.target)}

    def future(card: Card) -> bool:
        return card.revealFromEpisode is not None and card.revealFromEpisode > episode

    def judge(item: RecallItem) -> tuple[bool, str]:
        # (허용 여부, 허용하지 않을 때의 gap 이유). 이유가 비어 있으면 gap 없이 조용히 뺀다.
        kind, _, rest = item.ref.partition(':')
        if kind == 'relation':
            if rest not in ends:
                return False, _UNKNOWN
            if character_id not in ends[rest]:
                return False, _NOT_PARTY
            others = [cards.get(end) for end in ends[rest] if end != character_id]
            if None in others:
                return False, _UNKNOWN
            return (False, _NOT_REVEALED) if any(future(c) for c in others) else (True, '')
        if kind == 'manuscript':
            return (True, '') if name and name in _fold(item.text) else (False, _NOT_NAMED)
        card_id, _, part = rest.partition('#')
        card = cards.get(card_id) if kind == 'card' else None
        if card is None:
            return False, _UNKNOWN
        if part in ('', 'identity'):
            if card_id == character_id:
                return True, ''
            if future(card):
                return False, ''
            return (False, _NOT_LINKED) if card.cardType in _LINKED_TYPES and card_id not in linked else (True, '')
        number = _EPISODE_DOC.fullmatch(part)
        if part not in ('soul', 'memory') and not number:
            return False, _UNKNOWN
        return (True, '') if card_id == character_id and (not number or int(number.group(1)) <= episode) else (False, '')

    kept, gaps = [], []
    for item in items:
        allowed, reason = judge(item)
        if allowed:
            kept.append(item)
        elif reason:
            gaps.append(Gap(ref=item.ref, reason=reason))
    return kept, gaps


def _body_ref(card: Card) -> str:
    return f'card:{card.id}#identity' if card.cardType == 'character' else f'card:{card.id}'


def _documents(cards: list[Card]) -> dict[str, tuple[str, str]]:
    # ref → (제목, 본문): 카드 본문과 인물 카드의 SOUL·MEMORY·회차별 기억. 빈 문서는 뺀다.
    docs = {}
    for c in cards:
        docs[_body_ref(c)] = (c.title, c.text)
        if c.cardType == 'character':
            docs[f'card:{c.id}#soul'] = (c.title, c.soul)
            docs[f'card:{c.id}#memory'] = (c.title, c.memory)
            docs.update({f'card:{c.id}#ep{n:02d}': (c.title, text) for n, text in sorted(c.episodes.items())})
    return {ref: doc for ref, doc in docs.items() if doc[1].strip()}


def _relation_text(r: Relation, cards: dict[str, Card]) -> str:
    denied = r.polarity == 'denied'
    arrow = (_DENIED_ARROWS if denied else _ARROWS)[r.direction]
    line = f'{cards[r.source].title} {arrow} {cards[r.target].title}' + (' (아님)' if denied else '')
    return f'{line}: {r.label}' if r.label else line


def _graph(world: WorldSnapshot, query: str) -> list[tuple[str, str, float]]:
    # 0단계: 질문에서 찾은 카드를 출발점으로 한 PPR 점수순 (ref, 본문, 점수). 관계의 점수는 두 끝점 점수의 평균이다.
    # 부정(denied) 관계는 PPR이 걷는 간선에서 빼지만 관계 항목으로는 남는다(문장에 부정임이 드러난다).
    cards = {c.id: c for c in world.cards}
    relations = [r for r in world.relations if r.source in cards and r.target in cards]
    edges = [(r.source, r.target) for r in relations if r.polarity == 'asserted']
    scores = ppr(list(cards), edges, seed_cards(query, world.cards))
    found = [(_body_ref(cards[i]), cards[i].text, s) for i, s in scores.items() if s > 0 and cards[i].text.strip()]
    for r in relations:
        score = (scores.get(r.source, 0) + scores.get(r.target, 0)) / 2
        if score > 0:
            found.append((f'relation:{r.id}', _relation_text(r, cards), score))
    return sorted(found, key=lambda row: -row[2])


def recall(world: WorldSnapshot, character_id: str | None, episode: int, query: str, stage: Literal[0, 1, 2, 3] = 3,
           manuscript: Sequence[Excerpt] = (), k: int = 8) -> RecallResult:
    """한 번의 조회. 단계는 앞 단계에 하나씩 쌓인다(`stage`는 0~3, `k`는 1 이상).

    0 = PPR 그래프(카드·관계), 1 = + `manuscript` 발췌(받은 순서가 순위), 2 = + 카드·인물 문서 BM25, 3 = + 인물 시점 필터.
    1단계부터는 순위를 RRF로 합치고(source는 처음 찾은 방식) 0단계는 PPR 점수 그대로다. 필터는 합친 목록 전체에 적용한 뒤 k개를 자르며,
    gaps는 그렇게 남은 k개보다 앞 순위였던 항목만 담는다. `character_id=None`이면 3단계에서도 거르지 않는다.
    필터할 때 `world`는 `episode` 이전 시점의 관계여야 하고(더 늦으면 ValueError), 인물의 기준 회차 뒤 원고 발췌는 입력에서 뺀다.
    원고(kind=manuscript)가 아닌 발췌는 시점을 보증할 수 없어 쓰지 않고, 순위에 들기 전에 걸러 gap으로 남긴다(윈도우와 무관하게 항상).
    """
    filtering = stage >= 3 and character_id is not None
    skipped: list[Gap] = []
    if filtering:
        if world.episode > episode:
            raise ValueError('관계 스냅샷이 인물의 기준 회차보다 늦은 시점입니다.')
        skipped = [Gap(ref=f'manuscript:{e.id}', reason=_EXCERPT_GAPS[e.kind]) for e in manuscript if e.kind != 'manuscript']
        manuscript = [e for e in manuscript if e.kind == 'manuscript' and e.episode <= episode]
    graph = _graph(world, query)
    rankings = [[ref for ref, _, _ in graph]]
    found = {ref: ('graph', text) for ref, text, _ in graph}
    if stage >= 1:
        rankings.append([f'manuscript:{e.id}' for e in manuscript])
        for e in manuscript:
            found.setdefault(f'manuscript:{e.id}', ('manuscript', e.quote))
    if stage >= 2:
        docs = _documents(world.cards)
        hits = bm25_rank(query, [(ref, f'{title} {text}') for ref, (title, text) in docs.items()])
        rankings.append([ref for ref, _ in hits])
        for ref, _ in hits:
            found.setdefault(ref, ('bm25', docs[ref][1]))
    ranked = [(ref, score) for ref, _, score in graph] if stage == 0 else rrf(rankings)
    items = [RecallItem(ref=ref, source=found[ref][0], text=found[ref][1], rank=n, score=score)
             for n, (ref, score) in enumerate(ranked, 1)]
    gaps: list[Gap] = []
    if filtering:
        before = {i.ref: i.rank for i in items}
        items, gaps = filter_for_character(items, world, character_id, episode)
        last = items[k - 1].rank if len(items) >= k else len(before) + 1
        gaps = [g for g in gaps if before[g.ref] < last] + skipped
    items = [i.model_copy(update={'rank': n}) for n, i in enumerate(items[:k], 1)]
    return RecallResult(items=items, gaps=gaps, stage=stage)
