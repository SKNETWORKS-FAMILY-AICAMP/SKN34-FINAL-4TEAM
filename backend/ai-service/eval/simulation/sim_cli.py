"""인물 시뮬레이션 턴 속도·품질 성적표 실행기(#642). 설정 A~E는 sim_config.py, 결과 문서는 docs/evaluation/simulation.md.

    cd backend/ai-service
    uv run --locked --extra dev python eval/simulation/sim_cli.py prepare                      # TimeChara 내려받기·표본 고정(호출 없음, 무료)
    uv run --locked --extra dev python eval/simulation/sim_cli.py estimate [--configs A,B,C,D,E] [--suite quality|speed|all]   # 호출 없음
    set -a; . <저장소 루트 .env>; set +a                                                          # 아래부터 OpenAI 호출(비용 승인 뒤에만)
    uv run --locked --extra dev python eval/simulation/sim_cli.py run --suite quality|speed --configs A,B,... --limit-usd 10
    uv run --locked --extra dev python eval/simulation/sim_cli.py report [--suite quality|speed]  # results/*.json → 표

`run`은 시작할 때 Langfuse 키를 지운다: TimeChara 원문이 팀 Langfuse에 남지 않고, 프롬프트도 코드 문자열(운영 production 버전이 아님)로 돈다.
모델은 운영과 같게 .env의 OPENAI_MODEL(gpt-6-luna)이다. 질문·응답·장부는 eval/simulation/.data에만 남고 results/*.json에는 집계만 둔다.
"""

import argparse
import asyncio
import json
import os
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from llm import usd_llm  # noqa: E402
from timechara import TYPES  # noqa: E402

import sim_config as cfg  # noqa: E402
import sim_quality  # noqa: E402
import sim_speed  # noqa: E402
import sim_stats  # noqa: E402
import sim_worlds  # noqa: E402
from app.simulation import prompt, service  # noqa: E402

RESULTS = Path(__file__).resolve().parent / 'results'
CHARS_PER_TOKEN = 3.5   # 영어 JSON 입력의 글자/토큰 비(어림). 예상 금액의 입력 크기에만 쓴다
PARAGRAPH = 600         # 검사·채점 입력에 들어갈 응답 한 문단의 글자 수(어림)
ASSUMED = {'act_in': 8_000, 'check_in': 20_000, 'judge_in': 2_500, 'narrate_in': 8_000}  # prepare 전의 가정 입력 크기(토큰). prepare 뒤에는 실제 입력으로 잰다


def parse_configs(text: str) -> list[str]:
    names = [n.strip().upper() for n in text.split(',') if n.strip()]
    if not names or any(n not in cfg.CONFIGS for n in names):
        raise SystemExit(f'설정은 {",".join(cfg.CONFIGS)} 중에서 쉼표로 고른다: {text!r}')
    return names


def tokens(*parts: str) -> int:
    return int(sum(len(p) for p in parts) / CHARS_PER_TOKEN)


def prepared() -> bool:
    return all(path.exists() for path in (sim_worlds.TC / 'valid.json', sim_worlds.TC / 'utils.py', sim_worlds.DATA / 'sample.json'))


def sample_rows(worlds) -> list[dict]:
    """prepare가 고정한 표본(질문 idx 목록)의 행."""
    by_idx = {r['idx']: r for r in worlds.rows}
    return [by_idx[i] for i in json.loads((sim_worlds.DATA / 'sample.json').read_text())['idx']]


def measure_quality(worlds, rows: list[dict], templates: dict) -> list[dict]:
    """표본마다 운영이 만드는 인물 턴 입력·검사 입력의 크기(토큰, 모델 호출 없음)."""
    sized = []
    for r in rows:
        plan, world, actor, scene = worlds.interview(r)
        asked, extra, _ = service.character_view(plan, world, scene, actor)
        pov = f'limited:{actor.id}'
        check = {**asked, **extra, 'actionStyle': service.action_style(pov, actor), 'checks': service.check_kinds(plan, 'character', pov), 'paragraph': 'x' * PARAGRAPH}
        sized.append({'type': r['data_type'], 'act_in': tokens(prompt.ACT_INSTRUCTIONS, json.dumps(asked)),
                      'check_in': tokens(prompt.CHECK_INSTRUCTIONS, json.dumps(check)),
                      'judge_in': tokens(templates['spatiotemporal'], r['question'], 'x' * PARAGRAPH, r['temporal_label'])})
    return sized


