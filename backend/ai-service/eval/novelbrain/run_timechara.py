"""TimeChara 평가 실행: 검증 600건에서 유형마다 같은 수를 뽑아 구성별 문맥을 모으고, 인물 응답을 만들고, 공개 채점 기준으로 채점한다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py contexts [--subset]   # 호출 없음: 문맥·누설 지표
    set -a; . <저장소 루트 .env>; set +a                                # 아래부터 OpenAI 호출
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py run [--mode=sync|batch] [--subset]
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py paired                    # 호출 없음: 저장된 기록으로 집계·짝 비교만 다시

구성: zero(검색 없음, 공개 zero-shot과 같은 입력) · ppr(0단계) · vector · bm25 · s1 · s2 · s3. 문맥은 상위 6개 항목(rag-cutoff와 같은 6)이다.
채점은 공개 evaluate.py와 같다: 공간(absence·presence)이 0이면 시간은 묻지 않고, 성격은 1~7.
기본은 검증 600건 전체이고 `--subset`은 처음 평가한 유형별 20개(80건)다. 호출은 라운드(생성 → 채점 → 둘째 채점)로 묶어 동기 또는 Batch로 낸다.

다시 채점(채점 모델 하나로 견주기): 저장된 응답(.data/runs/timechara-rows.json)을 다시 만들지 않고 로컬 OpenCodex 게이트웨이의 gpt-6.2-sol(구독 경로, 금액 0, OpenAI 키를 읽지 않는다)로 채점만 다시 한다.
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py rejudge --name=luna-sol [--configs=zero,s2,s3] [--judge-model=gpt-6.2-sol] [--limit=8] [--no-personality]
결과는 .data/runs/timechara-rows-<name>.json·results/timechara-<name>.json에 따로 쓰고(기존 timechara-rows.json·results/timechara.json은 덮지 않는다), 채점 캐시는 .data/timechara-cache-judge-<모델>,
장부는 .data/cost-timechara-<name>.jsonl이다(KoTimeChara와 섞이지 않는다). --limit은 유형 비율을 지키며 고정 시드로 N문항만(파일럿)이다.
"""

import argparse
import ast
import json
import re
import sys
from collections import Counter
from pathlib import Path

from app.story_qa.models import Excerpt
from app.novelbrain.service import _documents, bm25_rank, recall
from batch import Round, cost_report, make_executor, plan_for, run_rounds
from cost import LIMIT_USD, MODEL
from embed import best_window, embed_texts, knn
from llm import Llm, usd_llm
from metrics import parse_score, sign_test, spatiotemporal_score, wilson_interval
from prepare import DATA, SEED, stratified_sample
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
SIM = Path(__file__).resolve().parents[1] / 'simulation'   # sim_via(로컬 게이트웨이 어댑터)의 위치
JUDGE_MODEL = 'gpt-6.2-sol'   # 채점 모델(사용자 결정 2026-11-25): 로컬 OpenCodex 게이트웨이(구독 경로, 금액 0)의 이 하나로 고정한다. ko_timechara/kt_exec.JUDGE_MODEL과 같은 값이다
REJUDGE_CONFIGS = ('zero', 's2', 's3')   # 다시 채점의 기본 구성: 검색 없음·전체−필터·전체
RESERVED = ('filter-v1', 'before-seed-fix')   # runs/timechara-rows-<이름>.json·results/timechara-<이름>.json이 이미 있는 보관 파일과 겹치는 이름
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]*')
STAMP = ('gen_model', 'gen_via', 'judge_model', 'judge_via')   # 기록에 남기는 응답·채점 모델과 각각의 호출 경로(via: 게이트웨이 ocx 또는 openai)


def context_message(question: str, texts: list[str]) -> str:
    """공개 rag-cutoff와 같은 사용자 메시지: 문맥이 없으면 질문만, 있으면 'Context: …\\n***\\n질문'."""
    return 'Context: ' + '\n\n'.join(texts) + '\n***\n' + question if texts else question


def item_episode(ref: str, lookup: dict) -> int | None:
    """항목이 나온 회차(장 번호). 알 수 없는 항목(IDENTITY·SOUL·GOAL)은 None."""
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
    """다른 인물의 SOUL·GOAL·회차 기억 문서인가(계약: 인물 입력에 넣지 않는다)."""
    kind, _, rest = ref.partition(':')
    card, _, part = rest.partition('#')
    return kind == 'card' and card != character_id and (part in ('soul', 'goal') or part.startswith('ep'))


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


