"""한국어 적용성: 저장소 샘플(`infrastructure/sample-data`)로 인물 시점 질문 세트를 만들고 같은 구성별 지표를 낸다.

    cd backend/ai-service
    set -a; . /Users/yunseongho/orca/SKN34-FINAL-4TEAM/.env; set +a
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko.py generate   # 모델로 질문 생성 → datasets/ko_sample.jsonl(커밋)
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko.py run        # 호출 없음: 구성별 지표 → results/ko-retrieval.json

질문 종류: known(그 인물이 겪은 사건) · future(기준 회차 뒤 사건) · unwitnessed(그 인물이 나오지 않은 사건) · setting(설정 항목).
모델이 만든 질문은 규칙(근거 구절이 원문에 있음·질문에 답이 그대로 없음·길이·낱말 겹침·중복)으로 다시 검증하고, 어긋난 것은 버린다.
"""

import csv
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import mean

from pydantic import BaseModel

from app.manuscript.models import Excerpt
from app.novelbrain.models import Card, Relation, WorldSnapshot
from app.novelbrain.service import _documents, bm25_rank, recall, tokenize
from embed import best_window, embed_texts, knn
from llm import CAP, Ledger, Llm, LlmFailure
from metrics import dedupe, precision_at_k, recall_at_k
from prepare import DATA, SEED

HERE = Path(__file__).resolve().parent
SAMPLE = HERE.parents[3] / 'infrastructure/sample-data/content'
DATASET = HERE / 'datasets/ko_sample.jsonl'
RESULTS = HERE / 'results'
WORKS = ('구운몽', '별빛 서약의 탑', '회색 도시의 우편배달부')   # 회차가 둘 이상인 원작. 홍길동전(1화)은 시점 질문을 만들 수 없다
QUOTA = {'known': 24, 'future': 14, 'unwitnessed': 14, 'setting': 14}
CARD_TYPE = {'인물': 'character', '장소': 'location', '규칙': 'rule', '상태': 'object', '지식': 'event'}
K, EXCERPTS, BIG = 5, 10, 1000

INSTRUCTIONS = """다음은 웹소설의 한 문단이거나 소설 설정 항목 하나다. 이 글에 적힌 사실 하나를 골라, 글을 보지 않은 사람에게 묻는 한국어 질문 하나와 그 근거가 되는 구절을 만든다.
- quote는 글에 있는 그대로 복사한 구절이어야 한다(고치거나 줄이지 말 것).
- question에는 quote 구절을 그대로 쓰지 않는다. 글의 이름·낱말은 써도 된다. 한 문장으로 쓴다."""


class KoQuestion(BaseModel):
    question: str
    quote: str


def _rows(name: str) -> list[dict]:
    return list(csv.DictReader((SAMPLE / name).open(newline='', encoding='utf-8')))


def load_works() -> dict:
    """샘플 CSV에서 작품별 회차 문단·설정 카드·참가자·링크를 읽는다(저장된 자체 원고만)."""
    works = {w['title']: w['id'] for w in _rows('work.csv') if w['title'] in WORKS}
    episodes, versions = _rows('episode.csv'), _rows('episode_version.csv')
    documents = {d['id']: d for d in _rows('setting_document.csv')}
    settings = _rows('setting_version.csv')
    participants, links = _rows('setting_reading_participant.csv'), _rows('setting_reading_link.csv')
    result = {}
    for title, work_id in works.items():
        sequence = {e['id']: int(e['sequence']) for e in episodes if e['work_id'] == work_id}
        saved = {sequence[v['episode_id']]: [p.strip() for p in v['content'].split('\n\n') if p.strip()]
                 for v in versions if v['episode_id'] in sequence and v['is_saved'] == 'true'}
        mine = [s for s in settings if documents[s['setting_document_id']]['world_id'] == work_id]
        by_version = {s['id']: s['name'] for s in mine}
        by_logical = {documents[s['setting_document_id']]['logical_id']: s['name'] for s in mine}
        result[title] = {
            'episodes': saved,
            'cards': [{'name': s['name'], 'category': s['category_id'], 'content': s['content']} for s in mine],
            'participants': [(by_version[v], [p['name'] for p in sorted((p for p in participants if p['setting_version_id'] == v),
                                                                       key=lambda p: int(p['position']))])
                             for v in by_version if any(p['setting_version_id'] == v for p in participants)],
            'links': [(by_version[l['setting_version_id']], by_logical[l['target_logical_id']], l['kind'])
                      for l in links if l['setting_version_id'] in by_version and l['target_logical_id'] in by_logical]}
    return result