def measure_speed(worlds) -> list[dict]:
    """고정 장면마다 첫 턴의 인물·나레이터·검사 입력 크기(토큰, 모델 호출 없음)."""
    sized = []
    for spec in sim_worlds.SCENES:
        plan, world = worlds.scene(spec)
        scene = service.new_scene(plan)
        asked, extra, _ = service.character_view(plan, world, scene, world.characters[plan.characterIds[0]])
        check = {**asked, **extra, 'checks': service.check_kinds(plan, 'character', 'omniscient'), 'paragraph': 'x' * PARAGRAPH}
        said, _, _ = service.narrator_view(plan, world, scene)
        narrate = {**said, **service.narration_input(plan, world, scene, 'opening', 'omniscient')}
        sized.append({'act_in': tokens(prompt.ACT_INSTRUCTIONS, json.dumps(asked)), 'check_in': tokens(prompt.CHECK_INSTRUCTIONS, json.dumps(check)),
                      'narrate_in': tokens(prompt.NARRATE_INSTRUCTIONS, json.dumps(narrate))})
    return sized


def sizes(per_type: int) -> tuple[list[dict], list[dict], str]:
    """(품질 입력 크기, 속도 입력 크기, 안내). prepare가 끝났으면 실제 입력으로 재고, 아니면 가정값이다."""
    if not prepared():
        note = (f'prepare 전이라 입력 크기는 가정값(act {ASSUMED["act_in"]:,}·check {ASSUMED["check_in"]:,}·judge {ASSUMED["judge_in"]:,}토큰)이다. '
                'prepare를 먼저 실행하면 실제 입력으로 잰다')
        return [{'type': t, **ASSUMED} for t in TYPES for _ in range(per_type)], [dict(ASSUMED)] * len(sim_worlds.SCENES), note
    worlds = sim_worlds.Worlds.load()
    rows = sample_rows(worlds)
    templates, _ = sim_quality.load_inputs(rows)
    return measure_quality(worlds, rows, templates), measure_speed(worlds), '실제 입력 크기로 계산(prepare 한 표본·고정 장면)'


def format_estimate(title: str, rows: dict[str, dict], note: str, limit_usd: float) -> str:
    """설정별 예상 호출 수·금액 표. 재사용하는 설정은 0이고 합계는 실제로 돌리는 설정만 더한다."""
    lines = [f'{title} — {note}']
    for name, row in rows.items():
        if row['reusedFrom']:
            lines.append(f"{name}  {row['reusedFrom']}와 같은 실행(이 경로에서 스위치 효과 없음): 호출·금액 0")
        else:
            lines.append(f"{name}  호출 {', '.join(f'{k} {v:,.0f}' for k, v in row['calls'].items())} → 약 ${row['usd']:.2f}")
    total = sum(row['usd'] for row in rows.values())
    lines.append(f"합계 ${total:.2f}(출력은 호출당 상한으로 센 값, 실제는 이보다 낮다) / 상한 ${limit_usd:.2f}" + (' — 상한을 넘는다' if total > limit_usd else ''))
    return '\n'.join(lines)


def results(suite: str, summaries: dict, ran_as: dict[str, str], meta: dict) -> dict:
    """results/<suite>.json: 돌린 설정(summaries의 키)의 집계만 담고 다른 설정을 재사용한 설정은 None(ranAs가 어느 설정인지 알려 준다). 질문·응답은 없다."""
    return {'suite': suite, **meta, 'ranAs': ran_as, 'configs': {name: summaries.get(name) for name in ran_as}}


def cmd_prepare(args) -> None:
    try:
        sim_worlds.prepare(args.per_type)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'내려받기 실패(HTTP {error.code}): HuggingFace 로그인·약관 동의를 확인한다(토큰은 ~/.cache/huggingface/token). 값은 출력하지 않는다.') from None


def cmd_estimate(args) -> None:
    configs = parse_configs(args.configs)
    quality, speed, note = sizes(args.per_type)
    for suite, title, inputs in (('quality', f'품질(표본 {len(quality)}문항)', quality), ('speed', f'속도(고정 장면 {len(speed)}개)', speed)):
        if args.suite in ('all', suite):
            print(format_estimate(title, cfg.estimate(suite, configs, inputs), note, args.limit_usd), '\n', sep='\n')


