"""TimeChara 평가 실행: 검증 600건에서 유형마다 같은 수를 뽑아 구성별 문맥을 모으고, 인물 응답을 만들고, 공개 채점 기준으로 채점한다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py contexts [--subset]   # 호출 없음: 문맥·누설 지표
    set -a; . <저장소 루트 .env>; set +a                                # 아래부터 OpenAI 호출
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py run [--mode=sync|batch] [--subset]

구성: zero(검색 없음, 공개 zero-shot과 같은 입력) · ppr(0단계) · vector · bm25 · s1 · s2 · s3. 문맥은 상위 6개 항목(rag-cutoff와 같은 6)이다.
채점은 공개 evaluate.py와 같다: 공간(absence·presence)이 0이면 시간은 묻지 않고, 성격은 1~7.
기본은 검증 600건 전체이고 `--subset`은 처음 평가한 유형별 20개(80건)다. 호출은 라운드(생성 → 채점 → 둘째 채점)로 묶어 동기 또는 Batch로 낸다.
"""

import ast
import json
import re
import sys
from collections import Counter
from pathlib import Path

from app.manuscript.models import Excerpt
from app.novelbrain.service import _documents, bm25_rank, recall
from batch import Round, cost_report, make_executor, plan_for, run_rounds
from cost import LIMIT_USD
from embed import best_window, embed_texts, knn
from llm import usd_llm
from metrics import parse_score, sign_test, spatiotemporal_score, wilson_interval
from prepare import DATA, SEED
from timechara import (SERIES, TYPES, build_world, chapter_tuple, common_names, cutoff, judge_name, load_chunks, ordinal_map,
                       parse_tables, sample_by_type, snapshot, system_prompt)

PER_TYPE = 20
K_CTX = 6
EXCERPTS = 10
CONFIGS = ('zero', 'ppr', 'vector', 'bm25', 's1', 's2', 's3')
PERSONALITY_CONFIGS = ('zero', 'ppr', 's1', 's2', 's3')   # 성격 채점은 누적 단계와 기준선만(단독 구성은 성격 차이가 기대되지 않는다)
WEIGHTS = {'future': 1 / 3, 'past-only': 1 / 3, 'past-absence': 1 / 6, 'past-presence': 1 / 6}   # 공개 600건의 유형 구성(200/200/100/100)
JUDGE_SYSTEM = 'You are a helpful and accurate assistant.'   # 공개 evaluate.py와 같다
GEN_TOKENS, JUDGE_TOKENS = 3000, 3000
RESULTS = Path(__file__).resolve().parent / 'results'
TC = DATA / 'timechara'


def context_message(question: str, texts: list[str]) -> str:
    """공개 rag-cutoff와 같은 사용자 메시지: 문맥이 없으면 질문만, 있으면 'Context: …\\n***\\n질문'."""
    return 'Context: ' + '\n\n'.join(texts) + '\n***\n' + question if texts else question


def item_episode(ref: str, lookup: dict) -> int | None:
    """항목이 나온 회차(장 번호). 알 수 없는 항목(IDENTITY·SOUL·MEMORY)은 None."""
    kind, _, rest = ref.partition(':')
    if kind == 'manuscript':
        return lookup['chunk'].get(rest)
    if kind == 'relation':
        return lookup['when'].get(rest)
    if kind == 'card':
        card, _, part = rest.partition('#')
        return int(part[2:]) if part.startswith('ep') else lookup['event'].get(card) if not part else None
    return None


def foreign_memory(ref: str, character_id: str) -> bool:
    """다른 인물의 SOUL·MEMORY·회차 기억 문서인가(계약: 인물 입력에 넣지 않는다)."""
    kind, _, rest = ref.partition(':')
    card, _, part = rest.partition('#')
    return kind == 'card' and card != character_id and (part in ('soul', 'memory') or part.startswith('ep'))


def _verdict(llm, template: str, name: str, question: str, response: str, fact: str) -> int | None:
    prompt = template.format(agent_name=name, question_0=question, answer_0=response, agent_fact_0=fact)
    return parse_score(llm.ask('judge', JUDGE_SYSTEM, prompt, max_output_tokens=JUDGE_TOKENS), (0, 1))


