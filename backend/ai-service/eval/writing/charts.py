"""기준선 평가 그림: `results/*.json`(집계만)에서 다시 그린다. matplotlib는 그릴 때만 불러온다.

    cd backend/ai-service && uv run --locked --with matplotlib python eval/writing/charts.py   # docs/evaluation/assets/writing-baseline/*.png
"""

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
V2 = bool(os.environ.get('EVAL_DATA'))   # run.py와 같이 v2 차수는 results/v2에서 읽어 따로 그린다
OUT = HERE.parents[3] / 'docs' / 'evaluation' / 'assets' / ('writing-v2' if V2 else 'writing-baseline')
TARGETS = ['guard', 'main', 'qa', 'review', 'world', 'editing', 'research', 'rating', 'pipeline']
LABELS = {'guard': 'Decision Guard', 'main': '메인 에이전트', 'qa': '작품 Q&A', 'review': '원고 검수', 'world': '세계관', 'editing': '기획·집필·수정',
          'research': '고증 조사', 'rating': '심의 등급', 'pipeline': '전체 파이프라인'}
APPLIES = {'S': {'qa'}}   # 검색만 평가를 쓰는 대상(검수 문맥 조립·세계관 impact·파이프라인 검색 점수는 다음 차수)
# 대상별 대표 지표(v2 설계안). 0~1 비율·점수만 막대로 그린다(5점 품질 같은 척도는 표로만).
HEADLINE = {'guard': ['attack_false_allow', 'normal_false_block', 'indirect_contamination', 'pass_k', 'capabilities_precision', 'capabilities_recall'],
            'main': ['trajectory', 'args', 'tool_precision', 'tool_recall', 'injection_followed', 'faithfulness'],
            'qa': ['correctness', 'faithfulness', 'false_abstain', 'abstain_ok', 'noise_cited', 'memorized'],
            'qa-S': ['recall@8', 'rr', 'card_recall@8', 'leak'],
            'review': ['detected', 'detected_confirmed', 'false_alarm_confirmed', 'false_alarm_suspected', 'spelling_f1'],
            'world': ['detected', 'false_alarm', 'valid', 'fact_kept', 'forbidden', 'new_conflicts', 'impact_precision', 'impact_recall'],
            'editing': ['constraints', 'exact', 'untouched_outside', 'spelling_f1', 'violation'],
            'research': ['answered', 'premise_corrected', 'gap_flagged', 'private_leak', 'served_unlisted', 'support', 'world_recall'],
            'rating': ['correct', 'adult_recall', 'over_rated', 'missed_adult'], 'pipeline': ['pass', 'tools_ok', 'first_status_ok', 'final_ok', 'no_write', 'conditional_ok']}


def load(results_dir: Path = HERE / 'results' / ('v2' if V2 else '')) -> dict:
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
    """(이름, 값, 하한, 상한, n). 비율은 Wilson 구간, 0~1 평균·점수는 구간 없이(하한=상한=값). 1을 넘는 평균과 없는 키는 뺀다."""
    rows = []
    for k in keys:
        v = summary.get(k)
        if isinstance(v, dict) and v.get('value') is not None:
            rows.append((k, v['value'], v['low'], v['high'], v['n']))
        elif isinstance(v, dict) and 'mean' in v and 0 <= v['mean'] <= 1:
            rows.append((k, v['mean'], v['mean'], v['mean'], v['n']))
        elif isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1:
            rows.append((k, v, v, v, None))
    return rows


def draw() -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['font.family'] = ['Malgun Gothic', 'AppleGothic', 'NanumGothic', 'DejaVu Sans']
    plt.rcParams['axes.unicode_minus'] = False
    OUT.mkdir(parents=True, exist_ok=True)
    results = load()

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
        ax.set_yticks(list(ys), [f'{r[0]} (n={r[4]})' if r[4] is not None else r[0] for r in rows], fontsize=8)
        ax.set_xlim(0, 1), ax.invert_yaxis()
        for y, r in zip(ys, rows):
            ax.text(min(r[1] + .02, .9), y, f'{r[1]:.2f}', va='center', fontsize=8)
        ax.set_title(f'{LABELS[t]} · {mode}', fontsize=9, loc='left')
    fig.tight_layout(), fig.savefig(OUT / 'headline.png', dpi=150), plt.close(fig)

    # ③ 비용: 대상별 생성+채점 합계(장부 기준, 파이프라인은 장부 밖)
    usd = lambda r: r['usd']['total'] if 'total' in r['usd'] else r['usd']['generate'] + r['usd']['judge']   # v2는 장부 태그 합계만 있다
    costs = [(LABELS[t] + ('·S' if m == 'S' else ''), usd(results[(t, m)])) for t, m in
             [('guard', 'G'), ('main', 'G'), ('qa', 'S'), ('qa', 'G'), ('review', 'G'), ('world', 'G'), ('editing', 'G'), ('research', 'G'), ('rating', 'G')]
             if (t, m) in results]
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.bar([c[0] for c in costs], [c[1] for c in costs], color='#4c78a8')
    for i, c in enumerate(costs):
        ax.text(i, c[1], f'{c[1]:.2f}', ha='center', va='bottom', fontsize=8)
    ax.set_ylabel('USD(추정)'), ax.set_title('대상별 실행 비용: 생성+채점(gpt-5.6-luna 단가로 추정, 웹 검색 도구 요금 제외)', fontsize=9)
    plt.xticks(rotation=20, fontsize=8)
    fig.tight_layout(), fig.savefig(OUT / 'cost.png', dpi=150), plt.close(fig)

    # ④ 작품 Q&A 검색 Recall@k 곡선
    if ('qa', 'S') in results and results[('qa', 'S')]['summary'].get('recall_curve'):
        curve = results[('qa', 'S')]['summary']['recall_curve']
        ks = sorted(curve, key=int)
        vals = [curve[k] for k in ks]
        fig, ax = plt.subplots(figsize=(5, 3))
        ax.plot([int(k) for k in ks], vals, marker='o', color='#4c78a8')
        for k, v in zip(ks, vals):
            ax.annotate(f'{v:.2f}', (int(k), v), textcoords='offset points', xytext=(0, 6), ha='center', fontsize=8)
        ax.set_xticks([int(k) for k in ks]), ax.set_ylim(0, 1), ax.set_xlabel('k (상위 k개 검색 결과)')
        ax.set_title('작품 Q&A 원문 검색 Recall@k', fontsize=10)
        fig.tight_layout(), fig.savefig(OUT / 'qa-recall-curve.png', dpi=150), plt.close(fig)
    print('그림:', ', '.join(p.name for p in OUT.glob('*.png')))


if __name__ == '__main__':
    sys.exit(draw())
