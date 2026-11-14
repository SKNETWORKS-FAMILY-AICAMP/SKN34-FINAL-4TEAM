"""NovelBrain 평가 실행: 데이터셋 × 구성(단독 3 + 누적)의 검색 지표와 답·채점. 알고리즘은 app.novelbrain을 그대로 쓴다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run.py retrieval musique|narrativeqa   # 호출 없음
    set -a; . /Users/yunseongho/orca/SKN34-FINAL-4TEAM/.env; set +a                                           # 아래부터 OpenAI 호출
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run.py answers musique [gold none]   # 답 정확도(EM·F1)

구성 이름: ppr(그래프만=0단계) · vector(벡터만) · bm25(BM25만) · s1(0+1) · s2(0+1+2) · s3(0+1+2+3, 인물·회차가 있는 데이터만).
집계 수치는 `results/*.json`, 질문별 순위·응답 원본은 `.data/runs`(git 무시)에 둔다.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import mean

from app.manuscript.models import Excerpt
from app.novelbrain.models import Card, Relation, WorldSnapshot
from app.novelbrain.service import _documents, bm25_rank, recall  # ponytail: BM25-only 구성이 2단계와 같은 문서를 쓰도록 비공개 헬퍼를 가져온다
from embed import best_window, cached_embeddings, embed_texts, knn
from llm import CAP, Ledger, Llm, LlmFailure
from metrics import answer_f1, dedupe, exact_match, precision_at_k, recall_at_k
from prepare import DATA

K = 5            # 지표의 상위 k
EXCERPTS = 10    # 벡터 검색이 recall에 넘기는 발췌 수
BIG = 1000       # recall이 k개로 자르기 전에 문단 순위를 만들 수 있게 넉넉히
MIN_NAME = 3     # seed_cards는 제목을 부분 문자열로 찾아 한두 글자 개체가 엉뚱한 낱말에서 일치하므로 세계관에서 뺀다
RESULTS = Path(__file__).resolve().parent / 'results'
READER = ('Answer the question using only the passages. Reply with the shortest possible answer (a name, a date, a number or a short phrase) '
          'and nothing else. If the passages do not contain the answer, give your best guess from them.')


def passage_ranking(refs: list[str], pids: set[str], rel_pid: dict[str, str]) -> list[str]:
    """recall 항목 ref를 근거 문단 순위로 바꾼다. 카드·발췌는 그 문단, 관계는 추출된 문단. 개체 카드는 문단이 아니다."""
    ranked = []
    for ref in refs:
        kind, _, rest = ref.partition(':')
        if kind in ('card', 'manuscript') and rest in pids:
            ranked.append(rest)
        elif kind == 'relation' and rest in rel_pid:
            ranked.append(rel_pid[rest])
    return dedupe(ranked)


def text_world(sample: dict, graph: dict) -> tuple[WorldSnapshot, dict[str, str]]:
    """문단·개체 그래프를 NovelBrain 세계관으로. HippoRAG처럼 문단 카드(본문 있음)와 개체 카드(본문 없음)를 두고,
    개체→문단 '등장'과 개체→개체 트리플을 관계로 둔다. 관계 id → 출처 문단 표도 함께 돌려준다."""
    cards = [Card(id=p['id'], cardType='other', title=p.get('title', ''), text=p['text']) for p in sample['passages']]
    cards_of: dict[str, str] = {}
    for n, (key, entity) in enumerate(sorted(graph['entities'].items())):
        if len(entity['name'].strip()) >= MIN_NAME:
            cards_of[key] = f'e{n}'
            cards.append(Card(id=f'e{n}', cardType=entity['type'], title=entity['name'], text=''))
    relations, rel_pid = [], {}
    for key, entity in sorted(graph['entities'].items()):
        for pid in entity['passages'] if key in cards_of else []:
            rid = f'm{cards_of[key]}-{pid}'
            relations.append(Relation(id=rid, source=cards_of[key], target=pid, label='mentioned in', direction='directed'))
            rel_pid[rid] = pid
    for n, t in enumerate(t for t in graph['triples'] if t['s'] in cards_of and t['o'] in cards_of):
        relations.append(Relation(id=f't{n}', source=cards_of[t['s']], target=cards_of[t['o']], label=t['r'], direction='directed'))
        rel_pid[f't{n}'] = t['p']
    return WorldSnapshot(worldId='eval', episode=1, cards=cards, relations=relations), rel_pid


def aggregate(rows: list[dict], k: int, group: str | None = None) -> dict:
    """질문별 {'ranked','gold'}의 Recall@k·P@k 평균. group 키가 있으면 그 값별로도 낸다."""
    def block(part):
        return {'n': len(part), f'recall@{k}': mean(recall_at_k(r['ranked'], set(r['gold']), k) for r in part),
                f'p@{k}': mean(precision_at_k(r['ranked'], set(r['gold']), k) for r in part)}
    result = block(rows)
    if group:
        result['by_group'] = {g: block([r for r in rows if r[group] == g]) for g in sorted({r[group] for r in rows})}
    return result


def reader_input(question: str, passages: list[dict]) -> str:
    """리더 입력: 번호 붙인 문단(제목이 있으면 함께) 다음에 질문. 모든 구성이 같은 형식을 쓴다."""
    blocks = [f"[{n}] {p['title']}\n{p['text']}" if p.get('title') else f"[{n}] {p['text']}" for n, p in enumerate(passages, 1)]
    return '\n\n'.join(blocks + [f'Question: {question}\nAnswer:']) if blocks else f'Question: {question}\nAnswer:'


def score_answers(rows: list[dict]) -> dict:
    """{'pred','golds','hops'} → EM·F1 평균(홉별 포함). pred가 None(호출 실패)이면 점수에서 빼고 failed로 센다."""
    def block(part):
        return {'n': len(part), 'em': mean(exact_match(r['pred'], r['golds']) for r in part),
                'f1': mean(answer_f1(r['pred'], r['golds']) for r in part)} if part else {'n': 0}
    done = [r for r in rows if r['pred'] is not None]
    result = block(done)
    result['failed'] = len(rows) - len(done)
    result['by_hops'] = {h: block([r for r in done if r['hops'] == h]) for h in sorted({r['hops'] for r in rows})}
    return result


def answers(name: str, extra: tuple[str, ...] = ()) -> None:
    """MuSiQue: 구성별 상위 5개 문단(전문)을 리더에게 주고 답 정확도를 잰다. extra: gold(정답 근거 문단)·none(문단 없음) 기준선."""
    sample = json.loads((DATA / name / 'sample.json').read_text())
    runs = json.loads((DATA / 'runs' / f'{name}-rankings.json').read_text())
    by_pid = {p['id']: p for p in sample['passages']}
    configs = ('ppr', 'vector', 'bm25', 's1', 's2') + extra
    ledger = Ledger(DATA / 'ledger.jsonl')
    llm = Llm(ledger, DATA / 'cache')

    def passages_for(q, config):
        if config == 'gold':
            return [by_pid[p] for p in q['gold']]
        return [] if config == 'none' else [by_pid[p] for p in runs[config][q['id']][:K]]

    def work(task):
        q, config = task
        try:
            return llm.ask('answer', READER, reader_input(q['question'], passages_for(q, config)), max_output_tokens=3000)
        except LlmFailure:
            return None

    tasks = [(q, c) for q in sample['questions'] for c in configs]
    print(f'{name}: 질문 {len(sample["questions"])} × 구성 {len(configs)} = 최대 {len(tasks)}회 (장부 {ledger.used()}/{CAP}, 같은 입력은 캐시)', flush=True)
    with ThreadPoolExecutor(12) as pool:
        preds = list(pool.map(work, tasks))
    result = {'dataset': name, 'k': K, 'model': llm.model, 'configs': {}}
    for config in configs:
        rows = [{'pred': pred, 'golds': [q['answer'], *q['aliases']], 'hops': q['hops']}
                for (q, c), pred in zip(tasks, preds) if c == config]
        empty = sum(not passages_for(q, config) for q in sample['questions'])
        result['configs'][config] = dict(score_answers(rows), empty_context=empty)
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f'{name}-answers.json'
    previous = json.loads(out.read_text())['configs'] if out.exists() else {}
    result['configs'] = {**previous, **result['configs']}
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    for config, block in result['configs'].items():
        print(f"{name:10s} {config:7s} EM={block['em']:.3f} F1={block['f1']:.3f} (n={block['n']}, 실패 {block['failed']})")
    print(f'장부 {ledger.used()}/{CAP}')


def retrieval(name: str) -> None:
    """문헌형 데이터셋(MuSiQue·NarrativeQA)의 근거 문단 Recall@5·P@5를 구성별로 낸다. OpenAI 호출 없음."""
    sample = json.loads((DATA / name / 'sample.json').read_text())
    graph = json.loads((DATA / name / 'graph.json').read_text())
    world, rel_pid = text_world(sample, graph)
    passages, questions = sample['passages'], sample['questions']
    texts, pids = [p['text'] for p in passages], {p['id'] for p in passages}
    matrix = cached_embeddings(DATA / name / 'vectors.npy', texts, 'passage')
    query_vectors = embed_texts([q['question'] for q in questions], 'query')
    docs = _documents(world.cards)
    bm25_docs = [(ref, f'{title} {text}') for ref, (title, text) in docs.items()]
    runs: dict[str, dict[str, list[str]]] = {c: {} for c in ('ppr', 'vector', 'bm25', 's1', 's2')}
    for number, q in enumerate(questions):
        manuscript = [Excerpt(id=passages[i]['id'], episode=1, quote=best_window(texts[i], q['question']))
                      for i in knn(matrix, query_vectors[number], EXCERPTS)]
        refs = {
            'ppr': [i.ref for i in recall(world, None, 1, q['question'], stage=0, k=BIG).items],
            'vector': [f'manuscript:{e.id}' for e in manuscript],
            'bm25': [ref for ref, _ in bm25_rank(q['question'], bm25_docs)],
            's1': [i.ref for i in recall(world, None, 1, q['question'], stage=1, manuscript=manuscript, k=BIG).items],
            's2': [i.ref for i in recall(world, None, 1, q['question'], stage=2, manuscript=manuscript, k=BIG).items],
        }
        for config, found in refs.items():
            runs[config][q['id']] = passage_ranking(found, pids, rel_pid)[:20]
    group = 'hops' if name == 'musique' else None
    result = {'dataset': name, 'passages': len(passages), 'entities': sum(c.text == '' for c in world.cards),
              'relations': len(world.relations), 'excerpts_per_question': EXCERPTS, 'k': K,
              'ceiling': {f'recall@{K}': mean(min(K, len(q['gold'])) / len(q['gold']) for q in questions),
                          f'p@{K}': mean(min(K, len(q['gold'])) / K for q in questions)},
              'configs': {c: aggregate([{'ranked': runs[c][q['id']], 'gold': q['gold'], 'hops': q.get('hops')} for q in questions],
                                       K, group) for c in runs}}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'{name}-retrieval.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    (DATA / 'runs').mkdir(exist_ok=True)
    (DATA / 'runs' / f'{name}-rankings.json').write_text(json.dumps(runs, ensure_ascii=False))
    for config, block in result['configs'].items():
        print(f"{name:12s} {config:7s} recall@{K}={block[f'recall@{K}']:.3f} p@{K}={block[f'p@{K}']:.3f} (n={block['n']})")


if __name__ == '__main__':
    commands = {'retrieval': retrieval, 'answers': answers}
    if len(sys.argv) < 3 or sys.argv[1] not in commands:
        raise SystemExit(f'사용법: run.py {"|".join(commands)} <데이터셋> [gold] [none]')
    commands[sys.argv[1]](sys.argv[2], *([tuple(sys.argv[3:])] if sys.argv[1] == 'answers' else []))
