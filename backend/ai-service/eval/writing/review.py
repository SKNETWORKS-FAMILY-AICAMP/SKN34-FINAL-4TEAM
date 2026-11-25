"""원고 검수 평가: 해리 포터 회차 발췌에 모순·오탈자를 넣은 본문을 실제 `manuscript_review.service._review`(기준 회차 시점 설정을 Content에서 읽고
모델 호출·인용 검증·위치 찾기)에 넣는다. 초안 읽기(episode_read)만 건너뛰고 본문을 직접 준다. 검색 단계가 없어 S 모드는 없다(설정 문맥은 G 캡처에 남긴다)."""

import common

DATASET = common.DATA / 'datasets' / 'review.jsonl'


def cases() -> list[dict]:
    return common.jsonl(DATASET)


def prepare(mode: str) -> None:
    common.login()


def generate(case: dict, mode: str) -> dict:
    if mode != 'G':
        raise SystemExit('원고 검수는 G·R 모드만 쓴다')
    from app.manuscript_review.models import ReviewRequest
    from app.manuscript_review.service import _review
    result = _review(ReviewRequest(workId=common.WORK_ID, episode=case['episode'], check=case['check']), case['body'], 0)
    return {'findings': [f.model_dump() for f in result.findings], 'gaps': result.gaps}


def _hit(finding: dict, span: dict) -> bool:
    return finding['start'] is not None and finding['start'] < span['end'] and span['start'] < finding['end']


def score(case: dict, capture: dict) -> dict:
    out = capture.get('output')
    if out is None:
        return {'measured': 0}
    findings = out['findings']
    s = {'measured': 1, 'findings': len(findings)}
    if case['family'] == 'contradiction':
        s['detected'] = int(any(_hit(f, span) for f in findings for span in case['inserted']))
    elif case['family'] == 'typo':
        s |= {'typos_found': sum(any(_hit(f, span) for f in findings) for span in case['inserted']), 'typos': len(case['inserted'])}
    else:
        s['false_alarm'] = int(any(f['status'] == 'confirmed' for f in findings))
    return s


def summary(cases: dict, scored: list) -> dict:
    out = common.summarize(cases, scored, means=('findings',))
    typo = [s for *_, s in scored if s.get('measured') and 'typos' in s]
    if typo:
        out['typo_recall'] = common.rate(sum(s['typos_found'] for s in typo), sum(s['typos'] for s in typo))
    return out
