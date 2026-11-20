"""해리 포터 번역본 원문 → 평가용 세계관 world.json(#642 후속): 장마다 모델이 사건·인물·설정·관계를 뽑고, 호칭을 한 사람으로 묶어 영어 정식 이름을 붙이고, 인물 문서를 쓴다.

단계: ① 장 나누기(hp_chapters) → ② 덩어리마다 추출(사건·인물·장소/조직/물건/능력/규칙·관계, 한국어) → ③ 정체 정리(같은 사람 묶기·영어 정식 이름)
→ ④ 인물마다 문서(IDENTITY·SOUL·GOAL) → ⑤ 시연 세계관(infrastructure/sample-data/simulation-demo)과 같은 world.json 하나를 .data/hp에 쓴다.
회차는 7권의 모든 장을 이어 붙인 번호다(1권 1장 = 1화). 장 → 회차 대응표를 world.json의 ordinals에 같이 둔다.
누설을 막는 규칙(제품 규칙 그대로): IDENTITY·SOUL·GOAL·별칭·설정 카드 본문은 늘 보이므로 **처음 나온 대목에서 이미 드러난 것만** 모델에 준다.
나중에 드러나는 것(정체·변화·비밀)은 그 회차의 episodes[N]·관계·사건 카드(revealFromEpisode)로만 둔다. 머리를 못 찾아 묶인 장의 사건은 묶음의 마지막 장 회차다.
호출은 novelbrain의 Llm(디스크 캐시·비용 장부)으로만 하고 원문·모델 응답은 .data에만 둔다. 같은 명령을 다시 쳐도 캐시된 요청은 다시 부르지 않는다.
"""

import ast
import hashlib
import json
import math
import re
import sys
import threading
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from pydantic import BaseModel  # noqa: E402

from cost import usd  # noqa: E402  eval/novelbrain/cost.py
from llm import CallCapExceeded, LlmFailure  # noqa: E402

import hp_chapters  # noqa: E402

HP = 'harry_potter'
WINDOW = 28_000          # 한 번에 읽는 글의 크기(글자). 묶인 장은 이보다 길어 여럿으로 자른다
CHARS_PER_TOKEN = 1.5    # 한국어 글자/토큰 비(어림, novelbrain 실측)
NAMES_BATCH = 80
MIN_UNITS = 2            # 이 수 이상의 덩어리에 나온 호칭만 영어 이름을 묻는다
DOC_UNITS = 1            # 인물 문서를 쓰려고 읽는 '처음 나온 덩어리' 수. 1이면 처음 나온 대목뿐이고, 늘리면 그만큼 뒤 장의 정보가 처음 나온 회차에 새어 든다
MAX_DOC = 3_000          # 카드 본문·인물 문서 한 편의 글자 한도(서버 검사·DEC-47)
MAX_PAIR = 8             # '알고 있음' 관계를 만드는 사건 참석자 수 상한(큰 장면은 앞 8명끼리만)
CALL_MAX_USD = 0.03      # 호출 하나가 쓸 수 있는 최대 금액(가장 큰 창·출력 상한): 동시 호출 수만큼을 상한 확인의 여유로 둔다
EXTRACT_TOKENS, NAMES_TOKENS, DOCS_TOKENS = 20_000, 8_000, 4_000
CANON = {'ron weasley': 'Ronald Weasley', 'ronald weasley': 'Ronald Weasley', 'harry james potter': 'Harry Potter', 'hermione jean granger': 'Hermione Granger'}
HONORIFICS = {'professor', 'mr', 'mrs', 'ms', 'miss', 'madam', 'uncle', 'aunt', 'lord', 'sir', 'dr'}
SETTINGS = {'location': ('space', '장소'), 'organization': ('society', '조직'), 'object': ('culture', '물건'), 'ability': ('special', '능력'), 'rule': ('special', '규칙')}  # 설정 종류 → (영역, 분류)
UNKNOWN_SOUL = '## 말투\n- 아직 드러나지 않았다.\n\n## 사고방식\n- 아직 드러나지 않았다.'

