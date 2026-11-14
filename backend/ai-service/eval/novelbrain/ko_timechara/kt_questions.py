"""KoTimeChara 질문: 정답표(지식표)에서 인물×기준 회차×사건을 골라 TimeChara 네 유형(future·past-only·past-absence·past-presence)의
질문과 공개 형식의 채점 기준 문장을 만든다. 정답표만 읽고 NovelBrain 입력(세계관)은 보지 않는다.

    cd backend/ai-service
    set -a; . <저장소 루트 .env>; set +a
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_questions.py [--mode=sync|batch] [작품 id …]

유형 규칙(기준 회차 p, 사건 회차 e, 인물 c):
- future: c가 참여하는 사건이 e > p. 인물은 그 사건을 아직 알 수 없다.
- past-presence: e ≤ p이고 c가 참여·목격했다. past-only: 같은 조건에서 자유 서술 질문(사건을 그대로 묻지 않는다).
- past-absence: e ≤ p이고 c가 참여·목격하지 않았으며 p회까지 전해 듣지도 않았고, c는 e회까지는 이미 등장했다(아직 없던 인물이 아니다).
질문 형식은 공개 TimeChara를 따른다: 정형(fact-structured)은 사건 요약을 넣은 정해진 문형, 자유(fact-freeform)는 모델이 사건을 가리키는 질문을 쓴다.
"""

import csv
import json
import random
import re
import sys
from collections import Counter

from pydantic import BaseModel

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
from batch import Round, cost_report, plan_for, run_rounds
from kt_common import KT, SEED
from kt_exec import load_works, make_executor, make_llm
from kt_label import PROFILE_INSTRUCTIONS, PROFILE_TOKENS, Profile, appearances, knows
from kt_text import squash

# 작품당 정원(합 64): 공개 600건의 유형 구성(future 1/3·past-only 1/3·absence 1/6·presence 1/6)과 같은 비율, future는 정형·자유 반반
QUOTA = {('future', 'fact-structured'): 11, ('future', 'fact-freeform'): 11, ('past-only', 'fact-freeform'): 22,
         ('past-absence', 'fact-structured'): 10, ('past-presence', 'fact-structured'): 10}
MAIN, OVERSAMPLE, QUESTION_TOKENS = 8, 1.5, 2000
REVIEW_FRACTION = 0.10

QUESTION_INSTRUCTIONS = """다음은 소설 속 한 인물과 그 인물이 관련된 사건이다. 인터뷰어가 이 인물에게 이 사건에 대해 묻는 한국어 질문을 한 문장으로 쓴다.
- 사건을 가리키는 구체적인 단서(인물·장소·물건·계기)를 넣어 어떤 사건인지 알 수 있게 하되, 사건의 결과나 질문의 답이 되는 세부는 쓰지 않는다.
- 근거 문장을 그대로 베끼지 않는다. 40~120자의 자연스러운 질문으로 쓴다."""


class Question(BaseModel):
    question: str


def main_characters(knowledge: list[dict], world: dict, k: int = MAIN) -> list[str]:
    """질문의 대상 인물: 세계관 카드가 있고 사건에 3개 회차 이상 참여·목격한 인물을 등장 회차 수가 많은 순으로 k명."""
    seen = appearances(knowledge)
    names = [n for n in world['character_id'] if len(seen.get(n, [])) >= 3]
    return sorted(names, key=lambda n: (-len(seen[n]), n))[:k]


def structured_question(kind: str, summary: str) -> str:
    """공개 정형 문형의 한국어판: future는 '솔직한 심정', absence·presence는 '직접 보았나요'."""
    if kind == 'future':
        return f'다음 일이 있었을 때 당신의 솔직한 심정은 어땠는지 말해 주세요. {summary}'
    return f'다음 장면을 직접 보았나요? {summary}'


def moment_passage(text: str, evidence: str, limit: int = 600) -> str:
    """채점 기준의 'Moment': 근거 문장이 들어 있는 원문 줄(없으면 근거 문장 그대로), 글자 상한 limit."""
    words = evidence.split()
    found = re.search(r'\s+'.join(map(re.escape, words)), text) if words else None
    if not found:
        return evidence[:limit]
    start, end = text.rfind('\n', 0, found.start()) + 1, text.find('\n', found.end())
    return text[start:end if end >= 0 else len(text)][:limit]


