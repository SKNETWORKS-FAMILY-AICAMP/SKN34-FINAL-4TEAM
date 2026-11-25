"""기준선 평가 그림: `results/*.json`(집계만)에서 다시 그린다. matplotlib는 그릴 때만 불러온다.

    cd backend/ai-service && uv run --locked --with matplotlib python eval/writing/charts.py   # docs/evaluation/assets/writing-baseline/*.png
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[3] / 'docs' / 'evaluation' / 'assets' / 'writing-baseline'
TARGETS = ['guard', 'main', 'qa', 'review', 'world', 'editing', 'research', 'rating', 'pipeline']
LABELS = {'guard': 'Decision Guard', 'main': '메인 에이전트', 'qa': '작품 Q&A', 'review': '원고 검수', 'world': '세계관', 'editing': '기획·집필·수정',
          'research': '고증 조사', 'rating': '심의 등급', 'pipeline': '전체 파이프라인'}
APPLIES = {'S': {'qa'}}   # 검색만 평가를 쓰는 대상(검수 문맥 조립·세계관 impact·파이프라인 검색 점수는 다음 차수)
# 대상별 대표 지표(설계안 §3). main은 pipeline 캡처를 메인 관점 지표로 읽는다.
HEADLINE = {'guard': ['accuracy', 'attack_false_allow', 'normal_false_block', 'consistency'], 'main': ['tools_ok', 'conditional_ok', 'first_status_ok'],
            'qa': ['correct', 'false_abstain', 'citation_hit', 'supported'], 'qa-S': ['recall@1', 'recall@3', 'recall@8', 'leak', 'card_found'],
            'review': ['detected', 'false_alarm', 'typo_recall'], 'world': ['detected', 'valid'], 'editing': ['exact', 'preserved', 'constraints'],
            'research': ['answered', 'premise_corrected'], 'rating': ['correct', 'adult_recall', 'over_rated'], 'pipeline': ['pass', 'final_ok', 'no_write']}


def load(results_dir: Path = HERE / 'results') -> dict:
    return {tuple(p.stem.rsplit('-', 1)): json.loads(p.read_text(encoding='utf-8')) for p in results_dir.glob('*.json')}


def status_grid(results: dict, targets: list[str]) -> dict:
    """대상 × 모드 칸: 측정 n/전체, 아직 안 돌림(missing), 해당 없음(n/a)."""
    grid = {}
    for t in targets:
        row = {}
        for mode in ('R', 'G', 'S'):
            if mode == 'S' and t not in APPLIES['S']:
                row[mode] = 'n/a'
            elif (t, mode) in results:
                m = results[(t, mode)]['summary']['measured']
                row[mode] = f"{m['n']}/{m['of']}"
            else:
                row[mode] = 'missing'
        grid[t] = row
    return grid


def headline(summary: dict, keys: list[str]) -> list[tuple]:
    """비율 지표만 (이름, 값, 하한, 상한, n). 평균 지표와 없는 키는 뺀다."""
    return [(k, summary[k]['value'], summary[k]['low'], summary[k]['high'], summary[k]['n'])
            for k in keys if isinstance(summary.get(k), dict) and summary[k].get('value') is not None]


def draw() -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['font.family'] = ['Malgun Gothic', 'AppleGothic', 'NanumGothic', 'DejaVu Sans']
    plt.rcParams['axes.unicode_minus'] = False
    OUT.mkdir(parents=True, exist_ok=True)
    results = load()
    if ('pipeline', 'G') in results:
        results[('main', 'G')] = results[('pipeline', 'G')]
    if ('pipeline', 'R') in results:
        results[('main', 'R')] = results[('pipeline', 'R')]

    # ① 대상 × 모드 상태판
    grid = status_grid(results, TARGETS)
    fig, ax = plt.subplots(figsize=(7, 4.6))
    colors = {'n/a': '#e9e9e9', 'missing': '#fbe3e3'}
    for i, t in enumerate(TARGETS):
        for j, mode in enumerate(('R', 'G', 'S')):
            v = grid[t][mode]
            color = colors.get(v, '#fbe3e3' if v.startswith('0/') else '#dff0e0')   # 측정 0건은 미실행과 같은 색
            ax.add_patch(plt.Rectangle((j, len(TARGETS) - 1 - i), 1, 1, color=color, ec='white'))
            ax.text(j + .5, len(TARGETS) - .5 - i, {'n/a': '해당 없음', 'missing': '미실행'}.get(v, f'측정 {v}'), ha='center', va='center', fontsize=9)
    ax.set_xlim(0, 3), ax.set_ylim(0, len(TARGETS))
    ax.set_xticks([.5, 1.5, 2.5], ['R 저장 응답 재평가', 'G 고정 근거 새 답변', 'S 검색만'])
    ax.set_yticks([len(TARGETS) - .5 - i for i in range(len(TARGETS))], [LABELS[t] for t in TARGETS])
    ax.tick_params(length=0)
    ax.set_title('대상 × 평가 모드 (측정 건수/전체)')
    fig.tight_layout(), fig.savefig(OUT / 'status-grid.png', dpi=150), plt.close(fig)

    # ② 대상별 대표 지표(Wilson 95% 구간)
    panels = [(t, mode) for t, mode in [('guard', 'G'), ('main', 'G'), ('qa', 'S'), ('qa', 'G'), ('review', 'G'), ('world', 'G'),
                                         ('editing', 'G'), ('research', 'G'), ('rating', 'G'), ('pipeline', 'G')] if (t, mode) in results]
    fig, axes = plt.subplots(len(panels), 1, figsize=(7.5, 1.15 * sum(max(1, len(headline(results[p]['summary'], HEADLINE[p[0] + ('-S' if p[1] == 'S' else '')]))) for p in panels) + 1))
    for ax, (t, mode) in zip(axes, panels):
        rows = headline(results[(t, mode)]['summary'], HEADLINE[t + ('-S' if mode == 'S' else '')])
        ys = range(len(rows))
        ax.barh(list(ys), [r[1] for r in rows], color='#4c78a8', height=.55)
        ax.errorbar([r[1] for r in rows], list(ys), xerr=[[r[1] - r[2] for r in rows], [r[3] - r[1] for r in rows]], fmt='none', ecolor='#333', capsize=3)
        ax.set_yticks(list(ys), [f'{r[0]} (n={r[4]})' for r in rows], fontsize=8)
        ax.set_xlim(0, 1), ax.invert_yaxis()
        for y, r in zip(ys, rows):
            ax.text(min(r[1] + .02, .9), y, f'{r[1]:.2f}', va='center', fontsize=8)
        ax.set_title(f'{LABELS[t]} · {mode}', fontsize=9, loc='left')
    fig.tight_layout(), fig.savefig(OUT / 'headline.png', dpi=150), plt.close(fig)

    # ③ 비용: 대상별 생성·채점(장부 기준, 파이프라인은 장부 밖)
    costs = [(LABELS[t], results[(t, m)]['usd']['generate'], results[(t, m)]['usd']['judge']) for t, m in
             [('guard', 'G'), ('qa', 'G'), ('review', 'G'), ('world', 'G'), ('editing', 'G'), ('research', 'G'), ('rating', 'G')] if (t, m) in results]
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.bar([c[0] for c in costs], [c[1] for c in costs], label='생성', color='#4c78a8')
    ax.bar([c[0] for c in costs], [c[2] for c in costs], bottom=[c[1] for c in costs], label='의미 채점', color='#f58518')
    ax.set_ylabel('USD(추정)'), ax.legend(), ax.set_title('대상별 실행 비용(gpt-5.6-luna 단가로 추정, Guard는 계측 수정 전이라 0)')
    plt.xticks(rotation=20, fontsize=8)
    fig.tight_layout(), fig.savefig(OUT / 'cost.png', dpi=150), plt.close(fig)
    print('그림:', ', '.join(p.name for p in OUT.glob('*.png')))


if __name__ == '__main__':
    sys.exit(draw())
