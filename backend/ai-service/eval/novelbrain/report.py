"""results/*.json 집계 수치를 docs/evaluation/novelbrain.md에 붙일 마크다운 표로 바꿔 출력한다. 호출·계산 없음.

    cd backend/ai-service && python3 eval/novelbrain/report.py

검색 표는 `<데이터셋>-retrieval.json`(작업 A의 시작점 낱말 경계 수정 뒤)과 `<데이터셋>-retrieval-before-seed-fix.json`(수정 전)을 함께 읽는다.
"""

import json
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / 'results'
NAMES = {'zero': '검색 없음', 'ppr': '그래프(PPR)만 = 0단계', 'vector': '벡터만', 'bm25': 'BM25만', 's1': '0+1', 's2': '0+1+2', 's3': '0+1+2+3',
         'gold': '정답 근거 문단(상한)', 'none': '문단 없음(닫힌 책)'}
ORDER = ('zero', 'none', 'ppr', 'vector', 'bm25', 's1', 's2', 's3', 'gold')
# 문헌형 검색 표: 단독 3 + 누적 2 + 하나씩 빼기. 전체 = 0+1+2, 'no_bm25'는 0+1과 같은 구성이다
RETRIEVAL_ROWS = (('ppr', '그래프만 (= 0단계)'), ('vector', '벡터만'), ('bm25', 'BM25만'), ('s1', '0+1 (= 전체 − BM25)'), ('s2', '0+1+2 (= 전체)'),
                  ('no_graph', '전체 − 그래프 (벡터+BM25)'), ('no_vector', '전체 − 벡터 (그래프+BM25)'))
RETRIEVAL_PAIRS = (('s1|ppr', '0+1 대 그래프만'), ('s1|vector', '0+1 대 벡터만 (벡터에 그래프를 더한 효과)'), ('s2|s1', '0+1+2 대 0+1 (BM25를 더한 효과)'),
                   ('s2|vector', '0+1+2 대 벡터만'), ('s2|bm25', '0+1+2 대 BM25만'), ('s2|ppr', '0+1+2 대 그래프만'),
                   ('s2|no_graph', '전체 대 전체 − 그래프'), ('s2|no_vector', '전체 대 전체 − 벡터'), ('vector|ppr', '벡터만 대 그래프만'))
KO_ROWS = (('ppr', '그래프만 (= 0단계)'), ('vector', '벡터만'), ('bm25', 'BM25만'), ('s1', '0+1'), ('s2', '0+1+2 (= 전체 − 필터)'),
           ('s3', '0+1+2+3 (= 전체)'), ('no_graph', '전체 − 그래프'), ('no_vector', '전체 − 벡터'), ('no_bm25', '전체 − BM25'))
KO_PAIRS = (('s3|s2', '전체 대 전체 − 필터'), ('s3|no_graph', '전체 대 전체 − 그래프'), ('s3|no_vector', '전체 대 전체 − 벡터'),
            ('s3|no_bm25', '전체 대 전체 − BM25'), ('s3|vector', '전체 대 벡터만'), ('s3|bm25', '전체 대 BM25만'), ('s3|ppr', '전체 대 그래프만'))
ANSWER_PAIRS = (('ppr|vector', '그래프만 대 벡터만'), ('ppr|s2', '그래프만 대 0+1+2'), ('ppr|bm25', '그래프만 대 BM25만'), ('s2|vector', '0+1+2 대 벡터만'),
                ('s2|none', '0+1+2 대 문단 없음'), ('vector|none', '벡터만 대 문단 없음'), ('gold|s2', '정답 근거 문단 대 0+1+2'))


def load(name: str):
    path = RESULTS / f'{name}.json'
    return json.loads(path.read_text()) if path.exists() else None


def table(header: list[str], rows: list[list[str]]) -> str:
    return '\n'.join(['| ' + ' | '.join(header) + ' |', '|' + '|'.join(['---'] + ['---:'] * (len(header) - 1)) + '|']
                     + ['| ' + ' | '.join(r) + ' |' for r in rows])


def ordered(configs: dict):
    return [c for c in ORDER if c in configs]


def sign(v: dict | None) -> str:
    """'오른:내린 (p)'. 앞 구성이 뒤 구성보다 나은 질문 수 : 못한 질문 수."""
    return f"{v['up']}:{v['down']} (p={v['p']:.3f})" if v else '-'


