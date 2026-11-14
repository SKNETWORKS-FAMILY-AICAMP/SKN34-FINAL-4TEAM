"""results/*.json 집계 수치를 docs/evaluation/novelbrain.md에 붙일 마크다운 표로 바꿔 출력한다. 호출·계산 없음.

    cd backend/ai-service && python3 eval/novelbrain/report.py

검색 표는 `<데이터셋>-retrieval.json`(작업 A의 시작점 낱말 경계 수정 뒤)과 `<데이터셋>-retrieval-before-seed-fix.json`(수정 전)을 함께 읽는다.
MuSiQue 답·TimeChara도 `*-before-seed-fix.json`(수정 전 문맥)과 수정 뒤 결과를 나란히 낸다. KoTimeChara는 `ko-timechara*.json`.
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
    data, before = load(f'{name}-answers'), load(f'{name}-answers-before-seed-fix')
    if not data:
        return ''
    hops = sorted(next(iter(data['configs'].values()))['by_hops'])

    def cell(config, key):
        block = (before or {}).get('configs', {}).get(config)
        return f"{block[key]:.3f}" if block else '-'
    rows = [[NAMES[c], cell(c, 'em'), f"{b['em']:.3f}", cell(c, 'f1'), f"{b['f1']:.3f}", str(b['n']), str(b['failed'])]
            + [f"{b['by_hops'][h]['f1']:.3f}" for h in hops] for c in ordered(data['configs']) for b in [data['configs'][c]]]
    pairs = [[label, sign((before or {}).get('paired_em', {}).get(key)), sign(data['paired_em'].get(key))] for key, label in ANSWER_PAIRS] \
        if 'paired_em' in data else []
    return (table(['구성', 'EM 수정 전', 'EM 수정 후', 'F1 수정 전', 'F1 수정 후', 'n(후)', '실패(후)'] + [f'F1 {h}홉(후)' for h in hops], rows)
            + f"\n\n리더 모델 `{data['model']}`, 문맥은 각 구성의 상위 {data['k']}개 문단 전문."
            + ('\n\n같은 질문의 EM 짝 부호 검정(앞만 맞음 : 뒤만 맞음):\n\n' + table(['앞 대 뒤', '수정 전', '수정 후'], pairs) if pairs else ''))


TC_PAIRS = (('s3|s2', '0+1+2+3 대 0+1+2'), ('s3|zero', '0+1+2+3 대 검색 없음'), ('s3|ppr', '0+1+2+3 대 그래프만'), ('s2|s1', '0+1+2 대 0+1'),
            ('s1|ppr', '0+1 대 그래프만'), ('ppr|zero', '그래프만 대 검색 없음'), ('s2|vector', '0+1+2 대 벡터만'), ('s2|bm25', '0+1+2 대 BM25만'),
            ('s3|vector', '0+1+2+3 대 벡터만'), ('s3|bm25', '0+1+2+3 대 BM25만'))
KINDS = ('future', 'past-only', 'past-absence', 'past-presence')


def psign(v: dict | None) -> str:
    """`paired()` 결과의 '앞만 : 뒤만 (p)'."""
    return f"{v['a_only']}:{v['b_only']} (p={v['p']:.3f})" if v else '-'


def type_cell(block: dict, kind: str) -> str:
    v = block['by_type'].get(kind)
    return f"{v['score']:.2f} [{v['ci'][0]:.2f}, {v['ci'][1]:.2f}]" if v else '-'


def timechara() -> str:
    data, before = load('timechara'), load('timechara-before-seed-fix')
    if not data:
        return ''
    rows = [[NAMES[c], f"{b['weighted']:.3f}"] + [type_cell(b, k) for k in KINDS]
            + [f"{b['personality']:.2f}" if b['personality'] is not None else '-', f"{b['future_ctx']:.2f}", f"{b['foreign_ctx']:.2f}", str(b['failed'])]
            for c in ordered(data['configs']) for b in [data['configs'][c]]]
    questions = data.get('questions') or 4 * data['per_type']
    out = [f"**검증 {questions}건, 시작점 수정 뒤 문맥**\n\n"
           + table(['구성', '시공간(가중)', 'future', 'past-only', 'past-absence', 'past-presence', '성격(1~7)', '문맥 미래', '문맥 타인 기억', '실패'], rows)
           + f"\n\n모델 `{data['model']}`, 문맥은 상위 {data['k_context']}개 항목. 유형 칸은 평균 [Wilson 95% 구간], 가중은 공개 600건의 유형 구성(200/200/100/100) 비율로 가중한 평균."]
    if 'first_80' in data and before:
        first = data['first_80']['configs']
        compare = [[NAMES[c], f"{before['configs'][c]['weighted']:.3f}", f"{first[c]['weighted']:.3f}", f"{data['configs'][c]['weighted']:.3f}",
                    (f"{before['configs'][c]['personality']:.2f}" if before['configs'][c]['personality'] is not None else '-'),
                    (f"{first[c]['personality']:.2f}" if first[c]['personality'] is not None else '-')]
                   for c in ordered(data['configs']) if c in before['configs']]
        out.append('**처음 평가한 80건(유형당 20)에서 수정 전과 후, 그리고 600건 전체**\n\n'
                   + table(['구성', '80건 수정 전 시공간', '80건 수정 후 시공간', '600건 수정 후 시공간', '80건 수정 전 성격', '80건 수정 후 성격'], compare))
        pairs = [[label, psign(before['paired'].get(key)), psign(data['first_80']['paired'].get(key)), psign(data['paired'].get(key))]
                 for key, label in TC_PAIRS]
        out.append('같은 질문에서 짝 비교(앞 구성만 맞은 질문 수 : 뒤 구성만 맞은 질문 수, 정확 부호 검정 양측 p):\n\n'
                   + table(['비교', '80건 수정 전', '80건 수정 후', f'{questions}건 수정 후'], pairs))
    else:
        out.append('같은 질문에서 짝 비교:\n\n' + table(['비교', '앞만 : 뒤만'], [[label, psign(data['paired'].get(key))] for key, label in TC_PAIRS]))
    if 'paired_by_type' in data:
        kinds = [[label] + [psign(data['paired_by_type'][k].get(key)) for k in KINDS] for key, label in TC_PAIRS[:4]]
        out.append('유형별 짝 비교(앞만 : 뒤만):\n\n' + table(['비교'] + list(KINDS), kinds))
    return '\n\n'.join(out)


KO_TC_ROWS = ('zero', 'ppr', 'vector', 'bm25', 's1', 's2', 's3', 'no_graph', 'no_vector', 'no_bm25')
KO_TC_NAMES = {**NAMES, 'no_graph': '전체 − 그래프', 'no_vector': '전체 − 벡터', 'no_bm25': '전체 − BM25', 's2': '0+1+2 (= 전체 − 필터)', 's3': '0+1+2+3 (= 전체)'}
KO_TC_PAIRS = (('s3|s2', '전체 대 전체 − 필터'), ('s3|no_graph', '전체 대 전체 − 그래프'), ('s3|no_vector', '전체 대 전체 − 벡터'),
               ('s3|no_bm25', '전체 대 전체 − BM25'), ('s3|vector', '전체 대 벡터만'), ('s3|bm25', '전체 대 BM25만'), ('s3|ppr', '전체 대 그래프만'),
               ('s3|zero', '전체 대 검색 없음'), ('s2|s1', '0+1+2 대 0+1'), ('s1|ppr', '0+1 대 그래프만'), ('ppr|zero', '그래프만 대 검색 없음'))


def ko_timechara_data() -> str:
    """KoTimeChara 데이터 구성(분포만, 작품 제목·원문 없음)과 근거 대조·자동 점검 통과율."""
    data = load('ko-timechara-data')
    if not data:
        return ''
    kinds = {'web': '웹소설(수집본)', 'classic': '고전(위키문헌)'}
    works = [[kinds[k], str(b['works']), str(b['episodes']), f"{b['episodes_per_work']['min']}~{b['episodes_per_work']['max']}",
              f"{b['chars_per_episode']['median']:,} ({b['chars_per_episode']['min']:,}~{b['chars_per_episode']['max']:,})", f"{b['total_chars']:,}"]
             for k, b in data['data']['by_kind'].items()]
    q, e, c = data['questions'], data['extraction'], data['question_checks']
    types = [[t, str(q['by_type'][t])] for t in KINDS if t in q['by_type']]
    label, learn = e['label'], e['learn']
    rate = lambda a, b: f'{a:,}/{b:,} ({a / b:.1%})' if b else '-'  # noqa: E731
    checks = [['사건(근거 문장이 원문에 글자 그대로 있음 + 요약·참여 인물 규칙)', rate(label.get('kept', 0), label.get('events', 0))],
              ['참여·목격 인물(이름이 본문에 있고 근거 문장이 원문에 있음)', rate(label.get('refs_kept', 0), label.get('refs', 0))],
              ['나중에 전해 들은 인물(앞 회차 사건·새로 안 인물·근거 문장)', rate(learn.get('learned_kept', 0), learn.get('learned', 0))],
              ['근거 문장 대조 통과율(사건·인물·전해 들음 전체)', rate(e['evidence_ok'], e['evidence_checked'])],
              ['질문 자동 점검(지식표로 유형 규칙을 다시 확인)', rate(c['kept'], c['audited'])],
              ['검수 표본(무작위 10%)의 근거 문장 대조', rate(c['review_evidence_ok'], c['review_sample'])]]
    genres = ', '.join(f'{g} {n}편' for g, n in sorted(data['data']['genres'].items(), key=lambda kv: -kv[1]))
    return ('\n\n'.join([table(['종류', '작품', '회차', '작품당 회차', '회차 글자 중앙값(범위)', '글자 합계'], works), f'장르(키워드 규칙으로 추정, 작품 수): {genres}.',
                          table(['유형', '질문'], types + [['합계', str(q['total'])]]),
                          f"종류별 {', '.join(f'{k} {v}' for k, v in q['by_kind'].items())}; 형식별 {', '.join(f'{k} {v}' for k, v in q['by_style'].items())}; "
                          f"작품당 {q['per_work']['min']}~{q['per_work']['max']}문항; 질문 대상 인물 {q['characters']}명(작품별 합).",
                          table(['자동 점검', '통과'], checks)]))


def ko_timechara() -> str:
    data = load('ko-timechara')
    if not data:
        return ''
    rows = [[KO_TC_NAMES[c], f"{b['weighted']:.3f}"] + [type_cell(b, k) for k in KINDS]
            + [f"{b['personality']:.2f}" if b['personality'] is not None else '-', f"{data['leak'][c]['future_ctx']:.2f}",
               f"{data['leak'][c]['unseen_ctx']:.2f}", f"{data['leak'][c]['foreign_ctx']:.2f}", str(b['failed'])]
            for c in KO_TC_ROWS if c in data['configs'] for b in [data['configs'][c]]]
    out = [table(['구성', '시공간(가중)', 'future', 'past-only', 'past-absence', 'past-presence', '성격(1~7)', '문맥 미래(필터 조건)', '문맥 미래·미목격(정답표 기준)',
                  '문맥 타인 기억', '실패'], rows)
           + f"\n\n질문 {data['questions']}개. 유형 칸은 평균 [Wilson 95% 구간], 가중은 공개 600건의 유형 구성 비율. 성격은 누적 단계와 기준선만 채점했다."]
    pairs = [[label, psign(data['paired'].get(key)), psign(data['by_kind']['web']['paired'].get(key)), psign(data['by_kind']['classic']['paired'].get(key))]
             for key, label in KO_TC_PAIRS]
    out.append('같은 질문에서 짝 비교(앞 구성만 맞은 질문 수 : 뒤 구성만 맞은 질문 수, 정확 부호 검정 양측 p):\n\n'
               + table(['비교', '전체', '웹소설', '고전'], pairs))
    kinds = [[label] + [psign(data['by_type_paired'][k].get(key)) for k in KINDS] for key, label in KO_TC_PAIRS]
    out.append('유형별 짝 비교(앞만 : 뒤만):\n\n' + table(['비교'] + list(KINDS), kinds))
    groups = []
    for group, label in (('web', '웹소설'), ('classic', '고전')):
        block = data['by_kind'][group]
        groups.append([label, str(block['questions'])] + [f"{block['configs'][c]['weighted']:.3f}" if c in block['configs'] else '-'
                                                          for c in ('zero', 'ppr', 'vector', 'bm25', 's1', 's2', 's3')])
    out.append('작품 종류별 시공간(가중):\n\n' + table(['종류', '질문', '검색 없음', '그래프만', '벡터만', 'BM25만', '0+1', '0+1+2', '0+1+2+3'], groups))
    genres = sorted(data['by_genre'])
    by_genre = [[g, str(data['by_genre'][g]['questions'])] + [f"{data['by_genre'][g]['configs'][c]['weighted']:.3f}" if c in data['by_genre'][g]['configs'] else '-'
                                                           for c in ('zero', 'vector', 's2', 's3')] for g in genres]
    out.append('장르별 시공간(가중):\n\n' + table(['장르', '질문', '검색 없음', '벡터만', '0+1+2', '0+1+2+3'], by_genre))
    return '\n\n'.join(out)


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
                          ('MuSiQue 답 정확도', answers('musique')), ('TimeChara', timechara()), ('한국어 샘플', ko()),
                          ('KoTimeChara 데이터', ko_timechara_data()), ('KoTimeChara', ko_timechara())):
        if body:
            print(f'## {heading}\n\n{body}\n')
