"""NovelBrain 평가 실행: 데이터셋 × 구성(단독 3 + 누적)의 검색 지표와 답·채점. 알고리즘은 app.novelbrain을 그대로 쓴다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run.py retrieval musique|narrativeqa   # 호출 없음
    set -a; . <저장소 루트 .env>; set +a                                           # 아래부터 OpenAI 호출
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run.py answers musique [gold none] [--cached-only]   # 답 정확도(EM·F1)

구성 이름: ppr(그래프만=0단계) · vector(벡터만) · bm25(BM25만) · s1(0+1) · s2(0+1+2) · s3(0+1+2+3, 인물·회차가 있는 데이터만),
하나씩 빼기: no_graph(벡터+BM25) · no_vector(그래프+BM25) · no_bm25(=s1). 같은 질문의 Recall@5로 짝 부호 검정(`paired`)을 함께 낸다.
집계 수치는 `results/*.json`, 질문별 순위·응답 원본은 `.data/runs`(git 무시)에 둔다.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import mean, stdev

from app.manuscript.models import Excerpt
from app.novelbrain.models import Card, RecallItem, Relation, WorldSnapshot
from app.novelbrain.service import _documents, bm25_rank, filter_for_character, recall, rrf  # ponytail: BM25-only 구성이 2단계와 같은 문서를 쓰도록 비공개 헬퍼를 가져온다
from embed import best_window, cached_embeddings, embed_texts, knn
from cost import LIMIT_USD
from llm import LlmFailure, usd_llm
from metrics import answer_f1, dedupe, exact_match, precision_at_k, recall_at_k, sign_test
from prepare import DATA

K = 5            # 지표의 상위 k
EXCERPTS = 10    # 벡터 검색이 recall에 넘기는 발췌 수
BIG = 10 ** 6    # recall이 순위를 자르지 않게(그래프 목록은 수천 개라 자르면 하나씩 빼기의 합산이 recall과 어긋난다)
MIN_NAME = 3     # seed_cards는 제목을 부분 문자열로 찾아 한두 글자 개체가 엉뚱한 낱말에서 일치하므로 세계관에서 뺀다
RESULTS = Path(__file__).resolve().parent / 'results'
# 짝 부호 검정에 쓰는 구성 쌍(앞이 뒤보다 나은 질문 수 : 못한 질문 수)
RETRIEVAL_PAIRS = (('s1', 'ppr'), ('s1', 'vector'), ('s2', 's1'), ('s2', 'vector'), ('s2', 'bm25'), ('s2', 'ppr'),
                   ('s2', 'no_graph'), ('s2', 'no_vector'), ('vector', 'ppr'))
ANSWER_PAIRS = (('ppr', 'vector'), ('ppr', 's2'), ('ppr', 'bm25'), ('s2', 'vector'), ('s2', 'none'), ('vector', 'none'), ('gold', 's2'))
READER = ('Answer the question using only the passages. Reply with the shortest possible answer (a name, a date, a number or a short phrase) '
          'and nothing else. If the passages do not contain the answer, give your best guess from them.')


def fuse(lists: list[list[str]]) -> list[str]:
    """ref 순위 목록들을 RRF로 합친 ref 목록. recall이 1단계 이상에서 하는 합산과 같은 `rrf`다."""
    return [ref for ref, _ in rrf(lists)]


def filtered(refs: list[str], texts: dict[str, str], world: WorldSnapshot, character_id: str, episode: int) -> list[str]:
    """합친 ref 목록에 인물 시점 필터만 건다(recall 3단계의 필터 부분). 필터는 ref와 발췌 본문(texts)만 읽는다."""
    items = [RecallItem(ref=ref, source='graph', text=texts.get(ref, ''), rank=n, score=0.0) for n, ref in enumerate(refs, 1)]
    return [i.ref for i in filter_for_character(items, world, character_id, episode)[0]]


def leave_one_out(graph: list[str], vector: list[str], bm25: list[str]) -> dict[str, list[str]]:
    """전체(0+1+2)에서 요소를 하나씩 뺀 ref 순위: 빠진 요소의 목록을 빼고 나머지를 RRF로 합친다."""
    return {'full': fuse([graph, vector, bm25]), 'no_graph': fuse([vector, bm25]), 'no_vector': fuse([graph, bm25]),
            'no_bm25': fuse([graph, vector])}


def compare(scores: dict[str, list[float]], pairs, groups: list | None = None) -> dict:
    """구성별 질문 점수 목록에서 쌍마다 부호 검정. groups(질문별 집단 값)가 있으면 집단별로도 낸다."""
    def run(index):
        return {f'{a}|{b}': sign_test([scores[a][i] for i in index], [scores[b][i] for i in index]) for a, b in pairs}
    everything = list(range(len(next(iter(scores.values())))))
    by_group = {g: run([i for i in everything if groups[i] == g]) for g in sorted(set(groups))} if groups else {}
    return {'all': run(everything), 'by_group': by_group}


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
    def stats(values):
        values = list(values)
        return mean(values), (stdev(values) / len(values) ** 0.5 if len(values) > 1 else 0.0)

    def block(part):
        recall, recall_se = stats(recall_at_k(r['ranked'], set(r['gold']), k) for r in part)
        precision, precision_se = stats(precision_at_k(r['ranked'], set(r['gold']), k) for r in part)
        return {'n': len(part), f'recall@{k}': recall, f'recall@{k}_se': recall_se, f'p@{k}': precision, f'p@{k}_se': precision_se}
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
    """MuSiQue: 구성별 상위 5개 문단(전문)을 리더에게 주고 답 정확도를 잰다. extra: gold(정답 근거 문단)·none(문단 없음) 기준선.
    `--cached-only`는 캐시에 있는 응답만 읽어 다시 계산한다(호출 0회, 캐시에 없는 요청은 실패로 센다)."""
    cached_only = '--cached-only' in extra
    extra = tuple(e for e in extra if e != '--cached-only')
    sample = json.loads((DATA / name / 'sample.json').read_text())
    runs = json.loads((DATA / 'runs' / f'{name}-rankings.json').read_text())
    by_pid = {p['id']: p for p in sample['passages']}
    configs = ('ppr', 'vector', 'bm25', 's1', 's2') + extra
    llm = usd_llm(DATA / 'cache', DATA / 'cost.jsonl', LIMIT_USD)   # 호출 수 대신 금액(비용 장부)으로 막는다

    def passages_for(q, config):
        if config == 'gold':
            return [by_pid[p] for p in q['gold']]
        return [] if config == 'none' else [by_pid[p] for p in runs[config][q['id']][:K]]

    def work(task):
        q, config = task
        text = reader_input(q['question'], passages_for(q, config))
        if cached_only and not llm.is_cached(READER, text, max_output_tokens=3000):
            return None
        try:
            return llm.ask('answer', READER, text, max_output_tokens=3000)
        except LlmFailure:
            return None

    tasks = [(q, c) for q in sample['questions'] for c in configs]
    fresh = sum(not llm.is_cached(READER, reader_input(q['question'], passages_for(q, c)), max_output_tokens=3000) for q, c in tasks)
    print(f'{name}: 질문 {len(sample["questions"])} × 구성 {len(configs)} = {len(tasks)}건, 캐시에 없는 것 {fresh}건 '
          f'(장부 ${llm.cost.spent():.3f} / 상한 ${LIMIT_USD:.2f})', flush=True)   # 순위가 바뀐 뒤에는 문맥이 달라져 캐시에 없는 요청이 생긴다
    with ThreadPoolExecutor(12) as pool:
        preds = list(pool.map(work, tasks))
    result = {'dataset': name, 'k': K, 'model': llm.model, 'configs': {}}
    for config in configs:
        rows = [{'pred': pred, 'golds': [q['answer'], *q['aliases']], 'hops': q['hops']}
                for (q, c), pred in zip(tasks, preds) if c == config]
        empty = sum(not passages_for(q, config) for q in sample['questions'])
        result['configs'][config] = dict(score_answers(rows), empty_context=empty)
    em = {c: {q['id']: exact_match(pred, [q['answer'], *q['aliases']]) for (q, cfg), pred in zip(tasks, preds)
              if cfg == c and pred is not None} for c in configs}
    result['paired_em'] = {f'{a}|{b}': sign_test([em[a][i] for i in sorted(em[a].keys() & em[b].keys())],
                                                [em[b][i] for i in sorted(em[a].keys() & em[b].keys())])
                           for a, b in ANSWER_PAIRS if a in em and b in em}
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f'{name}-answers.json'
    previous = json.loads(out.read_text())['configs'] if out.exists() else {}
    result['configs'] = {**previous, **result['configs']}
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    for config, block in result['configs'].items():
        print(f"{name:10s} {config:7s} EM={block['em']:.3f} F1={block['f1']:.3f} (n={block['n']}, 실패 {block['failed']})")
    print(f'장부 ${llm.cost.spent():.3f} / 상한 ${LIMIT_USD:.2f}')


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
    runs: dict[str, dict[str, list[str]]] = {c: {} for c in ('ppr', 'vector', 'bm25', 's1', 's2', 'no_graph', 'no_vector')}
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
        loo = leave_one_out(refs['ppr'], refs['vector'], refs['bm25'])
        # 하나씩 빼기가 recall과 같은 합산이라는 확인: 전체는 2단계, BM25를 뺀 것은 1단계와 ref 순위가 같아야 한다
        assert loo['full'] == refs['s2'] and loo['no_bm25'] == refs['s1'], q['id']
        refs |= {'no_graph': loo['no_graph'], 'no_vector': loo['no_vector']}
        for config, found in refs.items():
            runs[config][q['id']] = passage_ranking(found, pids, rel_pid)[:20]
    group = 'hops' if name == 'musique' else None
    result = {'dataset': name, 'passages': len(passages), 'entities': sum(c.text == '' for c in world.cards),
              'relations': len(world.relations), 'excerpts_per_question': EXCERPTS, 'k': K,
              'ceiling': {f'recall@{K}': mean(min(K, len(q['gold'])) / len(q['gold']) for q in questions),
                          f'p@{K}': mean(min(K, len(q['gold'])) / K for q in questions)},
              'configs': {c: aggregate([{'ranked': runs[c][q['id']], 'gold': q['gold'], 'hops': q.get('hops')} for q in questions],
                                       K, group) for c in runs}}
    scores = {c: [recall_at_k(runs[c][q['id']], set(q['gold']), K) for q in questions] for c in runs}
    result['paired'] = compare(scores, RETRIEVAL_PAIRS, [q.get('hops') for q in questions] if group else None)
    rankings_file = DATA / 'runs' / f'{name}-rankings.json'
    if rankings_file.exists():  # 이전 실행의 순위와 비교: 몇 문항이 달라졌는지, 같은 질문의 Recall@5가 올랐는지(작업 A 수정 반영 뒤 등)
        before = json.loads(rankings_file.read_text())
        print(f"{name}: 이전 순위와 상위 20이 같은 질문 " + ', '.join(
            f"{c} {sum(before[c][q['id']] == runs[c][q['id']] for q in questions)}/{len(questions)}" for c in before if c in runs))
        result['vs_previous_run'] = {c: sign_test(scores[c], [recall_at_k(before[c][q['id']], set(q['gold']), K) for q in questions])
                                     for c in runs if c in before}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'{name}-retrieval.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    (DATA / 'runs').mkdir(exist_ok=True)
    rankings_file.write_text(json.dumps(runs, ensure_ascii=False))
    for config, block in result['configs'].items():
        print(f"{name:12s} {config:7s} recall@{K}={block[f'recall@{K}']:.3f} p@{K}={block[f'p@{K}']:.3f} (n={block['n']})")


if __name__ == '__main__':
    commands = {'retrieval': retrieval, 'answers': answers}
    if len(sys.argv) < 3 or sys.argv[1] not in commands:
        raise SystemExit(f'사용법: run.py {"|".join(commands)} <데이터셋> [gold] [none]')
    commands[sys.argv[1]](sys.argv[2], *([tuple(sys.argv[3:])] if sys.argv[1] == 'answers' else []))