def facts(kind: str, name: str, cutoff: int, event: dict, passage: str) -> tuple[str, str]:
    """공개 평가 프롬프트의 [Fact] 두 문장(시간·공간). 공개 문장을 따르고 대명사만 'they'로 바꿨다(한국어 인물은 성별을 적지 않는다)."""
    summary = event['summary']
    if kind == 'future':
        return (f'Future: At the end of episode {cutoff}, {name} should (1) not be aware of or (2) contain any expression that reveals the '
                f'moment when {summary} (Since the moment is the future for {name}.)'), '-'
    speakers = ', '.join(p['name'] for p in event['participants'][:4])
    temporal = (f'Past: At the end of episode {cutoff}, {name} can respond based on the moment but should not wrongly recall it.\n'
                f"Moment (position: episode {event['episode']}, speakers: {speakers}): {passage}")
    spatial = {'past-absence': f'Absence: At the end of episode {cutoff}, {name} should not say that they were present when {summary}',
               'past-presence': f'Presence: At the end of episode {cutoff}, {name} should not say that they were absent when {summary}'}.get(kind, '-')
    return temporal, spatial


def valid_question(question: str, evidence: str, seen: set[str]) -> str | None:
    """모델이 쓴 자유 질문의 규칙 검증. 통과하면 None, 아니면 버리는 이유(고쳐 쓰지 않는다)."""
    flat, folded = ' '.join(question.split()), squash(evidence)
    asked = squash(flat)
    if not 12 <= len(flat) <= 160:
        return 'bad_length'
    if any(folded[i:i + 14] in asked for i in range(0, max(len(folded) - 13, 1), 3)):
        return 'copies_evidence'
    return 'duplicate' if flat in seen else None


def pick_specs(knowledge: list[dict], mains: list[str], quota: dict, rng: random.Random) -> list[dict]:
    """유형 규칙에 맞는 (인물, 사건, 기준 회차)를 quota만큼 뽑는다. 인물을 돌아가며 뽑고 같은 유형에서 같은 사건은 한 번만 쓴다."""
    events = {e['id']: e for r in knowledge for e in r['events']}
    seen = appearances(knowledge)
    last = max(r['episode'] for r in knowledge)
    present = {i: {p['name'] for p in e['participants'] + e['witnesses']} for i, e in events.items()}
    actors = {i: {p['name'] for p in e['participants']} for i, e in events.items()}

    def cutoffs(kind: str, name: str, event: dict) -> list[int]:
        e = event['episode']
        if kind == 'future':
            return list(range(max(min(seen[name]), e - 6), e))                 # 인물이 이미 등장했고 사건은 1~6회 뒤
        return list(range(e, min(e + 3, last) + 1))                              # 사건 뒤 0~3회 안

    def fits(kind: str, name: str, event: dict, p: int) -> bool:
        i = event['id']
        if kind == 'future':
            return name in actors[i] and event['episode'] > p
        if kind == 'past-absence':
            return name not in present[i] and min(seen[name]) <= event['episode'] <= p and not knows(knowledge, name, event, p)
        return name in present[i] and event['episode'] <= p

    specs = []
    for (kind, style), count in quota.items():
        pools = {}
        for name in mains:
            options = [(e, p) for e in events.values() for p in cutoffs(kind, name, e) if fits(kind, name, e, p)]
            rng.shuffle(options)
            pools[name] = options
        used, chosen = set(), 0
        while chosen < count and any(pools.values()):
            for name in list(pools):
                while pools[name] and pools[name][-1][0]['id'] in used:
                    pools[name].pop()
                if pools[name] and chosen < count:
                    event, p = pools[name].pop()
                    used.add(event['id'])
                    chosen += 1
                    specs.append({'type': kind, 'style': style, 'character': name, 'cutoff': p, 'event': event['id']})
    return specs


def audit(row: dict, knowledge: list[dict]) -> list[str]:
    """최종 질문 행을 지식표로 다시 확인한다(생성 규칙과 별개의 자동 점검): 위반 이유 목록, 통과하면 빈 목록."""
    events = {e['id']: e for r in knowledge for e in r['events']}
    event = events.get(row['event_id'])
    if event is None:
        return ['unknown_event']
    name, kind, p = row['character'], row['data_type'], row['cutoff']
    present = {x['name'] for x in event['participants'] + event['witnesses']}
    problems = []
    if kind == 'future' and event['episode'] <= p:
        problems.append('future_not_after_cutoff')
    if kind == 'past-absence':
        if name in present:
            problems.append('absence_but_present')
        elif knows(knowledge, name, event, p):
            problems.append('absence_but_learned')
    if kind in ('past-presence', 'past-only') and name not in present:
        problems.append('presence_but_absent')
    if kind != 'future' and event['episode'] > p:
        problems.append('past_after_cutoff')
    return problems


