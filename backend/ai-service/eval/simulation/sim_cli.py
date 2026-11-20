"""인물 시뮬레이션 턴 속도·품질 성적표 실행기(#642). 설정 A~E는 sim_config.py, 결과 문서는 docs/evaluation/simulation.md.

    cd backend/ai-service
    uv run --locked --extra dev python eval/simulation/sim_cli.py prepare                      # TimeChara 내려받기·표본 고정(호출 없음, 무료)
    uv run --locked --extra dev python eval/simulation/sim_cli.py estimate [--configs A,B,C,D,E] [--suite quality|speed|all]   # 호출 없음
    set -a; . <저장소 루트 .env>; set +a                                                          # 아래부터 OpenAI 호출(비용 승인 뒤에만)
    uv run --locked --extra dev python eval/simulation/sim_cli.py run --suite quality|speed --configs A,B,... --limit-usd 10
    uv run --locked --extra dev python eval/simulation/sim_cli.py report [--suite quality|speed]  # results/*.json → 표
    # 해리 포터 원문 기반 세계관(.data/hp/raw에 푼 번역본 → .data/hp/world.json). 저작권 때문에 모두 .data(git 무시)에만 둔다
    uv run --locked --extra dev python eval/simulation/sim_cli.py build-hp [--limit-usd 18] [--via openai|ocx]   # 실제 모델 호출(장부 누적 상한 안에서, 끝낸 호출은 캐시)
    uv run --locked --extra dev python eval/simulation/sim_cli.py show-hp                                           # preview.md(호출 없음)
    uv run --locked --extra dev python eval/simulation/sim_cli.py seed-hp [--base-url http://localhost:5173]       # 로컬 스택에 배치 적재(호출 없음, 로컬만)

`run`은 시작할 때 Langfuse 키를 지운다: TimeChara 원문이 팀 Langfuse에 남지 않고, 프롬프트도 코드 문자열(운영 production 버전이 아님)로 돈다.
모델은 운영과 같게 .env의 OPENAI_MODEL(gpt-6-luna)이다. 질문·응답·장부는 eval/simulation/.data에만 남고 results/*.json에는 집계만 둔다.
"""

import argparse
import asyncio
import json
import math
import os
import sys
import urllib.error
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from llm import CallCapExceeded, usd_llm  # noqa: E402
from timechara import TYPES  # noqa: E402

import hp_build  # noqa: E402
import hp_chapters  # noqa: E402
import sim_config as cfg  # noqa: E402
import sim_quality  # noqa: E402
import sim_speed  # noqa: E402
import sim_stats  # noqa: E402
import sim_via  # noqa: E402
import sim_worlds  # noqa: E402
from app.simulation import prompt, service  # noqa: E402

RESULTS = Path(__file__).resolve().parent / 'results'
CHARS_PER_TOKEN = 3.5   # 영어 JSON 입력의 글자/토큰 비(어림). 예상 금액의 입력 크기에만 쓴다
PARAGRAPH = 600         # 검사·채점 입력에 들어갈 응답 한 문단의 글자 수(어림)
ASSUMED = {'act_in': 8_000, 'check_in': 20_000, 'judge_in': 2_500, 'narrate_in': 8_000}  # prepare 전의 가정 입력 크기(토큰). prepare 뒤에는 실제 입력으로 잰다
HP_ASSUMED = {'act_in': 40_000, 'check_in': 60_000, 'judge_in': 2_500, 'narrate_in': 40_000}  # 원문 기반 세계관을 만들기 전의 가정(인물 기억·관계가 길다). 만든 뒤에는 실제 입력으로 잰다
HP_QUESTIONS = 150  # 해리 포터 TimeChara 질문 수(가정 입력용)


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


def question_rows(worlds, world: str) -> list[dict]:
    """품질 질문: thin은 prepare가 고정한 표본, hp는 해리 포터 질문 전부(원문 기반 세계관은 해리 포터만 있다)."""
    return [r for r in worlds.rows if r['series'] == sim_worlds.HP] if world == 'hp' else sample_rows(worlds)


