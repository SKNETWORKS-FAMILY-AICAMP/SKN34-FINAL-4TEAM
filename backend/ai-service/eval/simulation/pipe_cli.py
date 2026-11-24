"""원문 → 세계관(전처리 ①) → 인물 시뮬레이션(②) 통합 평가 실행기. 설계·점수 정의·결과는 docs/evaluation/pipeline-eval.md.

    cd backend/ai-service     # 공개 세트 원문·문항(.data/orig)이 있어야 한다: 없으면 .data/orig를 평가 데이터 폴더로 심볼릭 링크한다
    uv run --locked --extra dev python eval/simulation/pipe_cli.py estimate --works m01 --limit 2    # ①·② 호출 수와 금액 어림(호출 0)
    set -a; . <키 파일>; set +a                                                                         # 이하 유료 명령: 같은 명령 안에서 불러온다(키 값은 출력하지 않는다)
    uv run --locked --extra dev python eval/simulation/pipe_cli.py build --works m01 --limit-usd 2      # ① 세계관(캐시에 없는 회차만 부른다)
    uv run --locked --extra dev python eval/simulation/pipe_cli.py run --works m01 --limit 2 --limit-usd 2    # ② 파이프라인 세계관과 손라벨 세계관(기준선)으로 같은 문항
    uv run --locked --extra dev python eval/simulation/pipe_cli.py report --works m01                   # results/pipeline-eval-<태그>.json(집계만) + 표

로컬 게이트웨이(--via ocx, 금액 0)로 작은 표본을 먼저 돌려 볼 수 있다: OPENAI_API_KEY=ocx OPENAI_MODEL=gpt-6-luna SIMULATION_ACT_MODEL=gpt-6-luna(act를 luna로 되돌린다, orig_cli와 같다).
시작 때 Langfuse 키를 지워 원문이 Langfuse로 가지 않게 한다. OpenAI 호출은 별도 장부 .data/pipeline/cost-pipeline.jsonl(--limit-usd)로 센다.
"""

import argparse
import json
import os
from collections import Counter
from pathlib import Path

from orig_common import DATA, JUDGE, RESULTS  # noqa: I001  경로 설정(eval/novelbrain)이 아래 import보다 먼저여야 한다
from cost import CostLog
from llm import CallCapExceeded, usd_llm

import orig_cli as oc
import orig_judge
import orig_run as rn
import pipe_build as pb
import pipe_score as ps
import pipe_world as pw
import sim_via
from pipe_world import find_character

PIPE = Path(os.environ.get('PIPELINE_EVAL_DATA') or DATA / 'pipeline')   # 세계관 캐시·실행 기록·장부(git 무시). 다른 곳에 두려면 PIPELINE_EVAL_DATA
CACHE, RUNS = PIPE / 'worlds', PIPE / 'runs'
COST_PIPE, COST_OCX = PIPE / 'cost-pipeline.jsonl', PIPE / 'cost-ocx.jsonl'   # OpenAI 장부(상한), ocx 장부(금액 0, 토큰만)
SETS = ('1', '3n', '3m')
EVALUATE = {'1': rn.evaluate_dialogue, '3n': rn.evaluate_narration, '3m': rn.evaluate_narration}
SUMMARIZE = {'1': rn.summarize_dialogue, '3n': rn.summarize_narration, '3m': rn.summarize_narration}
STATUS = {'world_failed': '작품 ① 실패', 'no_character': '화자 카드 없음', 'late_card': '카드가 기준 회차보다 늦게 생김', 'docs_missing': 'SOUL 없음(운영이 시작 거절)'}


# ---- 순수 부분 ----

def select_items(items: list[dict], works: set[str], limit: int | None) -> list[dict]:
    """고른 작품의 문항만, limit이 있으면 같은 간격으로 limit개, 기준 회차 순서로(세계관을 다시 만드는 일을 줄인다)."""
    items = [i for i in items if i['work'] in works]
    return sorted(oc.sample_of(items, limit) if limit else items, key=lambda i: (i['base'], i['id']))


def skipped_record(item: dict, reason: str) -> dict:
    """모델을 부르지 않고 건너뛴 문항의 기록(orig_run과 같은 모양이라 집계·짝 비교가 그대로 읽는다)."""
    return {**rn.blank(item, None), 'skipped': reason, 'grade': None, 'usage': []}


def evaluator(corpus, evaluate, pipeline: bool):
    """문항 하나를 돌리는 함수. 파이프라인 세계관은 못 돌리는 문항(corpus.status가 ok가 아님)을 이유와 함께 건너뛰고 세어 보고한다(숨기지 않는다)."""
    def run(item: dict) -> dict:
        if pipeline and (why := corpus.status(item)) != 'ok':
            return skipped_record(item, why)
        return evaluate(item)
    return run