def profile_input(name: str, knowledge: list[dict]) -> str:
    """성격 서술 호출의 입력: 인물이 참여·목격한 사건 요약을 회차 순으로(최대 40개)."""
    lines = [f"{e['episode']}화: {e['summary']}" for r in knowledge for e in r['events']
             if name in {p['name'] for p in e['participants'] + e['witnesses']}][:40]
    return f'인물: {name}\n' + '\n'.join(lines)


def assemble(meta: dict, knowledge: list[dict], texts: dict[int, str], specs: list[dict], written: dict[int, str | None],
             quota: dict) -> tuple[list[dict], Counter]:
    """뽑은 spec으로 질문 행을 만든다. 자유 질문은 모델 출력(written[spec 번호])을 규칙으로 검증하고, 유형·형식마다 정원까지만 남긴다.
    마지막에 지식표로 자동 점검(audit)해 위반 행은 버린다. 돌려주는 집계는 버린 이유별 수이고 `audited`는 점검한 행 수다."""
    events = {e['id']: e for r in knowledge for e in r['events']}
    drops: Counter = Counter()
    rows, seen, counts = [], set(), Counter()
    for number, spec in enumerate(specs):
        key = (spec['type'], spec['style'])
        if counts[key] >= quota.get(key, 0):
            continue
        event = events[spec['event']]
        if spec['style'] == 'fact-structured':
            question = structured_question(spec['type'], event['summary'])
        else:
            question = ' '.join((written.get(number) or '').split())
            reason = 'model_failure' if not question else valid_question(question, event['evidence'], seen)
            if reason:
                drops[reason] += 1
                continue
        passage = moment_passage(texts[event['episode']], event['evidence'])
        temporal, spatial = facts(spec['type'], spec['character'], spec['cutoff'], event, passage)
        row = {'work': meta['id'], 'kind': meta['kind'], 'genre': meta['genre'], 'data_type': spec['type'], 'question_generation': spec['style'],
               'character': spec['character'], 'cutoff': spec['cutoff'], 'event_id': event['id'], 'event_episode': event['episode'],
               'event_summary': event['summary'], 'evidence': event['evidence'], 'participants': [p['name'] for p in event['participants']],
               'question': question, 'temporal_label': temporal, 'spatial_label': spatial}
        drops['audited'] += 1
        if problems := audit(row, knowledge):
            drops.update(problems)
            continue
        seen.add(question)
        counts[key] += 1
        rows.append(row | {'id': f"{meta['id']}-{len(rows) + 1:03d}"})
    return rows, drops


def review_sample(rows: list[dict], texts_of: dict[str, dict[int, str]], seed: int) -> list[dict]:
    """검수용 무작위 10%: 질문·정답(사건·근거 문장·그 사건에 있던 인물)·근거 위치(회차)와 근거 대조 결과. 저장소에 두지 않는다."""
    from kt_text import evidence_ok

    picked = random.Random(seed).sample(rows, max(1, round(len(rows) * REVIEW_FRACTION)))
    return [{'id': r['id'], 'work': r['work'], 'data_type': r['data_type'], 'question_generation': r['question_generation'],
             'character': r['character'], 'cutoff': r['cutoff'], 'evidence_episode': r['event_episode'], 'question': r['question'],
             'event_summary': r['event_summary'], 'evidence': r['evidence'], 'participants': ', '.join(r['participants']),
             'evidence_in_episode': evidence_ok(texts_of[r['work']][r['event_episode']], r['evidence'])} for r in sorted(picked, key=lambda r: r['id'])]


def load_knowledge(wid: str) -> list[dict]:
    return [json.loads(line) for line in (KT / 'works' / wid / 'knowledge.jsonl').read_text().splitlines()]