def sizes(per_type: int, world: str = 'thin') -> tuple[list[dict], list[dict], str]:
    """(품질 입력 크기, 속도 입력 크기, 안내). prepare(hp는 world.json도)가 끝났으면 실제 입력으로 재고, 아니면 가정값이다."""
    hp = world == 'hp'
    if not prepared() or (hp and not sim_worlds.HP_WORLD.exists()):
        assumed = HP_ASSUMED if hp else ASSUMED
        note = (f'{"world.json(build-hp)·" if hp else ""}prepare 전이라 입력 크기는 가정값(act {assumed["act_in"]:,}·check {assumed["check_in"]:,}·judge {assumed["judge_in"]:,}토큰)이다. '
                '먼저 실행하면 실제 입력으로 잰다')
        questions = [{'type': TYPES[i % len(TYPES)], **assumed} for i in range(HP_QUESTIONS)] if hp else [{'type': t, **assumed} for t in TYPES for _ in range(per_type)]
        return questions, [dict(assumed)] * len(sim_worlds.SCENES), note
    worlds = sim_worlds.Worlds.load(hp=True) if hp else sim_worlds.Worlds.load()
    rows = question_rows(worlds, world)
    templates, _ = sim_quality.load_inputs(rows)
    return measure_quality(worlds, rows, templates), measure_speed(worlds), '실제 입력 크기로 계산(' + ('원문 기반 세계관·해리 포터 질문 전부·고정 장면)' if hp else 'prepare 한 표본·고정 장면)')


def format_build_estimate() -> tuple[str, float]:
    """원문 기반 세계관 build의 예상(호출 없음): 이미 만들었으면 0, 원문이 있으면 장 나눈 글 크기로 잰다."""
    if sim_worlds.HP_WORLD.exists():
        return 'build(원문 → world.json): 이미 만들었다(.data/hp/world.json): 호출·금액 0', 0.0
    raw = sim_worlds.HP_DIR / 'raw'
    if not raw.exists():
        return 'build(원문 → world.json): 원문(.data/hp/raw)이 없어 예상 생략', 0.0
    plan = hp_build.estimate_build([len(u.text) for split in hp_chapters.split_all(raw).values() for u in split.units])
    calls = plan['calls']
    return f"build(원문 → world.json): 추출 {calls['extract']:,}회·이름 {calls['names']:,}회·문서 {calls['docs']:,}회 → 약 ${plan['usd']:.2f}(문서 수는 덩어리마다 6명으로 어림)", plan['usd']


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


def show_estimate(args, configs: list[str], quality: list[dict], speed: list[dict], note: str) -> float:
    """선택한 스위트의 예상 표를 출력하고 예상 합계(달러)를 돌려준다."""
    total = 0.0
    hp = getattr(args, 'world', 'thin') == 'hp'
    for suite, title, inputs in (('quality', f'품질({"해리 포터 질문 전부·원문 기반 세계관" if hp else "표본"} {len(quality)}문항)', quality),
                                 ('speed', f'속도(고정 장면 {len(speed)}개{"·해리 포터 장면은 원문 기반 세계관" if hp else ""})', speed)):
        if args.suite in ('all', suite):
            rows = cfg.estimate(suite, configs, inputs)
            print(format_estimate(title, rows, note, args.limit_usd), end='\n\n')
            total += sum(row['usd'] for row in rows.values())
    return total


def cmd_estimate(args) -> None:
    build = 0.0
    if args.world == 'hp':
        text, build = format_build_estimate()
        print(text, end='\n\n')
    total = show_estimate(args, parse_configs(args.configs), *sizes(args.per_type, args.world))
    if args.world == 'hp':
        print(f'세 가지 합계(build + 품질 + 속도): 약 ${build + total:.2f} / 상한 ${args.limit_usd:.2f}')


def make_llm(args):
    """비용 장부·디스크 캐시가 있는 Llm. ocx(구독 경로)는 금액 0이라 장부 상한과 무관하고 응답 캐시는 OpenAI와 같은 열쇠를 쓴다."""
    if args.via == 'ocx':
        return sim_via.ocx_llm(sim_worlds.DATA / 'cache', sim_worlds.DATA / 'cost.jsonl')
    llm = usd_llm(sim_worlds.DATA / 'cache', sim_worlds.DATA / 'cost.jsonl', args.limit_usd)
    llm.via = 'openai'
    return llm


def money_limit(args) -> float:
    """ocx 호출은 금액이 0이라 상한을 적용하지 않는다."""
    return math.inf if args.via == 'ocx' else args.limit_usd


def continue_with_ocx(stop, command: str) -> SystemExit:
    """OpenAI 상한 때문에 멈췄을 때의 안내: 끝낸 호출·문항은 캐시·결과 파일에 남아 있어 같은 명령을 --via ocx로 이어 받는다."""
    return SystemExit(f'{stop}\n같은 명령 뒤에 --via ocx를 붙여 이어 받는다({command}: 끝낸 호출·문항은 캐시·결과 파일에서 이어 받고, 구독 경로라 금액은 0이며 모델은 게이트웨이의 gpt-6-luna다. '
                      '결과에는 문항마다 via가 남아 openai·ocx가 섞인 것을 알 수 있다).')