EXTRACT_INSTRUCTIONS = """당신은 소설 「해리 포터」 한국어 번역본의 글 한 덩어리를 읽고 세계관 카드의 재료를 정리하는 편집자입니다. 이 글에 쓰인 것만 한국어로 정리합니다.

규칙
- 글에 없는 사실, 원작에 대해 아는 배경지식, 이 글 뒤의 줄거리는 쓰지 않습니다. 글에서 알 수 없는 것은 비워 둡니다.
- 원문 문장을 옮겨 적지 않고 짧게 요약합니다(8자를 넘는 구절을 그대로 인용하지 않습니다).
- 이름·호칭은 글에 쓰인 그대로 적습니다(영어 이름으로 바꾸지 않습니다). 번역본의 표기가 흔들려도 글의 표기를 따릅니다.
- 사건 요약과 관계 본문에는 그 자리에 있던 누구나 아는 겉으로 드러난 행동·말·사실만 씁니다. 인물의 속마음과 아직 밝혀지지 않은 일은 people의 memory에만 씁니다.

항목
- events: 이 글의 사건을 시간 순으로 최대 8개. title은 12자 안팎의 제목, summary는 한 문장(60자 안팎), participants는 그 사건에 실제로 있었던 인물의 호칭(이름이 나오지 않은 인물은 넣지 않습니다).
- people: 이 글에서 이름이나 호칭으로 불리며 행동하거나 말하거나 언급된 인물 전원(이름 없는 엑스트라 제외), 비중이 큰 순으로 최대 30명. name은 가장 자주 쓰인 호칭, aliases는 같은 사람을 확실히 가리키는 글 속의 다른 이름(그 사람만 가리키는 고유한 이름·성·애칭. '선생님'·'아버지' 같은 상황 호칭은 넣지 않습니다).
  looks(외모)·personality(성격)·speech(말투)·situation(소속·처지·하는 일)·wants(원하는 것)는 이 글에서 드러난 것만 한 문장 이내로, 드러나지 않았으면 빈 문자열. memory는 이 글에서 이 인물이 겪고 알게 되고 한 일을 그 인물의 시점에서 1~2문장(드러나지 않은 일은 쓰지 않습니다).
- things: 이 글에 나오는, 고유한 이름이 있거나 줄거리에 의미가 있는 장소(location)·조직과 단체와 기숙사(organization)·마법 물건(object)·주문과 마법 능력(ability)·세계의 규칙과 제도와 금지(rule). 흔한 일상 물건·장소는 넣지 않습니다. 최대 25개.
  name은 가장 자주 쓰인 호칭, aliases는 같은 것을 가리키는 다른 이름, description은 이 글에서 드러난 것만 1~2문장.
- relations: 인물과 인물(또는 인물과 things의 name) 사이의 관계 최대 20개. source·target은 people 또는 things의 name. category는 structural(가족·소속·직책·사제·소유처럼 구조적인 것) 또는 emotional(우정·호감·적대·신뢰·두려움 같은 감정·태도).
  label은 짧은 명사구로 "source의 label: target"으로 읽히게 쓴다(예: source=해리, target=론, label=친구). body는 이 글에서 겉으로 드러난 근거 한 문장.
- 글에 해당하는 것이 없으면 그 목록은 비웁니다."""

NAMES_INSTRUCTIONS = """소설 「해리 포터」 번역본에서 뽑은 인물 호칭 목록입니다. 호칭마다 그 인물의 영어 정식 이름(성과 이름, 예: Severus Snape)을 en에 적습니다.

규칙
- hint에 있는 이름과 같은 사람이면 hint의 철자를 그대로 씁니다. 같은 사람의 변형(Professor Snape·Severus Snape)은 가장 완전한 이름 하나로 통일합니다.
- 호칭이 성(姓)만이거나 직함·애칭만이라 누구인지 단정할 수 없으면 en을 null로 둡니다. 같은 성을 쓰는 서로 다른 사람(웨즐리 부인·웨즐리 씨)을 합치지 않습니다.
- 이름이 비슷하다는 이유만으로 같은 사람으로 보지 않습니다. desc(드러난 특징)·first(처음 나온 곳)·with(함께 나온 인물)가 그 사람임을 보일 때만 영어 이름을 줍니다.
- 소설에 없는 이름은 지어내지 않고 null로 둡니다.
- 응답에는 입력한 모든 호칭이 한 번씩 있어야 합니다(ko는 입력 그대로)."""

DOCS_INSTRUCTIONS = """소설 「해리 포터」의 인물 한 명이 이야기에 **처음 나온 대목**에서 드러난 기록입니다(번역본 원문에서 뽑은 것). 이 기록에서만 인물 문서 셋을 한국어로 씁니다.
이 문서는 인물이 나온 뒤로 늘 보이므로, 처음 나온 때 이미 드러난 것만 쓰고 이후에 바뀌거나 밝혀지는 것(정체·변화·비밀)은 쓰지 않습니다.

- identity: 이 인물이 누구인지(소속·처지·외모·주변 관계). 300자 안팎.
- soul: '## 말투'와 '## 사고방식' 두 절에 글머리표('- ')로, 기록에서 드러난 것만. 드러난 것이 없는 절에는 '- 아직 드러나지 않았다.'만 씁니다. 300자 안팎.
- goal: 이 인물이 원하는 것(기록에서 드러난 것만, 없으면 빈 문자열). 글머리표 1~3줄.

기록에 없는 사실, 원작에 대해 아는 지식, 기록 뒤의 줄거리를 쓰지 않습니다. 기록이 부족하면 짧게 쓰고 지어내지 않습니다."""


class Event(BaseModel):
    title: str
    summary: str
    participants: list[str]


class Person(BaseModel):
    name: str
    aliases: list[str]
    looks: str
    personality: str
    speech: str
    situation: str
    wants: str
    memory: str


class Setting(BaseModel):
    kind: Literal['location', 'organization', 'object', 'ability', 'rule']
    name: str
    aliases: list[str]
    description: str


class Link(BaseModel):
    source: str
    target: str
    category: Literal['structural', 'emotional']
    label: str
    body: str