def candidates(works: dict, seed: int) -> list[dict]:
    """질문 후보: 문단마다 종류별 조건에 맞는 인물을 하나 골라 결정적으로 뽑는다. 이 후보를 모델에 보내 질문을 만든다."""
    rng = random.Random(seed)
    pools: dict[str, list[dict]] = {kind: [] for kind in QUOTA}
    for title in WORKS:
        work = works[title]
        last = max(work['episodes'])
        names = [c['name'] for c in work['cards'] if c['category'] == '인물']
        for episode, paragraphs in sorted(work['episodes'].items()):
            for index, text in enumerate(paragraphs):
                source = {'episode': episode, 'index': index, 'text': text}
                inside = [n for n in names if n in text]
                outside = [n for n in names if n not in text]
                if inside:
                    pools['known'].append({'kind': 'known', 'work': title, 'character': rng.choice(inside), 'source': source,
                                           'episode': episode if index % 2 == 0 else last})
                    if episode >= 2:
                        pools['future'].append({'kind': 'future', 'work': title, 'character': rng.choice(inside), 'source': source,
                                                'episode': episode - 1})
                if outside:
                    pools['unwitnessed'].append({'kind': 'unwitnessed', 'work': title, 'character': rng.choice(outside),
                                                 'source': source, 'episode': last})
        for card in work['cards']:
            if card['category'] != '인물' and card['content'].strip() and names:
                pools['setting'].append({'kind': 'setting', 'work': title, 'character': rng.choice(names), 'episode': last,
                                         'source': {'category': card['category'], 'name': card['name'],
                                                    'text': f"{card['name']}: {card['content']}"}})
    picked = []
    for kind, quota in QUOTA.items():
        picked += rng.sample(pools[kind], min(quota, len(pools[kind])))
    return picked


def valid_question(text: str, out: dict, seen: set[str]) -> str | None:
    """규칙 검증. 통과하면 None, 아니면 버리는 이유. 모델 출력을 고쳐 쓰지 않는다."""
    flat = lambda s: ' '.join(s.split())  # noqa: E731
    question, quote = flat(out['question']), flat(out['quote'])
    if quote not in flat(text):
        return 'quote_not_in_text'
    if not 8 <= len(question) <= 100:
        return 'bad_length'
    if quote in question:
        return 'answer_in_question'
    if not set(tokenize(question)) & set(tokenize(text)):
        return 'no_overlap'
    if question in seen:
        return 'duplicate'
    return None


def evidence_ids(refs: list[str]) -> list[str]:
    """recall 항목 ref → 근거 id(문단·카드). 관계는 근거가 아니다."""
    ids = []
    for ref in refs:
        kind, _, rest = ref.partition(':')
        if kind in ('manuscript', 'card'):
            ids.append(rest.partition('#')[0])
    return dedupe(ids)


def paragraph_id(work: str, episode: int, index: int) -> str:
    return f'{WORKS.index(work)}.{episode}.{index}'


def generate() -> None:
    works = load_works()
    cands = candidates(works, SEED)
    ledger = Ledger(DATA / 'ledger.jsonl')
    print(f'후보 {len(cands)}개 → 호출 최대 {len(cands)}회 + 중복 재요청 (장부 {ledger.used()}/{CAP}, 캐시된 요청은 호출하지 않음)', flush=True)
    llm = Llm(ledger, DATA / 'cache')

    def ask(c, avoid=()):
        text = c['source']['text'] + (f"\n\n이미 만든 질문(이것들과 다른 사실을 묻는다): {' / '.join(avoid)}" if avoid else '')
        try:
            return llm.ask('ko-question', INSTRUCTIONS, text, schema=KoQuestion, max_output_tokens=2000)
        except LlmFailure:
            return None

    def gold_of(c):
        source = c['source']
        return ({'type': 'setting', 'work': c['work'], 'name': source['name']} if c['kind'] == 'setting'
                else {'type': 'paragraph', 'work': c['work'], 'episode': source['episode'], 'index': source['index']})

    rows, seen, dropped = [], set(), {}

    def take(c, out) -> str | None:
        reason = 'model_failure' if out is None else valid_question(c['source']['text'], out.model_dump(), seen)
        if not reason:
            question = ' '.join(out.question.split())
            seen.add(question)
            rows.append({'id': f'ko-{len(rows):03d}', 'kind': c['kind'], 'work': c['work'], 'character': c['character'],
                         'episode': c['episode'], 'question': question, 'quote': ' '.join(out.quote.split()), 'gold': gold_of(c)})
        return reason

    with ThreadPoolExecutor(8) as pool:
        outputs = list(pool.map(ask, cands))
    repeats = []
    for c, out in zip(cands, outputs):
        reason = take(c, out)
        if reason == 'duplicate':
            repeats.append(c)  # 같은 문단을 다른 종류 질문에도 쓰므로 모델이 같은 질문을 내면 '다른 사실'을 다시 요청한다
        elif reason:
            dropped[reason] = dropped.get(reason, 0) + 1
    with ThreadPoolExecutor(8) as pool:
        retried = list(pool.map(lambda c: ask(c, [r['question'] for r in rows if r['gold'] == gold_of(c)]), repeats))
    for c, out in zip(repeats, retried):
        reason = take(c, out)
        if reason:
            dropped[reason] = dropped.get(reason, 0) + 1
    DATASET.parent.mkdir(exist_ok=True)
    DATASET.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))
    print(f"질문 {len(rows)}개 저장(종류별 { {k: sum(r['kind'] == k for r in rows) for k in QUOTA} }), 버린 후보 {dropped}, 장부 {ledger.used()}/{CAP}")


