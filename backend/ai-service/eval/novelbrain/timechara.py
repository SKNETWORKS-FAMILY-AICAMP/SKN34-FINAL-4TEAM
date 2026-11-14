"""TimeChara 검증 세트 연결: 시점 표 파싱·기준 장 계산·역할 프롬프트·평가용 세계관 구성·Chroma 청크 읽기.

공개 구현(ahnjaewoo/timechara, MIT)의 `rag-cutoff` 시점 규칙과 `utils.py`의 프롬프트를 같은 결과가 나오게 옮겼다. 내려받은
`utils.py`는 실행하지 않고 시점 표(dict 리터럴)만 `ast`로 읽는다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/timechara.py embed   # 청크 벡터 계산(수 분)
"""

import ast
import hashlib
import random
import re
import sqlite3
import sys
from collections import Counter, defaultdict

from app.novelbrain.models import Card, Relation, WorldSnapshot
from prepare import DATA

SERIES = ('harry_potter', 'the_lord_of_the_rings', 'twilight', 'hunger_games')
TYPES = ('future', 'past-only', 'past-absence', 'past-presence')
BOOKS = {
    'harry_potter': {'1': "Harry Potter and the Philosopher's Stone", '2': 'Harry Potter and the Chamber of Secrets',
                     '3': 'Harry Potter and the Prisoner of Azkaban', '4': 'Harry Potter and the Goblet of Fire',
                     '5': 'Harry Potter and the Order of the Phoenix', '6': 'Harry Potter and the Half-Blood Prince',
                     '7': 'Harry Potter and the Deathly Hallows'},
    'the_lord_of_the_rings': {'1': 'The Fellowship of the Ring', '2': 'The Two Towers', '3': 'The Return of the King'},
    'twilight': {'1': 'Twilight', '2': 'New Moon', '3': 'Eclipse', '4': 'Breaking Dawn'},
    'hunger_games': {'1': 'The Hunger Games', '2': 'Catching Fire', '3': 'Mocking Jay'},
}
SOURCE = {
    'harry_potter': "from J.K. Rowling's Harry Potter novel series",
    'the_lord_of_the_rings': "from J.R.R. Tolkien's The Lord of the Rings novel series",
    'twilight': "from Stephenie Meyer's Twilight novel series",
    'hunger_games': "from Suzanne Collins's The Hunger Games novel series",
}
SHE = {'Hermione Granger', 'Bella Swan', 'Katniss Everdeen'}
TABLE_NAMES = {f'character_period_{series}': series for series in SERIES}


def parse_tables(source: str) -> dict:
    """utils.py의 `character_period_<시리즈>` dict 리터럴만 읽는다(코드를 실행하지 않는다)."""
    tables = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in TABLE_NAMES:
            tables[TABLE_NAMES[node.targets[0].id]] = ast.literal_eval(node.value)
    return tables


def chapter_tuple(text: str) -> tuple[int, ...]:
    """'Book5-chapter11'·'Volume1-part2-chapter4'·청크 경로에서 (권[, 부], 장) 숫자 묶음."""
    return tuple(int(n) for n in re.findall(r'\d+', text))


def cutoff(series: str, character: str, period: str, tables: dict) -> tuple[int, ...]:
    """인물의 기준 장. 공개 rag-cutoff와 같다: 이 장 이하의 글만 인물이 아는 시점이다. 표에 없는 시점은 KeyError."""
    parts = [p.strip() for p in period.split('/')]
    first, moment = parts[0], (parts[1] if len(parts) == 2 else None)
    if series == 'harry_potter':
        book = first[0]
        try:
            value = tables[series][('at the end of the scene' if moment is None else moment).lower()][int(book) - 1]
        except (KeyError, IndexError):
            value = f'{book}-0'  # 그 권이 시작하기 전
    elif series == 'the_lord_of_the_rings':
        value = tables[series][character][f'end of Volume{first}' if moment is None else moment]
    else:
        value = tables[series][character][f'end of book{first}' if moment is None else moment]
    return chapter_tuple(value)