def skipped_by(records: list[dict]) -> dict:
    return dict(Counter(r['skipped'] for r in records if r.get('skipped')))


def assemble(key: str, pipeline: list[dict], hand: list[dict]) -> dict:
    """세트 하나의 세계관별 집계(orig_run의 기존 루브릭 집계)와, 손라벨 기록이 있으면 같은 문항의 짝 비교(후보 = 파이프라인, 기준선 = 손라벨)."""
    side = lambda records: {'summary': SUMMARIZE[key](records), 'skippedBy': skipped_by(records)}  # noqa: E731
    return {'pipeline': side(pipeline), **({'hand': side(hand), 'vsHand': rn.compare_runs(key, hand, pipeline)} if hand else {})}


def claim_run(folder: Path, meta: dict) -> None:
    """한 기록 폴더 = 한 설정. 처음이면 설정을 적고, 다른 설정으로 이어 받으려 하면 호출 전에 멈춘다(공개 회차·모델·채점이 섞인 기록을 막는다)."""
    path = folder / 'meta.json'
    if not path.exists():
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(meta, ensure_ascii=False, sort_keys=True))
        return
    saved = json.loads(path.read_text())
    if diff := sorted(k for k in {*saved, *meta} if saved.get(k) != meta.get(k)):
        raise SystemExit(f"{folder.name}의 기존 기록은 설정이 다르다({', '.join(diff)}). --tag로 다른 이름을 쓴다.")


def people_of(cards: list, names: set[str]) -> list:
    """평가 인물 이름에 이어지는 인물 카드(카드마다 한 번)."""
    return list({c.key: c for n in sorted(names) if (c := find_character(cards, n))}.values())


def world_report(work: dict, built, names: set[str]) -> dict:
    """한 작품의 세계관 단·페르소나 단 보고(개수·비율, 원문·카드 본문 없음). names = 이 작품의 평가 문항에 나오는 인물 이름."""
    cards = built.payload.cards
    sources = {e['number']: e['text'] for e in work['episodes']}
    return {'episodes': len(work['episodes']), 'cards': len(cards), 'characters': sum(c.cardType == 'character' for c in cards), 'relations': len(built.payload.relations),
            'failures': [[n, code] for n, code in built.failures], 'extraction': ps.extraction_stats(built.extractions.values()),
            'coverage': ps.coverage(names, cards), 'persona': ps.persona_stats([(c, sources) for c in people_of(cards, names)])}


def world_section(entries: list[tuple[dict, object, set[str]]]) -> dict:
    """entries = [(작품, Built, 평가 인물 이름)] → 작품별 보고와, 작품을 합쳐 다시 센 합계(비율은 합친 개수로 다시 계산한다)."""
    per = {work['id']: world_report(work, built, names) for work, built, names in entries}
    pooled = [e for _, built, _ in entries for e in built.extractions.values()]
    pairs = [(c, {e['number']: e['text'] for e in work['episodes']}) for work, built, names in entries for c in people_of(built.payload.cards, names)]
    names, found = sum(r['coverage']['names'] for r in per.values()), sum(r['coverage']['found'] for r in per.values())
    return {'perWork': per, 'total': {'works': len(per), 'cards': sum(r['cards'] for r in per.values()), 'characters': sum(r['characters'] for r in per.values()),
                                      'relations': sum(r['relations'] for r in per.values()), 'failures': sum(len(r['failures']) for r in per.values()),
                                      'extraction': ps.extraction_stats(pooled), 'coverage': {'names': names, 'found': found, 'rate': ps.ratio(found, names)},
                                      'persona': ps.persona_stats(pairs)}}


def pct(value) -> str:
    return '-' if value is None else f'{value:.1%}'


