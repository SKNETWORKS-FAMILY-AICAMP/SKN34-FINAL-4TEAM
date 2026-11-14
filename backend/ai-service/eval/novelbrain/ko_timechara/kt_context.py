"""KoTimeChara 문맥: 작품마다 원고 조각·벡터를 준비하고 질문마다 구성별 문맥(상위 6개)과 누설 지표를 만든다. OpenAI 호출 없음.

구성(10): zero(검색 없음) · ppr(그래프만) · vector(벡터만) · bm25(BM25만) · s1(0+1) · s2(0+1+2) · s3(0+1+2+3) ·
하나씩 빼기 no_graph·no_vector·no_bm25(필터는 건 채로). 알고리즘은 `app.novelbrain`을 그대로 쓴다.

누설 지표 둘: future = 문맥 항목 중 기준 회차 뒤의 것이 있다(필터와 같은 조건), unseen = 원고 발췌가 정답표의 '그 인물이 보지 못한 사건 또는
미래 사건'의 근거 문장과 겹친다(정답표 기준이라 필터 규칙과 독립이다. 원고 발췌만 본다).
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import re

from app.manuscript.models import Excerpt
from app.novelbrain.service import _documents, bm25_rank, recall
from embed import best_window, knn
from kt_label import knows
from kt_text import squash
from run import BIG, filtered, fuse
from run_timechara import foreign_memory
from timechara import snapshot

CONFIGS = ('zero', 'ppr', 'vector', 'bm25', 's1', 's2', 's3', 'no_graph', 'no_vector', 'no_bm25')
K_CTX, EXCERPTS = 6, 10


def chunk_episode(text: str, size: int = 300, ceiling: int = 380) -> list[str]:
    """회차 원문을 줄 경계로 size자 안팎의 조각으로 묶는다. ceiling을 넘는 긴 줄은 문장 경계(없으면 글자 수)에서 자른다.

    한국어는 글자당 토큰이 많아 E5 입력 한도(512토큰)에 닿지 않도록 ceiling을 380자로 둔다.
    """
    pieces = []
    for line in (ln.strip() for ln in text.split('\n')):
        while len(line) > ceiling:
            cut = max((m.end() for m in re.finditer(r'[.!?。…]\s', line[:ceiling])), default=ceiling)
            pieces.append(line[:cut].strip())
            line = line[cut:].strip()
        if line:
            pieces.append(line)
    chunks, current = [], ''
    for piece in pieces:
        if current and len(current) + len(piece) + 1 > ceiling:
            chunks.append(current)
            current = ''
        current = f'{current} {piece}'.strip()
        if len(current) >= size:
            chunks.append(current)
            current = ''
    return chunks + ([current] if current else [])


def overlaps(quote: str, evidence: str, n: int = 12) -> bool:
    """발췌(quote)와 근거 문장(evidence)이 n자 이상 이어서 겹치는가(근거가 n자보다 짧으면 통째로 들어 있을 때). 둘 다 squash한 글이다."""
    if len(evidence) < n:
        return evidence in quote
    return any(evidence[i:i + n] in quote for i in range(0, len(evidence) - n + 1, 3))


def item_episode(ref: str, lookup: dict) -> int | None:
    """항목이 나온 회차(발췌=조각의 회차, 관계=기록된 회차, 회차 기억=그 회차, 카드=공개 회차). 알 수 없으면 None."""
    kind, _, rest = ref.partition(':')
    if kind == 'manuscript':
        return lookup['chunk'].get(rest)
    if kind == 'relation':
        return lookup['when'].get(rest)
    if kind == 'card':
        card, _, part = rest.partition('#')
        if part.startswith('ep'):
            return int(part[2:])
        return lookup['reveal'].get(card) if part in ('', 'identity') else None
    return None


def unseen_exposure(items: list[dict], row: dict, knowledge: list[dict], chunk_episode_of: dict[str, int], by_episode: dict[int, list[dict]]) -> bool:
    """문맥의 원고 발췌가 정답표 기준으로 인물이 모를 사건(그 인물이 보지 못한 사건·기준 회차 뒤 사건)의 근거 문장과 겹치는가."""
    for item in items:
        kind, _, rest = item['ref'].partition(':')
        if kind != 'manuscript' or rest not in chunk_episode_of:
            continue
        quote = squash(item['text'])
        for event in by_episode.get(chunk_episode_of[rest], []):
            if overlaps(quote, squash(event['evidence'])) and (event['episode'] > row['cutoff'] or not knows(knowledge, row['character'], event, row['cutoff'])):
                return True
    return False


def contexts_for(row: dict, data: dict, knowledge: list[dict], query_vector) -> dict[str, dict]:
    """질문 하나의 구성별 문맥 {config: {'items': [{'ref','text'}], 'future', 'foreign', 'unseen'}}.

    data: {'chunks': [{'id','episode','text'}], 'vectors', 'world'}. 하나씩 빼기는 recall 3단계와 같은 합산·필터라는 확인(assert)을 함께 한다.
    """
    world = data['world']
    episode, question = row['cutoff'], row['question']
    snap, character_id = snapshot(world, episode), world['character_id'][row['character']]
    chunks = data['chunks']
    manuscript = [Excerpt(id=chunks[i]['id'], episode=chunks[i]['episode'], quote=best_window(chunks[i]['text'], question))
                  for i in knn(data['vectors'], query_vector, EXCERPTS)]
    docs = _documents(world['cards'])
    graph = recall(snap, character_id, episode, question, stage=0, k=BIG).items
    refs = {'ppr': [i.ref for i in graph], 'vector': [f'manuscript:{e.id}' for e in manuscript],
            'bm25': [ref for ref, _ in bm25_rank(question, [(ref, f'{title} {text}') for ref, (title, text) in docs.items()])]}
    full = {}
    for config, stage in (('s1', 1), ('s2', 2), ('s3', 3)):
        full[stage] = recall(snap, character_id, episode, question, stage=stage, manuscript=manuscript, k=BIG).items
        refs[config] = [i.ref for i in full[stage]]
    text_of = {i.ref: i.text for i in full[2]} | {i.ref: i.text for i in graph}
    early = [f'manuscript:{e.id}' for e in manuscript if e.episode <= episode]
    quotes = {f'manuscript:{e.id}': e.quote for e in manuscript}
    keep = lambda lists: filtered(fuse(lists), quotes, snap, character_id, episode)  # noqa: E731
    assert keep([refs['ppr'], early, refs['bm25']]) == refs['s3'], row['id']
    refs |= {'no_graph': keep([early, refs['bm25']]), 'no_vector': keep([refs['ppr'], refs['bm25']]), 'no_bm25': keep([refs['ppr'], early])}
    lookup = {'chunk': {c['id']: c['episode'] for c in chunks}, 'when': world['when'],
              'reveal': {c.id: c.revealFromEpisode for c in world['cards'] if c.revealFromEpisode}}
    by_episode: dict[int, list[dict]] = {}
    for record in knowledge:
        by_episode[record['episode']] = record['events']
    out = {}
    for config in CONFIGS:
        items = [{'ref': ref, 'text': text_of[ref]} for ref in (refs.get(config, []))[:K_CTX]]
        out[config] = {'items': items,
                       'future': any((item_episode(i['ref'], lookup) or 0) > episode for i in items),
                       'foreign': any(foreign_memory(i['ref'], character_id) for i in items),
                       'unseen': unseen_exposure(items, row, knowledge, lookup['chunk'], by_episode)}
    return out
