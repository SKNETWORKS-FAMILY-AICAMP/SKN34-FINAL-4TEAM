"""KoTimeChara 세계관(NovelBrain 입력): 회차 원문만 보고 인물 카드·회차별 기억·사건 카드·회차별 관계를 모델로 뽑는다.

정답표(kt_label.py)와 다른 호출·다른 프롬프트이고 서로의 추출물을 보지 않는다. 모델 출력은 원문으로 다시 확인한다
(이름이 본문에 있는 인물만, 끝점이 인물인 관계만). 인물 카드는 첫 등장 회차부터 공개(revealFromEpisode)로 두어 등장하기 전 회차의
인물이 설정집에서 새어 나오지 않게 한다(작가가 설정집에 적을 때 하는 일을 따른다).
"""

import json
from collections import Counter

from pydantic import BaseModel

from app.novelbrain.models import Card, Relation

WORLD_TOKENS = 8_000

WORLD_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문이다. 이 회차만 보고 세계관 설정집에 적을 항목을 뽑는다.
- characters: 이름이 본문에 나오는 인물(이 회차에 등장하거나 언급된 인물). name은 본문이 그 인물을 부르는 고유한 이름이며, 종족·직업·직함·무리만 가리키는 말(예: 드워프, 고블린, 비서, 헌터들)은 이름이 아니므로 넣지 않는다. role은 이 인물이 누구인지 한 구절(직업·신분·성격 등 본문에 드러난 것)이다. memory는 이 회차에서 이 인물이 한 일·겪은 일·알게 된 것을 인물의 이름을 주어로 한두 문장으로 쓴 것이다(직접 나오지 않고 언급만 된 인물은 빈 문자열).
- events: 이 회차의 주요 사건 3~7개. title은 사건의 이름(6~20자 명사구, 결과를 쓰지 않는다), summary는 한두 문장, participants는 사건에 참여한 인물의 이름이다.
- relations: 이 회차에서 처음 드러나거나 바뀐 인물 사이의 관계(예: 사제, 연인, 적대, 동료, 부모와 자식, 주종). source·target은 characters의 name이고 label은 관계를 나타내는 짧은 말(10자 이내)이다.
본문에 없는 내용은 쓰지 않는다. 다른 회차의 내용은 모른다."""


class WChar(BaseModel):
    name: str
    role: str
    memory: str


class WEvent(BaseModel):
    title: str
    summary: str
    participants: list[str]


class WRel(BaseModel):
    source: str
    target: str
    label: str


class WorldOut(BaseModel):
    characters: list[WChar]
    events: list[WEvent]
    relations: list[WRel]


def _flat(text: str) -> str:
    return ' '.join(text.split())


def validate_world(text: str, out: WorldOut) -> tuple[dict, Counter]:
    """모델 출력을 본문으로 다시 확인한다: 이름이 본문에 있는 2~20자 인물만(중복 제외), 참가자는 확인된 인물만(없으면 사건을 버림),
    관계는 두 끝점이 확인된 서로 다른 인물이고 label이 1~20자인 것만(중복 제외)."""
    stats: Counter = Counter()
    characters: dict[str, dict] = {}
    for c in out.characters:
        name = _flat(c.name)
        if 2 <= len(name) <= 20 and name in text and name not in characters:
            characters[name] = {'role': _flat(c.role)[:80], 'memory': _flat(c.memory)[:500]}
        else:
            stats['bad_character'] += 1
    events = []
    for e in out.events:
        participants = [n for n in dict.fromkeys(_flat(p) for p in e.participants) if n in characters]
        title, summary = _flat(e.title)[:40], _flat(e.summary)
        if title and 8 <= len(summary) <= 400 and participants:
            events.append({'title': title, 'summary': summary, 'participants': participants})
        else:
            stats['bad_event'] += 1
    relations, seen = [], set()
    for r in out.relations:
        source, target, label = _flat(r.source), _flat(r.target), _flat(r.label)
        if source in characters and target in characters and source != target and 0 < len(label) <= 20 and (source, target, label) not in seen:
            seen.add((source, target, label))
            relations.append({'source': source, 'target': target, 'label': label})
        else:
            stats['bad_relation'] += 1
    stats.update(characters=len(characters), events=len(events), relations=len(relations))
    return {'characters': characters, 'events': events, 'relations': relations}, stats


def build_world(work_id: str, episodes: dict[int, dict], canon: dict[str, str]) -> dict:
    """검증된 회차별 출력(회차 번호 → validate_world 결과)으로 평가용 세계관을 만든다. `timechara.snapshot`이 읽는 모양과 같다.

    - 인물 카드: 본문 = 첫 회차의 role(IDENTITY), `episodes[회차]` = 그 회차의 memory(같은 인물로 합쳐진 이름은 이어 붙임), 공개 = 첫 등장 회차.
    - 사건 카드: 제목·본문 = 사건 이름·요약, 공개 = 사건이 일어난 회차. 관계: 참여 인물 → 사건 '참여', 인물 사이 관계(그 회차에 기록).
    - 이름은 `canon`(canonical_names)으로 대표 이름에 맞춘다.
    """
    name = lambda n: canon.get(n, n)  # noqa: E731
    first: dict[str, int] = {}
    roles: dict[str, str] = {}
    memories: dict[str, dict[int, list[str]]] = {}
    for number in sorted(episodes):
        data = episodes[number]
        for raw, info in data['characters'].items():
            who = name(raw)
            first.setdefault(who, number)
            if info['role'] and who not in roles:
                roles[who] = info['role']
            if info['memory']:
                memories.setdefault(who, {}).setdefault(number, []).append(info['memory'])
        for who in {name(n) for e in data['events'] for n in e['participants']} | {name(n) for r in data['relations'] for n in (r['source'], r['target'])}:
            first.setdefault(who, number)
    ids = {who: f'c{n:03d}' for n, who in enumerate(sorted(first), 1)}
    cards = [Card(id=ids[who], cardType='character', title=who, text=roles.get(who, ''), revealFromEpisode=first[who],
                  episodes={n: ' '.join(texts) for n, texts in sorted(memories.get(who, {}).items())}) for who in sorted(first)]
    relations, when, seen = [], {}, set()

    def add(rid: str, source: str, target: str, label: str, number: int) -> None:
        if (source, target, label) not in seen:
            seen.add((source, target, label))
            relations.append(Relation(id=rid, source=source, target=target, label=label, direction='directed'))
            when[rid] = number

    for number in sorted(episodes):
        data = episodes[number]
        for i, event in enumerate(data['events'], 1):
            event_id = f'e{number:02d}-{i}'
            cards.append(Card(id=event_id, cardType='event', title=event['title'], text=event['summary'], revealFromEpisode=number))
            for who in dict.fromkeys(name(n) for n in event['participants']):
                add(f'p-{event_id}-{ids[who]}', ids[who], event_id, '참여', number)
        for i, r in enumerate(data['relations'], 1):
            if name(r['source']) != name(r['target']):
                add(f'r{number:02d}-{i}', ids[name(r['source'])], ids[name(r['target'])], r['label'], number)
    return {'series': work_id, 'cards': cards, 'relations': relations, 'when': when, 'character_id': ids,
            'title': {c.id: c.title for c in cards}}


def save_world(path, world: dict) -> None:
    path.write_text(json.dumps({**world, 'cards': [c.model_dump() for c in world['cards']],
                                'relations': [r.model_dump() for r in world['relations']]}, ensure_ascii=False))


def load_world(path) -> dict:
    data = json.loads(path.read_text())
    return {**data, 'cards': [Card(**c) for c in data['cards']], 'relations': [Relation(**r) for r in data['relations']]}
