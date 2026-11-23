"""V4(초안 → 병렬 수정) 보고서 그림(docs/evaluation/images/simulation-v4-*.png)을 결과 집계(results/v4-hp-*.json)에서 그린다.

실행: cd backend/ai-service && uv run --with matplotlib python eval/simulation/v4_charts.py
speed는 OpenAI 실제 속도 측정(v4-hp-openai.json)이 있으면 그것을, 없으면 ocx 실행(참고용)을 쓴다. 호출 구조 그림은 집계의 호출 수·직렬 단계를 그대로 붙인다.
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE.parents[3] / 'docs' / 'evaluation' / 'images'
plt.rcParams['font.family'] = 'AppleGothic'
plt.rcParams['axes.unicode_minus'] = False
COLORS = {'base': '#9aa5b1', 'P1+N3': '#2f6fde', 'v4': '#e8870e'}
NAMES = {'base': 'v2 턴 방식', 'P1+N3': 'P1+N3 턴 방식', 'v4': 'V4 초안→병렬 수정'}


def load(via: str) -> dict | None:
    path = HERE / 'results' / f'v4-hp-{via}.json'
    return json.loads(path.read_text()) if path.exists() else None


def bars(ax, summary: dict, getter, title: str, fmt: str = '{:.1f}', err=None) -> None:
    conds = [c for c in NAMES if c in summary['conditions']]
    values = [getter(summary['conditions'][c]) for c in conds]
    errors = [err(summary['conditions'][c]) if err else None for c in conds]
    rects = ax.bar([NAMES[c] for c in conds], [v or 0 for v in values], color=[COLORS[c] for c in conds], yerr=[e or 0 for e in errors] if err else None, capsize=3)
    ax.bar_label(rects, [fmt.format(v) if v is not None else '-' for v in values], fontsize=8, padding=2)
    ax.set_title(title, fontsize=10)
    ax.tick_params(axis='x', labelsize=7)
    ax.spines[['top', 'right']].set_visible(False)


def speed() -> None:
    ocx, real = load('ocx'), load('openai')
    timing = real or ocx
    label = 'OpenAI 실제 측정' if real else 'ocx(참고용)'
    fig, axes = plt.subplots(1, 4, figsize=(15, 3.6))
    bars(axes[0], ocx, lambda s: s['serialSteps']['mean'], '직렬 모델 호출 단계(장면당) · ocx 80장면')
    bars(axes[1], ocx, lambda s: s['calls']['mean'], '모델 호출 수(장면당) · ocx 80장면')
    bars(axes[2], timing, lambda s: s['elapsedMs']['p50'] / 1000, f'장면 완성 시간 p50(초) · {label}')
    bars(axes[3], timing, lambda s: s['firstTurnMs']['p50'] / 1000, f'첫 턴이 보일 때까지 p50(초) · {label}')
    fig.suptitle('V4(초안 → 병렬 수정) 속도 — 해리 포터 고정 장면 8개')
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v4-speed.png', dpi=150)


def quality() -> None:
    summary = load('ocx')
    fig, axes = plt.subplots(1, 4, figsize=(15, 3.6))
    bars(axes[0], summary, lambda s: 100 * s['completed']['rate'], '장면 완료율(%)', '{:.0f}', err=lambda s: 100 * (s['completed']['ci'][1] - s['completed']['ci'][0]) / 2)
    for k, (key, name) in enumerate((('overall', '종합'), ('plan', '계획'), ('voice', '말투'))):
        conds = [c for c in NAMES if c in summary['conditions']]
        xs = [i + (k - 1) * 0.25 for i in range(len(conds))]
        values = [summary['conditions'][c]['mean'][key]['mean'] or 0 for c in conds]
        errs = [summary['conditions'][c]['mean'][key]['ci'] or 0 for c in conds]
        rects = axes[1].bar(xs, values, 0.25, yerr=errs, capsize=2, label=name, color=[COLORS[c] for c in conds], alpha=0.45 + 0.25 * k)
        axes[1].bar_label(rects, [f'{v:.2f}' for v in values], fontsize=6, padding=2)
    axes[1].set_xticks(range(3), [NAMES[c] for c in conds], fontsize=7)
    axes[1].set_title('채점(1~5): 종합·계획·말투(연한 순)', fontsize=10)
    axes[1].set_ylim(1, 5)
    axes[1].spines[['top', 'right']].set_visible(False)
    bars(axes[2], summary, lambda s: 100 * s['leakTurnRate'], '누설로 채점된 턴(%)', '{:.1f}')
    bars(axes[3], summary, lambda s: 100 * s['retryRate'], '검사에 걸려 다시 쓴 턴(%)', '{:.1f}')
    fig.suptitle('V4 품질 — 해리 포터 고정 장면 8개 × 10회, 모델 채점(ocx)')
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v4-quality.png', dpi=150)


def box(ax, x: float, y: float, text: str, color: str, w: float = 1.5, h: float = 0.55) -> None:
    ax.add_patch(plt.Rectangle((x, y), w, h, facecolor=color, edgecolor='#333', linewidth=0.8, alpha=0.85))
    ax.text(x + w / 2, y + h / 2, text, ha='center', va='center', fontsize=8)


def arrow(ax, x0: float, y0: float, x1: float, y1: float) -> None:
    ax.annotate('', xy=(x1, y1), xytext=(x0, y0), arrowprops={'arrowstyle': '->', 'color': '#333'})


def structure() -> None:
    summary = load('ocx')
    base, v4 = summary['conditions']['P1+N3'], summary['conditions']['v4']
    fig, ax = plt.subplots(figsize=(13, 4.6))
    ax.set_xlim(0, 13)
    ax.set_ylim(0, 5)
    ax.axis('off')
    ax.text(0.1, 4.6, f"턴 방식(지금): 턴마다 차례로 · 직렬 {base['serialSteps']['mean']:.1f}단계·호출 {base['calls']['mean']:.1f}회(ocx 80장면 평균)", fontsize=10, weight='bold')
    for turn in range(3):
        x = 0.3 + turn * 3.6
        box(ax, x, 3.5, '연출 결정', '#dfe6ee', w=1.4)
        box(ax, x + 1.9, 3.5, '대사·지문', '#cfdcf5', w=1.2)
        arrow(ax, x + 1.4, 3.77, x + 1.9, 3.77)
        ax.text(x + 0.2, 3.15, '→ 검사 → (실패하면 재생성)', fontsize=7)
        arrow(ax, x + 3.1, 3.77, x + 3.6, 3.77)
    ax.text(11.2, 3.7, '… 턴 수만큼\n이어진다', fontsize=8)
    ax.text(0.1, 2.2, f"V4: 직렬 {v4['serialSteps']['mean']:.1f}단계·호출 {v4['calls']['mean']:.1f}회(ocx 80장면 평균)", fontsize=10, weight='bold')
    box(ax, 0.3, 1.0, '초안 1회\n(전체 턴 목록)', '#f6dcb4', w=1.9, h=0.8)
    for k in range(3):
        box(ax, 3.2 + k * 0.25, 1.35 - k * 0.3, '수정(인물 입력+초안)' if k == 2 else '', '#f9e8cc', w=2.6, h=0.4)
        box(ax, 6.8 + k * 0.25, 1.35 - k * 0.3, '검사(턴마다)' if k == 2 else '', '#f9e8cc', w=1.9, h=0.4)
    arrow(ax, 2.2, 1.4, 3.2, 1.4)
    arrow(ax, 6.0, 0.9, 6.8, 0.9)
    box(ax, 9.9, 0.9, '실패한 턴만\n재수정·재검사(1회)', '#f3c9c4', w=2.1, h=0.8)
    arrow(ax, 8.9, 0.9, 9.9, 1.3)
    ax.text(3.2, 0.2, '턴마다 동시에(병렬)', fontsize=8)
    ax.text(6.8, 0.2, '턴마다 동시에(병렬)', fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v4-structure.png', dpi=150)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    speed(), quality(), structure()
    print(*sorted(p.name for p in OUT.glob('simulation-v4-*.png')), sep='\n')