class Extraction(BaseModel):
    events: list[Event]
    people: list[Person]
    things: list[Setting]
    relations: list[Link]


class NameEntry(BaseModel):
    ko: str
    en: str | None


class Names(BaseModel):
    names: list[NameEntry]


class Docs(BaseModel):
    identity: str
    soul: str
    goal: str


class LimitReached(SystemExit):
    """비용 상한에 닿아 멈췄다. 끝낸 호출은 캐시에 있어 같은 명령으로 이어 간다(sim_cli는 이때 --via ocx로 이어 받을 수 있다)."""


@dataclass
class Info:
    """덩어리(장 하나 또는 묶인 장들) 하나에서 뽑은 것. ordinal은 마지막 장의 회차 번호다."""
    book: int
    chapters: tuple[int, ...]
    ordinal: int
    extraction: Extraction


@dataclass(frozen=True)
class Record:
    """인물 한 명의 한 덩어리에서 드러난 것."""
    ordinal: int
    at: str
    looks: str
    personality: str
    speech: str
    situation: str
    wants: str
    memory: str


@dataclass(frozen=True)
class Who:
    key: str
    title: str
    en: str | None


@dataclass(frozen=True)
class What:
    key: str
    title: str
    kind: str


@dataclass(frozen=True)
class Resolved:
    """묶은 결과: key → 항목, 호칭 → key."""
    items: dict
    key_of: dict[str, str]


# --- 회차 --------------------------------------------------------------------------------------------------------------------

def ordinals_of(splits: dict[int, hp_chapters.Split]) -> dict[tuple[int, int], int]:
    """(권, 장) → 이야기 순서의 회차 번호(1부터). 묶인 장도 각자 번호를 가진다."""
    chapters = sorted((book, n) for book, split in splits.items() for unit in split.units for n in unit.chapters)
    return {key: i for i, key in enumerate(chapters, 1)}


def unit_label(info: Info) -> str:
    first, last = info.chapters[0], info.chapters[-1]
    return f'{info.book}권 {first}~{last}장' if first != last else f'{info.book}권 {first}장'


def hint_names(rows: list[dict]) -> list[str]:
    """TimeChara 해리 포터 질문의 영어 인물 이름(질문 인물과 사건 참석자) — 영어 정식 이름의 철자 기준이다."""
    hp = [r for r in rows if r['series'] == HP]
    return sorted({r['character'] for r in hp} | {n for r in hp for n in ast.literal_eval(r['participants'])})


# --- 정체 정리 --------------------------------------------------------------------------------------------------------------

def canonical_en(en: str | None) -> str | None:
    """TimeChara가 쓰는 철자로 맞춘다(질문 인물을 영어 이름으로 찾기 때문)."""
    if not en or not en.strip():
        return None
    clean = ' '.join(en.split())
    return CANON.get(clean.lower(), clean)


def name_requests(infos: list[Info], hints: list[str], size: int = NAMES_BATCH) -> list[tuple[list[str], str, str]]:
    """영어 이름을 물을 인물 호칭(MIN_UNITS개 이상의 덩어리에 나온 것)을 size개씩 묶은 요청 [(호칭들, 지시문, 입력 JSON)]. 호칭마다 처음 나온 곳·드러난 특징·관계 상대를 곁들인다."""
    units, first, desc, related = defaultdict(int), {}, {}, defaultdict(list)
    for info in sorted(infos, key=lambda i: i.ordinal):
        for name in {n for p in info.extraction.people for n in (p.name, *p.aliases)}:
            units[name] += 1
            first.setdefault(name, unit_label(info))
        for p in info.extraction.people:
            said = (p.situation or p.personality or p.looks)[:50]
            for name in (p.name, *p.aliases):
                if said and name not in desc:
                    desc[name] = said
        for r in info.extraction.relations:
            for me, other in ((r.source, r.target), (r.target, r.source)):
                if f'{other}({r.label})' not in related[me]:
                    related[me].append(f'{other}({r.label})')
    asked = sorted((n for n, count in units.items() if count >= MIN_UNITS), key=lambda n: (-units[n], n))
    return [(names, NAMES_INSTRUCTIONS, json.dumps({'hint': hints, 'names': [{'ko': n, 'units': units[n], 'first': first[n], 'desc': desc.get(n, ''), 'with': related[n][:3]} for n in names]},
                                                   ensure_ascii=False)) for names in (asked[i:i + size] for i in range(0, len(asked), size))]


def apply_names(asked: list[str], reply: Names) -> dict[str, str | None]:
    """모델 응답을 물은 호칭에만 적용한다. 응답에 없는 호칭은 모르는 것(None)이고 묻지 않은 호칭은 무시한다."""
    given = {e.ko: e.en for e in reply.names}
    return {name: canonical_en(given.get(name)) for name in asked}


