"""KoTimeChara 검증 실행: 질문마다 구성별 문맥을 만들고(호출 없음), 인물 응답을 생성해 공개 TimeChara 기준으로 채점한다(라운드·Batch).

    cd backend/ai-service
    set -a; . <저장소 루트 .env>; set +a
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py contexts [작품 id …]        # 호출 없음
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py run [--mode=…] [--configs=a,b]
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py report                      # 호출 없음: 표·짝 검정

채점은 공개 evaluate.py와 같다: 공간(absence·presence)이 0이면 시간은 묻지 않고, 시공간은 0/1, 성격은 1~7. 채점 모델은 생성 모델과 같다.
질문·응답·문맥 원본은 `KT`(.data, git 무시)에만 두고 results/에는 집계 수치만 쓴다.
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import json
import sys

from batch import cost_report, plan_for, run_rounds
from embed import cached_embeddings, embed_texts
from kt_common import KT, RESULTS, ROUNDS
from kt_context import CONFIGS, K_CTX, chunk_episode, contexts_for
from kt_exec import load_works, make_executor, make_llm
from kt_world import load_world
from prepare import DATA
from run_timechara import make_work as base_make_work
from run_timechara import paired, summarize

TC = DATA / 'timechara' / 'data'
PAIRS = (('s3', 's2'), ('s3', 'zero'), ('s3', 'ppr'), ('s2', 's1'), ('s1', 'ppr'), ('ppr', 'zero'), ('s2', 'vector'), ('s2', 'bm25'),
         ('s3', 'vector'), ('s3', 'bm25'), ('s3', 'no_graph'), ('s3', 'no_vector'), ('s3', 'no_bm25'))
TYPES = ('future', 'past-only', 'past-absence', 'past-presence')


def ko_system_prompt(character: str, cutoff: int) -> str:
    """공개 generate.py 역할 시스템 프롬프트(preprocess_generation)의 한국어판. 작품 이름은 넣지 않는다(고전의 사전 지식이 구성 사이 차이를 흐리지 않게)."""
    return (f'당신은 한국 소설 속 인물 {character}이다. {character}의 말투와 어휘로 대답하라. 지금은 소설의 {cutoff}화가 끝난 시점이며 '
            f'인터뷰어와 대화하고 있다고 가정하라. 이 시점보다 뒤에 일어나는 사실은 질문받아도 말하거나 언급해서는 안 된다. '
            f'{character}이(가) 질문이 나온 장소에 없었다면 그 질문과 관련된 정보나 지식을 모를 가능성이 높다. 한국어로 답하라.')


def judge_name(character: str, cutoff: int) -> str:
    return f'{character} at the end of episode {cutoff}'


def make_work(contexts: dict, templates: dict, personalities: dict):
    """run_timechara.make_work에 한국어 시스템 프롬프트·채점 이름·성격 서술(작품·인물별)을 끼운 work."""
    return base_make_work(contexts, templates, lambda r: ko_system_prompt(r['character'], r['cutoff']),
                          lambda r: judge_name(r['character'], r['cutoff']), lambda r: personalities.get(r['work'], {}).get(r['character']),
                          extra=lambda r, ctx: {'id': r['id'], 'work': r['work'], 'kind': r['kind'], 'genre': r['genre'], 'unseen_ctx': ctx['unseen']})


def leak_rates(records: list[dict], key: str = 'config') -> dict:
    """구성별 누설 보조 지표: 문맥에 기준 회차 뒤 항목이 있는 비율(필터와 같은 조건)·정답표 기준으로 인물이 모를 사건의 발췌가 있는 비율·다른 인물 기억."""
    out = {}
    for config in dict.fromkeys(r[key] for r in records):
        mine = [r for r in records if r[key] == config]
        out[config] = {name: sum(bool(r[name]) for r in mine) / len(mine) for name in ('future_ctx', 'unseen_ctx', 'foreign_ctx')}
    return out


def group_report(records: list[dict], group: str, pairs=PAIRS) -> dict:
    """집단(작품 종류·장르 등)마다: 구성별 요약(summarize)·짝 정확 부호 검정·누설 보조 지표."""
    out = {}
    for value in sorted({r[group] for r in records}):
        mine = [r for r in records if r[group] == value]
        configs = {r['config'] for r in mine}
        out[value] = {'questions': len({r['idx'] for r in mine}), 'configs': summarize(mine), 'leak': leak_rates(mine),
                      'paired': {f'{a}|{b}': paired(mine, a, b) for a, b in pairs if a in configs and b in configs}}
    return out


# ---- 입력 구성·실행(실제 데이터가 필요해 단위 테스트하지 않는다) ----

def load_rows() -> list[dict]:
    return [json.loads(line) for line in (KT / 'questions.jsonl').read_text().splitlines()]


def build_data(wids: list[str]) -> dict:
    out = {}
    works = load_works(wids)
    for wid, work in works.items():
        folder = KT / 'works' / wid
        chunks = [{'id': f"{wid}:{e['number']}:{i}", 'episode': e['number'], 'text': text}
                  for e in work['episodes'] for i, text in enumerate(chunk_episode(e['text']))]
        knowledge = [json.loads(line) for line in (folder / 'knowledge.jsonl').read_text().splitlines()]
        out[wid] = {'chunks': chunks, 'vectors': cached_embeddings(folder / 'vectors.npy', [c['text'] for c in chunks], 'passage'),
                    'world': load_world(folder / 'world.json'), 'knowledge': knowledge}
    return out


# 질문 임베딩 묶음. E5(int8 동적 양자화)는 같은 묶음의 다른 질문에 따라 벡터가 조금 달라져(성분 차이 최대 약 0.01) 이웃 순위가 바뀐다.
# 처음 17편(1,088문항)은 예전과 같은 한 묶음으로 임베딩해 이미 낸 응답·채점 캐시를 살리고, 작품을 늘린 차수마다 따로 묶는다.
def embed_group(work: str) -> int:
    return sum(work[0] == 'w' and int(work[1:]) > count for count in ROUNDS[:-1])


def build_contexts(rows: list[dict], data: dict) -> dict:
    groups: dict[int, list[int]] = {}
    for n, r in enumerate(rows):
        groups.setdefault(embed_group(r['work']), []).append(n)
    queries = {}
    for numbers in groups.values():
        queries.update(zip(numbers, embed_texts([rows[n]['question'] for n in numbers], 'query')))
    return {r['idx']: contexts_for(r, data[r['work']], data[r['work']]['knowledge'], queries[n]) for n, r in enumerate(rows)}


def context_rates(rows: list[dict], contexts: dict) -> dict:
    """구성별 문맥 노출(호출 없음): 기준 회차 뒤 항목·정답표 기준 모를 사건 발췌·다른 인물 기억이 든 질문의 비율과 평균 항목 수. 전체와 유형별."""
    def block(part):
        mine = [contexts[r['idx']][config] for r in part]
        return {'questions': len(part), 'future': sum(c['future'] for c in mine) / len(mine), 'unseen': sum(c['unseen'] for c in mine) / len(mine),
                'foreign': sum(c['foreign'] for c in mine) / len(mine), 'items': sum(len(c['items']) for c in mine) / len(mine)}
    out = {}
    for config in CONFIGS:
        out[config] = {'all': block(rows), 'by_type': {t: block([r for r in rows if r['data_type'] == t]) for t in TYPES if any(r['data_type'] == t for r in rows)}}
    return out


def context_summary(rows: list[dict], contexts: dict) -> None:
    for config, rate in context_rates(rows, contexts).items():
        b = rate['all']
        print(f"{config:9s} 기준 회차 뒤 항목 {b['future']:.2f} · 정답표 기준 모를 사건 발췌 {b['unseen']:.2f} · 다른 인물 기억 {b['foreign']:.2f} · 평균 항목 {b['items']:.1f}")


def run(mode: str, configs: tuple[str, ...]) -> None:
    rows = load_rows()
    data = build_data(sorted({r['work'] for r in rows}))
    contexts = build_contexts(rows, data)
    context_summary(rows, contexts)
    llm = make_llm()
    templates = {'spatiotemporal': (TC / 'spatiotemporal_consistency_evaluation_prompt.txt').read_text(),
                 'personality': (TC / 'personality_consistency_evaluation_prompt.txt').read_text()}
    personalities = json.loads((KT / 'personalities.json').read_text())
    tasks = [(r, c) for r in rows for c in configs]
    print(f'질문 {len(rows)}개 × 구성 {len(configs)} = {len(tasks)} 과제 · 방식 {mode} · 장부 ${llm.cost.spent():.3f}', flush=True)
    records = run_rounds(tasks, make_work(contexts, templates, personalities), llm, make_executor(llm, mode), plan=plan_for(llm, mode))
    (KT / 'runs').mkdir(exist_ok=True)
    (KT / 'runs' / 'rows.json').write_text(json.dumps(records, ensure_ascii=False))
    print(f"완료: 점수 없음(실패) {sum(r['score'] is None for r in records)}/{len(records)}")
    cost_report(llm)


def report() -> None:
    records = json.loads((KT / 'runs' / 'rows.json').read_text())
    rows = {r['idx']: r for r in load_rows()}
    result = {'questions': len({r['idx'] for r in records}), 'configs': summarize(records), 'leak': leak_rates(records),
              'paired': {f'{a}|{b}': paired(records, a, b) for a, b in PAIRS},
              'by_kind': group_report(records, 'kind'), 'by_genre': group_report(records, 'genre'),
              'by_type_paired': {kind: {f'{a}|{b}': paired([r for r in records if r['data_type'] == kind], a, b) for a, b in PAIRS}
                                 for kind in TYPES}, 'n_rows_loaded': len(rows)}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / 'ko-timechara.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    for config, block in result['configs'].items():
        pers = block['personality']
        print(f"{config:9s} 시공간(가중) {block['weighted']:.3f} 성격 {'-' if pers is None else round(pers, 2)} 실패 {block['failed']}/{block['n']} "
              + ' '.join(f"{k[:6]}={v['score']:.2f}" for k, v in block['by_type'].items()))


if __name__ == '__main__':
    command, options = (sys.argv[1] if len(sys.argv) > 1 else ''), [a for a in sys.argv[2:] if a.startswith('--')]
    rest = [a for a in sys.argv[2:] if not a.startswith('--')]
    opt = lambda name, default=None: next((o.split('=', 1)[1] for o in options if o.startswith(f'--{name}=')), default)  # noqa: E731
    if command == 'contexts':   # 호출 없음: 문맥 노출 비율을 results/ko-timechara-context.json에도 쓴다(작품을 고르지 않았을 때)
        rows = [r for r in load_rows() if not rest or r['work'] in rest]
        contexts = build_contexts(rows, build_data(sorted({r['work'] for r in rows})))
        context_summary(rows, contexts)
        if not rest:
            RESULTS.mkdir(exist_ok=True)
            (RESULTS / 'ko-timechara-context.json').write_text(json.dumps({'configs': context_rates(rows, contexts), 'k_context': K_CTX},
                                                                          ensure_ascii=False, indent=2, sort_keys=True))
    elif command == 'run':
        run(opt('mode', 'sync'), tuple(opt('configs', ','.join(CONFIGS)).split(',')))
    elif command == 'report':
        report()
    else:
        raise SystemExit('사용법: kt_run.py contexts [작품 id …] | run [--mode=…] [--configs=a,b] | report')
