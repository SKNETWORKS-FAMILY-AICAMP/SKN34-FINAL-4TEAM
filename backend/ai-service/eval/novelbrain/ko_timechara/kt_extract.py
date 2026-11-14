"""KoTimeChara 추출 실행: 회차마다 ① 정답표(사건·참여·목격), ② 세계관(인물·기억·사건·관계)을 서로 다른 호출로 뽑고,
③ 앞 회차 사건을 나중에 전해 들은 인물을 뽑는다. 라운드 1은 ①·②를, 라운드 2는 ③을 한꺼번에 낸다.

    cd backend/ai-service
    set -a; . <저장소 루트 .env>; set +a
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_extract.py [--mode=sync|batch] [작품 id …]

결과는 `KT/works/<id>/{knowledge.jsonl,world.json,extract_stats.json}`(git 무시)에 쓰고 화면에는 집계만 낸다.
"""

import json
import sys
from collections import Counter
from pathlib import Path

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다(스크립트로 실행할 때 eval/novelbrain을 찾는다)
from batch import Round, cost_report, plan_for, run_rounds
from kt_common import KT
from kt_exec import load_works, make_executor, make_llm
from kt_label import (LABEL_INSTRUCTIONS, LABEL_TOKENS, LEARN_INSTRUCTIONS, LEARN_TOKENS, EpisodeLabel, LearnedLabel, build_knowledge,
                      learned_input, verify_episode, verify_learned)
from kt_text import canonical_names
from kt_world import WORLD_INSTRUCTIONS, WORLD_TOKENS, WorldOut, build_world, save_world, validate_world

EMPTY_WORLD = {'characters': {}, 'events': [], 'relations': []}


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
        canon = canonical_names(names, text)
        knowledge = build_knowledge({r['episode']: r['events'] for r in mine}, {r['episode']: r['learned'] for r in mine if r['learned']}, canon)
        folder = root / wid
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'knowledge.jsonl').write_text(''.join(json.dumps(k, ensure_ascii=False) + '\n' for k in knowledge))
        save_world(folder / 'world.json', build_world(wid, {r['episode']: r['world'] for r in mine}, canon))
        (folder / 'extract_stats.json').write_text(json.dumps(summarize_extraction(mine), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    mode = next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--mode=')), 'sync')
    chosen = load_works([a for a in sys.argv[1:] if not a.startswith('--')] or None)
    llm = make_llm()
    tasks = [(wid, e['number']) for wid, work in chosen.items() for e in work['episodes']]
    print(f'작품 {len(chosen)}편 · 회차 {len(tasks)}개 · 방식 {mode} · 장부 ${llm.cost.spent():.3f}', flush=True)
    done = run_rounds(tasks, extractor(chosen), llm, make_executor(llm, mode), plan=plan_for(llm, mode))
    finish(chosen, done, KT / 'works')
    for wid in chosen:
        stats = json.loads((KT / 'works' / wid / 'extract_stats.json').read_text())
        label = stats['label']
        print(f"{wid} 사건 {label.get('kept', 0)}/{label.get('events', 0)} · 인물 근거 {label.get('refs_kept', 0)}/{label.get('refs', 0)} · "
              f"전해 들음 {stats['learn'].get('learned_kept', 0)}/{stats['learn'].get('learned', 0)} · 근거 통과율 "
              f"{stats['evidence_pass_rate']:.3f} · 세계관 인물 {stats['world'].get('characters', 0)} 사건 {stats['world'].get('events', 0)} "
              f"관계 {stats['world'].get('relations', 0)} · 영구 실패 {stats['failed']}")
    cost_report(llm)