def render(result: dict) -> str:
    """결과(report가 쓰는 JSON)를 사람이 읽는 표로."""
    total = result['world']['total']
    ex, persona = total['extraction'], total['persona']
    grounded = lambda *names: ps.ratio(sum(persona['docs'][n]['grounded'] for n in names), sum(persona['docs'][n]['lines'] for n in names))  # noqa: E731
    out = [f"[{result['tag']}] 작품 {total['works']}편 · 카드 {total['cards']}(인물 {total['characters']}) · 관계 {total['relations']} · 추출 실패 회차 {total['failures']}",
           f"세계관: 인용 통과율 {pct(ex['quotePass'])} · 항목 통과율 {pct(ex['itemPass'])}(남은 {ex['kept']} / 제안 {ex['kept'] + ex['dropped']}) · "
           f"평가 인물 포함률 {pct(total['coverage']['rate'])}({total['coverage']['found']}/{total['coverage']['names']})",
           f"페르소나: 평가 인물 {persona['characters']}명 중 IDENTITY·SOUL이 줄로 있는 인물 {persona['ready']}명 · IDENTITY·SOUL 줄 원문 근거 {pct(grounded('identity', 'soul'))} · "
           f"이름 명시 {pct(ps.ratio(sum(persona['docs'][n]['named'] for n in ('identity', 'soul')), sum(persona['docs'][n]['lines'] for n in ('identity', 'soul'))))}"]
    for key, counts in result['items'].items():
        out.append(f"문항 {oc.NAMES[key]}: " + ' · '.join(f'{STATUS.get(k, k)} {n}' for k, n in sorted(counts.items(), key=lambda kv: kv[0] != 'ok')))
    for key, sides in result['simulation'].items():
        for kind in ('pipeline', 'hand'):
            if kind in sides:
                s = sides[kind]['summary']
                scores = ' · '.join(f"{m} {s[m]['mean']:.2f}" for m in ('voice', 'intent', 'style', 'info') if m in s and s[m]['mean'] is not None)
                out.append(f"시뮬레이션 {oc.NAMES[key]} {kind}: 문항 {s['n']} · 건너뜀 {sides[kind]['skippedBy'] or 0} · 오류 {s['errors']} · 채점 실패 {s['failedJudge']} · {scores} · 시점 위반 {pct(s['leak']['rate'])}")
        if 'vsHand' in sides:
            out.append('    짝 비교(파이프라인 − 손라벨): ' + ' · '.join(f"{m} {v['up']}↑{v['down']}↓{v['tie']}= (평균차 {v['meanDiff'] or 0:+.2f}, p={v['p']:.3f}, n={v['n']})" for m, v in sides['vsHand']['metrics'].items()))
    return '\n'.join(out)


# ---- 명령 ----

def chosen_works(args) -> dict[str, dict]:
    """--works가 없으면 고른 세트에 문항이 있는 작품 전부."""
    ids = args.works.split(',') if args.works else None
    works = oc.load_works(None)
    if unknown := [i for i in ids or () if i not in works]:
        raise SystemExit(f"공개 세트에 없는 작품: {', '.join(unknown)}")
    have = {i['work'] for key in args.sets.split(',') for i in oc.load_items('public', key)}
    return {i: works[i] for i in (ids or sorted(works)) if ids or i in have}


def model_name() -> str:
    return os.environ.get('OPENAI_MODEL') or 'gpt-6-luna'


def load_worlds(works: dict[str, dict], reveal: str) -> tuple[dict, dict]:
    """캐시에서 작품마다 (Built, PipelineWorld)를 읽는다(모델 호출 없음). ①이 실패한 작품은 None이다. 캐시에 없으면 build를 먼저 하라고 멈춘다."""
    built, worlds = {}, {}
    for wid, work in works.items():
        try:
            built[wid] = pb.build_world(work, CACHE, model_name(), offline=True)
            worlds[wid] = pw.PipelineWorld(wid, built[wid].payload, built[wid].quotes, reveal)
        except pb.CacheMiss as miss:
            raise SystemExit(f'{miss}: 먼저 build를 실행한다.') from None
        except pb.WorldFailed:
            built[wid] = worlds[wid] = None
    return built, worlds


def cost_for(via: str):
    return sim_via.OcxCostLog(COST_OCX) if via == 'ocx' else CostLog(COST_PIPE)


def per_item(rows: dict) -> dict:
    return {key: row['usd'] / row['items'] for key, row in rows.items()}


def cmd_estimate(args) -> None:
    hand, works = oc.corpus_of('public'), chosen_works(args)
    sets, kinds = args.sets.split(','), args.worlds.split(',')
    act = oc.act_provider()
    rows, _ = oc.estimate(hand, sets, args.judge, None, folder='public', rate=oc.act_rate(act))
    one = pb.estimate_build(works, CACHE, model_name())
    print(f"① 세계관: 작품 {len(works)}편 · 추출 {one['extract']}회 · 정체 정리 {one['resolve']}회(캐시에 없는 것만) · 입력 {one['tokensIn']:,}토큰 · 출력 {one['tokensOut']:,}토큰(어림) · 예상 {one['usd']:.2f}달러")
    total, calls = one['usd'], 0
    for key, price in per_item(rows).items():
        n = len(select_items(oc.load_items('public', key), set(works), args.limit))
        total, calls = total + price * n * len(kinds), calls + n * len(kinds) * (2 if args.judge == 'openai' else 1)
        print(f"② {oc.NAMES[key]}: 문항 {n} × 세계관 {len(kinds)}({args.worlds}) · 입력 평균 {rows[key]['meanChars']:,}자 · 문항당 약 {price:.4f}달러")
    print(f"합계 약 {total:.2f}달러(모델 호출 약 {one['extract'] + one['resolve'] + calls}회, 채점 {args.judge}) / 상한 {args.limit_usd:.2f}달러" + (' — 상한을 넘는다' if total > args.limit_usd else '')
          + (f" · act는 {act['provider']} {act['model']} 단가" if act else ''))