def _slug(en: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', en.lower()).strip('-')


def _digest(*parts: str) -> str:
    return hashlib.sha1('|'.join(parts).encode()).hexdigest()[:8]


def _unique(key: str, taken) -> str:
    while key in taken:
        key += '-2'
    return key


def _uses(infos: list[Info], entries_of) -> tuple[dict[str, int], list[tuple[str, str]]]:
    """호칭별 등장 횟수(별칭으로만 나온 호칭은 0)와 '한 항목의 이름–별칭' 연결(별칭의 주인이 하나일 때만)."""
    uses: dict[str, int] = {}
    owners: dict[str, set[str]] = defaultdict(set)
    for info in sorted(infos, key=lambda i: i.ordinal):
        for entry in entries_of(info):
            uses[entry.name] = uses.get(entry.name, 0) + 1
            for alias in entry.aliases:
                uses.setdefault(alias, 0)
                owners[alias].add(entry.name)
    # 둘 이상의 이름이 별칭으로 올린 호칭('포터')은 누구의 것인지 알 수 없어 이어 주지 않는다(연쇄로 서로 다른 사람이 한 사람이 되는 것을 막는다).
    return uses, [(name, alias) for alias, names in owners.items() if len(names) == 1 for name in names]


def _merge(uses: dict[str, int], edges, en: dict[str, str | None]) -> list[tuple[list[str], str | None]]:
    """호칭을 한 대상으로 묶는다: 같은 영어 이름은 한 대상이고, 이름-별칭 연결은 영어 이름이 부딪치지 않을 때만 이어 준다. 이름이 비슷하거나 성이 같다는 이유로는 합치지 않는다."""
    parent = {n: n for n in uses}
    english = {n: ({en[n]} if en.get(n) else set()) for n in uses}

    def find(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    def union(a, b):
        a, b = find(a), find(b)
        if a != b and len(english[a] | english[b]) <= 1:
            parent[b], english[a] = a, english[a] | english[b]

    by_en = defaultdict(list)
    for n in sorted(uses):
        if en.get(n):
            by_en[en[n]].append(n)
    for members in by_en.values():
        for n in members[1:]:
            union(members[0], n)
    for a, b in edges:
        union(a, b)
    groups = defaultdict(list)
    for n in sorted(uses):
        groups[find(n)].append(n)
    return [(members, next(iter(english[root]), None)) for root, members in groups.items()]


def resolve_persons(infos: list[Info], en_of) -> Resolved:
    """인물 호칭을 사람으로 묶는다(영어 정식 이름이 열쇠). 영어 이름이 없는 사람은 가장 많이 쓰인 호칭에서 만든 key를 갖는다."""
    uses, edges = _uses(infos, lambda i: i.extraction.people)
    en = {n: canonical_en(en_of(n)) for n in uses}
    items, key_of = {}, {}
    for members, name in _merge(uses, edges, en):
        if not any(uses[n] for n in members):
            continue   # 별칭으로만 나온 호칭(주인이 여럿이라 이어 주지 않은 것)은 대상이 아니다
        title = max(members, key=lambda n: (uses[n], len(n), n))
        key = _unique(_slug(name) if name else 'p-' + _digest(title), items)
        items[key] = Who(key, title, name)
        key_of.update({n: key for n in members})
    return Resolved(items, key_of)


def resolve_settings(infos: list[Info]) -> Resolved:
    """장소·조직·물건·능력·규칙 호칭을 항목으로 묶는다(영어 이름 없이 이름-별칭 연결로만). 종류는 처음 나온 대목의 것이다."""
    uses, edges = _uses(infos, lambda i: i.extraction.things)
    kinds: dict[str, str] = {}
    for info in sorted(infos, key=lambda i: i.ordinal):
        for t in info.extraction.things:
            kinds.setdefault(t.name, t.kind)
    order = {n: i for i, n in enumerate(kinds)}
    items, key_of = {}, {}
    for members, _ in _merge(uses, edges, {}):
        if not any(uses[n] for n in members):
            continue
        title = max(members, key=lambda n: (uses[n], len(n), n))
        kind = kinds[min((n for n in members if n in kinds), key=order.get)]
        key = _unique('w-' + _digest(kind, title), items)
        items[key] = What(key, title, kind)
        key_of.update({n: key for n in members})
    return Resolved(items, key_of)


def match_names(names: list[str], english: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """TimeChara의 영어 인물 이름을 세계관 카드의 영어 이름에 맞춘다(직함 무시). 이름 낱말이 정확히 같거나 한 카드에만 들어 있을 때만 맞고, 여럿에 걸치면 가리지 못해 실패다."""
    found, failed = {}, []
    for name in names:
        want = _tokens(name)
        exact = [key for en, key in english.items() if _tokens(en) == want]
        within = [key for en, key in english.items() if want and set(want) <= set(_tokens(en))]
        hit = exact if len(exact) == 1 else within if len(within) == 1 else []
        if hit:
            found[name] = hit[0]
        else:
            failed.append(name)
    return found, failed


def _tokens(name: str) -> list[str]:
    return [t for t in re.findall(r'[a-z]+', name.lower()) if t not in HONORIFICS]


# --- 요청 ------------------------------------------------------------------------------------------------------------------

def extract_request(text: str) -> tuple[str, str]:
    return EXTRACT_INSTRUCTIONS, json.dumps({'text': text}, ensure_ascii=False)


def person_records(infos: list[Info], people: Resolved) -> dict[str, list[Record]]:
    """사람마다 덩어리별로 드러난 것(내용이 있는 것만, 회차 순)."""
    records: dict[str, list[Record]] = defaultdict(list)
    for info in sorted(infos, key=lambda i: i.ordinal):
        for p in info.extraction.people:
            if any((p.looks, p.personality, p.speech, p.situation, p.wants, p.memory)):
                records[people.key_of[p.name]].append(Record(info.ordinal, unit_label(info), p.looks, p.personality, p.speech, p.situation, p.wants, p.memory))
    return records


def first_records(records: list[Record], units: int = DOC_UNITS) -> list[Record]:
    """처음 나온 덩어리(units개)의 기록. 인물 문서는 이것만으로 쓴다."""
    chosen = set(sorted({r.ordinal for r in records})[:units])
    return [r for r in records if r.ordinal in chosen]


def docs_request(title: str, aliases: list[str], records: list[Record]) -> tuple[str, str]:
    """인물 문서 요청: 이름·별칭과 처음 나온 대목의 기록뿐이다(영어 이름은 싣지 않는다: 모델의 사전 지식을 끌어오지 않게)."""
    body = {'name': title, 'aliases': aliases, 'first_appearance': [{'at': r.at, 'looks': r.looks, 'personality': r.personality, 'speech': r.speech,
                                                                      'situation': r.situation, 'wants': r.wants, 'did': r.memory} for r in first_records(records)]}
    return DOCS_INSTRUCTIONS, json.dumps(body, ensure_ascii=False)


# --- 세계관 조립 ------------------------------------------------------------------------------------------------------------

def clip(text: str, limit: int = MAX_DOC) -> str:
    """서버 한도(문서 한 편 3,000자)를 지킨다: 넘으면 한도 안의 마지막 줄바꿈에서 자른다."""
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    return (cut[:cut.rfind('\n')] if '\n' in cut else cut).rstrip()


def _first_entries(infos: list[Info], key_of: dict[str, str], entries_of) -> dict[str, tuple[Info, list]]:
    """항목 key → (처음 나온 덩어리, 그 덩어리에서 그 항목으로 적힌 것들)."""
    first = {}
    for info in sorted(infos, key=lambda i: i.ordinal):
        entries = entries_of(info)
        for entry in entries:
            key = key_of.get(entry.name)
            if key and key not in first:
                first[key] = (info, [e for e in entries if key_of.get(e.name) == key])
    return first


def _claims(infos: list[Info], key_of: dict[str, str], entries_of) -> dict[str, set[str]]:
    """이름 → 그 이름을 이름이나 별칭으로 적은 항목들의 key. 둘 이상이면 한 대상만 가리키는 이름이 아니라 별칭으로 쓰지 않는다."""
    claimed: dict[str, set[str]] = defaultdict(set)
    for info in infos:
        for entry in entries_of(info):
            for n in (entry.name, *entry.aliases):
                claimed[n].add(key_of[entry.name])
    return claimed


def card_aliases(entries: list, title: str, key: str, claimed: dict[str, set[str]]) -> list[str]:
    """별칭은 처음 나온 대목에서 적힌, 그 대상만 가리키는 이름뿐이다(별칭은 회차 구분이 없어 카드가 보이는 순간 모두 보인다: 설계 규칙 6)."""
    names = dict.fromkeys(n.strip() for e in entries for n in (e.name, *e.aliases))
    return [n for n in names if n and n != title and claimed[n] == {key}]


def _relation(key, ordinal, source, target, predicate, label, body, polarity='asserted'):
    return {'key': key, 'from': ordinal, 'source': source, 'target': target, 'predicate': predicate, 'label': label, 'body': body, 'polarity': polarity}


def build_world(infos: list[Info], people: Resolved, settings: Resolved, docs: dict[str, Docs], ordinals: dict, unsplit: list[list[int]]) -> dict:
    """시연 세계관과 같은 모양의 world.json 하나: 인물·설정·사건 카드와 회차별 관계. 문서·본문·별칭은 처음 나온 대목에서 드러난 것만, 나중 것은 episodes[N]·관계·사건 카드로 둔다."""
    infos = sorted(infos, key=lambda i: i.ordinal)
    persons = lambda i: i.extraction.people  # noqa: E731
    things = lambda i: i.extraction.things  # noqa: E731
    first_person = _first_entries(infos, people.key_of, persons)
    first_thing = _first_entries(infos, settings.key_of, things)
    claimed_person, claimed_thing = _claims(infos, people.key_of, persons), _claims(infos, settings.key_of, things)
    records = person_records(infos, people)
    appear: dict[str, int] = {k: info.ordinal for k, (info, _) in first_person.items()}
    memory: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    label_of = {info.ordinal: unit_label(info) for info in infos}
    events, links = [], []
    attended: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    for info in infos:
        for p in info.extraction.people:
            if p.memory.strip():
                lines = memory[people.key_of[p.name]][info.ordinal]
                if p.memory.strip() not in lines:
                    lines.append(p.memory.strip())
        for j, e in enumerate(info.extraction.events):
            ekey = f'ev-{info.ordinal:03d}-{j:02d}'
            present = list(dict.fromkeys(people.key_of[n] for n in e.participants if n in people.key_of))
            events.append({'key': ekey, 'cardType': 'event', 'areaCode': 'history', 'title': clip(e.title or e.summary, 60), 'classification': '사건', 'aliases': [], 'tags': [],
                           'visibility': 'private', 'revealFromEpisode': info.ordinal, 'body': clip(e.summary)})
            for person in present:
                appear[person] = min(appear.get(person, info.ordinal), info.ordinal)
                attended[person][info.ordinal].append(e.summary.strip())
                links.append(_relation(f'{person}~{ekey}', info.ordinal, person, ekey, 'custom_relation_directed', '참여', '이 사건에 함께했다.'))
            crowd = present[:MAX_PAIR]
            for a in crowd:
                for b in crowd:
                    if a != b:
                        links.append(_relation(f'{a}>{b}>knows', info.ordinal, a, b, 'custom_relation_directed', '알고 있음', f'{people.items[a].title}은(는) {people.items[b].title}을(를) 안다.'))
    cards = []
    for key, who in sorted(people.items.items(), key=lambda kv: (appear[kv[0]], kv[0])):
        entries = first_person[key][1]
        mine = first_records(records.get(key, []))
        doc = docs.get(key)
        wants = next((r.wants for r in mine if r.wants), '')
        identity = (doc.identity.strip() if doc else '') or ' '.join(s for r in mine for s in (r.situation, r.looks, r.personality) if s) or f'{who.title}. {label_of[appear[key]]}에 처음 나온다.'
        episodes = {}
        for ordinal in sorted({*memory[key], *attended[key]}):
            lines = memory[key].get(ordinal) or list(dict.fromkeys(attended[key][ordinal]))[:2]
            episodes[str(ordinal)] = clip(f'## {ordinal}화({label_of[ordinal]})\n' + '\n'.join(f'- {line}' for line in lines))
        cards.append({'key': key, 'cardType': 'character', 'areaCode': 'basic', 'title': who.title, 'classification': '인물',
                      'aliases': card_aliases(entries, who.title, key, claimed_person), 'tags': [], 'visibility': 'private', 'revealFromEpisode': appear[key], 'body': clip(identity),
                      'characterDocs': {'soul': clip((doc.soul.strip() if doc else '') or UNKNOWN_SOUL), 'goal': clip((doc.goal.strip() if doc else '') or (f'- {wants}' if wants else '')), 'episodes': episodes},
                      'english': who.en})
    for key, what in sorted(settings.items.items(), key=lambda kv: (first_thing[kv[0]][0].ordinal, kv[0])):
        info, entries = first_thing[key]
        area, classification = SETTINGS[what.kind]
        body = ' '.join(dict.fromkeys(e.description.strip() for e in entries if e.description.strip())) or f'{what.title}. {unit_label(info)}에 처음 나온다.'
        cards.append({'key': key, 'cardType': what.kind, 'areaCode': area, 'title': what.title, 'classification': classification, 'aliases': card_aliases(entries, what.title, key, claimed_thing),
                      'tags': [], 'visibility': 'private', 'revealFromEpisode': info.ordinal, 'body': clip(body)})
    for info in infos:
        for r in info.extraction.relations:
            source = people.key_of.get(r.source) or settings.key_of.get(r.source)
            target = people.key_of.get(r.target) or settings.key_of.get(r.target)
            if source and target and source != target:
                links.append(_relation(f'{source}>{target}>{r.category}', info.ordinal, source, target, 'custom_relation_directed' if r.category == 'structural' else 'custom_emotion',
                                       r.label.strip() or '관계', r.body.strip() or r.label.strip() or '관계'))
    cards += events
    return {'world': {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'storyfork-eval-hp')), 'name': '해리 포터 · 원문 기반 평가 세계관',
                      'description': '번역본 원문에서 모델이 뽑은 평가 전용 세계관이다. 인물 문서·설정 본문은 처음 나온 대목에서 드러난 것만이고, 이후의 일은 회차별 기억·관계·사건 카드로 둔다.', 'genre': 'fantasy'},
            'work': {'title': '해리 포터(평가용·로컬 전용)', 'summary': '해리 포터 번역본 원문에서 만든 평가 전용 세계관을 붙인 로컬 작품입니다. 원고는 없습니다.',
                     'creationType': 'EXTERNAL_DERIVATIVE', 'genres': ['판타지'], 'hashtags': ['평가용'], 'allowFork': False},
            'cards': cards, 'relationships': _timeline(links), 'secrets': [],
            'ordinals': {f'{b}-{c}': n for (b, c), n in ordinals.items()}, 'english': {c['english']: c['key'] for c in cards if c.get('english')}, 'unsplit': unsplit}


def _timeline(links: list[dict]) -> list[dict]:
    """관계(key)마다 값이 처음 생기거나 바뀐 회차의 기록만 남긴다(DEC-51). 같은 회차에 여러 번 나오면 마지막 값."""
    last: dict[str, tuple[str, str]] = {}
    at: dict[tuple[str, int], dict] = {}
    for link in sorted(links, key=lambda r: r['from']):
        said = (link['label'], link['body'])
        if last.get(link['key']) != said:
            last[link['key']] = said
            at[(link['key'], link['from'])] = link
    return sorted(at.values(), key=lambda r: (r['from'], r['key']))


# --- 호출·실행 ---------------------------------------------------------------------------------------------------------------

def estimate_build(chars: list[int], persons: int | None = None) -> dict:
    """build의 예상 호출 수와 금액(호출 없이). chars는 덩어리별 글자 수. persons는 추출 전에는 모르므로 덩어리마다 6명으로 어림하고, 입출력 토큰은 호출당 평균의 어림이다."""
    windows = sum(math.ceil(c / WINDOW) for c in chars)
    persons = persons if persons is not None else 6 * len(chars)
    calls = {'extract': windows, 'names': math.ceil(persons * 0.4 / NAMES_BATCH), 'docs': persons}
    tokens_in = {'extract': sum(chars) / CHARS_PER_TOKEN / (windows or 1) + 900, 'names': 7_000, 'docs': 1_200}
    tokens_out = {'extract': 6_000, 'names': 3_000, 'docs': 1_100}   # 실측(2026-11-20 시험 호출 셋): 추출 출력 5.2~6.3K토큰·입력 글자/토큰 약 1.5
    return {'calls': calls, 'in': tokens_in, 'out': tokens_out, 'usd': sum(usd(int(n * tokens_in[k]), int(n * tokens_out[k])) for k, n in calls.items())}


def _ask(llm, kind, instructions, data, schema, tokens, text=None, depth=0):
    """한 번 묻는다. 추출이 끝나지 않으면(출력이 잘림) 글을 반으로 잘라 다시 읽고 합친다(두 번까지)."""
    try:
        return llm.ask(kind, instructions, data, schema=schema, max_output_tokens=tokens)
    except LlmFailure as failure:
        if text is None or depth >= 2 or str(failure) not in ('incomplete', 'unparsed') or len(text) < 2:
            raise
    parts = [_ask(llm, kind, *extract_request(half), schema, tokens, half, depth + 1) for half in hp_chapters.windows(text, len(text) // 2 + 1)]
    return Extraction(events=[e for p in parts for e in p.events], people=[x for p in parts for x in p.people], things=[t for p in parts for t in p.things],
                      relations=[r for p in parts for r in p.relations])


def _run(llm, kind: str, requests: dict, workers: int, limit_usd: float, log) -> dict:
    """requests = {id: (지시문, 입력, 스키마, 출력 상한, 잘릴 때 반으로 자를 글)} → {id: 응답}. 실패는 한 번 다시 시도하고, 상한에 닿으면 LimitReached, 계속 실패하면 원문 없이 SystemExit다."""
    results, failures, stop, lock = {}, {}, threading.Event(), threading.Lock()
    reserve = workers * CALL_MAX_USD

    def one(item):
        key, (instructions, data, schema, tokens, text) = item
        if stop.is_set() or llm.cost.spent() + reserve > limit_usd:
            stop.set()
            return
        try:
            reply = _ask(llm, kind, instructions, data, schema, tokens, text)
        except CallCapExceeded:
            stop.set()
            return
        except LlmFailure as failure:
            with lock:
                failures[key] = str(failure)
            return
        with lock:
            results[key] = reply
            if len(results) % 25 == 0:
                log(f'  {kind} {len(results)}/{len(requests)}')

    for _ in range(2):
        failures.clear()
        with ThreadPoolExecutor(workers) as pool:
            list(pool.map(one, {k: v for k, v in requests.items() if k not in results}.items()))
        if stop.is_set():
            raise LimitReached(f'{kind}: 비용 상한 ${limit_usd:.2f}에 닿아 멈췄다(끝낸 {len(results)}/{len(requests)}건). 같은 명령으로 이어 간다(응답은 캐시에 있다).')
        if not failures:
            return results
    raise SystemExit(f'{kind}: 호출 {len(failures)}건이 두 번 실패했다(원인: {sorted(set(failures.values()))}). 같은 명령으로 이어 갈 수 있다(끝낸 요청은 캐시에 있다).')


def build(llm, raw: Path, out: Path, rows: list[dict], *, limit_usd: float, workers: int = 8, log=print) -> dict:
    """장 나누기부터 world.json까지. 시작 전에 예상 금액이 남은 상한(상한 − 장부 누적)을 넘으면 호출 없이 멈춘다. 숫자만 돌려준다(원문·응답 없음)."""
    splits = hp_chapters.split_all(raw)
    hp_chapters.write_chapters(splits, out / 'chapters')
    ordinals = ordinals_of(splits)
    units = [(book, unit) for book, split in sorted(splits.items()) for unit in split.units]
    plan, started = estimate_build([len(u.text) for _, u in units]), llm.cost.spent()
    log(f'build 예상: 추출 {plan["calls"]["extract"]}회·이름 {plan["calls"]["names"]}회·문서 {plan["calls"]["docs"]}회 → 약 ${plan["usd"]:.2f} (장부 ${started:.2f} / 상한 ${limit_usd:.2f})')
    if plan['usd'] > limit_usd - started:
        raise LimitReached(f'예상 금액 ${plan["usd"]:.2f}가 남은 상한 ${limit_usd - started:.2f}(상한 ${limit_usd:.2f} − 장부 ${started:.2f})를 넘어 호출 없이 멈춘다.')
    requests = {(i, j): (*extract_request(window), Extraction, EXTRACT_TOKENS, window)
                for i, (_, unit) in enumerate(units) for j, window in enumerate(hp_chapters.windows(unit.text, WINDOW))}
    done = _run(llm, 'hp_extract', requests, workers, limit_usd, log)
    infos = []
    for i, (book, unit) in enumerate(units):
        parts = [done[k] for k in sorted(k for k in done if k[0] == i)]
        merged = Extraction(events=[e for p in parts for e in p.events], people=[x for p in parts for x in p.people], things=[t for p in parts for t in p.things],
                            relations=[r for p in parts for r in p.relations])
        infos.append(Info(book, unit.chapters, ordinals[(book, unit.ordinal_chapter)], merged))
    asked = name_requests(infos, hint_names(rows))
    replies = _run(llm, 'hp_names', {i: (instructions, data, Names, NAMES_TOKENS, None) for i, (_, instructions, data) in enumerate(asked)}, workers, limit_usd, log)
    english: dict[str, str | None] = {}
    for i, (names, _, _) in enumerate(asked):
        english.update(apply_names(names, replies[i]))
    people, settings = resolve_persons(infos, english.get), resolve_settings(infos)
    records, first = person_records(infos, people), _first_entries(infos, people.key_of, lambda i: i.extraction.people)
    claimed = _claims(infos, people.key_of, lambda i: i.extraction.people)
    doc_requests = {key: (*docs_request(people.items[key].title, card_aliases(first[key][1], people.items[key].title, key, claimed), records[key]), Docs, DOCS_TOKENS, None)
                    for key in people.items if records.get(key)}
    docs = _run(llm, 'hp_docs', doc_requests, workers, limit_usd, log)
    unsplit = [[book, list(u.chapters)] for book, u in units if len(u.chapters) > 1]
    world = build_world(infos, people, settings, docs, ordinals, unsplit)
    (out / 'world.json').write_text(json.dumps(world, ensure_ascii=False))
    found, failed = match_names(hint_names(rows), world['english'])
    kinds = defaultdict(int)
    for card in world['cards']:
        kinds[card['cardType']] += 1
    return {'units': len(units), 'chapters': len(ordinals), 'cards': dict(kinds), 'relations': len(world['relationships']), 'unsplit': unsplit,
            'nameMatched': len(found), 'nameFailures': failed, 'usd': llm.cost.spent() - started}


# --- 표본 보기 ----------------------------------------------------------------------------------------------------------------

def preview(world: dict, names: list[str], limit: int = 300) -> str:
    """사용자에게 보일 표본(마크다운): 물은 인물(영어 이름)의 문서 앞부분과 회차별 기억 예시, 사건 카드 셋, 인물 사이 관계 다섯."""
    cards = {c['key']: c for c in world['cards']}
    found, _ = match_names(names, world['english'])
    lines = ['# 해리 포터 원문 기반 세계관 표본', '', f'카드 {len(cards)}개 · 관계 기록 {len(world["relationships"])}개 · 회차 {len(world["ordinals"])}개', '']
    for name in names:
        card = cards.get(found.get(name, ''))
        lines += [f'## {name}' + (f' — {card["title"]}(첫 등장 {card["revealFromEpisode"]}화)' if card else ''), '']
        if card is None:
            lines += ['(카드 없음)', '']
            continue
        docs = card['characterDocs']
        for label, text in (('IDENTITY', card['body']), ('SOUL', docs['soul']), ('GOAL', docs['goal'])):
            lines += [f'**{label}** ' + (text.replace('\n', ' ')[:limit] or '(비어 있음)'), '']
        ordinals = sorted(docs['episodes'], key=int)
        for o in ordinals[:: max(len(ordinals) // 3, 1)][:3]:
            lines += [f'- {docs["episodes"][o].replace(chr(10), " ")[:limit]}']
        lines += ['']
    events = [c for c in cards.values() if c['cardType'] == 'event']
    lines += ['## 사건 카드 셋', '']
    for c in events[:: max(len(events) // 3, 1)][:3]:
        lines += [f'- {c["title"]} ({c["revealFromEpisode"]}화): {c["body"]}']
    ties = [r for r in world['relationships'] if r['label'] not in ('참여', '알고 있음') and cards[r['source']]['cardType'] == 'character' and cards[r['target']]['cardType'] == 'character']
    lines += ['', f'## 인물 사이 관계 ({len(ties)}개 중 다섯)', '']
    for r in ties[:: max(len(ties) // 5, 1)][:5]:
        lines += [f'- {cards[r["source"]]["title"]} → {cards[r["target"]]["title"]}: {r["label"]} — {r["body"]} ({r["from"]}화부터)']
    return '\n'.join(lines) + '\n'