def cmd_build_hp(args) -> None:
    if args.via == 'openai' and not os.environ.get('OPENAI_API_KEY'):
        raise SystemExit('OPENAI_API_KEY이(가) 필요하다. 저장소 루트 .env를 셸에 불러온 뒤 실행한다(값은 출력하지 않는다).')
    raw = sim_worlds.HP_DIR / 'raw'
    if not raw.exists():
        raise SystemExit('번역본 원문(.data/hp/raw/<권 폴더>/*.txt)이 없다.')
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)  # 원문이 Langfuse로 가지 않게
    try:
        stats = hp_build.build(make_llm(args), raw, sim_worlds.HP_DIR, sim_worlds.load_rows(), limit_usd=money_limit(args), workers=args.workers)
    except hp_build.LimitReached as stop:
        if args.via == 'ocx':
            raise
        raise continue_with_ocx(stop, 'build-hp') from None
    print(json.dumps(stats, ensure_ascii=False, sort_keys=True))


def cmd_show_hp(args) -> None:
    world = sim_worlds.load_hp()
    path = sim_worlds.HP_DIR / 'preview.md'
    path.write_text(hp_build.preview(world, ['Harry Potter', 'Hermione Granger', 'Severus Snape']), encoding='utf-8')
    print(f'표본을 {path}에 썼다(카드 {len(world["cards"])}개·관계 기록 {len(world["relationships"])}개·회차 {len(world["ordinals"])}개)')


def cmd_seed_hp(args) -> None:
    import hp_seed
    raise SystemExit(hp_seed.main(['--world', str(sim_worlds.HP_WORLD), '--base-url', args.base_url]))


def cmd_run(args) -> None:
    if args.suite == 'speed' and args.via == 'ocx':
        raise SystemExit('speed는 /v1/decisions(연출 결정)가 게이트웨이에 없고 지연도 OpenAI API와 달라 비교가 깨져 OpenAI API로만 돈다(--via ocx 불가).')
    for name in (('OPENAI_MODEL',) if args.via == 'ocx' else ('OPENAI_API_KEY', 'OPENAI_MODEL')):
        if not os.environ.get(name):
            raise SystemExit(f'{name}이(가) 필요하다(모델은 운영과 같은 gpt-6-luna). 저장소 루트 .env를 셸에 불러온 뒤 실행한다.')
    if args.via == 'ocx':
        sim_via.use_ocx()
    if not prepared():
        raise SystemExit('prepare를 먼저 실행한다(표본·고정 장면 입력이 없다).')
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)  # 원문이 Langfuse로 가지 않게, 프롬프트는 코드 문자열로
    configs, suffix = parse_configs(args.configs), '-hp' if args.world == 'hp' else ''   # 원문 기반 세계관의 실행·결과는 얇은 세계관의 것과 파일이 섞이지 않는다
    quality, speed, note = sizes(args.per_type, args.world)
    total = show_estimate(args, configs, quality, speed, note)
    if args.via == 'openai' and total > args.limit_usd:
        raise continue_with_ocx(f'예상 금액 ${total:.2f}가 상한 ${args.limit_usd:.2f}를 넘어 호출 없이 멈춘다. --limit-usd를 올리거나 --configs를 줄인다.', 'run')
    worlds = sim_worlds.Worlds.load(hp=True) if args.world == 'hp' else sim_worlds.Worlds.load()
    llm = make_llm(args)
    ran_as = cfg.plan_runs(configs, args.suite)
    meta, runs = {'model': os.environ['OPENAI_MODEL'], 'judge': llm.model, 'world': args.world}, sim_worlds.DATA / 'runs'
    if args.suite == 'quality':
        rows = question_rows(worlds, args.world)
        templates, personalities = sim_quality.load_inputs(rows)
        question_usd = max(cfg.question_max_usd(q) for q in quality)  # 동시에 진행하는 질문이 끝나도 상한을 넘지 않을 여유(sim_quality.run_quality)
        by_source = {}
        try:
            for name in dict.fromkeys(ran_as.values()):
                with cfg.applied(name):
                    by_source[name] = sim_quality.run_quality(rows, worlds, llm, templates, personalities, money_limit(args), args.workers, runs / f'quality-{name}{suffix}.jsonl', question_usd)
        except CallCapExceeded as stop:
            if args.via == 'ocx':
                raise
            raise continue_with_ocx(stop, 'run --suite quality') from None
        meta |= {'seed': sim_worlds.SEED, 'questions': len(rows), 'paired': sim_stats.paired_quality(by_source), 'usd': llm.cost.spent(),
                 'via': {name: dict(Counter(r.get('via', 'openai') for r in records)) for name, records in by_source.items()}}
        data = results('quality', {name: sim_stats.summarize_quality(records) for name, records in by_source.items()}, ran_as, meta)
    else:
        async def play() -> dict:  # 한 이벤트 루프에서 설정을 차례로 돈다(연출 분류기의 HTTP 연결이 루프에 묶인다)
            done = {}
            for name in dict.fromkeys(ran_as.values()):
                with cfg.applied(name):
                    done[name] = await sim_speed.run_speed(sim_worlds.SCENES, worlds, llm.cost, args.limit_usd, runs / f'speed-{name}{suffix}.jsonl')
            return done

        by_source = asyncio.run(play())
        data = results('speed', {name: sim_stats.summarize_speed(records) for name, records in by_source.items()}, ran_as,
                       {**meta, 'scenes': len(sim_worlds.SCENES), 'usd': llm.cost.spent(), 'via': 'openai'})
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'{args.suite}{suffix}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"{args.suite} 결과를 results/{args.suite}{suffix}.json에 썼다(비용 장부 합계 ${llm.cost.spent():.2f})")


