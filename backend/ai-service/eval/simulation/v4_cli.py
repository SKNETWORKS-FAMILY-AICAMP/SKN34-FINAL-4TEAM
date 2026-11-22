"""V4(초안 → 병렬 수정) 비교 실행기: 같은 장면 묶음을 세 조건(base·P1+N3 = 지금의 턴 방식, v4 = 초안 → 병렬 수정)으로 돌리고 채점·집계한다(평가 전용, app/ 변경 없음).

    cd backend/ai-service
    set -a; . <키 파일>; set +a         # ocx 실행도 연출(Decisions)은 OpenAI API라 키가 필요하다(값은 출력하지 않는다)
    uv run --locked --extra dev python eval/simulation/v4_cli.py run --cond base P1+N3 v4 --rounds 10 --via ocx --workers 8 [--limit-usd 35]
    uv run --locked --extra dev python eval/simulation/v4_cli.py judge --cond base P1+N3 v4 --via ocx         # 장면 채점(ocx, 금액 0)
    uv run --locked --extra dev python eval/simulation/v4_cli.py report --cond base P1+N3 v4 --via ocx        # results/v4-hp-<via>.json(집계만)
    uv run --locked --extra dev python eval/simulation/v4_cli.py run --cond base v4 --rounds 1 --via openai --workers 1   # 실제 속도(OpenAI, 장면을 차례로)

--via ocx: 생성·수정·검사는 로컬 OpenCodex(금액 0)로 돌고 연출(Decisions)만 OpenAI다. 지연이 OpenAI와 달라 속도는 참고용이다. 나레이션 검사는 끈다(전지적 나레이션 검사는 입력이 커서
세 조건 모두 SIMULATION_SKIP_NARRATION_CHECK=1이고 --narration-check로 켠다). 기록은 .data/orig/hp/v4/<조건>-<via>.jsonl(글 포함, 이어 받기), 집계는 results/에 숫자만 둔다.
"""

import argparse
import asyncio
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from orig_cli import need_openai, no_langfuse
from orig_common import COST, ORIG, RESULTS

V4DIR = ORIG / 'hp' / 'v4'
IDS = ('hp-1-if', 'hp-1-flow', 'hp-2-if', 'hp-3-flow', 'hp-3-if', 'hp-4-flow', 'hp-5-if', 'hp-5-flow')
CONDITIONS = {'base': ('turn', None), 'P1+N3': ('turn', 'P1+N3'), 'P1': ('turn', 'P1'), 'N3': ('turn', 'N3'), 'P1b+N3': ('turn', 'P1b+N3'), 'P1b': ('turn', 'P1b'), 'v4': ('v4', None)}   # 조건 → (엔진, 평가 때 끼우는 후보)


class OcxCost:
    """ocx로 도는 생성·검사 호출은 금액 0이라 장부에 넣지 않고, OpenAI로 도는 연출(director) 호출만 센다."""

    def __init__(self, cost):
        self.cost = cost

    def record(self, kind: str, tokens_in: int, tokens_out: int, **kwargs) -> float:
        return self.cost.record(kind, tokens_in, tokens_out, **kwargs) if kind == 'director' else 0.0

    def spent(self) -> float:
        return self.cost.spent()


def records_path(cond: str, via: str) -> Path:
    return V4DIR / f"{cond.replace('+', '_')}-{via}.jsonl"


def grades_path(cond: str, via: str) -> Path:
    return records_path(cond, via).with_suffix('.grades.jsonl')


def read_jsonl(path: Path) -> dict[str, dict]:
    return {r['id']: r for r in map(json.loads, path.read_text().splitlines())} if path.exists() else {}


def round_of(scene_id: str) -> int:
    """장면 id의 회차: 첫 번째는 id 그대로(1), 이후는 id#k(k)."""
    return int(scene_id.partition('#')[2] or 1)


def select(records: dict[str, dict], ids, rounds: int) -> dict[str, dict]:
    """기록 중 이름이 ids에 있는 장면의 처음 rounds번까지만(추가로 더 돈 회차가 같은 묶음 비교에 섞이지 않게)."""
    return {i: r for i, r in records.items() if i.partition('#')[0] in ids and round_of(i) <= rounds}