def cmd_build(args) -> None:
    oc.need_openai()
    oc.no_langfuse()
    works, cost = chosen_works(args), cost_for(args.via)
    one = pb.estimate_build(works, CACHE, model_name())
    print(f"작품 {len(works)}편 · 추출 {one['extract']}회 · 정체 정리 {one['resolve']}회 · 예상 {one['usd']:.2f}달러 · 장부 {cost.spent():.3f}달러 / 상한 {args.limit_usd:.2f}달러", flush=True)
    if args.via == 'openai' and cost.spent() + one['usd'] > args.limit_usd:
        raise SystemExit('예상 금액이 남은 상한을 넘어 호출 없이 멈춘다.')
    pb.install(args.via, cost, args.limit_usd, reserve=args.workers * pb.CALL_MAX_USD)
    for wid, work in works.items():
        try:
            built = pb.build_world(work, CACHE, model_name(), workers=args.workers)
        except pb.WorldFailed as error:
            print(f'{wid}: 세계관 실패 {error}', flush=True)
            continue
        ex = ps.extraction_stats(built.extractions.values())
        print(f"{wid}: 회차 {len(work['episodes'])}(실패 {len(built.failures)}) · 카드 {len(built.payload.cards)} · 관계 {len(built.payload.relations)} · 인용 통과 {pct(ex['quotePass'])} · 모델 호출 {built.calls} · 장부 {cost.spent():.3f}달러", flush=True)


def cmd_run(args) -> None:
    oc.need_openai()
    oc.no_langfuse()
    sets, kinds = args.sets.split(','), args.worlds.split(',')
    act = oc.act_provider()   # act가 OPENAI_MODEL이 아닌 모델(서비스 기본 gpt-6.1-terra)이면 기록에 밝히고 그 단가로 센다
    if args.via == 'ocx':
        if act:
            raise SystemExit('--via ocx는 게이트웨이 모델(gpt-6-luna) 하나로 보낸다: act 모델이 OPENAI_MODEL과 다르면 쓰지 않는다(SIMULATION_ACT_MODEL=gpt-6-luna로 되돌린 뒤).')
        sim_via.use_ocx()
    cost, hand, works = cost_for(args.via), oc.corpus_of('public'), chosen_works(args)
    _, worlds = load_worlds(works, args.reveal)
    corpus = pw.PipelineCorpus(hand, worlds)
    rows, _ = oc.estimate(hand, sets, args.judge, None, folder='public', rate=oc.act_rate(act))
    prices = per_item(rows)
    picked = {key: select_items(oc.load_items('public', key), set(works), args.limit) for key in sets if key in rows}
    total = sum(prices[key] * len(items) * len(kinds) for key, items in picked.items())
    print(f"문항 {sum(len(v) for v in picked.values())}개 × 세계관 {len(kinds)} · 예상 {total:.2f}달러 · 장부 {cost.spent():.3f}달러 / 상한 {args.limit_usd:.2f}달러", flush=True)
    if args.via == 'openai' and cost.spent() + total > args.limit_usd:
        raise SystemExit('예상 금액이 남은 상한을 넘어 호출 없이 멈춘다.')
    folder = RUNS / args.tag
    claim_run(folder, {'via': args.via, 'judge': args.judge, 'judgeModel': args.judge_model, 'reveal': args.reveal, 'act': act, 'model': model_name()})
    grader = orig_judge.grader_name(args.judge_model)
    judge_llm = (sim_via.ocx_llm(PIPE / f'cache-judge-{grader}', COST_OCX, args.judge_model) if args.judge == 'ocx' else usd_llm(PIPE / 'cache-judge-openai', COST_PIPE, args.limit_usd))
    for key, items in picked.items():
        runnable = [i for i in items if corpus.status(i) == 'ok']
        for kind in kinds:
            pipeline = kind == 'pipeline'
            source = corpus if pipeline else hand
            via = {'sut': args.via, 'judge': args.judge, 'judgeModel': args.judge_model, 'world': kind, **({'act': act} if act and key == '1' else {})}
            evaluate = lambda item, k=key, s=source, v=via, n=kind: {**EVALUATE[k](item, s, judge_llm, cost, None, n), 'via': v}  # noqa: E731
            records = rn.run_items(items if pipeline else runnable, evaluator(corpus, evaluate, pipeline), cost, args.limit_usd, args.workers, rn.run_path(folder, key, kind), rows[key]['itemMaxUsd'])
            print(f"{oc.NAMES[key]} {kind} 끝: {len(records)}문항 · 건너뜀 {skipped_by(records) or 0} · 장부 {cost.spent():.3f}달러 / 상한 {args.limit_usd:.2f}달러", flush=True)


