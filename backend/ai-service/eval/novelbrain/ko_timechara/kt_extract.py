"""KoTimeChara 추출 실행: 회차마다 ① 정답표(사건·참여·목격), ② 세계관(인물·기억·사건·관계)을 서로 다른 호출로 뽑고,
③ 앞 회차 사건을 나중에 전해 들은 인물을 뽑는다. 라운드 1은 ①·②를, 라운드 2는 ③을 한꺼번에 낸다.

    cd backend/ai-service
    set -a; . <저장소 루트 .env>; set +a
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_extract.py [--mode=sync|batch] [작품 id …]

유료 OpenAI 키·Batch 대신 로컬 게이트웨이(구독 경로, 실지출 0)로 새 작품만 추출하려면 작품 id를 직접 주고 모델·이름·금액 상한을 준다(OPENAI_API_KEY는 필요 없다):
    env -u OPENAI_API_KEY -u LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_extract.py \
        --gen-model=gpt-6-luna [--gen-effort=low] --name=<이름> --limit-usd=5 [--workers=6] n01 n02 …
응답 캐시는 KT/cache-<이름>, 장부는 KT/cost-<이름>.jsonl(정가 환산 금액)이고, 이미 추출 결과가 있는 작품은 --overwrite 없이는 다시 쓰지 않는다.

결과는 `KT/works/<id>/{knowledge.jsonl,world.json,extract_stats.json}`(git 무시)에 쓰고 화면에는 집계만 낸다.
"""

import argparse
import json
from collections import Counter
from itertools import combinations
from pathlib import Path

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다(스크립트로 실행할 때 eval/novelbrain을 찾는다)
from batch import Round, SyncExecutor, cost_report, plan_for, run_rounds
from kt_common import KT
from kt_exec import EFFORTS, load_works, make_executor, make_gen_llm, make_llm
from kt_label import (LABEL_INSTRUCTIONS, LABEL_TOKENS, LEARN_INSTRUCTIONS, LEARN_TOKENS, EpisodeLabel, LearnedLabel, build_knowledge,
                      learned_input, verify_episode, verify_learned)
from kt_text import canonical_names
from kt_world import WORLD_INSTRUCTIONS, WORLD_TOKENS, WorldOut, build_world, save_world, validate_world

EMPTY_WORLD = {'characters': {}, 'events': [], 'relations': []}
OUTPUTS = ('knowledge.jsonl', 'world.json', 'extract_stats.json')   # 작품 폴더에 쓰는 추출 결과


def extractor(works: dict):
    """run_rounds용 work(task, llm). task = (작품 id, 회차 번호). 전해 들은 인물 호출은 앞 회차 라벨이 모두 있어야 낼 수 있어 2라운드가 된다."""
    def work(task, llm):
        wid, n = task
        texts = {e['number']: e['text'] for e in works[wid]['episodes']}
        step = Round()
        labels = {m: step.get(lambda m=m: llm.ask('label', LABEL_INSTRUCTIONS, texts[m], schema=EpisodeLabel, max_output_tokens=LABEL_TOKENS))
                  for m in range(1, n + 1)}
        world, world_failed = step.get(lambda: llm.ask('world', WORLD_INSTRUCTIONS, texts[n], schema=WorldOut, max_output_tokens=WORLD_TOKENS))
        step.done()
        events = {m: verify_episode(texts[m], out, m)[0] if out else [] for m, (out, _) in labels.items()}
        own_events, label_stats = verify_episode(texts[n], labels[n][0], n) if labels[n][0] else ([], Counter())
        earlier = [e for m in range(1, n) for e in events[m]]
        learned, learn_stats, learn_failed = [], Counter(), False
        if earlier:
            out, learn_failed = step.get(lambda: llm.ask('learn', LEARN_INSTRUCTIONS, learned_input(texts[n], earlier), schema=LearnedLabel,
                                                         max_output_tokens=LEARN_TOKENS))
            step.done()
            if out:
                learned, learn_stats = verify_learned(texts[n], out, {e['id']: e for e in earlier}, n)
        world_data, world_stats = validate_world(texts[n], world) if world else (EMPTY_WORLD, Counter())
        return {'work': wid, 'episode': n, 'events': own_events, 'learned': learned, 'world': world_data,
                'stats': {'label': dict(label_stats), 'learn': dict(learn_stats), 'world': dict(world_stats)},
                'failed': {'label': labels[n][1], 'learn': learn_failed, 'world': world_failed}}
    return work


def summarize_extraction(records: list[dict]) -> dict:
    """라벨·전해 들은 인물·세계관 집계와 근거 대조 통과율(통과한 근거 수 / 확인한 근거 수), 영구 실패 수."""
    total = {part: Counter() for part in ('label', 'learn', 'world')}
    failed = Counter({part: 0 for part in total})
    for r in records:
        for part in total:
            total[part].update(r['stats'][part])
            failed[part] += r['failed'][part]
    checked = total['label']['evidence_checked'] + total['learn']['evidence_checked']
    passed = total['label']['evidence_ok'] + total['learn']['evidence_ok']
    return {**{part: dict(counter) for part, counter in total.items()}, 'failed': dict(failed), 'evidence_checked': checked,
            'evidence_ok': passed, 'evidence_pass_rate': passed / checked if checked else None}


