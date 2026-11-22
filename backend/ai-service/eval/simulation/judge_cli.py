"""채점 보강 실행기(평가 전용): 저장된 생성을 다른 채점 모델로 다시 채점하고(regrade, 생성은 다시 하지 않는다), 같은 문항의 두 생성을 A/B로 고르게 하고(judge-pair),
두 채점 방식의 일치를 낸다(agree). 채점은 ocx(금액 0)이고 기록은 채점 방식마다 따로 쌓인다(runs-<이름>·pairs-<이름>, 원본 runs는 건드리지 않는다).

    cd backend/ai-service
    uv run --locked --extra dev python eval/simulation/judge_cli.py regrade --corpus hp --sets 1,3n,3m --judge-model gpt-6.2-sol           # → runs-gpt-6.2-sol
    uv run --locked --extra dev python eval/simulation/judge_cli.py regrade --corpus hp --sets 1 --judge-model gpt-6.2-sol --voice-ref    # → runs-gpt-6.2-sol+ref(voiceRef 점수 추가)
    uv run --locked --extra dev python eval/simulation/judge_cli.py regrade --corpus hp --sets 1 --judge-model gpt-6-luna --name luna-retest   # 같은 모델 재채점(일치의 상한 어림)
    uv run --locked --extra dev python eval/simulation/judge_cli.py regrade --corpus hp --sets 1 --judge-model gpt-6-luna --name luna-regrade --source gpt-6.2-sol   # run --judge-model gpt-6.2-sol로 만든 후보를 다른 채점으로
    uv run --locked --extra dev python eval/simulation/judge_cli.py judge-pair --corpus hp --set 1 --pairs P1:base2 P1+M1:P1 --judge-model gpt-6.2-sol
    uv run --locked --extra dev python eval/simulation/judge_cli.py agree --corpus hp --pairs gpt-6-luna:gpt-6.2-sol gpt-6-luna:luna-retest gpt-6.2-sol:sol-retest
    uv run --locked --extra dev python eval/simulation/orig_cli.py summary --corpus hp --base base2 --grader gpt-6.2-sol          # 재채점 기록의 집계·짝 비교
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from orig_cli import corpus_of, home, load_items, no_langfuse  # noqa: E402
from orig_common import COST, LUNA, ORIG, RESULTS  # noqa: E402


def run_tag(path: Path) -> str:
    return path.stem.split('-', 1)[1]


def drop_failed(path: Path, failed) -> None:
    """이전 실행에서 호출·응답 확인이 실패한 기록(failed(기록)이 참)을 파일에서 지워, 이어 받을 때 그 문항만 다시 부르게 한다. 파일이 없으면 아무것도 하지 않는다."""
    if path.exists():
        path.write_text(''.join(line + '\n' for line in path.read_text().splitlines() if line.strip() and not failed(json.loads(line))))


def cmd_regrade(args) -> None:
    import orig_judge as oj
    import orig_run as rn
    import sim_via
    from cost import CostLog
    no_langfuse()
    name, sets = oj.grader_name(args.judge_model, args.voice_ref, args.name), args.sets.split(',')
    source, target = oj.runs_folder(ORIG / home(args), args.source), oj.runs_folder(ORIG / home(args), name)
    if source == target:
        raise SystemExit('채점 기록 폴더가 생성 기록 폴더(--source)와 같아 덮어쓴다: --name으로 다른 이름을 준다.')
    if args.voice_ref and sets != ['1']:
        raise SystemExit('--voice-ref는 ① 대사(--sets 1)만 쓴다.')
    corpus, llm, cost = corpus_of(args.corpus), sim_via.ocx_llm(oj.judge_cache(ORIG, name), COST, args.judge_model), CostLog(COST)
    via = {'judgeModel': args.judge_model, 'voiceRef': args.voice_ref}
    for key in sets:
        items = {item['id']: item for item in load_items(home(args), key)}
        for path in sorted(source.glob(f'{key}-*.jsonl')):
            if args.tags and run_tag(path) not in args.tags:
                continue
            records, out = rn.load_done(path), rn.run_path(target, key, run_tag(path))
            drop_failed(out, lambda r: r.get('generated') and not r.get('grade'))
            done = rn.run_items([items[i] for i in records if i in items], lambda item: oj.regrade(key, records[item['id']], item, corpus, llm, args.voice_ref, via), cost, 1e9, args.workers, out, 0.0)
            failed = sum(not r.get('error') and not r.get('skipped') and not r.get('grade') for r in done)
            print(f'{name} {key}-{run_tag(path)}: {len(done)}문항 · 채점 실패 {failed}', flush=True)


def cmd_judge_pair(args) -> None:
    import orig_judge as oj
    import orig_run as rn
    import sim_via
    from cost import CostLog
    no_langfuse()
    name, key = oj.grader_name(args.judge_model, name=args.name), args.set
    corpus, items = corpus_of(args.corpus), load_items(home(args), key)
    llm, cost = sim_via.ocx_llm(oj.judge_cache(ORIG, name), COST, args.judge_model), CostLog(COST)
    folder, runs = ORIG / home(args) / f'pairs-{name}', oj.runs_folder(ORIG / home(args), args.source)   # 생성 기록을 읽는 폴더(글은 채점 방식과 무관하다)
    for spec in args.pairs:
        cand, base = spec.split(':')
        texts = oj.shared_generations(rn.load_done(runs / f'{key}-{cand}.jsonl'), rn.load_done(runs / f'{key}-{base}.jsonl'))
        out = rn.run_path(folder, key, f'{cand}-vs-{base}')
        drop_failed(out, lambda r: r['outcome'] is None)
        done = rn.run_items([item for item in items if item['id'] in texts], lambda item: {'id': item['id'], **oj.judge_pair(llm, item, oj.voice_ref(corpus, item), *texts[item['id']])},
                            cost, 1e9, args.workers, out, 0.0)
        print(f"{name} {key} {cand} vs {base}: {json.dumps(oj.tally(list(done)), ensure_ascii=False)}", flush=True)
    has_ref = {item['id']: bool(oj.voice_ref(corpus, item)) for item in items}   # 말투 기준 줄이 있는 문항과 없는 문항을 따로도 센다(기준이 판정을 돕는지)
    out = {}
    for path in sorted(folder.glob(f'{key}-*-vs-*.jsonl')):
        cand, base = run_tag(path).split('-vs-')
        records = list(rn.load_done(path).values())
        out[f'{cand} vs {base}'] = {**oj.tally(records), 'withRef': oj.tally([r for r in records if has_ref.get(r['id'])]), 'noRef': oj.tally([r for r in records if not has_ref.get(r['id'])])}
    acts = {tag: act for tag in dict.fromkeys(t for spec in args.pairs for t in spec.split(':')) if (act := rn.act_of(list(rn.load_done(runs / f'{key}-{tag}.jsonl').values())))}   # act 제공사 실행의 표기
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'orig-{home(args)}-pairwise-{name}.json').write_text(json.dumps({'corpus': home(args), 'set': key, 'grader': name, 'refItems': sum(has_ref.values()), 'items': len(items), 'pairs': out,
                                                                                 **({'acts': acts} if acts else {})}, ensure_ascii=False, indent=2, sort_keys=True))


def cmd_agree(args) -> None:
    import orig_agree
    import orig_judge as oj
    import orig_run as rn

    def runs(grader: str, key: str) -> dict:
        return {run_tag(p): list(rn.load_done(p).values()) for p in sorted(oj.runs_folder(ORIG / home(args), grader).glob(f'{key}-*.jsonl'))}

    out = {}
    for spec in args.pairs:
        reference, grader = spec.split(':')
        for key in args.sets.split(','):
            a, b = runs(reference, key), runs(grader, key)
            if args.base in a and args.base in b:
                out.setdefault(f'{reference} vs {grader}', {})[key] = orig_agree.report(key, a, b, args.base)
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f'orig-{home(args)}-agreement.json'
    path.write_text(json.dumps({'corpus': home(args), 'base': args.base, 'pairs': out}, ensure_ascii=False, separators=(',', ':'), sort_keys=True))
    for name, sets in out.items():
        for key, rep in sets.items():
            print(f"{name} {key}: " + ' · '.join(f"{m} r={v['r']:.2f} n={v['n']}" if v['r'] is not None else f'{m} n={v["n"]}' for m, v in rep['items'].items()))
    print(f'{path.name}: {path.stat().st_size:,}바이트')


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    def command(name, handler, help_):
        p = sub.add_parser(name, help=help_)
        p.set_defaults(handler=handler)
        p.add_argument('--corpus', choices=('public', 'hp'), required=True)
        p.add_argument('--dev', action='store_true', help='hp-dev 세트(후보 고르기용)')
        return p

    regrade = command('regrade', cmd_regrade, '저장된 생성을 다른 채점 모델로 다시 채점(ocx)')
    regrade.add_argument('--sets', default='1,3n,3m')
    regrade.add_argument('--tags', nargs='*', default=None, help='다시 채점할 실행 이름(기본은 폴더의 모두)')
    regrade.add_argument('--judge-model', default=LUNA, help='ocx 채점 모델(게이트웨이 이름)')
    regrade.add_argument('--voice-ref', action='store_true', help='① 채점 입력에 말투 기준(voiceRef) 줄을 더하고 voiceRef 점수를 받는다')
    regrade.add_argument('--name', default=None, help='채점 방식 이름(기본은 모델 이름[+ref]; 같은 모델의 재채점은 다른 이름)')
    regrade.add_argument('--source', default=LUNA, help='생성 기록을 읽을 채점 방식 폴더(기본 runs; run --judge-model로 만든 후보는 그 모델 이름의 폴더에만 있다)')
    regrade.add_argument('--workers', type=int, default=8)
    pair = command('judge-pair', cmd_judge_pair, '같은 문항의 두 생성을 A/B로(순서를 바꿔 두 번) 고르게 한다(ocx)')
    pair.add_argument('--set', default='1')
    pair.add_argument('--pairs', nargs='+', required=True, help='후보:기준선(예: P1:base2)')
    pair.add_argument('--judge-model', default=LUNA)
    pair.add_argument('--name', default=None)
    pair.add_argument('--source', default=LUNA, help='생성 기록을 읽을 채점 방식 폴더(기본 runs)')
    pair.add_argument('--workers', type=int, default=8)
    agree = command('agree', cmd_agree, '두 채점 방식의 문항별 일치·후보 순위·짝 비교 방향(호출 없음)')
    agree.add_argument('--pairs', nargs='+', required=True, help='기준:견줄 채점 방식 이름(예: gpt-6-luna:gpt-6.2-sol, 같은 모델의 재채점은 gpt-6-luna:luna-retest)')
    agree.add_argument('--base', default='base2')
    agree.add_argument('--sets', default='1,3n,3m')
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == '__main__':
    main()