def cmd_report(args) -> None:
    works, hand = chosen_works(args), oc.corpus_of('public')
    built, worlds = load_worlds(works, args.reveal)
    corpus, folder, sets = pw.PipelineCorpus(hand, worlds), RUNS / args.tag, args.sets.split(',')
    every = {key: [i for i in oc.load_items('public', key) if i['work'] in works] for key in sets}
    entries = [(works[w], b, {name for items in every.values() for i in items if i['work'] == w for name in i['ids']}) for w, b in built.items() if b]
    result = {'tag': args.tag, 'config': json.loads((folder / 'meta.json').read_text()) if (folder / 'meta.json').exists() else None, 'works': sorted(works),
              'world': world_section(entries), 'items': {key: dict(Counter(corpus.status(i) for i in items)) for key, items in every.items()},   # 표본이 아니라 세트 전체 문항이 돌 수 있는지
              'simulation': {}}
    for key in sets:
        done = {kind: list(rn.load_done(rn.run_path(folder, key, kind)).values()) for kind in ('pipeline', 'hand')}
        if done['pipeline']:
            result['simulation'][key] = assemble(key, done['pipeline'], done['hand'])
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f'pipeline-eval-{args.tag}.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    print(render(result))
    print(f'→ {path.name}')


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(description='원문 → 세계관 → 인물 시뮬레이션 통합 평가(공개 세트)')
    sub = top.add_subparsers(dest='command', required=True)
    for name, handler, help_ in (('estimate', cmd_estimate, '호출 수·금액 어림(호출 없음)'), ('build', cmd_build, '① 세계관 만들기(모델 호출, 캐시)'),
                                 ('run', cmd_run, '② 시뮬레이션 문항 실행(모델 호출, 세계관은 캐시에서)'), ('report', cmd_report, '3단 점수 표와 results/pipeline-eval-<태그>.json(호출 없음)')):
        p = sub.add_parser(name, help=help_)
        p.set_defaults(handler=handler)
        p.add_argument('--works', default=None, help='작품 id(쉼표, 기본: 고른 세트에 문항이 있는 작품 전부)')
        p.add_argument('--sets', default=','.join(SETS), help='세트(쉼표): 1 대사 · 3n 나레이션 · 3m 독백')
        if name != 'report':
            p.add_argument('--limit-usd', type=float, default=5.0, help='pipeline 장부 누적 상한(달러, OpenAI 경로)')
        if name in ('run', 'report'):
            p.add_argument('--tag', default='run', help='실행 기록 이름(설정이 다르면 다른 이름)')
            p.add_argument('--reveal', choices=('none', 'first'), default='none', help='카드 공개 회차: none = Content 자동 적재 그대로, first = 작가가 첫 등장 회차를 공개 회차로 정한 경우')
        if name in ('estimate', 'run'):
            p.add_argument('--limit', type=int, default=None, help='세트마다 같은 간격으로 N문항만')
            p.add_argument('--worlds', default='pipeline,hand', help='pipeline(① 결과) · hand(손라벨 기준선), 쉼표')
            p.add_argument('--judge', choices=('openai', 'ocx'), default='ocx', help='채점 경로(ocx는 금액 0)')
        if name in ('build', 'run'):
            p.add_argument('--via', choices=('openai', 'ocx'), default='openai', help='모델 호출 경로(ocx = 로컬 게이트웨이, 금액 0, gpt-6-luna)')
            p.add_argument('--workers', type=int, default=4 if name == 'build' else 6)
        if name == 'run':
            p.add_argument('--judge-model', default=JUDGE, help='ocx 채점 모델(기본 gpt-6.2-sol)')
    return top


def main(argv=None) -> None:
    args = parser().parse_args(argv)
    try:
        args.handler(args)
    except CallCapExceeded as stop:
        raise SystemExit(f'{stop} 끝낸 것은 캐시·기록에 남았다: 같은 명령으로 이어 받는다.') from None


if __name__ == '__main__':
    main()
