"""원문 기반 시뮬레이션 평가 세트 ①~④ 실행기. 설계·규칙은 docs/evaluation/simulation-original.md.

    cd backend/ai-service
    uv run --locked --extra dev python eval/simulation/orig_cli.py collect                         # 공개 세트 원천 수집(호출 0회)
    set -a; . <키 파일>; set +a                                                                     # 이하 OpenAI·ocx 호출: 유료 명령마다 같은 명령 안에서 불러온다(키 값은 출력하지 않는다)
    uv run --locked --extra dev python eval/simulation/orig_cli.py label --limit-usd 5             # 공개 세트 정답표·세계관(기존 KoTimeChara 추출 그대로)
    uv run --locked --extra dev python eval/simulation/orig_cli.py align --corpus public|hp [--per-book 6] --limit-usd N   # 화자·독백 판별(OpenAI gpt-6-luna + ocx, 일치한 턴만)
    uv run --locked --extra dev python eval/simulation/orig_cli.py build-sets --corpus public|hp   # 문항 생성(호출 없음)
    uv run --locked --extra dev python eval/simulation/orig_cli.py review --corpus public|hp       # 사람 검수 표본 .data/orig/<corpus>/review-<세트>.md
    uv run --locked --extra dev python eval/simulation/orig_cli.py estimate --corpus hp --limit-usd N   # 예상 금액(호출 없음)
    uv run --locked --extra dev python eval/simulation/orig_cli.py run --corpus hp --sets 1,2,3n,3m,4 --limit-usd N [--variant V1] [--limit 20]
    uv run --locked --extra dev python eval/simulation/orig_cli.py report --corpus hp [--variant V1]   # results/orig-*.json(집계만)

실행 시작 때 Langfuse 키를 지워 원문이 Langfuse로 가지 않게 한다. OpenAI 호출은 별도 장부 .data/cost-orig.jsonl로 센다.
"""

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from orig_common import COST, ORIG, RESULTS, SEED

SIZES = {'public': {'act': 150, 'direct': 150, 'narrate': 70, 'monologue': 30, 'check_pass': 50, 'check_fail': 50},
         'hp': {'act': 400, 'direct': 300, 'narrate': 160, 'monologue': 40, 'check_pass': 150, 'check_fail': 150}}
REVIEW = {'public': 20, 'hp': 40}
KEYS = ('1', '2', '3n', '3m', '4')
NAMES = {'1': '① 대사', '2': '② 연출', '3n': '③ 나레이션', '3m': '③ 독백', '4': '④ 검사'}
SAMPLE = 20   # 예상 금액·문항당 최대 금액을 재는 표본 문항 수


def no_langfuse() -> None:
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)


def need_openai() -> None:
    if not os.environ.get('OPENAI_API_KEY') or not os.environ.get('OPENAI_MODEL'):
        raise SystemExit('OPENAI_API_KEY·OPENAI_MODEL이(가) 필요하다. 키 파일을 같은 명령 안에서 불러온 뒤 실행한다(값은 출력하지 않는다).')


def corpus_of(name: str):
    import orig_corpus
    return orig_corpus.PublicCorpus() if name == 'public' else orig_corpus.HpCorpus()


def load_works(ids=None) -> dict[str, dict]:
    works = {p.parent.name: json.loads(p.read_text()) for p in sorted((ORIG / 'works').glob('*/work.json'))}
    return {i: works[i] for i in ids} if ids else works


def load_records(corpus) -> list[dict]:
    """정렬이 끝난 회차들: [{ep(본문 포함), turns}]."""
    eps = {e['id']: e for e in corpus.episodes()}
    records = []
    for path in sorted((ORIG / corpus.name / 'aligned').glob('*.json')):
        rec = json.loads(path.read_text())
        records.append({'ep': eps[rec['id']], 'turns': rec['turns']})
    return records