def use_ocx_for_generation() -> None:
    """이 프로세스의 act·나레이션·검사·초안 호출만 ocx로 보낸다. 환경변수는 그대로라 연출(Decisions)은 OpenAI API로 간다. 키는 ocx용 더미를 쓴다."""
    import sim_via
    from app.simulation import agent
    agent.OpenAI = lambda **options: sim_via.client(**{**options, 'api_key': 'ocx'})


def scene_specs(ids, rounds: int) -> list[dict]:
    import orig_run
    import sim_worlds
    return orig_run.repeated([s for s in sim_worlds.SCENES if s['id'] in ids], rounds)


async def play(cond: str, specs: list[dict], worlds, cost, args) -> int:
    """조건 하나의 장면들을 돌려 끝난 것부터 기록한다(이미 있는 장면은 건너뛴다). 새로 돈 장면 수를 돌려준다."""
    import sim_speed
    import sim_v4
    from llm import CallCapExceeded
    engine, _ = CONDITIONS[cond]
    out = records_path(cond, args.via)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = read_jsonl(out)
    todo = [s for s in specs if s['id'] not in done]
    scenes, model_limit, file_lock, world_lock = asyncio.Semaphore(args.workers), asyncio.Semaphore(args.concurrency), asyncio.Lock(), asyncio.Lock()
    billed = cost if args.via == 'openai' else OcxCost(cost)

    async def one(spec: dict) -> None:
        async with scenes:
            if cost.spent() + sim_speed.SCENE_RESERVE_USD > args.limit_usd:
                raise CallCapExceeded(f'비용 상한 {args.limit_usd:.2f}달러에 가까워졌다. 같은 명령으로 이어 받는다.')
            async with world_lock:
                plan, world = await asyncio.to_thread(worlds.scene, spec)
            if engine == 'v4':
                record = await sim_v4.run_v4_scene(spec, plan, world, model_limit)
                for call in record['calls']:
                    billed.record(call['name'], call['inputTokens'] or 0, call['outputTokens'] or 0, failed=call['failed'])
            else:
                record = await sim_speed.run_scene(spec, plan, world, billed, transcript=True)
        async with file_lock:
            with out.open('a') as file:
                file.write(json.dumps(record, ensure_ascii=False) + '\n')
            stop = f":{record['stopReason']}" if record.get('stopReason') else ''
            print(f"{cond} {record['id']}: {record['status']}{stop} · {len(record['turns'])}턴 · 호출 {len(record['calls'])} · 직렬 {record['serialSteps']} · {record['elapsedMs'] / 1000:.0f}초", flush=True)

    results = await asyncio.gather(*[one(s) for s in todo], return_exceptions=True)
    if cap := next((r for r in results if isinstance(r, CallCapExceeded)), None):
        raise cap
    if error := next((r for r in results if isinstance(r, BaseException)), None):
        raise error
    return len(todo)


def cmd_run(args) -> None:
    need_openai()
    no_langfuse()
    import orig_variants
    import sim_v4
    import sim_worlds
    from cost import CostLog
    if args.narration_check:   # 환경에 남아 있던 생략 설정도 푼다
        os.environ.pop('SIMULATION_SKIP_NARRATION_CHECK', None)
    else:
        os.environ['SIMULATION_SKIP_NARRATION_CHECK'] = '1'
    if args.via == 'ocx':
        use_ocx_for_generation()
    cost, worlds, specs = CostLog(COST), sim_worlds.Worlds([], {}, sim_worlds.load_hp()), scene_specs(args.ids.split(','), args.rounds)

    async def conditions() -> None:   # 한 이벤트 루프에서 차례로(연출 분류기의 HTTP 연결이 루프에 묶여 조건마다 루프를 새로 만들면 닫힌 루프 오류가 난다)
        for cond in args.cond:
            engine, variant = CONDITIONS[cond]
            with sim_v4.revising() if engine == 'v4' else orig_variants.patched(variant):
                ran = await play(cond, specs, worlds, cost, args)
            print(f'{cond}: 새로 {ran}장면 · 장부 {cost.spent():.2f}달러 / 상한 {args.limit_usd:.2f}달러', flush=True)

    asyncio.run(conditions())