def finish(works: dict, records: list[dict], root: Path) -> None:
    """작품마다 이름을 하나로 맞춘 뒤(두 추출물이 같은 `canonical_names`만 쓴다) 지식표·세계관·집계를 root/<작품 id>/에 쓴다."""
    for wid, work in works.items():
        mine = sorted((r for r in records if r and r['work'] == wid), key=lambda r: r['episode'])
        text = '\n'.join(e['text'] for e in work['episodes'])
        names = ({p['name'] for r in mine for e in r['events'] for p in e['participants'] + e['witnesses']}
                 | {item['learner'] for r in mine for item in r['learned']} | {n for r in mine for n in r['world']['characters']})
        apart = [pair for r in mine for e in r['events'] for pair in combinations([p['name'] for p in e['participants'] + e['witnesses']], 2)]
        canon = canonical_names(names, text, apart)   # 같은 사건에 따로 올라온 이름은 다른 사람이라 묶지 않는다
        knowledge = build_knowledge({r['episode']: r['events'] for r in mine}, {r['episode']: r['learned'] for r in mine if r['learned']}, canon,
                                    {r['episode'] for r in mine if r['failed']['learn']})
        folder = root / wid
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'knowledge.jsonl').write_text(''.join(json.dumps(k, ensure_ascii=False) + '\n' for k in knowledge))
        save_world(folder / 'world.json', build_world(wid, {r['episode']: r['world'] for r in mine}, canon))
        (folder / 'extract_stats.json').write_text(json.dumps(summarize_extraction(mine), ensure_ascii=False, indent=2))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    parser.add_argument('ids', nargs='*', help='작품 id(기본: works/ 전체, --gen-model은 필수)')
    parser.add_argument('--mode', choices=('sync', 'batch'), default='sync')
    parser.add_argument('--gen-model', help='게이트웨이 모델 id(kt_exec.GEN_RATES): OpenAI 키·Batch 없이 로컬 게이트웨이(구독 경로)로 추출한다')
    parser.add_argument('--gen-effort', choices=EFFORTS, help='응답 호출의 reasoning.effort(없으면 모델 기본, 응답 캐시 열쇠에 들어간다)')
    parser.add_argument('--name', help='게이트웨이 실행 이름: 응답 캐시 cache-<이름>·장부 cost-<이름>.jsonl')
    parser.add_argument('--limit-usd', type=float, help='게이트웨이 장부의 금액 상한(달러, 정가 환산)')
    parser.add_argument('--workers', type=int, default=6, help='게이트웨이 동시 호출 수(기본 6 = 일반 실행기 12의 절반)')
    parser.add_argument('--overwrite', action='store_true', help='이미 추출 결과가 있는 작품도 다시 쓴다(게이트웨이 실행의 보호를 푼다)')
    args = parser.parse_args(argv)
    if args.gen_model and (args.mode != 'sync' or not args.ids or not args.name or args.limit_usd is None):
        raise SystemExit('--gen-model은 동기(--mode=sync)로만, 작품 id와 --name·--limit-usd를 함께 준다(Batch는 OpenAI 키를 쓰고, id 없이는 기존 작품을 다시 쓸 수 있다).')
    return args


def check_targets(ids: list[str], root: Path, overwrite: bool = False) -> None:
    """이미 추출 결과(knowledge.jsonl·world.json·extract_stats.json)가 있는 작품은 --overwrite 없이는 다시 쓰지 않는다(호출 전에 멈춘다)."""
    done = [wid for wid in ids if any((root / wid / name).exists() for name in OUTPUTS)]
    if done and not overwrite:
        raise SystemExit(f"추출 결과가 이미 있는 작품은 다시 쓰지 않는다(--overwrite로만): {', '.join(done)}")


def build(args: argparse.Namespace):
    """(llm, executor, plan): 게이트웨이 실행은 구독 경로의 Llm과 스레드 실행기(--workers), 아니면 예전과 같은 OpenAI Llm·실행기."""
    if args.gen_model:
        check_targets(args.ids, KT / 'works', args.overwrite)
        llm = make_gen_llm(args.gen_model, args.name, args.limit_usd, args.gen_effort)
        return llm, SyncExecutor(llm, args.workers), plan_for(llm, 'sync', args.limit_usd)
    llm = make_llm()
    return llm, make_executor(llm, args.mode), plan_for(llm, args.mode)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    chosen = load_works(args.ids or None)
    llm, executor, plan = build(args)
    tasks = [(wid, e['number']) for wid, work in chosen.items() for e in work['episodes']]
    how = f'{llm.model}(게이트웨이)' if args.gen_model else args.mode
    print(f'작품 {len(chosen)}편 · 회차 {len(tasks)}개 · 방식 {how} · 장부 $' f'{llm.cost.spent():.3f}', flush=True)
    done = run_rounds(tasks, extractor(chosen), llm, executor, plan=plan)
    finish(chosen, done, KT / 'works')
    for wid in chosen:
        stats = json.loads((KT / 'works' / wid / 'extract_stats.json').read_text())
        label = stats['label']
        print(f"{wid} 사건 {label.get('kept', 0)}/{label.get('events', 0)} · 인물 근거 {label.get('refs_kept', 0)}/{label.get('refs', 0)} · "
              f"전해 들음 {stats['learn'].get('learned_kept', 0)}/{stats['learn'].get('learned', 0)} · 근거 통과율 "
              f"{stats['evidence_pass_rate']:.3f} · 세계관 인물 {stats['world'].get('characters', 0)} 사건 {stats['world'].get('events', 0)} "
              f"관계 {stats['world'].get('relations', 0)} · 영구 실패 {stats['failed']}")
    cost_report(llm)


if __name__ == '__main__':
    main()