def load_items(corpus_name: str, key: str) -> list[dict]:
    path = ORIG / corpus_name / 'sets' / f'{key}.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def cmd_collect(args) -> None:
    import orig_collect
    orig_collect.collect()
    for wid, work in load_works().items():
        chars = sum(len(e['text']) for e in work['episodes'])
        print(f"{wid} {work['kind']:7s} {work['title'][:24]:24s} {work['author']} · {work['license']} · 회차 {len(work['episodes'])} · {chars:,}자")


def cmd_label(args) -> None:
    """공개 세트 작품마다 정답표(kt_label)·세계관(kt_world)을 기존 kt_extract 그대로 만든다. 장부·캐시·출력 경로만 이 작업의 것이다."""
    need_openai()
    no_langfuse()
    from batch import cost_report, make_executor, plan_for, run_rounds
    from llm import usd_llm
    import kt_extract
    works = load_works(args.works or None)
    llm = usd_llm(ORIG / 'cache-label', COST, args.limit_usd)
    tasks = [(wid, e['number']) for wid, work in works.items() for e in work['episodes']]
    print(f"작품 {len(works)}편 · 회차 {len(tasks)}개 · 장부 {llm.cost.spent():.3f}달러 / 상한 {args.limit_usd:.2f}달러", flush=True)
    done = run_rounds(tasks, kt_extract.extractor(works), llm, make_executor(llm, 'sync', ORIG / 'batches'), plan=plan_for(llm, 'sync', args.limit_usd))
    kt_extract.finish(works, done, ORIG / 'works')
    cost_report(llm)


def cmd_align(args) -> None:
    """회차마다 화자·독백을 두 경로(OpenAI gpt-6-luna와 ocx, 응답 캐시도 따로)가 판별하고 같은 턴만 확정해 ORIG/<corpus>/aligned/에 쓴다(이어 받기)."""
    no_langfuse()
    import orig_align
    import orig_corpus
    import orig_turns
    import sim_via
    from llm import usd_llm
    if args.first == 'openai':
        need_openai()
    corpus = corpus_of(args.corpus)
    works = corpus.works()
    episodes = corpus.episodes()
    if args.corpus == 'hp':
        episodes = orig_corpus.sample_units(episodes, args.per_book)
    first = usd_llm(ORIG / 'cache-align-openai', COST, args.limit_usd, model=sim_via.MODEL) if args.first == 'openai' else sim_via.ocx_llm(ORIG / 'cache-align-ocx-first', COST)
    second = sim_via.ocx_llm(ORIG / 'cache-align-ocx', COST)
    folder = ORIG / corpus.name / 'aligned'
    folder.mkdir(parents=True, exist_ok=True)

    def one(ep):
        path = folder / f"{ep['id'].replace('#', '-')}.json"
        if path.exists():
            return
        names = list(orig_corpus.episode_names(corpus, ep))
        first_person = works[ep['work']]['person'] == 'first'
        if names or first_person:
            got = orig_align.align_episode(ep['text'], names, first_person, first, second, workers=args.workers)
        else:   # 판별할 인물 이름이 없는 회차(카드가 없는 작품)
            got = {'turns': [{**t, 'status': 'unlabeled', 'speaker': '', 'monologue': ''} for t in orig_turns.split_turns(ep['text'])], 'chunks': 0, 'failedChunks': 0}
        stats = orig_align.agreement(got['turns'])
        path.write_text(json.dumps({'id': ep['id'], 'work': ep['work'], 'n': ep['n'], 'base': ep['base'], 'turns': got['turns'], 'chunks': got['chunks'],
                                    'failedChunks': got['failedChunks'], 'agreement': stats}, ensure_ascii=False))
        print(f"{ep['id']} 대사 {stats['dialogueAgreed']}/{stats['dialogue']} · 지문 {stats['narrationAgreed']}/{stats['narration']} · 독백 {stats['monologue']} · 실패 청크 {got['failedChunks']}/{got['chunks']} · "
              f"장부 {first.cost.spent():.3f}달러", flush=True)

    with ThreadPoolExecutor(args.episodes) as pool:   # 회차 몇 개를 동시에(청크 호출은 회차 안에서 따로 동시)
        list(pool.map(one, episodes))


