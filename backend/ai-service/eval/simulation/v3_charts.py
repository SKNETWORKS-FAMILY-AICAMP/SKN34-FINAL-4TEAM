"""시뮬레이션 v3 보고서 그림(docs/evaluation/images/simulation-v3-*.png)을 결과 집계에서 그린다.

실행: cd backend/ai-service && uv run --with matplotlib python eval/simulation/v3_charts.py
값은 전부 results/*.json에서 읽는다(손으로 적지 않는다): ① 말투·의도·지연·후보 판정은 orig-hp-summary-base2-gpt-6.2-sol.json(sol 채점),
장면 속도·비용은 orig-hp-scenes-*.json이다. v3 = v2 + act 기본 모델 terra + 지시문 P1(act)·N3(narrate)이고 ① 대사의 v3는 P1+M1(M1 가운데 act 모델만 채택,
① 입력에 나레이션은 들어가지 않는다)이다. 그림을 그리는 matplotlib는 일회성 도구라 그릴 때만 불러온다(pyproject·lockfile을 바꾸지 않는다).
"""

import json
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parents[3] / 'docs' / 'evaluation' / 'images'
SUMMARY = 'orig-hp-summary-base2-gpt-6.2-sol'
VERSIONS = (('v1', 'A'), ('v2', 'base2'), ('v2+P1', 'P1'), ('v3', 'P1+M1'))   # ① 대사의 버전별 실행 태그
# ① 후보: (채택 여부, 견주는 기준 실행). 원문 평가 §13.1·§16. V1·V3·V5는 v1 요청(A)으로 만든 실행이라 v2(base2)가 아니라 A와 견준다
CANDIDATES = {'P1': (True, 'base2'), 'P1+M1': (True, 'base2'), 'E1': (False, 'base2'), 'E2': (False, 'base2'), 'P1+E1': (False, 'base2'), 'P1b': (False, 'base2'),
              'V1': (False, 'A'), 'V3': (False, 'A'), 'V5': (False, 'A')}
SCENE_RUNS = (('v2\n(luna act, 32장면)', 'base'), ('v2 + P1·N3\n(luna act, 32장면)', 'P1+N3'), ('terra act\n(v2 지시문, 2장면)', 'terra-act'), ('v3\n(terra act + P1·N3, 8장면)', 'v3'))
CALL_ORDER = ('director', 'narrate', 'check', 'act')   # 비용 구성의 쌓는 순서


def load(name: str) -> dict:
    return json.loads((HERE / 'results' / f'{name}.json').read_text())


def version_rows(summary: dict) -> list[dict]:
    """버전별 ① 대사의 말투·의도 평균, act 호출 지연(초)·호출당 달러."""
    one = summary['sets']['1']
    return [{'label': label, 'voice': one[tag]['summary']['voice']['mean'], 'intent': one[tag]['summary']['intent']['mean'],
             'actP50': one[tag]['summary']['callMs']['p50'] / 1000, 'actP95': one[tag]['summary']['callMs']['p95'] / 1000, 'usdPerCall': one[tag]['summary']['usdPerCall']}
            for label, tag in VERSIONS]


def candidate_points(summary: dict) -> list[dict]:
    """① 후보마다 자기 기준 실행과 견준 act 지연 변화(초)·말투 평균 변화(sol)·호출당 달러와 채택 여부."""
    one = summary['sets']['1']
    return [{'tag': tag, 'adopted': adopted, 'base': base, 'dLatency': (one[tag]['summary']['callMs']['p50'] - one[base]['summary']['callMs']['p50']) / 1000,
             'dVoice': one[tag]['summary']['voice']['mean'] - one[base]['summary']['voice']['mean'], 'usdPerCall': one[tag]['summary']['usdPerCall']}
            for tag, (adopted, base) in CANDIDATES.items()]


def scene_rows(read, runs=SCENE_RUNS) -> list[dict]:
    """장면 실행별 턴 지연(초)·장면당 달러와 호출 종류별 장면당 달러. read(이름) -> 결과 JSON."""
    rows = []
    for label, name in runs:
        data = read(f'orig-hp-scenes-{name}')
        speed = data['speed']
        rows.append({'label': label, 'scenes': speed['scenes'], 'turnP50': speed['turnMs']['p50'] / 1000, 'turnP95': speed['turnMs']['p95'] / 1000, 'usdPerScene': speed['usdPerScene'],
                     'perScene': {kind: part['usd'] / speed['scenes'] for kind, part in data['byCall'].items()} if 'byCall' in data else None})   # 옛 luna 실행은 턴 합계만 있다
    return rows


# --- 그림(matplotlib는 그릴 때만 불러온다) -------------------------------------------------------------------------------------

COLORS = {'v1': '#9aa5b1', 'v2': '#2f6fde', 'v2+P1': '#8fb3ee', 'v3': '#1b9e77'}
ADOPTED, DROPPED = '#1b9e77', '#c0504d'
SCENE_COLORS = ('#9aa5b1', '#8fb3ee', '#c9a227', '#1b9e77')
KIND_NAMES = {'director': '연출(Decisions)', 'narrate': '나레이션', 'check': '검사', 'act': '인물 대사(act, terra)'}
OFFSETS = {'P1': (-6, 10), 'P1+M1': (14, -6), 'E1': (-14, 12), 'E2': (8, -16), 'P1+E1': (-22, 10), 'P1b': (-10, -18), 'V1': (-26, -4), 'V3': (-8, 12), 'V5': (10, -14)}   # 겹치는 이름표를 옮긴다


def plt_setup():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['font.family'] = 'AppleGothic'
    plt.rcParams['axes.unicode_minus'] = False
    return plt


