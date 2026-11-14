"""results/*.json 집계 수치를 docs/evaluation/novelbrain.md에 붙일 마크다운 표로 바꿔 출력한다. 호출·계산 없음.

    cd backend/ai-service && python3 eval/novelbrain/report.py
"""

import json
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / 'results'
NAMES = {'zero': '검색 없음', 'ppr': '그래프(PPR)만 = 0단계', 'vector': '벡터만', 'bm25': 'BM25만', 's1': '0+1', 's2': '0+1+2', 's3': '0+1+2+3',
         'gold': '정답 근거 문단(상한)', 'none': '문단 없음(닫힌 책)'}
ORDER = ('zero', 'none', 'ppr', 'vector', 'bm25', 's1', 's2', 's3', 'gold')


def load(name: str):
    path = RESULTS / f'{name}.json'
    return json.loads(path.read_text()) if path.exists() else None


def table(header: list[str], rows: list[list[str]]) -> str:
    return '\n'.join(['| ' + ' | '.join(header) + ' |', '|' + '|'.join(['---'] + ['---:'] * (len(header) - 1)) + '|']
                     + ['| ' + ' | '.join(r) + ' |' for r in rows])


def ordered(configs: dict):
    return [c for c in ORDER if c in configs]


def retrieval(name: str, title: str) -> str:
    data = load(f'{name}-retrieval')
    if not data:
        return ''
    k, ceil = data['k'], data['ceiling']
    groups = sorted(next(iter(data['configs'].values())).get('by_group', {}))
    header = ['구성', f'Recall@{k}', f'P@{k}'] + [f'Recall@{k} {g}홉' for g in groups]
    rows = [[NAMES[c], f"{b[f'recall@{k}']:.3f}", f"{b[f'p@{k}']:.3f}"] + [f"{b['by_group'][g][f'recall@{k}']:.3f}" for g in groups]
            for c in ordered(data['configs']) for b in [data['configs'][c]]]
    n = next(iter(data['configs'].values()))['n']
    return (f"**{title}** (질문 {n}개, 문단 {data['passages']}개, 개체 카드 {data['entities']}개, 관계 {data['relations']}개)\n\n"
            + table(header, rows) + f"\n\n천장값(질문마다 정답 근거 수로 계산한 최대치): Recall@{k} {ceil[f'recall@{k}']:.3f}, P@{k} {ceil[f'p@{k}']:.3f}")


def answers(name: str) -> str:
    data = load(f'{name}-answers')
    if not data:
        return ''
    rows = [[NAMES[c], f"{b['em']:.3f}", f"{b['f1']:.3f}", str(b['n']), str(b['failed'])] + [f"{b['by_hops'][h]['f1']:.3f}" for h in sorted(b['by_hops'])]
            for c in ordered(data['configs']) for b in [data['configs'][c]]]
    hops = sorted(next(iter(data['configs'].values()))['by_hops'])
    return table(['구성', 'EM', 'F1', 'n', '실패'] + [f'F1 {h}홉' for h in hops], rows) + f"\n\n리더 모델 `{data['model']}`, 문맥은 각 구성의 상위 {data['k']}개 문단 전문."


def timechara() -> str:
    data = load('timechara')
    if not data:
        return ''
    kinds = ('future', 'past-only', 'past-absence', 'past-presence')

    def cell(block, kind):
        v = block['by_type'].get(kind)
        return f"{v['score']:.2f} [{v['ci'][0]:.2f}, {v['ci'][1]:.2f}]" if v else '-'
    rows = [[NAMES[c], f"{b['weighted']:.3f}"] + [cell(b, k) for k in kinds]
            + [f"{b['personality']:.2f}" if b['personality'] is not None else '-', f"{b['future_ctx']:.2f}", f"{b['foreign_ctx']:.2f}", str(b['failed'])]
            for c in ordered(data['configs']) for b in [data['configs'][c]]]
    return (table(['구성', '시공간(가중)', 'future', 'past-only', 'past-absence', 'past-presence', '성격(1~7)', '문맥 미래', '문맥 타인 기억', '실패'], rows)
            + f"\n\n유형마다 {data['per_type']}문항(합 {4 * data['per_type']}), 모델 `{data['model']}`, 문맥은 상위 {data['k_context']}개 항목. "
              "유형 칸은 평균 [Wilson 95% 구간], 가중은 공개 600건의 유형 구성(200/200/100/100) 비율로 가중한 평균.")


def ko() -> str:
    data = load('ko-retrieval')
    if not data:
        return ''
    k = data['k']
    rows = [[NAMES[c], f"{b['known'][f'recall@{k}']:.2f}", f"{b['known'][f'p@{k}']:.2f}", f"{b['setting'][f'recall@{k}']:.2f}",
             f"{b['setting'][f'p@{k}']:.2f}", f"{b['future']['leak']:.2f}", f"{b['unwitnessed']['leak']:.2f}"]
            for c in ordered(data['configs']) for b in [data['configs'][c]]]
    return (table(['구성', 'known R@5', 'known P@5', 'setting R@5', 'setting P@5', 'future 누설', 'unwitnessed 누설'], rows)
            + f"\n\n질문 {data['n']}개: " + ', '.join(f'{k} {v}' for k, v in data['by_kind'].items()))


if __name__ == '__main__':
    for heading, body in (('MuSiQue 근거 검색', retrieval('musique', 'MuSiQue')), ('NarrativeQA 근거 검색', retrieval('narrativeqa', 'NarrativeQA')),
                          ('MuSiQue 답 정확도', answers('musique')), ('TimeChara', timechara()), ('한국어 샘플', ko())):
        if body:
            print(f'## {heading}\n\n{body}\n')
