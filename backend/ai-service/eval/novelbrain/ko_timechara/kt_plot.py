"""run 묶음별 '비용 대비 시공간 일관성' 꺾은선 그래프(호출 없음): 응답 모델·추론 강도를 바꿔 돌린 run들의 문항당 응답 비용(장부 환산 달러)과 시공간(가중) 점수를 견준다.

    cd backend/ai-service
    uv run --locked --extra dev --with matplotlib python eval/novelbrain/ko_timechara/kt_plot.py '<표시 이름>=<run name>[,<run name>…]' … --out=<png>
    예) … kt_plot.py 'gpt-6-luna=luna-low,luna-medium,luna-high' 'gemini-3.8-flash=gemini-flash-low' --out=.data/ko_timechara/plots/cost-score.png

묶음 하나가 선 하나다(run은 적은 순서대로 잇는다: 강도 순으로 적는다). run마다 `KT/runs/rows-<name>.json`에서 구성 s3·zero의 시공간(가중) 점수(`run_timechara.summarize`, kt_run의 집계와 같다)를,
`KT/cost-<name>.jsonl`에서 gen 행 금액 합계 ÷ 질문 수(문항당 환산 비용, 달러. 구성 zero·s3의 응답 호출을 합친 값)를 읽는다. x는 문항당 비용(로그 눈금), y는 s3 점수(%)이고
같은 색 점선이 zero 점수다. 점의 강도 라벨은 기록의 gen_model `@<강도>`에서 읽는다(없으면 '기본'). 표는 --out 옆에 같은 이름의 .json으로 쓴다.
matplotlib는 의존성이 아니라 `uv run --with matplotlib`로만 쓴다. 그리기는 시험하지 않는다(계산은 test_kt_plot.py).
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json
import sys
from pathlib import Path

from kt_common import KT
from run_timechara import summarize

TITLE = 'NovelBrain 비용 대비 시공간 일관성 (KoTimeChara, 채점 gpt-6.2-sol)'
DEFAULT_EFFORT = '기본'   # 추론 강도를 보내지 않은 실행
COLORS = ('#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#f06292', '#fff176')   # 어두운 배경에서 구별되는 밝은 색(묶음 순서)
MARKERS = 'osD^vP'


def parse_group(text: str) -> tuple[str, list[str]]:
    """'<표시 이름>=<run name>[,<run name>…]' → (표시 이름, run 이름 목록). 표시 이름이나 run 이름이 없으면 멈춘다."""
    label, _, names = text.partition('=')
    runs = [name for name in names.split(',') if name]
    if not label or not runs:
        raise argparse.ArgumentTypeError(f"'<표시 이름>=<run name>[,<run name>…]' 꼴로 적는다: {text!r}")
    return label, runs


def effort_of(records: list[dict]) -> str:
    """기록의 gen_model 끝 '@<강도>'(여럿 섞였으면 숨기지 않고 '/'로 잇는다). 강도 표기가 없으면 '기본'."""
    return '/'.join(sorted({r.get('gen_model', '').partition('@')[2] or DEFAULT_EFFORT for r in records}))


def run_stats(name: str, records: list[dict], cost_rows: list[dict]) -> dict:
    """run 하나의 점수·비용 한 줄: 구성 s3·zero의 시공간(가중) 점수(%)와 실패 수, 질문 수, gen 행 환산 금액 합계와 문항당 금액(달러). 없는 값은 None이다(꾸며 채우지 않는다)."""
    configs = summarize(records)
    questions = len({r['idx'] for r in records})
    gen_usd = sum(row['usd'] for row in cost_rows if row['kind'] == 'gen')

    def pct(config):
        weighted = configs.get(config, {}).get('weighted')
        return None if weighted is None else round(weighted * 100, 2)

    def joined(key):
        return '/'.join(sorted({r.get(key, '') for r in records}))

    return {'run': name, 'effort': effort_of(records), 'gen_model': joined('gen_model'), 'judge_model': joined('judge_model'), 'questions': questions,
            's3_pct': pct('s3'), 'zero_pct': pct('zero'), 's3_failed': configs.get('s3', {}).get('failed'), 'zero_failed': configs.get('zero', {}).get('failed'),
            'gen_usd': round(gen_usd, 6), 'cost_per_question_usd': round(gen_usd / questions, 6) if questions and gen_usd else None}


def build_table(groups: list[tuple[str, list[str]]], runs: dict[str, tuple[list[dict], list[dict]]]) -> list[dict]:
    """groups = [(표시 이름, [run 이름 …])], runs = {run 이름: (기록, 장부 줄)} → [{'name': 표시 이름, 'runs': [run_stats …]}]. 묶음·run 순서는 준 그대로다."""
    return [{'name': label, 'runs': [run_stats(name, *runs[name]) for name in names]} for label, names in groups]


def points(group: dict) -> tuple[list[dict], list[str]]:
    """그릴 수 있는 run(응답 비용과 s3 점수가 있다: 로그 눈금은 0을 못 그린다)과 건너뛴 run 이름."""
    drawable = [r for r in group['runs'] if r['cost_per_question_usd'] and r['s3_pct'] is not None]
    return drawable, [r['run'] for r in group['runs'] if r not in drawable]


def load_run(name: str) -> tuple[list[dict], list[dict]]:
    """run 하나의 기록(KT/runs/rows-<name>.json)과 비용 장부 줄(KT/cost-<name>.jsonl). 파일이 없으면 이름을 알리고 멈춘다."""
    rows, cost = KT / 'runs' / f'rows-{name}.json', KT / f'cost-{name}.jsonl'
    for path in (rows, cost):
        if not path.exists():
            raise SystemExit(f'{path.name}이 없다(run 이름 {name}).')
    return json.loads(rows.read_text()), [json.loads(line) for line in cost.read_text().splitlines() if line.strip()]


def draw(table: list[dict], out: Path) -> None:
    """꺾은선을 PNG로 그린다: 어두운 배경, 한글 글꼴은 AppleGothic이 있으면. 묶음마다 색 하나 — 실선이 s3, 같은 색 점선(작은 표식)이 zero."""
    try:
        import matplotlib.pyplot as plt
        from matplotlib import font_manager, ticker
        from matplotlib.lines import Line2D
    except ImportError:
        raise SystemExit('matplotlib이 없다: uv run --locked --extra dev --with matplotlib python eval/novelbrain/ko_timechara/kt_plot.py … 로 돌린다.') from None
    shown = [(group, *points(group)) for group in table]
    for group, _, skipped in shown:
        if skipped:
            print(f"그리지 않음({group['name']}): 응답 비용이나 s3 점수가 없는 run {', '.join(skipped)}", file=sys.stderr)
    if not any(drawable for _, drawable, _ in shown):
        raise SystemExit('그릴 점이 없다: 모든 run에 응답 비용(gen 행)과 s3 점수가 있는지 본다.')
    plt.style.use('dark_background')
    if 'AppleGothic' in {font.name for font in font_manager.fontManager.ttflist}:
        plt.rcParams['font.family'] = 'AppleGothic'
    plt.rcParams['axes.unicode_minus'] = False
    fig, ax = plt.subplots(figsize=(11, 6.5))
    for i, (group, drawable, _) in enumerate(shown):
        if not drawable:
            continue
        color, xs = COLORS[i % len(COLORS)], [r['cost_per_question_usd'] for r in drawable]
        ax.plot(xs, [r['s3_pct'] for r in drawable], marker=MARKERS[i % len(MARKERS)], ms=7, lw=2, color=color, label=group['name'])
        zero = [(x, r['zero_pct']) for x, r in zip(xs, drawable) if r['zero_pct'] is not None]
        if zero:
            ax.plot(*zip(*zero), marker='x', ms=4, lw=1.2, ls='--', color=color, alpha=0.75)
        dx, dy = (-5, 8) if i % 2 == 0 else (5, -8)   # 오르는 선의 빈 쪽: 짝수 묶음은 왼쪽 위, 홀수 묶음은 오른쪽 아래에 라벨을 둬 서로·자기 선과 덜 겹친다
        for x, r in zip(xs, drawable):
            ax.annotate(f"{r['effort']}\n{r['s3_pct']:.1f}%", (x, r['s3_pct']), textcoords='offset points', xytext=(dx, dy), fontsize=8, color=color,
                        ha='right' if dx < 0 else 'left', va='bottom' if dy > 0 else 'top', bbox={'boxstyle': 'round,pad=0.15', 'fc': 'black', 'ec': 'none', 'alpha': 0.6})
    ax.set_xscale('log')
    ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda value, _: f'${value:g}'))
    ax.set(xlabel='문항당 응답 비용 (달러, 정가 환산, 로그 눈금)', ylabel='시공간 일관성 (%)', title=TITLE)
    ax.margins(x=0.12, y=0.18)
    ax.grid(alpha=0.25)
    handles, labels = ax.get_legend_handles_labels()
    handles += [Line2D([], [], color='#999999', lw=2), Line2D([], [], color='#999999', lw=1.2, ls='--', marker='x', ms=4)]
    ax.legend(handles, labels + ['실선: s3(NovelBrain 3단계)', '점선: zero(검색 없음)'], loc='best', frameon=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=160, bbox_inches='tight', facecolor=fig.get_facecolor())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('groups', nargs='+', type=parse_group, metavar='표시이름=run[,run…]', help='선 하나: 표시 이름과 run 이름(강도 순으로 적는다)')
    parser.add_argument('--out', required=True, type=Path, help='PNG 경로(옆에 같은 이름의 .json 표를 쓴다)')
    args = parser.parse_args(argv)
    table = build_table(args.groups, {name: load_run(name) for _, names in args.groups for name in names})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    table_path = args.out.with_suffix('.json')
    table_path.write_text(json.dumps(table, ensure_ascii=False, indent=2))   # 그리기가 실패해도(matplotlib 없음) 표는 남는다
    draw(table, args.out)
    print(f'그림 {args.out} · 표 {table_path}')


if __name__ == '__main__':
    main()