def judge_spatiotemporal(llm, row: dict, response: str, name: str, template: str) -> dict:
    """공개 evaluate.py의 흐름: absence·presence는 공간을 먼저 묻고 0이면 시간은 묻지 않는다. 파싱 실패는 None."""
    kind, spatial = row['data_type'], None
    if kind in ('past-absence', 'past-presence'):
        spatial = _verdict(llm, template, name, row['question'], response, row['spatial_label'])
        temporal = 0 if spatial == 0 else None if spatial is None else _verdict(
            llm, template, name, row['question'], response, row['temporal_label'])
    else:
        temporal = _verdict(llm, template, name, row['question'], response, row['temporal_label'])
    unknown = temporal is None or (kind in ('past-absence', 'past-presence') and spatial is None)
    return {'temporal': temporal, 'spatial': spatial, 'score': None if unknown else spatiotemporal_score(kind, temporal, spatial)}


def judge_personality(llm, question: str, response: str, name: str, personality: str, template: str) -> int | None:
    prompt = template.format(agent_name=name, question_0=question, response_0=response, agent_personality=personality)
    return parse_score(llm.ask('judge', JUDGE_SYSTEM, prompt, max_output_tokens=JUDGE_TOKENS), range(1, 8))


def summarize(records: list[dict]) -> dict:
    """구성별: 유형별 시공간 일관성(0/1 평균·Wilson 구간), 공개 유형 구성으로 가중한 평균, 성격 평균, 문맥 누설 비율, 실패 수."""
    out = {}
    for config in dict.fromkeys(r['config'] for r in records):
        mine = [r for r in records if r['config'] == config]
        by_type = {}
        for kind in TYPES:
            scores = [r['score'] for r in mine if r['data_type'] == kind and r['score'] is not None]
            if scores:
                by_type[kind] = {'n': len(scores), 'score': sum(scores) / len(scores), 'ci': list(wilson_interval(sum(scores), len(scores)))}
        weight = sum(WEIGHTS[k] for k in by_type)
        personality = [r['personality'] for r in mine if r['personality'] is not None]
        out[config] = {
            'n': len(mine), 'failed': sum(r['score'] is None for r in mine), 'by_type': by_type,
            'weighted': sum(WEIGHTS[k] * v['score'] for k, v in by_type.items()) / weight if weight else None,
            'personality': sum(personality) / len(personality) if personality else None,
            'personality_n': len(personality),
            'future_ctx': sum(r['future_ctx'] for r in mine) / len(mine), 'foreign_ctx': sum(r['foreign_ctx'] for r in mine) / len(mine)}
    return out


def paired(records: list[dict], a: str, b: str) -> dict:
    """같은 질문에서 두 구성의 시공간 점수를 짝지어 센다: a만 맞음·b만 맞음과 정확 부호 검정(양측) p.
    표본이 작아 구간이 겹치므로 '단계가 올랐다'는 말은 이 짝 비교로만 한다. 한쪽이 실패(None)한 질문은 뺀다."""
    score = {(r['idx'], r['config']): r['score'] for r in records}
    both = [(score[idx, a], score[idx, b]) for idx in sorted({r['idx'] for r in records})
            if score.get((idx, a)) is not None and score.get((idx, b)) is not None]
    out = sign_test([x for x, _ in both], [y for _, y in both])
    return {'a_only': out['up'], 'b_only': out['down'], 'p': out['p']}


PAIRS = (('s3', 's2'), ('s3', 'zero'), ('s3', 'ppr'), ('s2', 's1'), ('s1', 'ppr'), ('ppr', 'zero'), ('s2', 'vector'), ('s2', 'bm25'),
         ('s3', 'vector'), ('s3', 'bm25'))


# ---- 입력 구성·실행(실제 데이터가 필요해 단위 테스트하지 않는다) ----

def build_inputs(everything: bool = True):
    import numpy as np

    rows = [dict(r, idx=i) for i, r in enumerate(json.loads((TC / 'valid.json').read_text()))]
    tables = parse_tables((TC / 'utils.py').read_text())
    series_data = {}
    for series in SERIES:
        mine = [r for r in rows if r['series'] == series]
        chunks = load_chunks(series)
        ordinals = ordinal_map({c['tuple'] for c in chunks} | {chapter_tuple(r['question_period']) for r in mine}
                               | {cutoff(series, r['character'], r['character_period'], tables) for r in mine})
        words = Counter(w for c in chunks for w in re.findall(r'[A-Z][A-Za-z]+', c['text']))
        names = sorted({r['character'] for r in mine} | {n for r in mine for n in ast.literal_eval(r['participants'])})
        world = build_world(mine, ordinals, common_names(names, words))
        series_data[series] = {'chunks': chunks, 'vectors': np.load(TC / f'vectors_{series}.npy'), 'ordinals': ordinals, 'world': world,
                               'docs': _documents(world['cards']), 'tables': tables}
    return (rows if everything else sample_by_type(rows, PER_TYPE, SEED)), series_data