def ko_world(works: dict, title: str, episode: int) -> WorldSnapshot:
    """한 작품의 설정을 세계관으로: 카드(본문=설정 내용), 참가자→지식(사건) 관계, 링크 관계."""
    work, number = works[title], WORKS.index(title)
    cards = [Card(id=f"{number}:{c['name']}", cardType=CARD_TYPE.get(c['category'], 'other'), title=c['name'], text=c['content'])
             for c in work['cards']]
    ids = {c.title: c.id for c in cards}
    relations = [Relation(id=f'p{n}-{name}', source=ids[name], target=ids[event], label='participated', direction='directed')
                 for n, (event, names) in enumerate(work['participants']) for name in names if name in ids and event in ids]
    relations += [Relation(id=f'l{n}', source=ids[src], target=ids[dst], label=kind, direction='directed')
                  for n, (src, dst, kind) in enumerate(work['links']) if src in ids and dst in ids]
    return WorldSnapshot(worldId=title, episode=episode, cards=cards, relations=relations)


def run() -> None:
    works = load_works()
    rows = [json.loads(line) for line in DATASET.read_text().splitlines()]
    pools = {t: [(e, i, text) for e, ps in sorted(w['episodes'].items()) for i, text in enumerate(ps)] for t, w in works.items()}
    vectors = {t: embed_texts([text for _, _, text in pool], 'passage') for t, pool in pools.items()}
    queries = embed_texts([r['question'] for r in rows], 'query')
    runs: dict[str, dict[str, list[str]]] = {c: {} for c in ('ppr', 'vector', 'bm25', 's1', 's2', 's3')}
    for n, r in enumerate(rows):
        title, episode = r['work'], r['episode']
        world = ko_world(works, title, episode)
        character_id = next(c.id for c in world.cards if c.title == r['character'])
        pool = pools[title]
        manuscript = []
        for i in knn(vectors[title], queries[n], EXCERPTS):
            e, index, text = pool[i]
            manuscript.append(Excerpt(id=paragraph_id(title, e, index), episode=e, quote=best_window(text, r['question'])))
        docs = _documents(world.cards)
        refs = {
            'ppr': [i.ref for i in recall(world, character_id, episode, r['question'], stage=0, k=BIG).items],
            'vector': [f'manuscript:{e.id}' for e in manuscript],
            'bm25': [ref for ref, _ in bm25_rank(r['question'], [(ref, f'{t} {x}') for ref, (t, x) in docs.items()])],
        }
        for config, stage in (('s1', 1), ('s2', 2), ('s3', 3)):
            refs[config] = [i.ref for i in recall(world, character_id, episode, r['question'], stage=stage,
                                                  manuscript=manuscript, k=BIG).items]
        for config, found in refs.items():
            runs[config][r['id']] = evidence_ids(found)[:K]
    cards_of = {t: {c.title: c.id for c in ko_world(works, t, 1).cards} for t in works}
    result = {'n': len(rows), 'k': K, 'excerpts_per_question': EXCERPTS, 'by_kind': {kind: sum(r['kind'] == kind for r in rows) for kind in QUOTA},
              'configs': {}}
    for config in runs:
        block = {}
        for kind in ('known', 'setting'):
            mine = [r for r in rows if r['kind'] == kind]
            gold = lambda r: {paragraph_id(r['work'], r['gold']['episode'], r['gold']['index'])} if kind == 'known' else {  # noqa: E731
                cards_of[r['work']][r['gold']['name']]}
            block[kind] = {'n': len(mine), f'recall@{K}': mean(recall_at_k(runs[config][r['id']], gold(r), K) for r in mine),
                           f'p@{K}': mean(precision_at_k(runs[config][r['id']], gold(r), K) for r in mine)}
        future = [r for r in rows if r['kind'] == 'future']
        block['future'] = {'n': len(future), 'leak': mean(any(int(i.split('.')[1]) > r['episode'] for i in runs[config][r['id']] if '.' in i)
                                                           for r in future)}
        unseen = [r for r in rows if r['kind'] == 'unwitnessed']
        block['unwitnessed'] = {'n': len(unseen), 'leak': mean(
            paragraph_id(r['work'], r['gold']['episode'], r['gold']['index']) in runs[config][r['id']] for r in unseen)}
        result['configs'][config] = block
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / 'ko-retrieval.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    for config, b in result['configs'].items():
        print(f"{config:7s} known R@5={b['known']['recall@5']:.2f} P@5={b['known']['p@5']:.2f} | setting R@5={b['setting']['recall@5']:.2f} "
              f"P@5={b['setting']['p@5']:.2f} | 미래 누설 {b['future']['leak']:.2f} | 미목격 누설 {b['unwitnessed']['leak']:.2f}")


if __name__ == '__main__':
    commands = {'generate': generate, 'run': run}
    if sys.argv[1:] not in [[c] for c in commands]:
        raise SystemExit(f'사용법: ko.py {"|".join(commands)}')
    commands[sys.argv[1]]()
