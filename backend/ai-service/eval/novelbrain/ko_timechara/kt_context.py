"""KoTimeChara 문맥: 작품마다 원고 조각·벡터를 준비하고 질문마다 구성별 문맥(상위 6개)과 누설 지표를 만든다. OpenAI 호출 없음.

구성(10, kt_run의 기본): zero(검색 없음) · ppr(그래프만) · vector(벡터만) · bm25(BM25만) · s1(0+1) · s2(0+1+2) · s3(0+1+2+3) ·
하나씩 빼기 no_graph·no_vector·no_bm25(필터는 건 채로). 알고리즘은 `app.novelbrain`을 그대로 쓴다.
연결 후보 변형(3, kt_pairs의 --configs로 쓴다): 벡터(원고 발췌) 없이 인물에 연결된 카드 안에서만 고른다. link_bm25 = 카드 BM25 순위에 필터만(인물 본인 문서와 직접 연결된 카드 안에서
질문 낱말로 고르기) · link_ppr = 그래프(PPR) 순위에 필터만(연결된 카드를 그래프 가까운 순으로) · link2_bm25 = link_bm25가 허용하는 것 + 기준 회차 스냅샷에서 인물로부터
관계 2홉 안에 있는(부정 관계 제외) 인물이 아닌 카드 중 공개 회차가 지난 것(순위는 카드 BM25) · link_cells = link_bm25 + 인물이 아닌 카드의 회차 칸(⑦이 원문을 보고 쓴 작가용 설명)을 후보에 더한 카드 BM25:
그 인물과 이어진(asserted) 사건에 그 카드가 '관련'으로 걸려 있고 칸의 회차가 질문 시점 이하인 칸만 후보다(서비스는 비인물 카드의 회차 칸을 색인·필터하지 않아 서비스 코드는 바꾸지 않고 평가 코드에서만 흉내 낸다).
link_known = link_cells의 후보 중 칸의 문장마다 근거 인용이 그 인물이 이어진 사건(기준 회차까지)의 인용 안에 있거나 그 인용을 품은 문장만 남긴 글(칸에는 그 인물이 모를 사건의 문장도 섞여 있어 link_cells는 모르는 쪽이 새므로 그 문장을 뺀다).

누설 지표 둘: future = 문맥 항목 중 기준 회차 뒤의 것이 있다(필터와 같은 조건), unseen = 원고 발췌가 정답표의 '그 인물이 보지 못한 사건 또는
미래 사건'의 근거 문장과 겹친다(정답표 기준이라 필터 규칙과 독립이다. 원고 발췌만 본다).
문맥 지표 하나: asked_ep = 문맥에 물어본 사건과 같은 회차(행의 event_episode)의 사건 카드나 원고 발췌가 들었다(event_episode가 없는 행은 None). unseen이 원고 발췌만 봐서
놓치는 카드 쪽 노출을 보완하는 거친 지표다(같은 회차의 다른 사건도 센다).
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import re

from app.story_qa.models import Excerpt
from app.novelbrain.service import _documents, bm25_rank, recall
from embed import best_window, knn
from kt_label import knows
from kt_text import squash
from run import BIG, filtered, fuse
from run_timechara import foreign_memory
from timechara import snapshot

CONFIGS = ('zero', 'ppr', 'vector', 'bm25', 's1', 's2', 's3', 'no_graph', 'no_vector', 'no_bm25')   # kt_run의 기본 구성(바꾸면 기본 실행·집계가 달라진다)
LINK_CONFIGS = ('link_bm25', 'link_ppr', 'link2_bm25', 'link_cells', 'link_known')
ALL_CONFIGS = CONFIGS + LINK_CONFIGS
ITEM_KINDS = ('identity', 'memory', 'event', 'relation', 'manuscript', 'cell')   # 문맥 항목 종류: 인물 본문·회차 기억·사건 카드·관계·원고 발췌·인물이 아닌 카드의 회차 칸(link_cells만)
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
        if part.startswith('ep') or part.startswith('cell'):
            return int(part[2:] if part.startswith('ep') else part[4:])
        return lookup['reveal'].get(card) if part in ('', 'identity') else None
    return None


def item_kind(ref: str) -> str:
    """문맥 항목의 종류(ref 형식은 app.novelbrain.service 설명): identity(인물 본문 IDENTITY·SOUL·GOAL)·memory(회차 기억)·event(인물이 아닌 카드)·relation·manuscript.

    ponytail: 이 평가 세계관의 카드는 인물과 사건뿐이라 인물이 아닌 카드를 사건 카드로 읽는다. 장소·물건 카드가 생기면 카드 유형을 읽어 나눈다.
    """
    kind, _, rest = ref.partition(':')
    if kind != 'card':
        return kind
    part = rest.partition('#')[2]
    return 'event' if not part else 'memory' if part.startswith('ep') else 'cell' if part.startswith('cell') else 'identity'


def asked_episode(items: list[dict], lookup: dict, episode: int) -> bool:
    """문맥에 질문한 사건과 같은 회차(episode)의 사건 카드나 원고 발췌가 있는가. 같은 회차의 다른 사건도 센다(거친 지표). 회차 기억·인물 본문·관계는 세지 않는다."""
    return any(item_kind(i['ref']) in ('event', 'manuscript') and item_episode(i['ref'], lookup) == episode for i in items)


def two_hop_cards(snap, character_id: str, episode: int) -> set[str]:
    """link2_bm25의 넓힌 후보: 스냅샷에서 인물로부터 (부정이 아닌) 관계 2홉 안에 있는 인물이 아닌 카드 중 공개 회차가 지난(공개 회차가 없으면 공개) 것의 id.

    관계는 PPR처럼 방향 없이 걷는다. 인물 카드는 넓히지 않는다(다른 인물의 카드·기억 문서는 2홉으로 허용하지 않는다). 서비스 필터는 바꾸지 않고 평가 코드에서만 쓴다.
    """
    near = {character_id}
    for _ in range(2):
        near |= {end for r in snap.relations if r.polarity == 'asserted' and (r.source in near or r.target in near) for end in (r.source, r.target)}
    cards = {c.id: c for c in snap.cards}
    return {i for i in near if cards[i].cardType != 'character' and (cards[i].revealFromEpisode or 0) <= episode}


def _linked_events(snap, character_id: str) -> tuple[dict, list, set[str]]:
    """스냅샷의 카드 표, asserted 관계, 그 인물과 이어진(asserted) 사건 카드 id."""
    cards = {c.id: c for c in snap.cards}
    asserted = [r for r in snap.relations if r.polarity == 'asserted']
    events = {end for r in asserted if character_id in (r.source, r.target) for end in (r.source, r.target) if end in cards and cards[end].cardType == 'event'}
    return cards, asserted, events


def linked_cells(snap, character_id: str, episode: int) -> dict[str, tuple[str, str]]:
    """link_cells의 추가 후보: 인물이 아닌 카드의 회차 칸 {ref: (카드 제목, 칸 글)}, ref는 `card:<id>#cell<NN>`.

    그 인물과 이어진(asserted 관계) 사건 카드에 그 카드가 '관련'으로 걸려 있고(스냅샷의 관계라 기준 회차까지 기록된 것만) 칸의 회차가 기준 회차 이하일 때만 후보다.
    이어지지 않은 카드의 칸·뒤 회차 칸·인물 카드의 칸·빈 칸은 넣지 않는다.
    """
    cards, asserted, events = _linked_events(snap, character_id)
    tied = {r.source for r in asserted if r.label == '관련' and r.target in events and r.source in cards and cards[r.source].cardType != 'character'}
    return {f'card:{cid}#cell{n:02d}': (cards[cid].title, text) for cid in sorted(tied) for n, text in sorted(cards[cid].episodes.items()) if n <= episode and text.strip()}


def _slot(stored: dict, ref: str) -> list:
    """세계관 덧붙임 칸(cell_quotes·cell_sentences: {카드 id: {회차: [...]}}, JSON을 거치면 회차 키가 글자)에서 회차 칸 ref(`card:<id>#cell<NN>`)의 목록. 없으면 빈 목록."""
    card, _, number = ref[len('card:'):].partition('#cell')
    by_episode = stored.get(card, {})
    return by_episode.get(str(int(number))) or by_episode.get(int(number)) or []


def known_cells(world: dict, snap, character_id: str, episode: int) -> dict[str, tuple[str, list[str], list[str]]]:
    """link_known의 후보 {ref: (카드 제목, 남은 문장들, 그 문장들의 근거 인용)}: linked_cells의 칸에서 문장마다 근거 인용이 그 인물이 이어진(asserted) 사건의 인용(world['events'][사건 id]['quote'])과
    한쪽이 다른 쪽 안에 들어 있는 문장만 남긴다(인용 8자 미만은 아무 데나 맞아 세지 않는다). 남은 문장이 없는 칸은 뺀다. 문장·인용 기록(cell_sentences·cell_quotes)이 없으면 후보가 없다."""
    known = [k for k in (squash(world['events'][e]['quote']) for e in _linked_events(snap, character_id)[2] if e in world.get('events', {})) if len(k) >= 8]
    out = {}
    for ref, (title, _) in linked_cells(snap, character_id, episode).items():
        pairs = [(text, quote) for text, quote in zip(_slot(world.get('cell_sentences', {}), ref), _slot(world.get('cell_quotes', {}), ref))
                 if (q := squash(quote)) and any(q in k or k in q for k in known)]
        if pairs:
            out[ref] = (title, [t for t, _ in pairs], [q for _, q in pairs])
    return out


def unseen_exposure(items: list[dict], row: dict, knowledge: list[dict], chunk_episode_of: dict[str, int], by_episode: dict[int, list[dict]],
                    cell_quotes: dict[str, list[str]] | None = None) -> bool:
    """문맥의 원고 발췌(와 cell_quotes가 있으면 회차 칸의 근거 인용 = 칸 문장이 기댄 원문 문장)가 정답표 기준으로 인물이 모를 사건(그 인물이 보지 못한 사건·기준 회차 뒤 사건)의 근거 문장과 겹치는가.
    칸은 그 칸의 회차 사건만 본다."""
    for item in items:
        kind, _, rest = item['ref'].partition(':')
        if kind == 'manuscript' and rest in chunk_episode_of:
            quote, events = squash(item['text']), by_episode.get(chunk_episode_of[rest], [])
        elif kind == 'card' and '#cell' in rest and cell_quotes:
            quote, events = squash(' '.join(cell_quotes.get(item['ref'], []))), by_episode.get(int(rest.rpartition('#cell')[2]), [])
        else:
            continue
        for event in events:
            if overlaps(quote, squash(event['evidence'])) and (event['episode'] > row['cutoff'] or not knows(knowledge, row['character'], event, row['cutoff'])):
                return True
    return False


def contexts_for(row: dict, data: dict, knowledge: list[dict], query_vector) -> dict[str, dict]:
    """질문 하나의 구성별 문맥 {config: {'items': [{'ref','text'}], 'future', 'foreign', 'unseen', 'asked_ep'}}(ALL_CONFIGS 전부).

    data: {'chunks': [{'id','episode','text'}], 'vectors', 'world'}. 하나씩 빼기는 recall 3단계와 같은 합산·필터라는 확인(assert)을 함께 한다.
    """
    world, asked = data['world'], row.get('event_episode')
    episode, question = row['cutoff'], row['question']
    character_id = world['character_id'].get(row['character'])
    if character_id is None:   # 세계관에 이 인물의 카드가 없다(전처리가 만들지 못했다): 인물이 기억할 근거가 없어 모든 구성의 문맥이 빈다
        return {config: {'items': [], 'future': False, 'foreign': False, 'unseen': False, 'asked_ep': None if asked is None else False} for config in ALL_CONFIGS}
    snap = snapshot(world, episode)
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
    linked = keep([refs['bm25']])
    allowed = set(linked) | {f'card:{i}' for i in two_hop_cards(snap, character_id, episode)}
    cells = linked_cells(snap, character_id, episode)   # link_cells: 인물이 아닌 카드의 회차 칸도 BM25 후보(허용된 칸만), 인물 시점 필터는 칸이 아닌 문서에만 건다(칸의 허용은 위 규칙이 이미 정했다)
    ranked = [ref for ref, _ in bm25_rank(question, [(ref, f'{title} {text}') for ref, (title, text) in {**docs, **cells}.items()])]
    base = set(keep([[ref for ref in ranked if ref not in cells]]))
    text_of |= {ref: f'{title}: {text}' for ref, (title, text) in cells.items()}
    known = known_cells(world, snap, character_id, episode)   # link_known: 위 칸에서 그 인물이 아는 사건의 인용에 기댄 문장만
    ranked_known = [ref for ref, _ in bm25_rank(question, [(ref, f'{title} {text}') for ref, (title, text) in {**docs, **{r: (t, ' '.join(s)) for r, (t, s, _) in known.items()}}.items()])]
    base_known = set(keep([[ref for ref in ranked_known if ref not in known]]))
    refs |= {'link_bm25': linked, 'link_ppr': keep([refs['ppr']]), 'link2_bm25': [ref for ref in refs['bm25'] if ref in allowed], 'link_cells': [ref for ref in ranked if ref in cells or ref in base],
             'link_known': [ref for ref in ranked_known if ref in known or ref in base_known]}
    stored = world.get('cell_quotes', {})
    lookup = {'chunk': {c['id']: c['episode'] for c in chunks}, 'when': world['when'],
              'reveal': {c.id: c.revealFromEpisode for c in world['cards'] if c.revealFromEpisode}}
    by_episode: dict[int, list[dict]] = {}
    for record in knowledge:
        by_episode[record['episode']] = record['events']
    out = {}
    for config in ALL_CONFIGS:
        strict = config == 'link_known'   # 같은 ref라도 link_known은 아는 문장만 남긴 글과 그 문장들의 근거 인용을 쓴다
        items = [{'ref': ref, 'text': f'{known[ref][0]}: {" ".join(known[ref][1])}' if strict and ref in known else text_of[ref]} for ref in (refs.get(config, []))[:K_CTX]]
        cell_quotes = {i['ref']: known[i['ref']][2] if strict else _slot(stored, i['ref']) for i in items if '#cell' in i['ref']}
        out[config] = {'items': items,
                       'future': any((item_episode(i['ref'], lookup) or 0) > episode for i in items),
                       'foreign': any(foreign_memory(i['ref'], character_id) for i in items),
                       'unseen': unseen_exposure(items, row, knowledge, lookup['chunk'], by_episode, cell_quotes),
                       'asked_ep': None if asked is None else asked_episode(items, lookup, asked)}
    return out
