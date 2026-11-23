"""시뮬레이션 v1 → v2 보고서 그림(docs/evaluation/images/simulation-v2-*.png)을 결과 집계에서 그린다.

실행: cd backend/ai-service && uv run --with matplotlib python eval/simulation/v2_charts.py
속도·품질(장면 단위) 수치는 docs/evaluation/simulation.md 표, 검사·대사 수치는 results/orig-hp-*.json에서 읽는다.
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
V1, V2 = '#9aa5b1', '#2f6fde'


def summary(name: str) -> dict:
    return json.loads((HERE / 'results' / f'{name}.json').read_text())['summary']


def bars(ax, labels, before, after, title, unit='', fmt='{:.1f}'):
    xs = range(len(labels))
    for offset, values, color, tag in ((-0.2, before, V1, 'v1'), (0.2, after, V2, 'v2')):
        rects = ax.bar([x + offset for x in xs], values, 0.4, color=color, label=tag)
        ax.bar_label(rects, [fmt.format(v) + unit for v in values], fontsize=8)
    ax.set_xticks(list(xs), labels)
    ax.set_title(title)
    ax.spines[['top', 'right']].set_visible(False)


def speed():
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6))
    bars(axes[0], ['p50', 'p95'], [10.8, 25.0], [7.9, 16.2], '장면 턴 지연(초)')
    bars(axes[1], ['장면당'], [0.388], [0.372], '장면 비용(달러)', fmt='{:.3f}')
    bars(axes[2], ['완료율'], [90], [100], '장면 완료율(%)', fmt='{:.0f}')
    axes[0].legend()
    fig.suptitle('① 추론 강도 기본값 low — 해리 포터 세계관 장면 10개(OpenAI)')
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v2-speed.png', dpi=150)


def check():
    a, b = summary('orig-hp-4'), summary('orig-hp-4-B')
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6))
    bars(axes[0], ['입력 토큰(천)'], [a['inputTokens'] / 1000], [b['inputTokens'] / 1000], '검사 1회 입력')
    bars(axes[1], ['p50 지연(초)', '오류(건)'], [a['callMs']['p50'] / 1000, a['errors']], [b['callMs']['p50'] / 1000, b['errors']], '검사 지연·오류')
    bars(axes[2], ['정확도', '오경보', '놓침'],
         [100 * a['accuracy']['rate'], 100 * a['falseAlarm']['rate'], 100 * a['covered']['miss']['rate']],
         [100 * b['accuracy']['rate'], 100 * b['falseAlarm']['rate'], 100 * b['covered']['miss']['rate']], '판정(%)', fmt='{:.0f}')
    axes[0].legend()
    fig.suptitle('② 대사 검사 금지 목록 장면 관련 20개 — 해리 포터 ④ 300문항(같은 문항 짝 비교 24↑24↓, p=1.0)')
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v2-check.png', dpi=150)


def quality():
    base = summary('orig-hp-1')
    rows = [('기준(A)', base), ('V1 말투 예시', summary('orig-hp-1-V1')), ('V3 관계 24', summary('orig-hp-1-V3')), ('V5 관계 48', summary('orig-hp-1-V5'))]
    fig, axes = plt.subplots(1, 2, figsize=(12, 3.6))
    names = [n for n, _ in rows]
    colors = [V1, '#c9a227', '#d9534f', '#e8908c']
    for ax, key, title in ((axes[0], 'voice', '① 대사 말투(1~5)'), (axes[1], 'inputTokens', '① 대사 입력 토큰')):
        values = [s[key]['mean'] if key == 'voice' else s[key] for _, s in rows]
        rects = ax.bar(names, values, color=colors)
        ax.bar_label(rects, [f'{v:.2f}' if key == 'voice' else f'{v:,.0f}' for v in values], fontsize=8)
        ax.set_title(title)
        ax.spines[['top', 'right']].set_visible(False)
    axes[0].set_ylim(2.3, 2.8)
    fig.suptitle('채택하지 않은 후보 — 해리 포터 ① 400문항')
    fig.tight_layout()
    fig.savefig(OUT / 'simulation-v2-candidates.png', dpi=150)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    speed(), check(), quality()
    print(*sorted(p.name for p in OUT.glob('simulation-v2-*.png')), sep='\n')
