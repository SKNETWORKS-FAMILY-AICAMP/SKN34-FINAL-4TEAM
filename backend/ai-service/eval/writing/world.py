"""세계관 평가: 로컬 스택의 해리 포터 연결 세계관을 실제 `world_review.service.linked_world`로 읽고,
check는 카드 하나의 본문을 모순되게 바꾼 요청을 `review`에, enrich는 `enrich`에 넣는다. impact는 이번 기준선에서 뺐다(원고·계획 읽기 경로가 커서 다음 차수).
검색 단계가 없어 S 모드는 없다."""

import re

import common

DATASET = common.DATA / 'datasets' / 'world.jsonl'
FORBIDDEN = ('호크룩스', '죽음의 성물', '혼혈 왕자', '이중첩자', '알고 보니', '정체는')   # hp_traits의 모든 인물 공통 금지 낱말 일부(후반 반전)


def cases() -> list[dict]:
    return common.jsonl(DATASET)


def prepare(mode: str) -> None:
    common.login()


def generate(case: dict, mode: str) -> dict:
    if mode != 'G':
        raise SystemExit('세계관은 G·R 모드만 쓴다')
    from app.world_review import service
    request, world_id, revision = service.linked_world(common.WORK_ID)
    titles = {c.id: c.title for c in request.cards}
    if case['family'] == 'enrich':
        result = service.enrich(case['request'], request, world_id, revision)
        return {'fixes': [f.model_dump() for f in result.fixes], 'note': result.note}
    if case['family'] == 'conflict':
        cards = [c.model_copy(update={'body': case['body']}) if c.title == case['card'] else c for c in request.cards]
        if cards == request.cards:
            raise LookupError('바꿀 카드가 세계관에 없다')
        request = request.model_copy(update={'cards': cards})
    result = service.review(request)
    return {'findings': [{'cards': [titles.get(i, i) for i in f.cardIds], 'kind': f.kind, 'message': f.message} for f in result.findings],
            'reviewed': result.reviewedCards}


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r'(?<=[.!?다])\s+', text) if len(s.strip()) > 3]


def score(case: dict, capture: dict) -> dict:
    out = capture.get('output')
    if out is None:
        return {'measured': 0}
    if case['family'] == 'enrich':
        texts = [f['text'] for f in out['fixes'] if f['cardTitle'] == case['card']]
        body = next((f['text'] for f in out['fixes'] if f['cardTitle'] == case['card'] and f['target'] == 'body'), None)
        original = _sentences(case['original'])
        kept = sum(s in body for s in original) / len(original) if body is not None and original else 0.0
        return {'measured': 1, 'valid': int(bool(texts)), 'kept': kept, 'forbidden': sum(w in t for t in texts for w in FORBIDDEN)}
    s = {'measured': 1, 'findings': len(out['findings'])}
    if case['family'] == 'conflict':
        s['detected'] = int(any({case['card'], case['partner']} & set(f['cards']) for f in out['findings']))
    return s


def summary(cases: dict, scored: list) -> dict:
    return common.summarize(cases, scored, means=('findings', 'kept', 'forbidden'))