def build_contexts(sample: list[dict], series_data: dict) -> dict[int, dict]:
    """질문마다 구성별 문맥 항목과 누설 지표. OpenAI 호출 없음."""
    queries = embed_texts([r['question'] for r in sample], 'query')
    contexts = {}
    for number, r in enumerate(sample):
        s = series_data[r['series']]
        world = s['world']
        episode = s['ordinals'][cutoff(r['series'], r['character'], r['character_period'], s['tables'])]
        snap, character_id = snapshot(world, episode), world['character_id'][r['character']]
        manuscript = []
        for i in knn(s['vectors'], queries[number], EXCERPTS):
            chunk = s['chunks'][i]
            quote = best_window(chunk['text'], r['question'])
            if quote:
                manuscript.append(Excerpt(id=chunk['id'], episode=s['ordinals'][chunk['tuple']], quote=quote))
        docs = s['docs']
        bm25 = bm25_rank(r['question'], [(ref, f'{title} {text}') for ref, (title, text) in docs.items()])[:K_CTX]
        found = {
            'zero': [],
            'ppr': [(i.ref, i.text) for i in recall(snap, character_id, episode, r['question'], stage=0, k=K_CTX).items],
            'vector': [(f'manuscript:{e.id}', e.quote) for e in manuscript[:K_CTX]],
            'bm25': [(ref, docs[ref][1]) for ref, _ in bm25],
        }
        for config, stage in (('s1', 1), ('s2', 2), ('s3', 3)):
            found[config] = [(i.ref, i.text) for i in recall(snap, character_id, episode, r['question'], stage=stage,
                                                              manuscript=manuscript, k=K_CTX).items]
        lookup = {'chunk': {c['id']: s['ordinals'][c['tuple']] for c in s['chunks']},
                  'event': {c.id: c.revealFromEpisode for c in world['cards'] if c.cardType == 'event'}, 'when': world['when']}
        contexts[r['idx']] = {config: {'items': [{'ref': ref, 'text': text} for ref, text in items],
                                       'future': any((item_episode(ref, lookup) or 0) > episode for ref, _ in items),
                                       'foreign': any(foreign_memory(ref, character_id) for ref, _ in items)}
                              for config, items in found.items()}
    return contexts


def context_report(sample: list[dict], contexts: dict) -> None:
    for config in CONFIGS:
        by_type = {k: [contexts[r['idx']][config] for r in sample if r['data_type'] == k] for k in TYPES}
        future = {k: sum(c['future'] for c in v) / len(v) for k, v in by_type.items()}
        everything = [c for v in by_type.values() for c in v]
        print(f"{config:7s} 문맥에 기준 회차 뒤 항목 {sum(c['future'] for c in everything) / len(everything):.2f} "
              f"(future형 {future['future']:.2f}) · 다른 인물 기억 {sum(c['foreign'] for c in everything) / len(everything):.2f} · "
              f"평균 항목 수 {sum(len(c['items']) for c in everything) / len(everything):.1f}")


def make_work(contexts: dict, templates: dict, system_of, name_of, personality_of, extra=None):
    """run_rounds용 work(task, llm). task = (질문 행, 구성). 라운드 1: 인물 응답 생성, 2: 시공간(공간 먼저)·성격 채점, 3: 공간이 1일 때 시간.

    system_of(row)·name_of(row)·personality_of(row)(없으면 None)는 데이터마다 다른 부분이고, extra(row, ctx)는 기록에 더할 필드다.
    호출이 영구 실패하면 score가 None인 채로 남아 집계의 failed로 센다(성공으로 꾸미지 않는다).
    """
    def work(task, llm):
        r, config = task
        ctx = contexts[r['idx']][config]
        record = {'idx': r['idx'], 'config': config, 'data_type': r['data_type'], 'response': None, 'score': None, 'temporal': None,
                  'spatial': None, 'personality': None, 'future_ctx': ctx['future'], 'foreign_ctx': ctx['foreign'],
                  **(extra(r, ctx) if extra else {})}
        step = Round()
        response, failed = step.get(lambda: llm.ask('gen', system_of(r), context_message(r['question'], [i['text'] for i in ctx['items']]),
                                                    max_output_tokens=GEN_TOKENS))
        step.done()
        if failed:
            return record
        name, personality = name_of(r), personality_of(r)
        verdict, _ = step.get(lambda: judge_spatiotemporal(llm, r, response, name, templates['spatiotemporal']))
        score = step.get(lambda: judge_personality(llm, r['question'], response, name, personality, templates['personality']))[0] \
            if config in PERSONALITY_CONFIGS and personality else None
        step.done()
        record.update(response=response, personality=score, **(verdict or {}))
        return record
    return work


