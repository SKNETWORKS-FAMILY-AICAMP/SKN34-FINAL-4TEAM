"""기획·집필·수정(Writing & Editing) 평가: 실제 `app.writing.agent`의 patch·plan·draft에 고정 문맥(앞 회차 발췌)을 넣는다.
채팅 경로의 허용 문맥 조립(Content MCP work_context_read)은 건너뛰고 같은 모양의 문맥 글을 직접 준다. 검색을 쓰지 않아 S 모드는 없다."""

import difflib

import common

DATASET = common.DATA / 'datasets' / 'editing.jsonl'


def cases() -> list[dict]:
    return common.jsonl(DATASET)


def generate(case: dict, mode: str) -> dict:
    if mode != 'G':
        raise SystemExit('집필은 G·R 모드만 쓴다')
    from app.writing import agent
    from app.writing.models import DraftRequest, PatchRequest, PlanRequest
    if case['family'] == 'patch':
        r = agent.patch(PatchRequest(selection=case['selection'], instruction=case['instruction'], precedingText=case.get('before', ''),
                                     followingText=case.get('after', ''), context=case.get('context', '')))
        return {'after': r.after}
    if case['family'] == 'plan':
        r = agent.plan(PlanRequest(episodeNumber=case['episode'], request=case['request'], context=case.get('context', '')))
        return {'plans': [p.model_dump() for p in r.plans], 'notes': r.notes}
    r = agent.draft(DraftRequest(episodeNumber=case['episode'], plan=case['plan'], context=case.get('context', '')))
    return {'text': r.text}


def score(case: dict, capture: dict) -> dict:
    out = capture.get('output')
    if out is None:
        return {'measured': 0}
    if case['family'] == 'patch':
        after = out['after'].strip()
        return {'measured': 1, 'exact': int(after == case['expected']),
                'preserved': int(difflib.SequenceMatcher(None, after, case['expected']).ratio() >= 0.97)}
    if case['family'] == 'plan':
        words = ' '.join(p['title'] + ' ' + ' '.join(p['beats']) for p in out['plans'])
        ok = 1 <= len(out['plans']) <= case['max_plans'] and not any(name in words for name in case['banned'])
        return {'measured': 1, 'constraints': int(ok)}
    text = out['text']
    ok = case['min_chars'] <= len(text) <= case['max_chars'] and not any(name in text for name in case['banned'])
    return {'measured': 1, 'constraints': int(ok), 'chars': len(text)}


def summary(cases: dict, scored: list) -> dict:
    return common.summarize(cases, scored, means=('chars',))