def retrieval(name: str, title: str) -> str:
    data, before = load(f'{name}-retrieval'), load(f'{name}-retrieval-before-seed-fix')
    if not data:
        return ''
    k, ceil = data['k'], data['ceiling']
    groups = sorted(data['configs']['s2'].get('by_group', {}))
    header = ['구성', f'Recall@{k} 수정 전', f'Recall@{k} 수정 후', f'P@{k} 수정 후'] + [f'R@{k} {g}홉(수정 후)' for g in groups]
    rows = [[label, f"{before['configs'][c][f'recall@{k}']:.3f}" if before else '-', f"{b[f'recall@{k}']:.3f} ± {b[f'recall@{k}_se']:.3f}",
             f"{b[f'p@{k}']:.3f} ± {b[f'p@{k}_se']:.3f}"] + [f"{b['by_group'][g][f'recall@{k}']:.3f}" for g in groups]
            for c, label in RETRIEVAL_ROWS for b in [data['configs'][c]]]
    n = data['configs']['s2']['n']
    pairs = [[label, sign(before['paired']['all'].get(key)) if before else '-', sign(data['paired']['all'].get(key))] for key, label in RETRIEVAL_PAIRS]
    for g in groups:  # 사후 하위집단(홉)
        size = data['configs']['s2']['by_group'][g]['n']
        pairs += [[f'{label} — {g}홉만({size}문항, 사후 하위집단)', sign(before['paired']['by_group'][g].get(key)) if before else '-',
                   sign(data['paired']['by_group'][g].get(key))]
                  for key, label in (('s2|vector', '0+1+2 대 벡터만'), ('s2|ppr', '0+1+2 대 그래프만')) if g == groups[-1]]
    fix = [[NAMES[c], sign(data['vs_previous_run'].get(c))] for c in ('ppr', 's1', 's2')] if 'vs_previous_run' in data else []
    return (f"**{title}** (질문 {n}개, 문단 {data['passages']}개, 개체 카드 {data['entities']}개, 관계 {data['relations']}개)\n\n"
            + table(header, rows) + f"\n\n천장값: Recall@{k} {ceil[f'recall@{k}']:.3f}, P@{k} {ceil[f'p@{k}']:.3f}. ± 뒤는 질문 평균의 표준오차.\n\n"
            + f"짝 부호 검정(Recall@{k}, 오른 질문 : 내린 질문, 같은 점수는 뺌, 양측 정확 검정):\n\n"
            + table(['앞 대 뒤', '수정 전', '수정 후'], pairs)
            + ('\n\n시작점 수정 자체의 효과(같은 질문, 수정 후 대 수정 전):\n\n' + table(['구성', '오른 : 내린'], fix) if fix else ''))


def answers(name: str) -> str:
    data = load(f'{name}-answers')
    if not data:
        return ''
    rows = [[NAMES[c], f"{b['em']:.3f}", f"{b['f1']:.3f}", str(b['n']), str(b['failed'])] + [f"{b['by_hops'][h]['f1']:.3f}" for h in sorted(b['by_hops'])]
            for c in ordered(data['configs']) for b in [data['configs'][c]]]
    hops = sorted(next(iter(data['configs'].values()))['by_hops'])
    paired = [[label, sign(data['paired_em'].get(key))] for key, label in ANSWER_PAIRS] if 'paired_em' in data else []
    return (table(['구성', 'EM', 'F1', 'n', '실패'] + [f'F1 {h}홉' for h in hops], rows)
            + f"\n\n리더 모델 `{data['model']}`, 문맥은 각 구성의 상위 {data['k']}개 문단 전문."
            + ('\n\n같은 질문의 EM 짝 부호 검정(앞만 맞음 : 뒤만 맞음):\n\n' + table(['앞 대 뒤', 'EM'], paired) if paired else ''))


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
    rows = [[label, f"{b['known'][f'recall@{k}']:.2f}", f"{b['known'][f'p@{k}']:.2f}", f"{b['setting'][f'recall@{k}']:.2f}",
             f"{b['setting'][f'p@{k}']:.2f}", f"{b['future']['leak']:.2f}", f"{b['unwitnessed']['leak']:.2f}"]
            for c, label in KO_ROWS for b in [data['configs'][c]]]
    kinds = (('known', 'known R@5'), ('setting', 'setting R@5'), ('future', 'future 막음'), ('unwitnessed', 'unwitnessed 막음'))
    pairs = [[label] + [sign(data['paired'][kind].get(key)) for kind, _ in kinds] for key, label in KO_PAIRS]
    return (table(['구성', 'known R@5', 'known P@5', 'setting R@5', 'setting P@5', 'future 누설', 'unwitnessed 누설'], rows)
            + f"\n\n질문 {data['n']}개: " + ', '.join(f'{k} {v}' for k, v in data['by_kind'].items())
            + '\n\n짝 부호 검정(앞 대 뒤, 앞이 나은 질문 : 못한 질문). 값은 known·setting은 Recall@5, future·unwitnessed는 누설을 막은 질문:\n\n'
            + table(['앞 대 뒤'] + [label for _, label in kinds], pairs))


if __name__ == '__main__':
    for heading, body in (('MuSiQue 근거 검색', retrieval('musique', 'MuSiQue')), ('NarrativeQA 근거 검색', retrieval('narrativeqa', 'NarrativeQA')),
                          ('MuSiQue 답 정확도', answers('musique')), ('TimeChara', timechara()), ('한국어 샘플', ko())):
        if body:
            print(f'## {heading}\n\n{body}\n')