def cmd_build_sets(args) -> None:
    import orig_sets
    corpus = corpus_of(args.corpus)
    records = load_records(corpus)
    sets, stats = orig_sets.build_items(corpus, records, SIZES[args.corpus], SEED)
    folder = ORIG / corpus.name / 'sets'
    folder.mkdir(parents=True, exist_ok=True)
    for key, items in sets.items():
        (folder / f'{key}.jsonl').write_text(''.join(json.dumps(item, ensure_ascii=False) + '\n' for item in items))
    agree = {}
    for rec in records:
        turns = [t for t in rec['turns'] if t['kind'] == 'dialogue']
        row = agree.setdefault(rec['ep']['work'], [0, 0])
        row[0] += sum(t['status'] == 'agreed' for t in turns)
        row[1] += len(turns)
    stats |= {'counts': {key: len(items) for key, items in sets.items()}, 'episodes': len(records), 'dialogueAgreement': {w: {'agreed': a, 'total': t} for w, (a, t) in agree.items()}}
    (folder / 'stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=1))
    print(json.dumps({k: stats[k] for k in ('counts', 'pool', 'dropped', 'episodes')}, ensure_ascii=False))
    print('대사 판별 일치(작품: 일치/전체):', {w: f'{v["agreed"]}/{v["total"]}' for w, v in stats['dialogueAgreement'].items()})


def cmd_review(args) -> None:
    import orig_sets
    for key in KEYS:
        items = load_items(args.corpus, key)
        if items:
            path = ORIG / args.corpus / f'review-{key}.md'
            path.write_text(orig_sets.review_md(items, REVIEW[args.corpus], SEED), encoding='utf-8')
            print(f'{NAMES[key]}: {min(REVIEW[args.corpus], len(items))}개 → {path}')


def item_chars(key: str, item: dict, corpus, rn) -> int:
    """문항 하나의 모델 입력 글자 수(조립만 하고 호출은 하지 않는다)."""
    if key == '1':
        view = rn.act_view(item, corpus)
        return rn.size_of({**view['asked'], 'actionStyle': view['style']})
    if key == '4':
        view = rn.act_view(item, corpus)
        return rn.size_of({**view['asked'], **view['extra'], 'actionStyle': view['style'], 'checks': view['kinds'], 'paragraph': item['gold']})
    if key == '2':
        return rn.size_of(rn.direct_view(item, corpus)[0]) + 2000   # 연출 분류기의 지시문·선택지 어림
    return rn.size_of(rn.narrate_data(item, corpus))


def sample_of(items: list[dict], n: int) -> list[dict]:
    """같은 간격으로 n개(모자라면 전부). 세트의 앞부분이 한쪽 종류(④의 원작)로 몰려 있어도 고르게 뽑는다."""
    return [items[i * len(items) // n] for i in range(min(n, len(items)))]


def estimate(corpus, keys, judge: str, limit: int | None, sample: int = SAMPLE) -> tuple[dict, float]:
    """세트별 {문항 수, 평균 입력 글자, 예상 금액, 문항당 최대 금액}과 합계(호출 없음). 표본 문항의 입력을 실제로 조립해 재고 전체로 늘린다."""
    import orig_run as rn
    from cost import usd
    rows, total = {}, 0.0
    for key in keys:
        items = sample_of(load_items(corpus.name, key), limit) if limit else load_items(corpus.name, key)
        if not items:
            continue
        chars = [item_chars(key, item, corpus, rn) for item in sample_of(items, sample)]
        mean = sum(chars) / len(chars)
        out = 100 if key == '2' else 700
        per = usd(int(mean / rn.CHARS_PER_TOKEN), out) + (usd(rn.JUDGE_IN, rn.JUDGE_OUT) if judge == 'openai' and key != '2' else 0)
        rows[key] = {'items': len(items), 'meanChars': round(mean), 'usd': per * len(items), 'itemMaxUsd': rn.estimate_item_usd(max(chars) * 1.3) if key != '2' else usd(int(max(chars) * 1.3 / rn.CHARS_PER_TOKEN), 100)}
        total += rows[key]['usd']
    return rows, total


def cmd_estimate(args) -> None:
    corpus = corpus_of(args.corpus)
    rows, total = estimate(corpus, args.sets.split(','), args.judge, args.limit)
    for key, row in rows.items():
        print(f"{NAMES[key]}: 문항 {row['items']} · 입력 평균 {row['meanChars']:,}자(약 {row['meanChars'] / 2:,.0f}토큰) · 예상 {row['usd']:.2f}달러 · 문항당 최대 {row['itemMaxUsd']:.3f}달러")
    print(f"합계 약 {total:.2f}달러(출력은 ①③④ 700토큰·②100토큰 어림, 채점 {args.judge}) / 상한 {args.limit_usd:.2f}달러" + (' — 상한을 넘는다' if total > args.limit_usd else ''))


def cmd_run(args) -> None:
    need_openai()
    no_langfuse()
    import orig_run as rn
    import sim_via
    from cost import CostLog
    from llm import usd_llm
    sets = args.sets.split(',')
    if args.via == 'ocx':
        if '2' in sets:
            raise SystemExit('② 연출은 /v1/decisions가 게이트웨이에 없어 OpenAI API로만 돈다(--via ocx 불가).')
        sim_via.use_ocx()
    corpus = corpus_of(args.corpus)
    rows, total = estimate(corpus, sets, args.judge, args.limit)
    print(json.dumps({k: {'items': v['items'], 'meanChars': v['meanChars'], 'usd': round(v['usd'], 2)} for k, v in rows.items()}, ensure_ascii=False))
    cost = CostLog(COST)
    if args.via == 'openai' and cost.spent() + total > args.limit_usd:
        raise SystemExit(f'예상 {total:.2f}달러가 남은 상한(장부 {cost.spent():.2f}달러 / {args.limit_usd:.2f}달러)을 넘어 호출 없이 멈춘다.')
    judge_llm = sim_via.ocx_llm(ORIG / 'cache-judge-ocx', COST) if args.judge == 'ocx' else usd_llm(ORIG / 'cache-judge-openai', COST, args.limit_usd)
    variants = None
    if args.variant:
        import orig_variants
        variants = orig_variants.VARIANTS[args.variant]
    tag = args.variant or args.tag or 'A'   # 후보 없이 채택한 서비스 구성으로 다시 잴 때는 --tag B
    via = {'sut': args.via, 'judge': args.judge}
    for key in sets:
        items = sample_of(load_items(corpus.name, key), args.limit) if args.limit else load_items(corpus.name, key)
        items = sorted(items, key=lambda i: (i['base'], i['id']))   # 기준 회차 순서로 돌려 세계관(World)을 다시 만드는 일을 줄인다
        out = ORIG / corpus.name / 'runs' / f'{key}-{tag}.jsonl'
        item_usd = rows[key]['itemMaxUsd']
        if key == '2':
            records = rn.run_direct(items, corpus, cost, args.limit_usd, args.workers, out, item_usd, variants and variants.get('2'), args.variant)
        else:
            evaluate = {'1': rn.evaluate_dialogue, '3n': rn.evaluate_narration, '3m': rn.evaluate_narration, '4': rn.evaluate_check}[key]
            variant = variants and variants.get(key)
            records = rn.run_items(items, lambda item, e=evaluate, v=variant: {**e(item, corpus, judge_llm, cost, v, args.variant), 'via': via}, cost, args.limit_usd, args.workers, out, item_usd)
        print(f"{NAMES[key]} 끝: {len(records)}문항 · 장부 {cost.spent():.2f}달러 / 상한 {args.limit_usd:.2f}달러", flush=True)


SUMMARIES = {'1': 'summarize_dialogue', '2': 'summarize_direct', '3n': 'summarize_narration', '3m': 'summarize_narration', '4': 'summarize_check'}


def cmd_report(args) -> None:
    import orig_run as rn
    tag = args.variant or args.tag or 'A'
    RESULTS.mkdir(exist_ok=True)
    for key in KEYS:
        out = ORIG / args.corpus / 'runs' / f'{key}-{tag}.jsonl'
        if not out.exists():
            continue
        records = list(rn.load_done(out).values())
        data = {'corpus': args.corpus, 'set': key, 'name': NAMES[key], 'variant': tag, 'items': len(load_items(args.corpus, key)), 'ran': len(records),
                'via': records[0].get('via') if records else None, 'summary': getattr(rn, SUMMARIES[key])(records)}
        (RESULTS / f'orig-{args.corpus}-{key}{"" if tag == "A" else "-" + tag}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True))
        print(f"{NAMES[key]} ({tag}): {json.dumps(data['summary'], ensure_ascii=False)[:420]}")


def model_input(key: str, item: dict, corpus, rn) -> dict:
    """내보낼 문항의 모델 입력: 서비스가 그 문항에서 모델에 보내는 값 그대로(다음 작업이 같은 입력으로 프롬프트 버전을 돌릴 수 있게)."""
    if key == '1':
        view = rn.act_view(item, corpus)
        return {'set': 'dialogue', 'data': {**view['asked'], 'actionStyle': view['style']}}
    if key == '2':
        state, cast, last = rn.direct_view(item, corpus)
        return {'set': 'direct', 'state': state, 'cast': cast, 'allowed': rn.ALLOWED, 'lastPov': last}
    if key in ('3n', '3m'):
        return {'set': 'narration' if key == '3n' else 'monologue', 'data': rn.narrate_data(item, corpus)}
    view = rn.act_view(item, corpus)
    return {'set': 'check', 'data': {**view['asked'], **view['extra'], 'actionStyle': view['style'], 'checks': view['kinds'], 'paragraph': item['gold']}}


def cmd_export(args) -> None:
    """공개 세트 ①~④ 중 저작권 만료·자유 이용 문항만 app/evaluation/datasets/simulation/에 기존 평가 세트 jsonl 형식으로 쓴다(고전·근대 소설 파일과 SCP 파일을 나눈다)."""
    import orig_export
    import orig_run as rn
    corpus = corpus_of('public')
    folder = Path(__file__).resolve().parents[2] / 'app' / 'evaluation' / 'datasets' / 'simulation'
    folder.mkdir(parents=True, exist_ok=True)
    files = {'free': ('original.jsonl', 'sim.orig'), 'scp': ('original-scp.jsonl', 'sim.orig.scp')}
    for group, (name, prefix) in files.items():
        lines = []
        for key in KEYS:
            free, scp = orig_export.split_by_license(load_items('public', key))
            for n, item in enumerate(orig_export.pick(free if group == 'free' else scp, args.per_set), 1):
                lines.append(json.dumps(orig_export.record(key, item, f'{prefix}-{key}-{n:02d}', model_input(key, item, corpus, rn)), ensure_ascii=False))
        (folder / name).write_text('\n'.join(lines) + '\n', encoding='utf-8')
        print(f'{name}: 항목 {len(lines)}개 · {(folder / name).stat().st_size:,}바이트')


def cmd_compare(args) -> None:
    """같은 문항에서 후보(--variant)와 기준선(A)을 짝 비교해 results/orig-<corpus>-compare-<후보>.json에 집계만 쓴다."""
    import orig_run as rn
    out, shown = {}, []
    for key in KEYS:
        base_path, cand_path = (ORIG / args.corpus / 'runs' / f'{key}-{tag}.jsonl' for tag in ('A', args.variant))
        if base_path.exists() and cand_path.exists():
            out[key] = rn.compare_runs(key, list(rn.load_done(base_path).values()), list(rn.load_done(cand_path).values()))
            line = lambda metrics: ' · '.join(f"{m} {v['up']}↑{v['down']}↓{v['tie']}= (평균차 {v['meanDiff'] or 0:+.2f}, p={v['p']:.3f}, n={v['n']})" for m, v in metrics.items())   # noqa: E731
            shown.append(f"{NAMES[key]}: " + line(out[key]['metrics']) + f" · 입력 토큰 {out[key]['tokens']['base'] or 0:,.0f}→{out[key]['tokens']['cand'] or 0:,.0f}"
                         + f"\n    입력이 바뀐 {out[key]['applied']['n']}문항만: " + line(out[key]['applied']['metrics']))
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'orig-{args.corpus}-compare-{args.variant}.json').write_text(json.dumps({'corpus': args.corpus, 'variant': args.variant, 'sets': out}, ensure_ascii=False, indent=2, sort_keys=True))
    print('\n'.join(shown) or '비교할 실행 기록이 없다.')


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description='원문 기반 시뮬레이션 평가 세트')
    sub = parser.add_subparsers(dest='command', required=True)

    def command(name, handler, help_, corpus=True, limit_usd=None):
        p = sub.add_parser(name, help=help_)
        p.set_defaults(handler=handler)
        if corpus:
            p.add_argument('--corpus', choices=('public', 'hp'), required=True)
        if limit_usd is not None:
            p.add_argument('--limit-usd', type=float, default=limit_usd, help='cost-orig 장부 누적 상한(달러)')
        return p

    command('collect', cmd_collect, '공개 세트 원천 수집(호출 없음)', corpus=False)
    label = command('label', cmd_label, '공개 세트 정답표·세계관(모델 호출)', corpus=False, limit_usd=5.0)
    label.add_argument('--works', nargs='*')
    align = command('align', cmd_align, '화자·독백 판별(OpenAI + ocx, 일치한 턴만)', limit_usd=5.0)
    align.add_argument('--per-book', type=int, default=6, help='hp: 권마다 판별할 덩어리 수')
    align.add_argument('--first', choices=('openai', 'ocx'), default='openai', help='첫 판별 경로(둘째는 항상 ocx)')
    align.add_argument('--workers', type=int, default=6, help='회차 하나의 청크를 동시에 부르는 수')
    align.add_argument('--episodes', type=int, default=3, help='동시에 판별하는 회차 수')
    command('build-sets', cmd_build_sets, '문항 생성(호출 없음)')
    command('review', cmd_review, '검수 표본(호출 없음)')
    for name, handler, help_ in (('estimate', cmd_estimate, '예상 금액(호출 없음)'), ('run', cmd_run, '실제 호출(비용 승인 뒤에만)')):
        p = command(name, handler, help_, limit_usd=35.0)
        p.add_argument('--sets', default=','.join(KEYS), help='쉼표로: 1,2,3n,3m,4')
        p.add_argument('--limit', type=int, default=None, help='세트마다 앞의 N문항만(시험 실행)')
        p.add_argument('--judge', choices=('openai', 'ocx'), default='ocx', help='채점 경로(ocx는 금액 0)')
        if name == 'run':
            p.add_argument('--via', choices=('openai', 'ocx'), default='openai', help='생성(서비스 함수) 호출 경로')
            p.add_argument('--variant', default=None, help='입력 구성 후보(orig_variants.VARIANTS)')
            p.add_argument('--tag', default=None, help='실행 기록 이름(후보 없이 채택한 서비스 구성으로 다시 잴 때 B 등, 기본 A)')
            p.add_argument('--workers', type=int, default=12)
    report = command('report', cmd_report, 'results/orig-*.json(집계만)')
    report.add_argument('--variant', default=None)
    report.add_argument('--tag', default=None)
    export = command('export', cmd_export, '공개 세트 문항을 LLMOps 평가 세트 형식으로(호출 없음)', corpus=False)
    export.add_argument('--per-set', type=int, default=12, help='세트·라이선스 묶음마다 내보낼 문항 수')
    compare = command('compare', cmd_compare, '후보와 기준선(A)의 짝 비교(호출 없음)')
    compare.add_argument('--variant', required=True)
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == '__main__':
    main()
