"""원문 기반 시뮬레이션 평가 세트 ①~⑤ 실행기. 설계·규칙은 docs/evaluation/simulation-original.md.

    cd backend/ai-service
    uv run --locked --extra dev python eval/simulation/orig_cli.py collect                       # 공개 세트 원천 수집(호출 0회)
    set -a; . <키 파일>; set +a                                                                   # 이하 OpenAI·ocx 호출(비용 승인 뒤에만, 키 값은 출력하지 않는다)
    uv run --locked --extra dev python eval/simulation/orig_cli.py label --limit-usd 5           # 공개 세트 정답표·세계관(기존 KoTimeChara 추출 그대로)

실행 시작 때 Langfuse 키를 지워 원문이 Langfuse로 가지 않게 한다. 호출은 별도 장부 .data/cost-orig.jsonl로 센다.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from orig_common import COST, ORIG


def no_langfuse() -> None:
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)


def load_works(ids=None) -> dict[str, dict]:
    works = {p.parent.name: json.loads(p.read_text()) for p in sorted((ORIG / 'works').glob('*/work.json'))}
    return {i: works[i] for i in ids} if ids else works


def cmd_collect(args) -> None:
    import orig_collect
    orig_collect.collect()
    for wid, work in load_works().items():
        chars = sum(len(e['text']) for e in work['episodes'])
        print(f"{wid} {work['kind']:7s} {work['title'][:24]:24s} {work['author']} · {work['license']} · 회차 {len(work['episodes'])} · {chars:,}자")


def cmd_label(args) -> None:
    """공개 세트 작품마다 정답표(kt_label)·세계관(kt_world)을 기존 kt_extract 그대로 만든다. 장부·캐시·출력 경로만 이 작업의 것이다."""
    if not os.environ.get('OPENAI_API_KEY'):
        raise SystemExit('OPENAI_API_KEY이(가) 필요하다. 키 파일을 셸에 불러온 뒤 실행한다(값은 출력하지 않는다).')
    no_langfuse()
    from batch import cost_report, make_executor, plan_for, run_rounds
    from llm import usd_llm
    import kt_extract
    works = load_works(args.works or None)
    llm = usd_llm(ORIG / 'cache-label', COST, args.limit_usd)
    tasks = [(wid, e['number']) for wid, work in works.items() for e in work['episodes']]
    print(f"작품 {len(works)}편 · 회차 {len(tasks)}개 · 장부 ${llm.cost.spent():.3f} / 상한 ${args.limit_usd:.2f}", flush=True)
    done = run_rounds(tasks, kt_extract.extractor(works), llm, make_executor(llm, 'sync', ORIG / 'batches'), plan=plan_for(llm, 'sync', args.limit_usd))
    kt_extract.finish(works, done, ORIG / 'works')
    for wid in works:
        stats = json.loads((ORIG / 'works' / wid / 'extract_stats.json').read_text())
        print(f"{wid} 사건 {stats['label'].get('kept', 0)}/{stats['label'].get('events', 0)} · 전해 들음 {stats['learn'].get('learned_kept', 0)} · 근거 통과율 "
              f"{(stats['evidence_pass_rate'] or 0):.3f} · 세계관 인물 {stats['world'].get('characters', 0)} · 영구 실패 {stats['failed']}")
    cost_report(llm)


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description='원문 기반 시뮬레이션 평가 세트 ①~⑤')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('collect', help='공개 세트 원천 수집(호출 없음)').set_defaults(handler=cmd_collect)
    label = sub.add_parser('label', help='공개 세트 정답표·세계관(실제 모델 호출, 장부 상한 안에서)')
    label.set_defaults(handler=cmd_label)
    label.add_argument('--limit-usd', type=float, default=5.0, help='cost-orig 장부 누적 상한(달러)')
    label.add_argument('--works', nargs='*', help='작품 id(기본 전부)')
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == '__main__':
    main()