def chapter_label(t: tuple[int, ...]) -> str:
    """이야기 안의 위치 이름. 사건 카드 제목으로 쓴다(사건 요약이 질문에 그대로 나오는 것과 겹치지 않게)."""
    return f'Volume {t[0]}, book {t[1]}, chapter {t[2]}' if len(t) == 3 else f'Book {t[0]}, chapter {t[1]}'


def common_names(names: list[str], counts: Counter) -> dict[str, str]:
    """인물 이름 → 카드 제목. 본문이 그 인물을 가장 자주 부르는 낱말(이름·이름의 앞부분)이다.

    인물 카드는 작가가 본문이 쓰는 이름으로 만든다는 가정이다. 공개 데이터의 이름은 전체 이름('Ronald Weasley')인데 소설은
    'Ron'이라 부르므로, 전체 이름을 제목으로 쓰면 인물 시점 필터(발췌에 제목이 나와야 목격으로 본다)가 거의 모든 발췌를 뺀다.
    여러 인물이 나눠 쓰는 낱말(성)은 제외하고, 어느 것도 본문에 없으면 전체 이름을 쓴다.
    """
    tokens = {name: name.split() for name in names}
    shared = {t for t, c in Counter(t for ts in tokens.values() for t in set(ts)).items() if c > 1}
    titles = {}
    for name, ts in tokens.items():
        candidates = {t for t in ts if t not in shared} | {ts[0][:i] for i in range(3, len(ts[0])) if ts[0] not in shared}
        best = max(candidates, key=lambda c: (counts[c], len(c)), default=name)
        titles[name] = best if counts[best] else name
    return titles


def ordinal_map(tuples) -> dict[tuple[int, ...], int]:
    """(권, 장) 묶음을 순서를 지키는 1부터의 회차 번호로. 카드·발췌·기준 회차가 같은 번호 체계를 쓴다."""
    return {t: i for i, t in enumerate(sorted(set(tuples)), 1)}


def system_prompt(series: str, character: str, period: str) -> str:
    """공개 generate.py의 역할 시스템 프롬프트(preprocess_generation)와 같은 문장."""
    parts = [p.strip() for p in period.split('/')]
    first, moment = parts[0], (parts[1] if len(parts) == 2 else None)
    book_no = first[0] if series == 'harry_potter' else first
    book = BOOKS[series][book_no]
    his, pron = ('her', 'she') if character in SHE else ('his', 'he')
    if moment is None:
        scene = (f'at the end of the scene in {book} as a {first} student' if series == 'harry_potter' and book_no != '7'
                 else f'at the end of the scene in {book}')
    else:
        scene = f'{moment} during {his} {first} in {book}' if series == 'harry_potter' else f'{moment} in {book}'
    return (f'I want you to act like {character} {SOURCE[series]}. I want you to respond and answer like {character}, '
            f'using the tone, manner, and vocabulary {character} would use. Assume that you are {scene} and interviewing '
            f'with the interviewer. You should not answer the question and mention any fact that is future to the period. '
            f'If {pron} was not present at the location where the question was raised, {pron} is likely unaware of the '
            f'information or knowledge related to that question.')


def judge_name(series: str, character: str, period: str) -> str:
    """채점 프롬프트의 {agent_name}(공개 evaluate.py의 preprocess_evaluation)."""
    parts = [p.strip() for p in period.split('/')]
    first = parts[0]
    day = f'at the end of the scene in {BOOKS[series][first[0]]}' if len(parts) == 1 else parts[1]
    return f'{first} {character} {day}' if series == 'harry_potter' and period.strip() != '7th-year' else f'{character} {day}'


