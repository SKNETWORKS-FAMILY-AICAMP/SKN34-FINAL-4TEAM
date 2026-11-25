"""심의 등급 평가: 실제 `rating.service._rate`(모델 판별 → 인용 구절이 원고에 있는지 검증 → 문턱값)에 회차 본문을 넣는다.
초안 읽기만 건너뛴다. 인물 카드는 비워 둔다(판별 기준은 본문). 검색이 없어 S 모드는 없다.
기대값: adult(19세), general(전체), not_adult(전체·검토 필요는 맞고 19세만 틀림: 원작의 폭력 장면), review(검토 필요·19세 모두 허용하는 경계 사례)."""

import common

DATASET = common.DATA / 'datasets' / 'rating.jsonl'


def cases() -> list[dict]:
    return common.jsonl(DATASET)


def generate(case: dict, mode: str) -> dict:
    if mode != 'G':
        raise SystemExit('심의 등급은 G·R 모드만 쓴다')
    from app.content_mcp.service import Draft
    from app.rating.service import _rate
    r = _rate(1, Draft(revision=0, title=case['title'], body=case['body']), [])
    return {'verdict': r.verdict, 'prohibited': r.prohibited, 'error': r.error,
            'levels': {a.criterion: a.level for a in (r.assessments or [])}}


def score(case: dict, capture: dict) -> dict:
    out = capture.get('output')
    if out is None or out.get('verdict') is None:
        return {'measured': 0}
    verdict, want = out['verdict'], case['expect']
    allowed = {'adult': {'adult'}, 'general': {'general'}, 'not_adult': {'general', 'needsReview'}, 'review': {'needsReview', 'adult'}}[want]
    over = (want == 'general' and verdict != 'general') or (want == 'not_adult' and verdict == 'adult')
    return {'measured': 1, 'correct': int(verdict in allowed), 'adult_case': int(want == 'adult'),
            'missed_adult': int(want == 'adult' and verdict != 'adult'), 'over_rated': int(over)}


def summary(cases: dict, scored: list) -> dict:
    out = common.summarize(cases, scored)
    m = [s for *_, s in scored if s.get('measured')]
    out['adult_recall'] = common.rate(sum(s['adult_case'] - s['missed_adult'] for s in m), sum(s['adult_case'] for s in m))
    return out