def cmd_judge(args) -> None:
    import sim_scene_judge
    import sim_via
    import sim_worlds
    no_langfuse()
    worlds = sim_worlds.Worlds([], {}, sim_worlds.load_hp())
    scenes = {s['id']: worlds.scene(s) for s in sim_worlds.SCENES if s['id'] in args.ids.split(',')}
    llm = sim_via.ocx_llm(ORIG / 'cache-judge-scene-ocx', COST)

    def judge(record: dict) -> dict:
        plan, world = scenes[record['id'].split('#')[0]]
        grade = sim_scene_judge.judge_scene(llm, sim_scene_judge.scene_payload(plan, world, record)) if len(record['turns']) >= 2 else None
        return {'id': record['id'], 'grade': grade}

    for cond in args.cond:
        records, done = select(read_jsonl(records_path(cond, args.via)), scenes, 10 ** 6), read_jsonl(grades_path(cond, args.via))   # --ids의 장면만(없는 장면은 채점 입력을 못 만든다)
        todo = [r for i, r in records.items() if i not in done]
        with ThreadPoolExecutor(args.workers) as pool, grades_path(cond, args.via).open('a') as file:
            for graded in pool.map(judge, todo):
                file.write(json.dumps(graded, ensure_ascii=False) + '\n')
        grades = read_jsonl(grades_path(cond, args.via))
        print(f"{cond}: 채점 {sum(g['grade'] is not None for g in grades.values())}/{len(records)}장면(실패·건너뜀 {sum(g['grade'] is None for g in grades.values())})", flush=True)


def cmd_report(args) -> None:
    import v4_report
    ids = args.ids.split(',')
    records = {cond: list(select(read_jsonl(records_path(cond, args.via)), ids, args.rounds).values()) for cond in args.cond}
    grades = {cond: {i: g['grade'] for i, g in select(read_jsonl(grades_path(cond, args.via)), ids, args.rounds).items()} for cond in args.cond}
    summary = {'via': args.via, 'ids': ids, 'rounds': args.rounds, **v4_report.build_summary(records, grades)}
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"v4-hp-{args.via}{args.suffix}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    for cond, s in summary['conditions'].items():
        m = s['mean']
        print(f"{cond}: {s['n']}장면 · 완료 {s['completed']['k']}/{s['n']} {s['stops']} · 종합 {m['overall']['mean']} 계획 {m['plan']['mean']} 말투 {m['voice']['mean']} · 누설 턴 {s['leakTurnRate']} · "
              f"호출 {s['calls']['mean']} 직렬 {s['serialSteps']['mean']} · 경과 p50 {s['elapsedMs']['p50']} 첫 턴 p50 {s['firstTurnMs']['p50']}")
    print(f'{path.name}: {path.stat().st_size:,}바이트')


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    for name, handler, help_ in (('run', cmd_run, '장면 실행(유료 키 필요)'), ('judge', cmd_judge, '장면 채점(ocx)'), ('report', cmd_report, '집계(호출 없음)')):
        p = sub.add_parser(name, help=help_)
        p.set_defaults(handler=handler)
        p.add_argument('--cond', nargs='+', choices=sorted(CONDITIONS), default=sorted(CONDITIONS))
        p.add_argument('--via', choices=('ocx', 'openai'), default='ocx')
        p.add_argument('--ids', default=','.join(IDS), help='장면 id(쉼표)')
        if name == 'judge':
            p.add_argument('--workers', type=int, default=8)
        if name == 'report':
            p.add_argument('--rounds', type=int, default=10, help='처음 N회차까지만 집계한다(추가로 더 돈 회차는 따로 --suffix로)')
            p.add_argument('--suffix', default='', help='결과 파일 이름 끝(v4-hp-<via><suffix>.json)')
        if name == 'run':
            p.add_argument('--rounds', type=int, default=10, help='같은 장면을 N번(2번째부터 id에 #k)')
            p.add_argument('--workers', type=int, default=8, help='동시에 도는 장면 수')
            p.add_argument('--concurrency', type=int, default=16, help='V4가 한꺼번에 보내는 모델 호출 수')
            p.add_argument('--limit-usd', type=float, default=35.0)
            p.add_argument('--narration-check', action='store_true', help='전지적 나레이션 검사를 켠다(입력이 커서 기본은 끈다)')
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    main()