def main(mode: str, ids: list[str]) -> None:
    from kt_world import load_world

    works = load_works(ids or None)
    llm = make_llm()
    plans, tasks = {}, []
    for wid, work in works.items():
        knowledge, world = load_knowledge(wid), load_world(KT / 'works' / wid / 'world.json')
        mains = main_characters(knowledge, world)
        want = {key: -(-count * OVERSAMPLE // 1) if key[1] == 'fact-freeform' else count for key, count in QUOTA.items()}   # 자유 질문은 버려질 몫을 더 뽑는다
        specs = pick_specs(knowledge, mains, {k: int(v) for k, v in want.items()}, random.Random(f'{SEED}-{wid}'))
        events = {e['id']: e for r in knowledge for e in r['events']}
        plans[wid] = {'knowledge': knowledge, 'specs': specs, 'mains': mains}
        tasks += [('q', wid, n, spec, events[spec['event']]) for n, spec in enumerate(specs) if spec['style'] == 'fact-freeform']
        tasks += [('p', wid, name, None, None) for name in mains]

    def work_fn(task, ask):
        kind, wid, key, spec, event = task
        step = Round()
        if kind == 'q':
            text = f"인물: {spec['character']}\n사건 요약: {event['summary']}\n근거 문장: {event['evidence']}"
            out, _ = step.get(lambda: ask.ask('question', QUESTION_INSTRUCTIONS, text, schema=Question, max_output_tokens=QUESTION_TOKENS))
        else:
            out, _ = step.get(lambda: ask.ask('profile', PROFILE_INSTRUCTIONS, profile_input(key, plans[wid]['knowledge']), schema=Profile,
                                              max_output_tokens=PROFILE_TOKENS))
        step.done()
        return out

    print(f'작품 {len(works)}편 · 호출 최대 {len(tasks)}건 · 방식 {mode} · 장부 ${llm.cost.spent():.3f}', flush=True)
    outputs = run_rounds(tasks, work_fn, llm, make_executor(llm, mode), plan=plan_for(llm, mode))
    written: dict[str, dict[int, str | None]] = {wid: {} for wid in works}
    personalities: dict[str, dict[str, str]] = {wid: {} for wid in works}
    for (kind, wid, key, _, _), out in zip(tasks, outputs):
        if kind == 'q':
            written[wid][key] = out.question if out else None
        elif out:
            personalities[wid][key] = ' '.join(out.personality.split())
    rows, drops = [], Counter()
    texts_of = {wid: {e['number']: e['text'] for e in work['episodes']} for wid, work in works.items()}
    (KT / 'question_stats.json').parent.mkdir(parents=True, exist_ok=True)
    for wid, work in works.items():
        mine, dropped = assemble({'id': wid, 'kind': work['kind'], 'genre': work['genre']}, plans[wid]['knowledge'], texts_of[wid],
                                 plans[wid]['specs'], written[wid], QUOTA)
        rows += mine
        drops.update(dropped)
        print(f"{wid} 질문 {len(mine)} ({dict(Counter(r['data_type'] for r in mine))}) 인물 {len(plans[wid]['mains'])} 버림 "
              f"{ {k: v for k, v in dropped.items() if k != 'audited'} }")
    rows = [dict(r, idx=n) for n, r in enumerate(rows)]
    (KT / 'questions.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))
    (KT / 'personalities.json').write_text(json.dumps(personalities, ensure_ascii=False))
    sample = review_sample(rows, texts_of, SEED)
    with (KT / 'review_sample.csv').open('w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=list(sample[0]))
        writer.writeheader()
        writer.writerows(sample)
    audited = drops.pop('audited')
    (KT / 'question_stats.json').write_text(json.dumps({'audited': audited, 'kept': len(rows), 'dropped': dict(drops),
                                                        'review_sample': len(sample), 'review_evidence_ok': sum(s['evidence_in_episode'] for s in sample)}))
    print(f'질문 {len(rows)}개 (유형 {dict(Counter(r["data_type"] for r in rows))}), 버린 이유 {dict(drops)}, 검수 표본 {len(sample)}개 '
          f'(근거 대조 통과 {sum(s["evidence_in_episode"] for s in sample)}/{len(sample)})')
    cost_report(llm)


if __name__ == '__main__':
    options = [a for a in sys.argv[1:] if a.startswith('--')]
    main(next((o.split('=')[1] for o in options if o.startswith('--mode=')), 'sync'), [a for a in sys.argv[1:] if not a.startswith('--')])