def tidy(ax, title):
    ax.set_title(title, fontsize=11)
    ax.spines[['top', 'right']].set_visible(False)


def quality(plt, summary):
    rows = version_rows(summary)
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.9))
    for ax, key, title, low, high in ((axes[0], 'voice', '① 대사 말투(1~5)', 2.0, 3.55), (axes[1], 'intent', '① 대사 의도(1~5)', 2.0, 2.8)):
        values = [r[key] for r in rows]
        rects = ax.bar([r['label'] for r in rows], values, color=[COLORS[r['label']] for r in rows])
        ax.bar_label(rects, [f'{v:.2f}' for v in values], fontsize=9)
        ax.set_ylim(low, high)
        tidy(ax, title)
    fig.suptitle('v1 → v3 ① 대사 품질: 해리 포터 400문항, sol 채점(세로축은 2.0부터)', fontsize=12)
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v3-quality.png', dpi=150)


def speed(plt, summary, scenes):
    rows = version_rows(summary)
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.2), gridspec_kw={'width_ratios': [1, 1.25]})
    for ax, labels, p50, p95, title in ((axes[0], [r['label'] for r in rows], [r['actP50'] for r in rows], [r['actP95'] for r in rows], '인물 대사(act) 호출 지연(초, ① 400문항)'),
                                         (axes[1], [r['label'] for r in scenes], [r['turnP50'] for r in scenes], [r['turnP95'] for r in scenes], '장면 턴 지연(초, 전지적 나레이션 검사 끔)')):
        xs = range(len(labels))
        for offset, values, color, tag in ((-0.2, p50, '#2f6fde', 'p50'), (0.2, p95, '#9aa5b1', 'p95')):
            rects = ax.bar([x + offset for x in xs], values, 0.4, color=color, label=tag)
            ax.bar_label(rects, [f'{v:.1f}' for v in values], fontsize=8)
        ax.set_xticks(list(xs), labels, fontsize=8)
        tidy(ax, title)
    axes[0].legend()
    fig.suptitle('v1 → v3 속도', fontsize=12)
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v3-speed.png', dpi=150)


def candidates(plt, summary):
    points = candidate_points(summary)
    fig, ax = plt.subplots(figsize=(8.6, 5.2))
    ax.axhline(0, color='#cccccc', linewidth=1)
    ax.axvline(0, color='#cccccc', linewidth=1)
    for p in points:
        ax.scatter(p['dLatency'], p['dVoice'], s=p['usdPerCall'] * 120000, color=ADOPTED if p['adopted'] else DROPPED, alpha=0.75, edgecolor='white', linewidth=1)
        ax.annotate(p['tag'], (p['dLatency'], p['dVoice']), textcoords='offset points', xytext=OFFSETS.get(p['tag'], (8, 6)), fontsize=9)
    ax.set_xlabel('act 호출 지연 변화(초, 후보의 기준 실행 대비)')
    ax.set_ylabel('① 말투 평균 변화(sol, 후보의 기준 실행 대비)')
    ax.set_ylim(-0.05, 0.33)
    ax.text(0.99, 0.97, '왼쪽 위일수록 좋고 빠르다', transform=ax.transAxes, va='top', ha='right', fontsize=9, color='#666666')
    ax.scatter([], [], s=150, color=ADOPTED, label='채택(P1, act terra)')
    ax.scatter([], [], s=150, color=DROPPED, label='미채택')
    ax.legend(loc='lower right', fontsize=9, title='원의 넓이 = 호출당 비용', title_fontsize=8)
    tidy(ax, '① 후보 판정 지도: 해리 포터 400문항(기준은 v2, V1·V3·V5만 v1 요청 A)')
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v3-candidates.png', dpi=150)


def cost(plt, scenes):
    v3 = scenes[-1]   # SCENE_RUNS의 마지막이 v3 실행이다
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.2), gridspec_kw={'width_ratios': [1.25, 1]})
    totals = [r['usdPerScene'] for r in scenes]
    rects = axes[0].bar([r['label'] for r in scenes], totals, color=SCENE_COLORS[:len(scenes)])
    axes[0].bar_label(rects, [f'{v:.3f}' for v in totals], fontsize=9)
    axes[0].set_xticks(range(len(scenes)), [r['label'] for r in scenes], fontsize=8)
    tidy(axes[0], '장면당 비용(달러, 전지적 나레이션 검사 끔)')
    parts = [(KIND_NAMES.get(k, k), v3['perScene'][k]) for k in CALL_ORDER if k in v3['perScene']]
    total = sum(v for _, v in parts)
    rects = axes[1].barh([n for n, _ in parts], [v for _, v in parts], color='#1b9e77')
    axes[1].bar_label(rects, [f'{v:.4f} ({v / total:.0%})' for _, v in parts], fontsize=9)
    axes[1].set_xlim(0, max(v for _, v in parts) * 1.45)
    axes[1].invert_yaxis()
    tidy(axes[1], f"v3 장면 1개의 호출 종류별 비용({v3['scenes']}장면 평균, 합계 {total:.3f}달러)")
    fig.suptitle('v3 비용', fontsize=12)
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v3-cost.png', dpi=150)


def main() -> None:
    plt = plt_setup()
    OUT.mkdir(parents=True, exist_ok=True)
    summary, scenes = load(SUMMARY), scene_rows(load)
    quality(plt, summary), speed(plt, summary, scenes), candidates(plt, summary), cost(plt, scenes)
    print(*sorted(p.name for p in OUT.glob('simulation-v3-*.png')), sep='\n')


if __name__ == '__main__':
    main()