def run(mode: str = 'sync', everything: bool = True) -> None:
    sample, series_data = build_inputs(everything)
    contexts = build_contexts(sample, series_data)
    context_report(sample, contexts)
    llm = usd_llm(DATA / 'cache', DATA / 'cost.jsonl', LIMIT_USD)
    templates = {'spatiotemporal': (TC / 'data/spatiotemporal_consistency_evaluation_prompt.txt').read_text(),
                 'personality': (TC / 'data/personality_consistency_evaluation_prompt.txt').read_text()}
    personality = {r['character']: (TC / f"data/personality/{r['character'].lower().replace(' ', '_')}_personality.txt").read_text()
                   for r in sample}
    work = make_work(contexts, templates, lambda r: system_prompt(r['series'], r['character'], r['character_period']),
                     lambda r: judge_name(r['series'], r['character'], r['character_period']), lambda r: personality[r['character']])
    tasks = [(r, config) for r in sample for config in CONFIGS]
    print(f'질문 {len(sample)}개 × 구성 {len(CONFIGS)} = {len(tasks)} 과제 · 방식 {mode} · 장부 ${llm.cost.spent():.3f}', flush=True)
    records = run_rounds(tasks, work, llm, make_executor(llm, mode, DATA / 'batches'), plan=plan_for(llm, mode))
    (DATA / 'runs').mkdir(exist_ok=True)
    (DATA / 'runs' / 'timechara-rows.json').write_text(json.dumps(records, ensure_ascii=False))
    write_results(records, llm.model, everything)
    cost_report(llm)


def write_results(records: list[dict], model: str, everything: bool) -> None:
    """집계를 results/timechara.json에 쓴다(전체 600건이면 처음 평가한 80건 부분집합 수치도 함께: 시작점 수정 전 80건과 같은 질문으로 비교하려고)."""
    rows = [dict(r, idx=i) for i, r in enumerate(json.loads((TC / 'valid.json').read_text()))]
    first = {r['idx'] for r in sample_by_type(rows, PER_TYPE, SEED)}
    summary = {'questions': len({r['idx'] for r in records}), 'per_type': PER_TYPE, 'seed': SEED, 'k_context': K_CTX, 'excerpts': EXCERPTS, 'model': model,
               'configs': summarize(records), 'paired': {f'{a}|{b}': paired(records, a, b) for a, b in PAIRS},
               'paired_by_type': {kind: {f'{a}|{b}': paired([r for r in records if r['data_type'] == kind], a, b) for a, b in PAIRS} for kind in TYPES}}
    if everything:
        subset = [r for r in records if r['idx'] in first]
        summary['first_80'] = {'questions': len(first), 'configs': summarize(subset), 'paired': {f'{a}|{b}': paired(subset, a, b) for a, b in PAIRS}}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / 'timechara.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    for config, block in summary['configs'].items():
        print(f"{config:7s} 시공간(가중) {block['weighted']:.3f} 성격 {block['personality'] if block['personality'] is None else round(block['personality'], 2)} "
              f"실패 {block['failed']}/{block['n']}")


if __name__ == '__main__':
    options = [a for a in sys.argv[2:] if a.startswith('--')]
    if sys.argv[1:2] == ['contexts']:
        sample, series_data = build_inputs('--subset' not in options)
        context_report(sample, build_contexts(sample, series_data))
    elif sys.argv[1:2] == ['run']:
        run(next((o.split('=', 1)[1] for o in options if o.startswith('--mode=')), 'sync'), '--subset' not in options)
    elif sys.argv[1:2] == ['paired']:  # 저장된 질문별 결과(.data/runs)로 집계·짝 비교만 다시 계산한다. 호출 없음
        write_results(json.loads((DATA / 'runs' / 'timechara-rows.json').read_text()), 'saved', True)
    else:
        raise SystemExit('사용법: run_timechara.py contexts|run|paired [--mode=…] [--subset]')