def cmd_run(args) -> None:
    for name in ('OPENAI_API_KEY', 'OPENAI_MODEL'):
        if not os.environ.get(name):
            raise SystemExit(f'{name}이(가) 필요하다(모델은 운영과 같은 gpt-6-luna). 저장소 루트 .env를 셸에 불러온 뒤 실행한다.')
    if not prepared():
        raise SystemExit('prepare를 먼저 실행한다(표본·고정 장면 입력이 없다).')
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)  # 원문이 Langfuse로 가지 않게, 프롬프트는 코드 문자열로
    configs = parse_configs(args.configs)
    cmd_estimate(argparse.Namespace(configs=args.configs, suite=args.suite, per_type=args.per_type, limit_usd=args.limit_usd))
    worlds = sim_worlds.Worlds.load()
    llm = usd_llm(sim_worlds.DATA / 'cache', sim_worlds.DATA / 'cost.jsonl', args.limit_usd)
    ran_as = cfg.plan_runs(configs, args.suite)
    meta, runs = {'model': os.environ['OPENAI_MODEL'], 'judge': llm.model}, sim_worlds.DATA / 'runs'
    if args.suite == 'quality':
        rows = sample_rows(worlds)
        templates, personalities = sim_quality.load_inputs(rows)
        by_source = {}
        for name in dict.fromkeys(ran_as.values()):
            with cfg.applied(name):
                by_source[name] = sim_quality.run_quality(rows, worlds, llm, templates, personalities, args.limit_usd, args.workers, runs / f'quality-{name}.jsonl')
        meta |= {'seed': sim_worlds.SEED, 'questions': len(rows), 'paired': sim_stats.paired_quality(by_source), 'usd': llm.cost.spent()}
        data = results('quality', {name: sim_stats.summarize_quality(records) for name, records in by_source.items()}, ran_as, meta)
    else:
        async def play() -> dict:  # 한 이벤트 루프에서 설정을 차례로 돈다(연출 분류기의 HTTP 연결이 루프에 묶인다)
            done = {}
            for name in dict.fromkeys(ran_as.values()):
                with cfg.applied(name):
                    done[name] = await sim_speed.run_speed(sim_worlds.SCENES, worlds, llm.cost, args.limit_usd, runs / f'speed-{name}.jsonl')
            return done

        by_source = asyncio.run(play())
        data = results('speed', {name: sim_stats.summarize_speed(records) for name, records in by_source.items()}, ran_as,
                       {**meta, 'scenes': len(sim_worlds.SCENES), 'usd': llm.cost.spent()})
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'{args.suite}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"{args.suite} 결과를 results/{args.suite}.json에 썼다(비용 장부 합계 ${llm.cost.spent():.2f})")


def cmd_report(args) -> None:
    for suite, table in (('quality', sim_stats.quality_table), ('speed', sim_stats.speed_table)):
        if args.suite not in ('all', suite):
            continue
        path = RESULTS / f'{suite}.json'
        if not path.exists():
            print(f'{suite}: 결과 없음(run 전)')
            continue
        data = json.loads(path.read_text())
        print(f"## {suite} (모델 {data['model']}, 채점 {data.get('judge', '-')}, 비용 ${data['usd']:.2f})\n\n{table(data)}\n")
        for pair, found in data.get('paired', {}).items():
            print(f"짝 비교 {pair}(최종 시공간): 앞만 맞음 {found['a_only']}·뒤만 맞음 {found['b_only']}, p={found['p']:.3f}")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description='인물 시뮬레이션 턴 속도·품질 성적표(#642)')
    sub = parser.add_subparsers(dest='command', required=True)
    for name, handler, helper in (('prepare', cmd_prepare, 'TimeChara 내려받기·표본 고정(호출 없음)'), ('estimate', cmd_estimate, '예상 호출 수·금액(호출 없음)'),
                                  ('run', cmd_run, '실제 OpenAI 호출(비용 승인 뒤에만)'), ('report', cmd_report, 'results/*.json → 표')):
        command = sub.add_parser(name, help=helper)
        command.set_defaults(handler=handler)
        command.add_argument('--per-type', type=int, default=sim_worlds.PER_TYPE, help='유형마다 표본 수(기본 50)')
        if name in ('estimate', 'run'):
            command.add_argument('--configs', default=','.join(cfg.CONFIGS), help='설정 A~E를 쉼표로(기본 모두)')
            command.add_argument('--limit-usd', type=float, default=10.0, help='금액 상한(달러)')
        if name == 'run':
            command.add_argument('--suite', choices=('quality', 'speed'), required=True)
            command.add_argument('--workers', type=int, default=12, help='품질 질문을 동시에 돌리는 수(속도는 장면을 순서대로)')
        elif name != 'prepare':
            command.add_argument('--suite', choices=('quality', 'speed', 'all'), default='all')
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == '__main__':
    main()
