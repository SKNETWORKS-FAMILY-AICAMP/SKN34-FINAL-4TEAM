"""KoTimeChara 데이터 구성 집계: 작품 수·회차 수·분량·장르 분포, 추출의 근거 대조 통과율, 질문 구성과 자동 점검 통과율.

작품 제목·원문·질문·요약은 쓰지 않고 분포와 개수만 `results/ko-timechara-data.json`에 쓴다(커밋 대상). 호출 없음.

    cd backend/ai-service && uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_report.py
"""

import json
import statistics
from collections import Counter

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
from kt_common import KT, RESULTS


def describe_works(works: dict) -> dict:
    """작품 수·종류별(웹소설·고전) 회차 수·작품당 회차 수·회차 글자 수(최소·중앙값·최대)·글자 합계와 장르별 작품 수."""
    by_kind = {}
    for kind in dict.fromkeys(w['kind'] for w in works.values()):
        mine = [w for w in works.values() if w['kind'] == kind]
        chars = [len(e['text']) for w in mine for e in w['episodes']]
        counts = [len(w['episodes']) for w in mine]
        by_kind[kind] = {'works': len(mine), 'episodes': sum(counts), 'episodes_per_work': {'min': min(counts), 'max': max(counts)},
                         'chars_per_episode': {'min': min(chars), 'median': int(statistics.median(chars)), 'max': max(chars)},
                         'total_chars': sum(chars)}
    return {'works': len(works), 'by_kind': by_kind, 'genres': dict(Counter(w['genre'] for w in works.values()))}


def describe_questions(rows: list[dict]) -> dict:
    per_work = Counter(r['work'] for r in rows)
    return {'total': len(rows), 'by_type': dict(Counter(r['data_type'] for r in rows)), 'by_kind': dict(Counter(r['kind'] for r in rows)),
            'by_genre': dict(Counter(r['genre'] for r in rows)), 'by_style': dict(Counter(r['question_generation'] for r in rows)),
            'per_work': {'min': min(per_work.values()), 'max': max(per_work.values())},
            'characters': len({(r['work'], r['character']) for r in rows})}


def main() -> None:
    from kt_exec import load_works
    from kt_extract import summarize_extraction

    works = load_works()
    stats = [json.loads((KT / 'works' / wid / 'extract_stats.json').read_text()) for wid in works]
    extraction = summarize_extraction([{'stats': {part: s[part] for part in ('label', 'learn', 'world')}, 'failed': s['failed']} for s in stats])
    rows = [json.loads(line) for line in (KT / 'questions.jsonl').read_text().splitlines()]
    result = {'data': describe_works(works), 'extraction': extraction, 'questions': describe_questions(rows),
              'question_checks': json.loads((KT / 'question_stats.json').read_text())}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / 'ko-timechara-data.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
