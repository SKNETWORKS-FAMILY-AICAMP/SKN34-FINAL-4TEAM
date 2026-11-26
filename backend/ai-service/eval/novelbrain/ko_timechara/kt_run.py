"""KoTimeChara 검증 실행: 질문마다 구성별 문맥을 만들고(호출 없음), 인물 응답을 생성해 공개 TimeChara 기준으로 채점한다(라운드·Batch).

    cd backend/ai-service
    set -a; . <저장소 루트 .env>; set +a                     # OpenAI 호출(--gen-model 없는 run)에만 필요하다. 게이트웨이 경로는 키를 읽지 않는다
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py contexts [작품 id …]        # 호출 없음
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py run [--mode=…] [--configs=a,b] [--works=w41,w42]
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py report                      # 호출 없음: 표·짝 검정

교차 모델(응답 모델을 바꾸고 채점은 게이트웨이 gpt-6.2-sol 하나로 고정, 결과는 rows-<name>.json·cost-<name>.jsonl·results/ko-timechara-<name>.json에 따로 쓴다):
    … kt_run.py run --gen-model=openrouter/google/gemini-3.8-flash --gen-effort=low --name=gemini-flash --limit-usd=10 [--limit=200] [--configs=zero,s3] [--no-personality]
    … kt_run.py rejudge --from=rows.json --name=luna-sol [--configs=zero,s3] [--judge-model=gpt-6.2-sol] [--limit=200] [--no-personality]   # 저장된 응답을 채점만 다시
    … kt_run.py report --name=gemini-flash                                                                                        # 호출 없음

채점은 공개 evaluate.py와 같다: 공간(absence·presence)이 0이면 시간은 묻지 않고, 시공간은 0/1, 성격은 1~7. 채점 모델은 기본으로 생성 모델과 같고
`--gen-model`·`--judge-model`을 주면 따로다(응답·채점 모델과 호출 경로는 기록과 집계의 gen_model·judge_model·gen_via·judge_via에 남는다).
질문·응답·문맥 원본은 `KT`(.data, git 무시)에만 두고 results/에는 집계 수치만 쓴다.
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json

from batch import cost_report, plan_for, run_rounds
from cost import MODEL
from embed import cached_embeddings, embed_texts
from kt_common import COST, KT, LIMIT_USD, RESULTS, ROUNDS
from kt_context import CONFIGS, K_CTX, chunk_episode, contexts_for
from kt_exec import EFFORTS, JUDGE_MODEL, load_works, make_executor, make_gen_llm, make_judge_llm, make_llm
from kt_world import load_world
from prepare import DATA
from run_timechara import check_name as _check_name
from run_timechara import make_work as base_make_work
from run_timechara import models_of, paired, pilot, summarize   # 파일럿·이름 검사·모델 표기는 TimeChara 다시 채점과 같은 것을 쓴다

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


def make_work(contexts: dict, templates: dict, personalities: dict, responses: dict | None = None):
    """run_timechara.make_work에 한국어 시스템 프롬프트·채점 이름·성격 서술(작품·인물별)을 끼운 work. responses를 주면 저장된 응답을 채점만 한다(rejudge)."""
    return base_make_work(contexts, templates, lambda r: ko_system_prompt(r['character'], r['cutoff']),
                          lambda r: judge_name(r['character'], r['cutoff']), lambda r: personalities.get(r['work'], {}).get(r['character']),
                          extra=lambda r, ctx: {'id': r['id'], 'work': r['work'], 'kind': r['kind'], 'genre': r['genre'], 'unseen_ctx': ctx['unseen']},
                          responses=responses)


def leak_rates(records: list[dict], key: str = 'config', names: tuple[str, ...] = ('future_ctx', 'unseen_ctx', 'foreign_ctx')) -> dict:
    """구성별 누설 보조 지표: 문맥에 기준 회차 뒤 항목이 있는 비율(필터와 같은 조건)·정답표 기준으로 인물이 모를 사건의 발췌가 있는 비율·다른 인물 기억.
    names는 셀 기록 필드(kt_pairs가 같은 회차 사건 노출 asked_ep_ctx를 더해 쓴다)."""
    out = {}
    for config in dict.fromkeys(r[key] for r in records):
        mine = [r for r in records if r[key] == config]
        out[config] = {name: sum(bool(r[name]) for r in mine) / len(mine) for name in names}
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


def build_data(wids: list[str], world: str = 'world') -> dict:
    """작품마다 원고 조각·벡터·세계관·정답표. world는 KT/works/<작품 id>/ 안의 세계관 파일 이름이다(기본 world = 기존 평가용 세계관, world2 = 시제품 등)."""
    out = {}
    works = load_works(wids)
    for wid, work in works.items():
        folder = KT / 'works' / wid
        chunks = [{'id': f"{wid}:{e['number']}:{i}", 'episode': e['number'], 'text': text}
                  for e in work['episodes'] for i, text in enumerate(chunk_episode(e['text']))]
        knowledge = [json.loads(line) for line in (folder / 'knowledge.jsonl').read_text().splitlines()]
        out[wid] = {'chunks': chunks, 'vectors': cached_embeddings(folder / 'vectors.npy', [c['text'] for c in chunks], 'passage'),
                    'world': load_world(folder / f'{world}.json'), 'knowledge': knowledge}
    return out


# 질문 임베딩 묶음. E5(int8 동적 양자화)는 같은 묶음의 다른 질문에 따라 벡터가 조금 달라져(성분 차이 최대 약 0.01) 이웃 순위가 바뀐다.
# 처음 17편(1,088문항)은 예전과 같은 한 묶음으로 임베딩해 이미 낸 응답·채점 캐시를 살리고, 작품을 늘린 차수마다 따로 묶는다.
def embed_group(work: str) -> int:
    return sum(work[0] == 'w' and int(work[1:]) > count for count in ROUNDS[:-1])


def build_contexts(rows: list[dict], data: dict, only: set[int] | None = None) -> dict:
    """rows는 질문 전체. 질문 임베딩은 data에 없는 작품의 질문까지 포함한 묶음으로 만들어(작품을 골라 실행해도 벡터가 전체 실행과 같다)
    문맥은 data에 있는 작품 것만 만든다. only(질문 idx 집합, 파일럿)를 주면 그 질문의 문맥만 만든다."""
    groups: dict[int, list[int]] = {}
    for n, r in enumerate(rows):
        groups.setdefault(embed_group(r['work']), []).append(n)
    queries = {}
    for numbers in groups.values():
        queries.update(zip(numbers, embed_texts([rows[n]['question'] for n in numbers], 'query')))
    return {r['idx']: contexts_for(r, data[r['work']], data[r['work']]['knowledge'], queries[n]) for n, r in enumerate(rows)
            if r['work'] in data and (only is None or r['idx'] in only)}


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


RESERVED = ('data', 'context', 'sample')   # results/ko-timechara-data.json·ko-timechara-context.json, runs/rows-sample.json과 겹치는 이름


def check_name(name: str) -> str:
    """결과 이름(--name): 파일 이름에 붙으므로 영문·숫자·-_.만 받고, 이미 있는 다른 결과 파일과 겹치는 이름은 막는다."""
    return _check_name(name, RESERVED)


def rows_path(name: str | None):
    """질문×구성별 결과 기록: 이름이 없으면 기존 rows.json, 있으면 rows-<이름>.json(기존 파일을 덮지 않는다)."""
    return KT / 'runs' / (f'rows-{name}.json' if name else 'rows.json')


def result_path(name: str | None):
    return RESULTS / (f'ko-timechara-{name}.json' if name else 'ko-timechara.json')


def load_templates() -> dict:
    return {'spatiotemporal': (TC / 'spatiotemporal_consistency_evaluation_prompt.txt').read_text(),
            'personality': (TC / 'personality_consistency_evaluation_prompt.txt').read_text()}


def run(mode: str, configs: tuple[str, ...], works: tuple[str, ...] = (), *, gen_model: str | None = None, gen_effort: str | None = None,
        judge_model: str | None = None, name: str | None = None, limit_usd: float | None = None, limit: int | None = None, personality: bool = True) -> None:
    """works를 주면 그 작품의 응답·채점만 캐시에 채운다(작품을 늘린 차수를 다른 실행과 겹치지 않게 따로 돌릴 때). 전체 집계 파일은 작품을 거르지 않은 실행이 쓴다.
    질문 임베딩 묶음은 전체 질문으로 정해 같은 질문의 문맥·요청이 전체 실행과 같다(캐시를 그대로 쓴다).

    교차 모델: gen_model(게이트웨이 모델 id)을 주면 응답을 로컬 OpenCodex 게이트웨이로 내고(limit_usd 필수, 단가표 밖의 모델은 호출 전에 멈춘다)
    채점은 judge_model(기본 gpt-6.2-sol, 게이트웨이)이 한다. judge_model만 주면 응답은 지금처럼 OpenAI다. 둘 다 없으면 지금처럼 응답 모델이 채점한다.
    gen_effort(minimal|low|medium|high)는 gen_model의 응답 호출에만 reasoning.effort로 보낸다(캐시 열쇠·기록의 gen_model에 `@<강도>`, 상세는 kt_exec.make_gen_llm).
    모델 지정·limit(파일럿: 유형 비율대로 N문항)·personality=False(성격 채점 생략)는 결과가 달라지므로 name이 필수이고, 결과는 rows-<name>.json·
    cost-<name>.jsonl에 따로 쓴다(기존 rows.json·cost.jsonl은 건드리지 않는다). 응답·채점 모델을 나눈 게이트웨이 경로는 동기 실행만 된다.
    """
    if not configs:
        raise SystemExit('--configs가 비었다: 구성을 하나 이상 준다(빈 실행이 기존 결과를 덮지 않게).')
    if any(model is not None and not model.strip() for model in (gen_model, judge_model)):
        raise SystemExit('--gen-model·--judge-model이 비었다: 모델 id를 주거나 옵션을 뺀다(빈 값이 기본 유료 OpenAI 경로를 고르지 않게).')
    if name is None and (gen_model or judge_model or limit is not None or not personality):
        raise SystemExit('--gen-model·--judge-model·--limit·--no-personality는 --name이 필요하다(기존 rows.json·cost.jsonl을 덮거나 섞지 않게).')
    if gen_effort and not gen_model:
        raise SystemExit('--gen-effort는 --gen-model(게이트웨이 응답 모델)과 함께 쓴다: 강도는 응답 호출에만 붙는다.')
    if name is not None:
        check_name(name)
    cost_path = COST if name is None else KT / f'cost-{name}.jsonl'
    llm = make_gen_llm(gen_model, name, limit_usd, gen_effort) if gen_model else make_llm(cost_path=cost_path, limit_usd=LIMIT_USD if limit_usd is None else limit_usd)
    judge_id = judge_model or (JUDGE_MODEL if gen_model else None)
    if judge_id:
        llm.judge = make_judge_llm(judge_id, cost_path)
    executor = make_executor(llm, mode)   # 응답·채점 모델을 나눈 실행은 동기만: 질문·문맥을 읽기 전에 막는다
    every = load_rows()
    rows = pilot([r for r in every if not works or r['work'] in works], limit)
    data = build_data(sorted({r['work'] for r in rows}))
    contexts = build_contexts(every, data, only={r['idx'] for r in rows})
    context_summary(rows, contexts)
    personalities = json.loads((KT / 'personalities.json').read_text()) if personality else {}   # 성격 서술이 없으면 성격 채점을 건너뛴다
    tasks = [(r, c) for r in rows for c in configs]
    stamp = {'gen_model': llm.model, 'gen_via': getattr(llm, 'via', 'openai'), 'judge_model': judge_id or llm.model,
             'judge_via': getattr(llm.for_kind('judge'), 'via', 'openai')}
    print(f"질문 {len(rows)}개 × 구성 {len(configs)} = {len(tasks)} 과제 · 방식 {mode} · 응답 {stamp['gen_model']}({stamp['gen_via']}) "
          f"채점 {stamp['judge_model']}({stamp['judge_via']}) · 장부 ${llm.cost.spent():.3f}", flush=True)
    plan = None if llm.judge else plan_for(llm, mode)   # ponytail: 나눈 실행은 luna 단가표로 사전 어림하지 않고 호출마다 장부 상한만 막는다(진행 중 12호출 정도가 넘칠 수 있다). 사전 점검은 estimate에 모델 단가를 넘기면 된다
    records = [{**r, **stamp} for r in run_rounds(tasks, make_work(contexts, load_templates(), personalities), llm, executor, plan=plan)]
    print(f"완료: 점수 없음(실패) {sum(r['score'] is None for r in records)}/{len(records)}")
    if name or not works:   # 이름이 없으면 작품을 거르지 않은 전체 실행만 rows.json을 쓴다
        (KT / 'runs').mkdir(exist_ok=True)
        rows_path(name).write_text(json.dumps(records, ensure_ascii=False))
    cost_report(llm)


def rejudge(source: str, name: str, configs: tuple[str, ...], judge_model: str = JUDGE_MODEL, personality: bool = True, limit: int | None = None) -> None:
    """저장된 기록(KT/runs/<source>)의 응답을 다시 만들지 않고 judge_model(게이트웨이)로 채점만 다시 해 rows-<name>.json에 쓴다(원본 기록은 건드리지 않는다).
    응답이 없는(실패) 기록은 호출 없이 실패로 둔다. 같은 채점 모델·응답·프롬프트는 채점 캐시(cache-judge-<모델>)에서 읽는다.
    응답 모델 표기는 원본 기록의 것을 옮기고, 모델 기록이 없는 옛 기록은 옛 실행의 응답 모델(cost.MODEL, OpenAI)이다."""
    out = rows_path(check_name(name))
    if out.resolve() == (KT / 'runs' / source).resolve():
        raise SystemExit('--name이 --from과 같은 파일이라 원본 기록을 덮는다: 다른 이름을 준다.')
    saved = [r for r in json.loads((KT / 'runs' / source).read_text()) if r['config'] in configs]
    if not saved:
        raise SystemExit(f"{source}에 구성 {','.join(configs)}의 기록이 없다.")
    questions = {r['idx']: r for r in load_rows()}
    if any(questions.get(r['idx'], {}).get('id') != r['id'] for r in saved):
        raise SystemExit(f'{source}의 기록이 지금 질문 파일(idx·id)과 맞지 않는다.')
    keep = {r['idx'] for r in pilot([questions[i] for i in sorted({r['idx'] for r in saved})], limit)}
    saved = [r for r in saved if r['idx'] in keep]
    judge = make_judge_llm(judge_model, KT / f'cost-{name}.jsonl')
    contexts: dict = {}   # 응답을 다시 만들지 않으니 문맥 항목은 쓰지 않고, 기록에 남길 누설 표지만 원본 기록에서 옮긴다
    for r in saved:
        contexts.setdefault(r['idx'], {})[r['config']] = {'items': [], 'future': r['future_ctx'], 'foreign': r['foreign_ctx'], 'unseen': r['unseen_ctx']}
    personalities = json.loads((KT / 'personalities.json').read_text()) if personality else {}
    work = make_work(contexts, load_templates(), personalities, responses={(r['idx'], r['config']): r['response'] for r in saved})
    tasks = [(questions[r['idx']], r['config']) for r in saved]
    judged = {'judge_model': judge_model, 'judge_via': getattr(judge, 'via', 'openai')}
    print(f"다시 채점: 기록 {len(tasks)}건(질문 {len(keep)}개) ← {source} · 채점 {judge_model}({judged['judge_via']}) · 장부 ${judge.cost.spent():.3f}", flush=True)
    gen = {(r['idx'], r['config']): {k: r[k] for k in ('gen_model', 'gen_via') if k in r} for r in saved}
    records = [{**r, 'gen_model': MODEL, 'gen_via': 'openai', **gen[r['idx'], r['config']], **judged}
               for r in run_rounds(tasks, work, judge, make_executor(judge, 'sync'))]
    print(f"완료: 점수 없음(실패) {sum(r['score'] is None for r in records)}/{len(records)}")
    (KT / 'runs').mkdir(exist_ok=True)
    out.write_text(json.dumps(records, ensure_ascii=False))
    cost_report(judge)


def report(name: str | None = None) -> None:
    """rows(-<name>).json을 집계해 results/ko-timechara(-<name>).json에 쓴다(호출 없음). 기록에 없는 구성이 낀 짝은 건너뛴다."""
    if name:
        check_name(name)
    records = json.loads(rows_path(name).read_text())
    rows = {r['idx']: r for r in load_rows()}
    configs = {r['config'] for r in records}
    pairs = tuple(p for p in PAIRS if set(p) <= configs)
    result = {'questions': len({r['idx'] for r in records}), 'configs': summarize(records), 'leak': leak_rates(records),
              'paired': {f'{a}|{b}': paired(records, a, b) for a, b in pairs},
              'by_kind': group_report(records, 'kind', pairs), 'by_genre': group_report(records, 'genre', pairs),
              'by_type_paired': {kind: {f'{a}|{b}': paired([r for r in records if r['data_type'] == kind], a, b) for a, b in pairs}
                                 for kind in TYPES}, 'n_rows_loaded': len(rows)}
    if models := models_of(records):   # 모델 기록이 없는 옛 기록만이면 집계 모양을 그대로 둔다
        result['models'] = models
    RESULTS.mkdir(exist_ok=True)
    result_path(name).write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    for config, block in result['configs'].items():
        weighted, pers = block['weighted'], block['personality']
        print(f"{config:9s} 시공간(가중) {'-' if weighted is None else format(weighted, '.3f')} 성격 {'-' if pers is None else round(pers, 2)} "
              f"실패 {block['failed']}/{block['n']} " + ' '.join(f"{k[:6]}={v['score']:.2f}" for k, v in block['by_type'].items()))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    sub = parser.add_subparsers(dest='command', required=True)

    def command(name: str, help_: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, help=help_, allow_abbrev=False)   # 철자 틀린 옵션이 조용히 무시돼 기본 유료 모델로 도는 일을 막는다

    def names(text: str) -> tuple[str, ...]:
        return tuple(filter(None, text.split(',')))

    command('contexts', '문맥 노출 비율(호출 없음)').add_argument('works', nargs='*', help='작품 id(없으면 전체)')
    run_ = command('run', '응답 생성·채점')
    run_.add_argument('--mode', choices=('sync', 'batch'), default='sync')
    run_.add_argument('--configs', type=names, default=names(','.join(CONFIGS)))
    run_.add_argument('--works', type=names, default=())
    run_.add_argument('--gen-model', help='응답을 낼 게이트웨이 모델 id(단가표 GEN_RATES에 있는 모델, --limit-usd 필수)')
    run_.add_argument('--gen-effort', choices=EFFORTS, help='응답 호출의 reasoning.effort(--gen-model과 함께, 채점 호출은 그대로). 응답 캐시 열쇠와 기록의 gen_model에 들어간다')
    run_.add_argument('--judge-model', help=f'채점 게이트웨이 모델 id(--gen-model이 있으면 기본 {JUDGE_MODEL})')
    run_.add_argument('--name', help='결과 이름: rows-<name>.json·cost-<name>.jsonl(--gen-model·--judge-model·--limit·--no-personality에 필수)')
    run_.add_argument('--limit-usd', type=float, help='응답 장부의 금액 상한(달러)')
    run_.add_argument('--limit', type=int, help='파일럿: 유형 비율을 지키며 고정 시드로 N문항만')
    run_.add_argument('--no-personality', action='store_true', help='성격 채점을 건너뛴다(시공간만)')
    again = command('rejudge', '저장된 응답을 채점만 다시')
    again.add_argument('--from', dest='source', default='rows.json', help='KT/runs 안의 원본 기록 파일(기본 rows.json)')
    again.add_argument('--name', required=True, help='결과 이름: rows-<name>.json')
    again.add_argument('--configs', type=names, default=names(','.join(CONFIGS)))
    again.add_argument('--judge-model', default=JUDGE_MODEL)
    again.add_argument('--limit', type=int, help='파일럿: 유형 비율을 지키며 고정 시드로 N문항만')
    again.add_argument('--no-personality', action='store_true', help='성격 채점을 건너뛴다(시공간만)')
    command('report', '집계(호출 없음)').add_argument('--name', help='rows-<name>.json을 집계해 results/ko-timechara-<name>.json에 쓴다')
    args = parser.parse_args(argv)
    if args.command == 'contexts':   # 호출 없음: 문맥 노출 비율을 results/ko-timechara-context.json에도 쓴다(작품을 고르지 않았을 때)
        every = load_rows()
        rows = [r for r in every if not args.works or r['work'] in args.works]
        contexts = build_contexts(every, build_data(sorted({r['work'] for r in rows})))
        context_summary(rows, contexts)
        if not args.works:
            RESULTS.mkdir(exist_ok=True)
            (RESULTS / 'ko-timechara-context.json').write_text(json.dumps({'configs': context_rates(rows, contexts), 'k_context': K_CTX},
                                                                          ensure_ascii=False, indent=2, sort_keys=True))
    elif args.command == 'run':
        run(args.mode, args.configs, args.works, gen_model=args.gen_model, gen_effort=args.gen_effort, judge_model=args.judge_model, name=args.name,
            limit_usd=args.limit_usd, limit=args.limit, personality=not args.no_personality)
    elif args.command == 'rejudge':
        rejudge(args.source, args.name, args.configs, judge_model=args.judge_model, personality=not args.no_personality, limit=args.limit)
    else:
        report(args.name)


if __name__ == '__main__':
    main()