def format_via(via) -> str:
    """결과의 via: 설정마다 문항 수(openai·ocx가 섞였으면 둘 다). ocx가 있으면 모델이 달라 섞였음을 알린다."""
    if isinstance(via, str):
        return f'via: {via}'
    parts = ', '.join(f"{name} {' · '.join(f'{k} {n}' for k, n in sorted(counts.items()))}" for name, counts in via.items())
    mixed = ' — ocx 문항은 생성·채점 모델이 게이트웨이의 gpt-6-luna라 OpenAI 문항과 섞여 있다' if any('ocx' in counts for counts in via.values()) else ''
    return f'via(문항 수): {parts}{mixed}'


def cmd_report(args) -> None:
    suffix = '-hp' if args.world == 'hp' else ''
    for suite, table in (('quality', sim_stats.quality_table), ('speed', sim_stats.speed_table)):
        if args.suite not in ('all', suite):
            continue
        path = RESULTS / f'{suite}{suffix}.json'
        if not path.exists():
            print(f'{suite}{suffix}: 결과 없음(run 전)')
            continue
        data = json.loads(path.read_text())
        print(f"## {suite}{' (원문 기반 세계관)' if suffix else ''} (모델 {data['model']}, 채점 {data.get('judge', '-')}, 비용 ${data['usd']:.2f})\n\n{table(data)}\n")
        if 'via' in data:
            print(format_via(data['via']) + '\n')
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
        if name != 'prepare':
            command.add_argument('--world', choices=('thin', 'hp'), default='thin', help='hp: 해리 포터를 원문 기반 세계관(build-hp)으로(질문 150개 전부, 장면 8개). 기본 thin은 TimeChara 행으로 만든 얇은 세계관')
        if name in ('estimate', 'run'):
            command.add_argument('--configs', default=','.join(cfg.CONFIGS), help='설정 A~E를 쉼표로(기본 모두)')
            command.add_argument('--limit-usd', type=float, default=10.0, help='금액 상한(달러)')
        if name == 'run':
            command.add_argument('--suite', choices=('quality', 'speed'), required=True)
            command.add_argument('--workers', type=int, default=12, help='품질 질문을 동시에 돌리는 수(속도는 장면을 순서대로)')
            command.add_argument('--via', choices=('openai', 'ocx'), default='openai', help='ocx: 로컬 OpenCodex 게이트웨이(구독 경로, 금액 0). speed는 불가')
        elif name != 'prepare':
            command.add_argument('--suite', choices=('quality', 'speed', 'all'), default='all')
    build = sub.add_parser('build-hp', help='해리 포터 원문 → world.json(실제 모델 호출, 비용 상한 안에서)')
    build.set_defaults(handler=cmd_build_hp)
    build.add_argument('--limit-usd', type=float, default=18.0, help='OpenAI 금액 상한(장부 누적, 달러)')
    build.add_argument('--workers', type=int, default=12, help='동시에 부르는 호출 수')
    build.add_argument('--via', choices=('openai', 'ocx'), default='openai', help='ocx: 로컬 OpenCodex 게이트웨이(구독 경로, 금액 0)')
    sub.add_parser('show-hp', help='world.json → .data/hp/preview.md(호출 없음)').set_defaults(handler=cmd_show_hp)
    seed = sub.add_parser('seed-hp', help='world.json을 로컬 스택에 배치로 적재(호출 없음, 로컬만)')
    seed.set_defaults(handler=cmd_seed_hp)
    seed.add_argument('--base-url', default='http://localhost:5173', help='로컬 스택의 공개 진입점(localhost만 허용)')
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == '__main__':
    main()