def make_work(contexts: dict, templates: dict, system_of, name_of, personality_of, extra=None, responses=None):
    """run_rounds용 work(task, llm). task = (질문 행, 구성). 라운드 1: 인물 응답 생성, 2: 시공간(공간 먼저)·성격 채점, 3: 공간이 1일 때 시간.

    system_of(row)·name_of(row)·personality_of(row)(없으면 None)는 데이터마다 다른 부분이고, extra(row, ctx)는 기록에 더할 필드다.
    호출이 영구 실패하면 score가 None인 채로 남아 집계의 failed로 센다(성공으로 꾸미지 않는다).
    응답 모델과 채점 모델은 work가 아니라 llm이 나눈다: 호출마다 붙인 종류('gen'·'judge')를 `Llm.for_kind`가 가른다.
    responses = {(질문 idx, 구성): 저장된 응답}을 주면 응답을 다시 만들지 않고 그 응답을 채점만 한다(다시 채점). 응답이 None인 기록은 실패 그대로 둔다.
    """
    def work(task, llm):
        r, config = task
        ctx = contexts[r['idx']][config]
        record = {'idx': r['idx'], 'config': config, 'data_type': r['data_type'], 'response': None, 'score': None, 'temporal': None,
                  'spatial': None, 'personality': None, 'future_ctx': ctx['future'], 'foreign_ctx': ctx['foreign'],
                  **(extra(r, ctx) if extra else {})}
        step = Round()
        if responses is None:
            response, failed = step.get(lambda: llm.ask('gen', system_of(r), context_message(r['question'], [i['text'] for i in ctx['items']]),
                                                        max_output_tokens=GEN_TOKENS))
        else:
            response = responses.get((r['idx'], config))
            failed = response is None
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