def _slug(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def build_world(rows: list[dict], ordinals: dict[tuple[int, ...], int], titles: dict[str, str] | None = None) -> dict:
    """한 시리즈의 평가용 세계관. 사실 사건만(지어낸 사건은 정본이 아니다) 정본으로 삼는다.

    - 인물 카드: 본문 없음(채점 기준인 성격 설명을 넣지 않는다), `episodes[회차]` = 그 인물이 참석한 사건 요약(기억 문서).
    - 사건 카드: 본문 = 사건 요약, revealFromEpisode = 사건이 일어난 장, 제목은 이야기 안의 위치(사건 요약과 겹치지 않게).
    - `titles`: 인물 카드 제목(common_names). 없으면 전체 이름.
    - 관계: 참석자 → 사건 '참석'. 관계는 일어난 회차부터 기록되므로 snapshot이 기준 회차까지만 담는다.
    """
    series = rows[0]['series']
    events, seen = [], set()
    for r in rows:
        key = (r['question_period'], r['event_summary'])
        if r['question_generation'] != 'fake-freeform' and key not in seen:
            seen.add(key)
            events.append(r)
    names = {r['character'] for r in rows} | {n for r in events for n in ast.literal_eval(r['participants'])}
    cards = {n: Card(id=f'c-{_slug(n)}', cardType='character', title=(titles or {}).get(n, n), text='') for n in sorted(names)}
    memories: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    relations, when, per_chapter = [], {}, defaultdict(int)
    event_cards = []
    for r in events:
        ordinal = ordinals[chapter_tuple(r['question_period'])]
        per_chapter[ordinal] += 1
        event_id = 'e-' + hashlib.sha1(f"{r['question_period']}\n{r['event_summary']}".encode()).hexdigest()[:10]
        position = chapter_tuple(r['question_period'])
        event_cards.append(Card(id=event_id, cardType='event', title=f'{chapter_label(position)} (scene {per_chapter[ordinal]})',
                                text=r['event_summary'], revealFromEpisode=ordinal))
        for name in dict.fromkeys(ast.literal_eval(r['participants'])):
            memories[name][ordinal].append(r['event_summary'])
            relation = Relation(id=f'r-{event_id[2:]}-{_slug(name)}', source=cards[name].id, target=event_id,
                                label='participated', direction='directed')
            relations.append(relation)
            when[relation.id] = ordinal
    for name, by_ordinal in memories.items():
        cards[name] = cards[name].model_copy(update={'episodes': {o: '\n'.join(texts) for o, texts in by_ordinal.items()}})
    all_cards = list(cards.values()) + event_cards
    return {'series': series, 'cards': all_cards, 'relations': relations, 'when': when,
            'title': {c.id: c.title for c in all_cards}, 'character_id': {n: c.id for n, c in cards.items()}}


def snapshot(world: dict, episode: int) -> WorldSnapshot:
    """`episode`화 시점의 스냅샷: 카드는 전부(작가 시점), 관계는 그 회차까지 기록된 것만."""
    return WorldSnapshot(worldId=world['series'], episode=episode, cards=world['cards'],
                         relations=[r for r in world['relations'] if world['when'][r.id] <= episode])


def sample_by_type(rows: list[dict], per_type: int, seed: int) -> list[dict]:
    """유형마다 같은 수를 결정적으로 뽑는다(단계별·유형별 표가 같은 표본 크기를 갖게)."""
    picked = []
    for kind in TYPES:
        picked += random.Random(f'{seed}-{kind}').sample([r for r in rows if r['data_type'] == kind], per_type)
    return picked


def load_chunks(series: str) -> list[dict]:
    """공개 rag-cutoff Chroma의 소설 청크(1,000자). 원문이라 .data에서만 읽고 저장소에 두지 않는다."""
    path = DATA / f'timechara-chroma/text-embedding-ada-002/cutoff/{series}/chroma.db/chroma.sqlite3'
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    try:
        rows = con.execute(
            "select e.id, d.string_value, s.string_value from embeddings e "
            "join embedding_metadata d on d.id = e.id and d.key = 'chroma:document' "
            "join embedding_metadata s on s.id = e.id and s.key = 'source' order by e.id").fetchall()
    finally:
        con.close()
    return [{'id': f'{series}:{i}', 'text': text, 'tuple': chapter_tuple(source)} for i, text, source in rows]


if __name__ == '__main__':
    from embed import cached_embeddings

    if sys.argv[1:] != ['embed']:
        raise SystemExit('사용법: timechara.py embed')
    for name in SERIES:
        chunks = load_chunks(name)
        cached_embeddings(DATA / f'timechara/vectors_{name}.npy', [c['text'] for c in chunks], 'passage')
        print(f'{name}: {len(chunks)} chunks embedded', flush=True)
