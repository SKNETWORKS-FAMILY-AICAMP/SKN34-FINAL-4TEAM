"""KoTimeChara 정답표(라벨): 회차 원문에서 사건·참여 인물·목격 인물·나중에 전해 들은 인물과 근거 문장을 모델로 뽑고,
근거 문장이 회차 원문에 글자 그대로 있는지 Python으로 확인해 없는 항목은 버린다.

정답표는 NovelBrain 입력(세계관, kt_world.py)과 다른 호출·다른 프롬프트로 만든다. 같은 추출물을 라벨과 필터에 같이 쓰면 자기 검증이라서다.
이름 합치기(`canonical_names`)만 두 쪽이 같은 규칙을 쓴다(문자열 함수라 추출물을 공유하지 않는다).
"""

from collections import Counter

from pydantic import BaseModel

from kt_text import evidence_ok

LABEL_TOKENS, LEARN_TOKENS, PROFILE_TOKENS = 12_000, 6_000, 3_000

LABEL_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문이다. 이 회차에서 일어난 주요 사건을 순서대로 4~8개 뽑는다. 각 사건마다:
- summary: 사건을 '누가 무엇을 했다'로 한두 문장, 과거형 평서문으로 쓴다. 본문에 적힌 사실만 쓰고, 대명사 대신 본문이 쓰는 이름을 쓴다.
- evidence: 그 사건을 가장 잘 보여 주는 본문 문장 하나를 한 글자도 고치지 말고 그대로 복사한다(따옴표·띄어쓰기·문장부호 포함). 여러 문장을 이어 붙이지 않는다.
- participants: 사건에 직접 참여한 인물(행동하거나 행동의 대상인 인물). name은 본문이 그 인물을 부르는 고유한 이름이고, evidence는 그 인물이 그 장면에 있음을 보여 주는 본문 문장 하나를 그대로 복사한 것이다. 종족·직업·직함·무리만 가리키는 말(예: 드워프, 고블린, 비서, 헌터들)은 이름이 아니므로 넣지 않는다.
- witnesses: 사건에 참여하지는 않았지만 그 자리에서 직접 보거나 들은 인물. 같은 형식이고, 없으면 빈 목록이다.
이름이 본문에 나오지 않는 인물은 넣지 않는다. 본문에 없는 내용은 쓰지 않는다. 다른 회차의 내용은 모른다."""

LEARN_INSTRUCTIONS = """다음은 소설의 앞 회차들에서 일어난 사건 목록(id, 회차, 요약)과 그 뒤 한 회차의 본문이다. 이 회차 본문에서 어떤 인물이 앞 회차의 사건을 전해 듣거나, 알게 되거나, 읽거나, 떠올리는 장면만 뽑는다. 각 항목:
- event: 앞 회차 사건의 id.
- learner: 그 사실을 이 회차에서 알게 되는 인물의 이름(본문이 쓰는 이름).
- evidence: 그 장면을 보여 주는 이 회차 본문 문장 하나를 한 글자도 고치지 말고 그대로 복사한다.
사건이 단순히 언급될 뿐 인물이 새로 알게 되는 것이 아니면 넣지 않는다. 그 사건에 이미 참여했거나 직접 본 인물은 넣지 않는다. 없으면 빈 목록이다."""

PROFILE_INSTRUCTIONS = """다음은 한국 소설 속 한 인물이 겪은 사건들을 회차 순으로 적은 목록이다. 이 목록만 근거로 그 인물의 성격을 한국어 서너 문장으로 쓴다. 좋아하는 것·가치관·신념·말투와 행동 방식을 담고, 목록에 없는 사실은 쓰지 않는다. 특정 사건의 세부 내용을 나열하지 말고 성격을 서술한다."""


class Ref(BaseModel):
    name: str
    evidence: str


class Ev(BaseModel):
    summary: str
    evidence: str
    participants: list[Ref]
    witnesses: list[Ref]


class EpisodeLabel(BaseModel):
    events: list[Ev]


class Learn(BaseModel):
    event: str
    learner: str
    evidence: str


class LearnedLabel(BaseModel):
    learned: list[Learn]


class Profile(BaseModel):
    personality: str


def _flat(text: str) -> str:
    return ' '.join(text.split())


def _checked(text: str, sentence: str, stats: Counter) -> bool:
    """근거 대조 한 번. 확인한 수(evidence_checked)와 통과한 수(evidence_ok)를 집계해 검수 통과율로 쓴다."""
    stats['evidence_checked'] += 1
    found = evidence_ok(text, sentence)
    stats['evidence_ok'] += found
    return found


def verify_episode(text: str, out: EpisodeLabel, number: int) -> tuple[list[dict], Counter]:
    """근거 대조: 사건 근거가 원문에 글자 그대로 없으면 사건 통째로, 인물 근거나 이름이 원문에 없으면 그 인물만 버린다.

    한 사람이 참여와 목격에 함께 올라오면 참여가 이긴다. 검증된 참여 인물이 없는 사건은 질문을 만들 수 없어 버린다.
    돌려주는 집계(stats)는 검수 통과율 계산에 쓴다: events·kept·refs·refs_kept와 버린 이유별 수.
    """
    stats: Counter = Counter()
    events = []
    for event in out.events:
        stats['events'] += 1
        summary = _flat(event.summary)
        if not 8 <= len(summary) <= 300:
            stats['bad_summary'] += 1
            continue
        if not _checked(text, event.evidence, stats):
            stats['event_evidence'] += 1
            continue
        people: dict[str, tuple[str, str]] = {}
        for role, refs in (('participants', event.participants), ('witnesses', event.witnesses)):
            for ref in refs:
                stats['refs'] += 1
                name = _flat(ref.name)
                if not 2 <= len(name) <= 20 or name not in text:
                    stats['bad_name'] += 1
                elif not _checked(text, ref.evidence, stats):
                    stats['ref_evidence'] += 1
                elif name not in people:
                    people[name] = (role, _flat(ref.evidence))
                    stats['refs_kept'] += 1
        if not any(role == 'participants' for role, _ in people.values()):
            stats['no_participant'] += 1
            continue
        events.append({'id': f'E{number}.{len(events) + 1}', 'episode': number, 'summary': summary, 'evidence': _flat(event.evidence),
                       **{role: [{'name': n, 'evidence': e} for n, (r, e) in people.items() if r == role]
                          for role in ('participants', 'witnesses')}})
        stats['kept'] += 1
    return events, stats


def learned_input(text: str, earlier: list[dict]) -> str:
    """'나중에 전해 들은 인물' 호출의 입력: 앞 회차 사건 목록 다음에 이 회차 본문."""
    lines = [f"{e['id']} ({e['episode']}화) {e['summary']}" for e in earlier]
    return '[앞 회차 사건]\n' + '\n'.join(lines) + '\n\n[이 회차 본문]\n' + text


def verify_learned(text: str, out: LearnedLabel, earlier: dict[str, dict], number: int) -> tuple[list[dict], Counter]:
    """전해 들은 항목 검증: 앞 회차의 알려진 사건이어야 하고, 그 사건에 이미 참여·목격한 인물이 아니어야 하며,
    이름과 근거 문장이 이 회차 원문에 글자 그대로 있어야 한다."""
    stats: Counter = Counter()
    kept = []
    for item in out.learned:
        stats['learned'] += 1
        event = earlier.get(item.event.strip())
        learner = _flat(item.learner)
        if event is None or event['episode'] >= number:
            stats['unknown_event'] += 1
        elif learner in {p['name'] for p in event['participants'] + event['witnesses']}:
            stats['already_present'] += 1
        elif not 2 <= len(learner) <= 20 or learner not in text:
            stats['bad_name'] += 1
        elif not _checked(text, item.evidence, stats):
            stats['learn_evidence'] += 1
        else:
            kept.append({'event': event['id'], 'learner': learner, 'episode': number, 'evidence': _flat(item.evidence)})
            stats['learned_kept'] += 1
    return kept, stats


def build_knowledge(events: dict[int, list[dict]], learned: dict[int, list[dict]], canon: dict[str, str]) -> list[dict]:
    """회차별 지식표: 이름을 대표 이름으로 맞추고(같은 사건 안의 중복은 참여가 이긴다) 회차 순으로 낸다."""
    def rename(people: list[dict], skip: set[str]) -> list[dict]:
        seen, out = set(skip), []
        for person in people:
            name = canon.get(person['name'], person['name'])
            if name not in seen:
                seen.add(name)
                out.append({**person, 'name': name})
        return out

    knowledge = []
    for number in sorted(set(events) | set(learned)):
        rows = []
        for event in events.get(number, []):
            participants = rename(event['participants'], set())
            rows.append({**event, 'participants': participants,
                         'witnesses': rename(event['witnesses'], {p['name'] for p in participants})})
        knowledge.append({'episode': number, 'events': rows,
                          'learned': [{**item, 'learner': canon.get(item['learner'], item['learner'])} for item in learned.get(number, [])]})
    return knowledge


def appearances(knowledge: list[dict]) -> dict[str, list[int]]:
    """인물 → 사건에 참여·목격한 회차 목록(오름차순). 등장 횟수와 첫 등장 회차를 여기서 읽는다."""
    seen: dict[str, set[int]] = {}
    for record in knowledge:
        for event in record['events']:
            for person in event['participants'] + event['witnesses']:
                seen.setdefault(person['name'], set()).add(record['episode'])
    return {name: sorted(numbers) for name, numbers in seen.items()}


def knows(knowledge: list[dict], name: str, event: dict, by: int) -> bool:
    """`by`화까지 이 인물이 사건을 아는가: 사건에 참여·목격했고 사건이 `by`화 이하이거나, `by`화 이하에서 전해 들었다."""
    if event['episode'] <= by and name in {p['name'] for p in event['participants'] + event['witnesses']}:
        return True
    return any(item['event'] == event['id'] and item['learner'] == name and item['episode'] <= by
               for record in knowledge for item in record['learned'])