def write_results(records: list[dict], model: str, everything: bool, name: str | None = None) -> None:
    """집계를 results/timechara.json(name을 주면 results/timechara-<name>.json)에 쓴다(전체 600건이면 처음 평가한 80건 부분집합 수치도 함께: 시작점 수정 전 80건과 같은 질문으로 비교하려고).
    기록에 없는 구성이 낀 짝은 건너뛰고, 기록에 응답·채점 모델이 있으면(다시 채점) models에 남긴다(모델 기록이 없는 옛 기록만이면 집계 모양을 그대로 둔다)."""
    rows = [dict(r, idx=i) for i, r in enumerate(json.loads((TC / 'valid.json').read_text()))]
    first = {r['idx'] for r in sample_by_type(rows, PER_TYPE, SEED)}
    present = {r['config'] for r in records}
    pairs = tuple(p for p in PAIRS if set(p) <= present)
    summary = {'questions': len({r['idx'] for r in records}), 'per_type': PER_TYPE, 'seed': SEED, 'k_context': K_CTX, 'excerpts': EXCERPTS, 'model': model,
               'configs': summarize(records), 'paired': {f'{a}|{b}': paired(records, a, b) for a, b in pairs},
               'paired_by_type': {kind: {f'{a}|{b}': paired([r for r in records if r['data_type'] == kind], a, b) for a, b in pairs} for kind in TYPES}}
    if everything:
        subset = [r for r in records if r['idx'] in first]
        summary['first_80'] = {'questions': len(first), 'configs': summarize(subset), 'paired': {f'{a}|{b}': paired(subset, a, b) for a, b in pairs}}
    if models := models_of(records):
        summary['models'] = models
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / ('timechara.json' if name is None else f'timechara-{name}.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    for config, block in summary['configs'].items():
        weighted, personality = block['weighted'], block['personality']
        print(f"{config:7s} 시공간(가중) {'-' if weighted is None else format(weighted, '.3f')} 성격 {'-' if personality is None else round(personality, 2)} "
              f"실패 {block['failed']}/{block['n']}")


# ---- 저장된 응답을 채점만 다시(rejudge) ----

def check_name(name: str, reserved: tuple[str, ...]) -> str:
    """결과 이름(--name): 파일 이름에 붙으므로 영문·숫자로 시작하는 영문·숫자·-_.만 받고, reserved(이미 있는 다른 결과 파일과 겹치는 이름)는 막는다."""
    if not NAME.fullmatch(name) or name in reserved:
        raise SystemExit(f"--name '{name}'은 쓸 수 없다: 영문·숫자로 시작하는 영문·숫자·-_.만 쓰고 {'·'.join(reserved)}는 기존 파일과 겹친다.")
    return name


def pilot(rows: list[dict], limit: int | None) -> list[dict]:
    """파일럿: 유형(data_type) 비율을 지키며 고정 시드(SEED)로 limit문항만, 질문 파일 순서대로. limit이 없거나 전체 이상이면 rows 그대로. rows는 id·idx를 가진다."""
    if limit is not None and limit < 1:
        raise SystemExit('--limit은 1 이상이어야 한다.')
    if limit is None or limit >= len(rows):
        return rows
    return sorted(stratified_sample(rows, lambda r: r['data_type'], limit, SEED), key=lambda r: r['idx'])


def models_of(records: list[dict]) -> dict:
    """집계에 남기는 응답·채점 모델과 호출 경로: 기록에 있는 값의 목록(모델 기록이 없는 옛 기록만이면 빈 dict)."""
    found = {key: sorted({r[key] for r in records if key in r}) for key in STAMP}
    return {key: values for key, values in found.items() if values}


def rows_path(name: str | None = None) -> Path:
    """질문×구성별 기록: 이름이 없으면 run이 쓰는 timechara-rows.json, 있으면 timechara-rows-<이름>.json(다시 채점 결과, 기존 파일을 덮지 않는다)."""
    return DATA / 'runs' / (f'timechara-rows-{name}.json' if name else 'timechara-rows.json')


def judge_llm(model: str, name: str) -> Llm:
    """게이트웨이 채점 Llm(금액 0, via ocx): 채점 캐시는 .data/timechara-cache-judge-<모델 이름>, 장부는 .data/cost-timechara-<name>.jsonl이다(KoTimeChara 채점 캐시·장부와 섞이지 않는다)."""
    if str(SIM) not in sys.path:
        sys.path.append(str(SIM))
    import sim_via   # langchain-openai를 읽으므로 필요할 때만 불러온다

    return sim_via.ocx_llm(DATA / f"timechara-cache-judge-{model.rsplit('/', 1)[-1]}", DATA / f'cost-timechara-{name}.jsonl', model)


def rejudge(name: str, configs: tuple[str, ...] = REJUDGE_CONFIGS, judge_model: str = JUDGE_MODEL, limit: int | None = None, personality: bool = True) -> None:
    """저장된 기록(.data/runs/timechara-rows.json)의 응답을 다시 만들지 않고 judge_model(게이트웨이)로 채점만 다시 해 timechara-rows-<name>.json에,
    집계를 results/timechara-<name>.json에 쓴다(원본 기록·results/timechara.json은 건드리지 않는다). 응답이 없는(실패) 기록은 호출 없이 실패로 둔다.
    같은 채점 모델·응답·프롬프트는 채점 캐시에서 읽는다. 응답 모델 표기는 원본 실행의 것(cost.MODEL, OpenAI)이다.
    limit은 파일럿(유형 비율을 지키며 고정 시드로 N문항)이고, 질문 전체가 아니면 처음 80건 부분집합을 집계하지 않는다. personality=False면 성격 채점을 건너뛴다."""
    check_name(name, RESERVED)
    questions = {i: dict(r, idx=i, id=f'tc-{i:04d}') for i, r in enumerate(json.loads((TC / 'valid.json').read_text()))}
    saved = [r for r in json.loads(rows_path().read_text()) if r['config'] in configs]
    if not saved:
        raise SystemExit(f"timechara-rows.json에 구성 {','.join(configs)}의 기록이 없다.")
    if any(questions.get(r['idx'], {}).get('data_type') != r['data_type'] for r in saved):
        raise SystemExit('timechara-rows.json의 기록이 지금 질문 파일(idx·data_type)과 맞지 않는다.')
    keep = {q['idx'] for q in pilot([questions[i] for i in sorted({r['idx'] for r in saved})], limit)}
    saved = [r for r in saved if r['idx'] in keep]
    templates = {'spatiotemporal': (TC / 'data/spatiotemporal_consistency_evaluation_prompt.txt').read_text(),
                 'personality': (TC / 'data/personality_consistency_evaluation_prompt.txt').read_text()}
    texts = {c: (TC / f"data/personality/{c.lower().replace(' ', '_')}_personality.txt").read_text()
             for c in {questions[i]['character'] for i in keep}} if personality else {}
    contexts: dict = {}   # 응답을 다시 만들지 않으니 문맥 항목은 쓰지 않고, 기록에 남길 누설 표지만 원본 기록에서 옮긴다
    for r in saved:
        contexts.setdefault(r['idx'], {})[r['config']] = {'items': [], 'future': r['future_ctx'], 'foreign': r['foreign_ctx']}
    work = make_work(contexts, templates, lambda r: system_prompt(r['series'], r['character'], r['character_period']),
                     lambda r: judge_name(r['series'], r['character'], r['character_period']), lambda r: texts.get(r['character']),
                     responses={(r['idx'], r['config']): r['response'] for r in saved})
    tasks = [(questions[r['idx']], r['config']) for r in saved]
    judge = judge_llm(judge_model, name)
    judged = {'judge_model': judge_model, 'judge_via': getattr(judge, 'via', 'openai')}
    print(f"다시 채점: 기록 {len(tasks)}건(질문 {len(keep)}개) ← timechara-rows.json · 채점 {judge_model}({judged['judge_via']}) · 장부 ${judge.cost.spent():.3f}", flush=True)
    records = [{**r, 'gen_model': MODEL, 'gen_via': 'openai', **judged} for r in run_rounds(tasks, work, judge, make_executor(judge, 'sync', DATA / 'batches'))]
    print(f"완료: 점수 없음(실패) {sum(r['score'] is None for r in records)}/{len(records)}")
    (DATA / 'runs').mkdir(exist_ok=True)
    rows_path(name).write_text(json.dumps(records, ensure_ascii=False))
    write_results(records, MODEL, len(keep) == len(questions), name)   # 처음 80건 부분집합은 600문항 전부를 다시 채점했을 때만(--limit이 전체 이상이어도 전체다)
    cost_report(judge)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    sub = parser.add_subparsers(dest='command', required=True)

    def command(name: str, help_: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, help=help_, allow_abbrev=False)   # 철자 틀린 옵션이 조용히 무시되는 일을 막는다

    def names(text: str) -> tuple[str, ...]:
        return tuple(filter(None, text.split(',')))

    command('contexts', '문맥·누설 지표(호출 없음)').add_argument('--subset', action='store_true', help='처음 평가한 유형별 20개(80건)만')
    run_ = command('run', '응답 생성·채점(OpenAI)')
    run_.add_argument('--mode', choices=('sync', 'batch'), default='sync')
    run_.add_argument('--subset', action='store_true', help='처음 평가한 유형별 20개(80건)만')
    command('paired', '저장된 기록으로 집계·짝 비교만 다시(호출 없음)')
    again = command('rejudge', '저장된 응답을 게이트웨이 채점기로 채점만 다시')
    again.add_argument('--name', required=True, help='결과 이름: timechara-rows-<name>.json·results/timechara-<name>.json')
    again.add_argument('--configs', type=names, default=REJUDGE_CONFIGS)
    again.add_argument('--judge-model', default=JUDGE_MODEL)
    again.add_argument('--limit', type=int, help='파일럿: 유형 비율을 지키며 고정 시드로 N문항만')
    again.add_argument('--no-personality', action='store_true', help='성격 채점을 건너뛴다(시공간만)')
    args = parser.parse_args(argv)
    if args.command == 'contexts':
        sample, series_data = build_inputs(not args.subset)
        context_report(sample, build_contexts(sample, series_data))
    elif args.command == 'run':
        run(args.mode, not args.subset)
    elif args.command == 'paired':   # 저장된 질문별 결과(.data/runs)로 집계·짝 비교만 다시 계산한다. 호출 없음
        write_results(json.loads(rows_path().read_text()), 'saved', True)
    else:
        rejudge(args.name, args.configs, judge_model=args.judge_model, limit=args.limit, personality=not args.no_personality)


if __name__ == '__main__':
    main()
