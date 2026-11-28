"""KoTimeChara 전처리 평가(연결 평가): 세계관(json)과 정답표(knowledge.jsonl)를 코드로 대조한다(모델 호출 없음). 같은 잣대로 세계관 셋을 잰다:
world.json(기존 평가용 세계관)·world2.json(시제품, kt_world2)·world_svc.json(지금 서비스 전처리 결과, kt_world_svc).

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_linkeval.py --name=cmp [--worlds=world,world2,world_svc] [작품 id …]

사건 짝짓기: 정답표 사건 하나에 같은 회차의 세계관 사건 하나(가장 잘 맞는 것, 서로 하나씩만). 규칙 두 가지.
- quote: 세계관 사건의 원문 인용이 정답표 근거 문장과 겹친다(kt_context.overlaps와 같은 12자 창, 겹친 창의 비율이 큰 쪽). 인용이 있는 세계관(시제품·서비스)만 쓴다.
- text: 인용이 없는 세계관(기존 world.json)을 위한 보조 규칙. 정답표 요약의 글자 2-gram(인물 이름은 뺀다: 이름이 모든 사건에 들어 있어 변별력이 없다)이 세계관 사건 글의 한 창(문장 하나나 이어진 두 문장,
  첫 창에는 제목을 붙인다)에 TEXT_MIN 이상 들어 있고, 참여 인물 집합의 겹침(Jaccard)을 점수에 더한다. 사건 글의 길이가 달라도 같은 길이의 창끼리 견주지만, 요약이 서로 다른 모델 호출이 쓴 글이라 같은 사건이어도
  글이 많이 달라 느슨하고(오짝·놓침이 모두 가능) 인용 규칙과 잣대가 다르다 — 그래서 인용이 있는 세계관은 두 규칙을 모두 잰다(세 세계관을 같은 잣대로 견줄 때는 text 행끼리).
인물 대응: 세계관 인물 카드 이름(제목·별칭) 하나가 정답표 인물 이름과 호칭 변형(서비스 _base)까지 같으면 그 인물이고, 아니면 한쪽이 다른 쪽의 끝부분·첫 낱말(성을 뗀 이름·직함이 붙은 이름)인 정답표 인물이 하나뿐일 때 그 인물이다
(정답표 인물이 둘 이상이면 어느 쪽인지 몰라 잇지 않는다. 기존 canonical_names는 세계관 쪽 긴 이름이 둘이면 합치지 않아 '김지수'·'서울 판관 김지수' 카드를 정답표 '지수'에 잇지 못했다).
정답표 인물도 같은 규칙으로 한 인물씩 묶는다(gold_classes): 정답표 추출의 canonical_names는 '철수'·'철수야' 같은 호칭 변형을 합치지 못해 한 인물이 둘로 올라 있어, 그대로 두면 이를 올바르게 합친 카드가 '섞임'으로 읽힌다
(같은 사건에 다른 사람으로 오른 쌍은 합치지 않는다). 섞임은 카드가 정답표 인물 둘 이상에 걸린 것(cards_mixed)과 그중 같은 사건에 다른 사람으로 함께 나온 인물이 걸린 분명한 오병합(cards_mixed_apart)을 따로 센다.
지표(작품별·전체·웹소설/고전, Wilson 95% 구간): 사건 재현율 · 겪음 정확도(짝지은 사건에서 세계관이 이은 인물 중 정답표 참여·목격자, 정답표 인물에 대응하지 못한 카드는 분모에서 빼고 건수로 따로)
· 겪음 재현율 · 들음 정확도·재현율(정답표 learned와 대조, 회차 일치는 따로) · 인물 병합(쪼개짐·섞임) · 인물 기준 지식 정확도(주요 인물 × 정답 사건 × 기준 회차 0~3, knows()와 일치).
지식 F1 = 2tp/(2tp+fp+fn)(정밀·재현의 조화평균, 이 평가의 주 지표). '넓힌' 지식 판정(…_wide)은 엄격 판정(사건과의 연결)에 더해 인물 카드의 회차 기억 중 사건이 아닌 서술(표지 [사건]·[겪은 일]·[들은 일] 항목이 아닌 줄)이 같은 회차 정답 사건과
text 규칙으로 맞으면(서술 하나는 가장 잘 맞는 정답 사건 하나에 속한다) 그 인물이 사건을 안다고 센다(서비스 기준선은 사건 카드와 인물이 이어지지 않아 엄격 판정이 거의 0이라 따로 본다. 세 세계관에 똑같이 적용하고 호출은 없다).
들음은 같은 회차에 들음(세계관의 들음 기록 회차 = 사건 회차: 정답표에 대응 범주가 없어 그 인물이 사건을 알고 있었는지만)과 뒤 회차에 들음(기록 회차 > 사건 회차: 정답표 learned와 대조, 정확도·재현율)을 따로 센다.
결과는 results/ko-timechara-linkeval-<name>.json(집계만)과 콘솔 표. --worlds의 이름은 world·world2·world_svc와 자가 개선 판 sv-<이름>이다.
세계관마다 같은 작품 집합(요청한 작품 중 모든 세계관 파일이 있는 작품, 결과의 common)으로 재고, 세계관별로 빠진 작품은 worlds.<이름>.missing에 남긴다(한 세계관만 일부 작품이 빠지면 작품 구성 차이가 성능 차이로 읽힌다).
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json
import re
from collections import Counter
from itertools import combinations

from app.manuscript_extraction.service import _base
from kt_common import KT, RESULTS
from kt_exec import load_works
from kt_label import knows
from kt_questions import load_knowledge, main_characters
from kt_text import squash
from kt_world import load_world
from metrics import wilson_interval

WORLDS = ('world', 'world2', 'world_svc')
WORLD_NAME = re.compile(r'world[A-Za-z0-9_]*|sv-[A-Za-z0-9_-]+')   # 세계관 파일 이름: world·world2·world_svc와 자가 개선 판 sv-<이름>
EVENT_LABELS = ('[사건] ', '[겪은 일] ', '[들은 일] ')   # 인물 기억에서 사건 항목의 표지(서비스 [사건], 시제품 [겪은 일]·[들은 일])
LABEL_ROW = re.compile(r'\[[^\]\n]{1,8}\] ')
TEXT_MIN = 0.2   # text 규칙에서 정답표 요약의 2-gram(이름 제외)이 세계관 사건 글의 한 창에 들어 있어야 하는 비율(실데이터 분포로 정한 값, 보고서에 근거)
SENTENCE = re.compile(r'(?<=[.!?。])\s+')
AFTER_SPAN = 3    # 기준 회차: 사건 회차 이후 0~3회(kt_pairs·kt_questions와 같다)


def check_worlds(names) -> tuple[str, ...]:
    """--worlds의 이름(works/<id>/<이름>.json): 세계관 파일이다(world로 시작하거나 자가 개선 판 sv-<이름>, 통계 파일 <이름>_stats는 아니다)."""
    if bad := [n for n in names if not WORLD_NAME.fullmatch(n) or n.endswith('_stats')]:
        raise SystemExit(f"--worlds에 세계관이 아닌 이름 {','.join(bad)}가 있다(world·world2·world_svc처럼 world로 시작하거나 sv-<이름>).")
    return tuple(names)


# ---- 짝짓기 ----

def overlap_score(quote: str, evidence: str, n: int = 12) -> float:
    """정답표 근거 문장(evidence)의 n자 창(3자 간격)이 인용(quote)에 들어 있는 비율. 0보다 크면 kt_context.overlaps와 같다(둘 다 squash한 글). 근거가 n자보다 짧으면 통째로 들어 있을 때 1."""
    if len(evidence) < n:
        return float(evidence in quote)
    windows = range(0, len(evidence) - n + 1, 3)
    return sum(evidence[i:i + n] in quote for i in windows) / len(windows)


def gold_people(event: dict) -> set[str]:
    """정답표 사건에 참여·목격한 인물 이름."""
    return {p['name'] for p in event['participants'] + event['witnesses']}


def world_events(world: dict) -> list[dict]:
    """세계관의 사건을 공통 모양으로: {id, episode, title, text, quote(없으면 None), experienced: {카드 id: 기록 회차}, heard: {카드 id: 기록 회차}}.
    평가용 덧붙임(world['events'], 시제품·서비스 변환 세계관)이 있으면 그것을, 없으면(기존 세계관) 사건 카드와 인물 → 사건 '참여' 관계를 읽는다."""
    cards = {c.id: c for c in world['cards']}
    if 'events' in world:
        return [{'id': eid, 'episode': m['episode'], 'title': m['title'], 'text': cards[eid].text if eid in cards else '', 'quote': m['quote'],
                 'experienced': dict(m['experienced']), 'heard': dict(m['heard'])} for eid, m in world['events'].items()]
    events = {c.id: {'id': c.id, 'episode': c.revealFromEpisode, 'title': c.title, 'text': c.text, 'quote': None, 'experienced': {}, 'heard': {}}
              for c in world['cards'] if c.cardType == 'event'}
    for r in world['relations']:
        if r.label == '참여' and r.target in events and r.source in cards and cards[r.source].cardType == 'character':
            events[r.target]['experienced'][r.source] = world['when'][r.id]
    return list(events.values())


def gold_matches(name: str, gold_names, claimed=frozenset()) -> set[str]:
    """세계관 이름 하나에 대응하는 정답표 인물: 호칭 변형(_base)까지 같은 이름이 있으면 그것(들), 없으면 한쪽이 다른 쪽의 끝부분·첫 낱말(2자 이상)인 정답표 이름이 하나뿐일 때 그것. 모호하면 빈 집합.
    claimed = 세계관에 이름이 같은 카드가 따로 있는 정답표 이름: 끝부분·첫 낱말 대응이 둘 이상에 걸려 모호할 때만 뺀다('로빈 하트' 카드는 '하트' 카드가 따로 있으면 '로빈'의 카드다).
    하나뿐인 대응은 그대로다('김철수' 카드는 '철수' 카드가 따로 있어도 '철수'의 쪼개진 카드)."""
    base = _base(name)
    if exact := {g for g in gold_names if _base(g) == base}:
        return exact
    tails = {g for g in gold_names if len(g) >= 2 and len(base) >= 2 and (base.endswith(g) or g.endswith(base) or base.startswith(g + ' ') or g.startswith(base + ' '))}
    if len(tails) > 1:
        tails -= set(claimed)
    return tails if len(tails) == 1 else set()


def person_cards(gold_names, world: dict) -> tuple[dict[str, list[str]], dict[str, set[str]]]:
    """(정답표 인물 → 대응하는 세계관 인물 카드 id들, 인물 카드 id → 대응하는 정답표 인물들). 카드 이름은 제목과 별칭(world['aliases'])이고 대응 규칙은 gold_matches다."""
    chars = {c.id: [c.title, *world.get('aliases', {}).get(c.id, [])] for c in world['cards'] if c.cardType == 'character'}
    claimed = {g for names in chars.values() for n in names for g in gold_names if _base(g) == _base(n)}
    gold_of = {cid: {g for n in names for g in gold_matches(n, gold_names, claimed)} for cid, names in chars.items()}
    return {g: sorted(cid for cid, gs in gold_of.items() if g in gs) for g in gold_names}, gold_of


def character_ids(world: dict, names) -> dict[str, str]:
    """정답표 인물 이름 → 세계관 인물 카드 id(kt_pairs가 정답표 이름으로 만든 질문을 이 세계관의 카드에 잇는다). 대응하는 카드가 여럿(쪼개진 인물)이면 회차 기억이 가장 많은 카드,
    같으면 먼저 공개된 카드·id 순이다. 대응하는 카드가 없는 이름은 뺀다."""
    cards, _ = person_cards(names, world)
    by_id = {c.id: c for c in world['cards']}
    return {name: min(ids, key=lambda i: (-len(by_id[i].episodes), by_id[i].revealFromEpisode or 0, i)) for name, ids in cards.items() if ids}


def _bigrams(text: str, drop=()) -> set[str]:
    """squash한 글의 글자 2-gram. drop의 이름(긴 것부터)은 먼저 뺀다."""
    s = squash(text)
    for name in drop:
        s = s.replace(squash(name), '')
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _windows(title: str, text: str, drop) -> list[set[str]]:
    """세계관 사건 글의 비교 창: 문장 하나와 이어진 두 문장의 2-gram 집합들(첫 문장으로 시작하는 창에는 제목을 붙인다)."""
    sentences = [s for s in SENTENCE.split(text.strip()) if s] or ['']
    return [_bigrams(' '.join(([title] if i == 0 else []) + sentences[i:i + k]), drop) for k in (1, 2) for i in range(max(1, len(sentences) - k + 1))]


def match_events(gold: list[dict], events: list[dict], rule: str, present: dict[str, set[str]], gold_of: dict[str, set[str]], drop=()) -> dict[str, dict]:
    """정답표 사건 id → 짝지은 세계관 사건(같은 회차, 점수가 큰 쌍부터 서로 하나씩). rule = 'quote'(인용이 근거 문장과 겹침) | 'text'(요약 2-gram이 사건 글의 한 창에 포함 + 참여 인물 겹침).
    drop은 text 규칙에서 2-gram을 세기 전에 뺄 인물 이름들이다."""
    by_episode: dict[int, list[dict]] = {}
    for w in events:
        by_episode.setdefault(w['episode'], []).append(w)
    windows = {w['id']: _windows(w['title'], w['text'], drop) for w in events} if rule == 'text' else {}
    scored = []
    for g in gold:
        evidence, summary = squash(g['evidence']), _bigrams(g['summary'], drop) if rule == 'text' else set()
        for w in by_episode.get(g['episode'], []):
            if rule == 'quote':
                score = overlap_score(squash(w['quote']), evidence) if w['quote'] else 0.0
                if score <= 0:
                    continue
            else:
                score = max((len(summary & window) / len(summary) for window in windows[w['id']]), default=0.0) if summary else 0.0
                if score < TEXT_MIN:
                    continue
            mine, theirs = present[g['id']], {n for card in w['experienced'] for n in gold_of.get(card, ())}
            jaccard = len(mine & theirs) / len(mine | theirs) if mine | theirs else 0.0
            scored.append((-(score + jaccard if rule == 'text' else score), -jaccard, g['id'], w['id'], w))
    matches, used = {}, set()
    for _, _, gid, wid, w in sorted(scored, key=lambda row: row[:4]):
        if gid not in matches and wid not in used:
            matches[gid] = w
            used.add(wid)
    return matches


def statements(memory: str) -> list[str]:
    """인물 기억 글에서 사건이 아닌 서술들. 표지([정체]·[계획] 등)로 시작하는 줄이 한 항목이고 표지 없이 이어지는 줄은 앞 항목에 딸린다(서비스는 인용 안에 개행이 있다).
    사건 항목(EVENT_LABELS)은 엄격 판정이 이미 보므로 뺀다. 표지가 없는 글(기존 세계관의 기억)은 통째로 서술이다."""
    entries: list[tuple[bool, str]] = []   # (사건 항목인가, 글)
    for row in memory.split('\n'):
        if LABEL_ROW.match(row):
            entries.append((row.startswith(EVENT_LABELS), LABEL_ROW.sub('', row, count=1)))
        elif entries:
            entries[-1] = (entries[-1][0], entries[-1][1] + '\n' + row)
        elif row.strip():
            entries.append((False, row))
    return [text for event, text in entries if not event and text.strip()]


def memory_matches(world: dict, gold: list[dict], drop=()) -> dict[str, dict[str, int]]:
    """정답표 사건 id → {인물 카드 id: 그 사건에 맞은 서술이 든 회차}. 인물 카드의 회차 기억에서 사건이 아닌 서술(statements)의 비교 창(문장 하나·이어진 두 문장)이 같은 회차 정답 사건의
    요약과 text 규칙(2-gram 비율 TEXT_MIN 이상, 인물 이름 drop은 뺀다)으로 맞으면 그 창은 가장 잘 맞는 정답 사건 하나에 속한다(점수가 같으면 앞 사건). 넓힌 지식 판정이 쓴다."""
    options: dict[int, list[tuple[str, set[str]]]] = {}
    for g in gold:
        if summary := _bigrams(g['summary'], drop):
            options.setdefault(g['episode'], []).append((g['id'], summary))
    found: dict[str, dict[str, int]] = {}
    for card in world['cards']:
        for n, memory in card.episodes.items() if card.cardType == 'character' else ():
            for text in statements(memory) if options.get(int(n)) else ():
                for window in _windows('', text, drop):
                    score, _, gid = max((len(summary & window) / len(summary), -i, gid) for i, (gid, summary) in enumerate(options[int(n)]))
                    if score >= TEXT_MIN:
                        found.setdefault(gid, {}).setdefault(card.id, int(n))
    return found


def gold_classes(names, apart) -> dict[str, str]:
    """정답표 이름 → 같은 인물로 읽는 이름들의 대표 이름(가장 짧은 이름). 호칭 변형(_base)이 같거나 한쪽이 다른 쪽의 끝부분(성을 뗀 이름)인 유일한 짝(gold_matches)을 한 인물로 본다:
    정답표 추출의 canonical_names는 '철수'·'철수야' 같은 호칭 변형을 합치지 못해 한 인물이 둘로 올라 있다. 같은 사건에 다른 사람으로 오른 쌍(apart)은 합치지 않는다:
    합치는 두 묶음의 이름들 사이에 그런 쌍이 하나라도 있으면 합치지 않는다(apart인 '로빈'·'하트'가 긴 이름 '로빈 하트'를 거쳐 한 인물이 되지 않는다. 이름 가나다 순으로 먼저 합친 쪽에 긴 이름이 붙는다)."""
    parent = {n: n for n in names}
    members = {n: [n] for n in names}   # 대표 → 그 묶음의 이름들

    def find(n: str) -> str:
        while parent[n] != n:
            n = parent[n]
        return n

    different = {frozenset(pair) for pair in apart}
    for n in sorted(names):
        for m in gold_matches(n, [x for x in names if x != n]):
            a, b = find(n), find(m)
            if a != b and not any(frozenset((x, y)) in different for x in members[a] for y in members[b]):
                parent[a] = b
                members[b] += members.pop(a)
    groups: dict[str, list[str]] = {}
    for n in names:
        groups.setdefault(find(n), []).append(n)
    return {n: min(group, key=lambda x: (len(x), x)) for group in groups.values() for n in group}


# ---- 지표(작품 하나의 개수) ----

def work_counts(knowledge: list[dict], world: dict, mains: list[str], rule: str) -> Counter:
    """한 작품·한 세계관·한 짝짓기 규칙의 개수(분자·분모). 정답표 인물은 사건에 오른 인물과 전해 들은 인물을 gold_classes로 한 인물씩 묶은 것이다.
    겪음·들음 정확도는 이은 카드마다(같은 정답표 인물들에 대응하는 카드는 한 번) 그 인물 중 하나라도 정답표 참여·목격자(들음은 전해 들은 인물)인지를 센다."""
    gold = [e for r in knowledge for e in r['events']]
    spoken = {e['id']: gold_people(e) for e in gold}
    apart = [pair for people in spoken.values() for pair in combinations(sorted(people), 2)]
    rep = gold_classes(sorted({n for people in spoken.values() for n in people} | {i['learner'] for r in knowledge for i in r['learned']}), apart)
    members: dict[str, list[str]] = {}
    for n, r in rep.items():
        members.setdefault(r, []).append(n)
    present = {eid: {rep[n] for n in people} for eid, people in spoken.items()}
    learned: dict[str, dict[str, int]] = {}   # 사건 → 정답표 인물(묶음) → 처음 전해 들은 회차(같은 인물의 두 호칭이 올린 기록 중 가장 이른 것)
    for r in knowledge:
        for item in r['learned']:
            who = learned.setdefault(item['event'], {})
            who[rep[item['learner']]] = min(who.get(rep[item['learner']], item['episode']), item['episode'])
    names = sorted(members)
    cards, gold_of = person_cards(names, world)
    drop = sorted({n for n in rep if len(n) >= 2} | {n for c in world['cards'] if c.cardType == 'character' for n in [c.title, *world.get('aliases', {}).get(c.id, [])] if len(n) >= 2},
                  key=len, reverse=True)   # text 규칙은 사건 글에서 인물 이름을 뺀다
    matches = match_events(gold, world_events(world), rule, present, gold_of, drop)
    memory = memory_matches(world, gold, drop)   # 넓힌 지식 판정: 사건이 아닌 기억 서술이 정답 사건과 맞는 인물
    c: Counter = Counter(gold_events=len(gold), matched=len(matches))
    for g in gold:
        w = matches.get(g['id'])
        if w is None:
            continue
        mine, who = present[g['id']], learned.get(g['id'], {})
        units = {frozenset(gold_of[card]) for card in w['experienced'] if gold_of.get(card)}
        found = set().union(*units) & mine
        c['exp_unmapped'] += sum(not gold_of.get(card) for card in w['experienced'])
        c['exp_linked'] += len(units)
        c['exp_correct'] += sum(bool(u & mine) for u in units)
        c['exp_gold'] += len(mine)
        c['exp_found'] += len(found)
        for learner, episode in who.items():
            when = [w['heard'][card] for card in cards.get(learner, ()) if card in w['heard']]
            c['learned_gold'] += 1
            c['heard_found'] += bool(when)
            c['heard_found_later'] += any(e > g['episode'] for e in when)
            c['heard_found_ep'] += episode in when
        heard: dict[frozenset, int] = {}   # 들음으로 이은 인물(같은 정답표 인물들에 대응하는 카드는 한 번) → 가장 이른 기록 회차
        for card, at in w['heard'].items():
            if gold_of.get(card):
                unit = frozenset(gold_of[card])
                heard[unit] = min(at, heard.get(unit, at))
        c['heard_linked'] += len(heard)
        c['heard_correct'] += sum(bool(u & set(who)) for u in heard)
        c['heard_known'] += sum(bool(u & (set(who) | mine)) for u in heard)
        for unit, at in heard.items():   # 사건과 같은 회차에 들음(정답표에는 대응 범주가 없어 알고 있었는지만)과 뒤 회차에 들음(정답표 learned와 대조)
            part = 'later' if at > g['episode'] else 'same'
            c[f'heard_{part}_linked'] += 1
            c[f'heard_{part}_known'] += bool(unit & (set(who) | mine))
            c['heard_later_correct'] += part == 'later' and bool(unit & set(who))
    mains = list(dict.fromkeys(rep.get(n, n) for n in mains))
    different = {frozenset((rep[a], rep[b])) for a, b in apart if rep[a] != rep[b]}
    c.update(persons=len(names), persons_found=sum(bool(cards[n]) for n in names), persons_split=sum(len(cards[n]) >= 2 for n in names),
             person_cards=sum(len(cards[n]) for n in names), main_persons=len(mains), main_found=sum(bool(cards.get(n)) for n in mains),
             main_split=sum(len(cards.get(n, ())) >= 2 for n in mains), cards=len(gold_of), cards_mixed=sum(len(gs) >= 2 for gs in gold_of.values()),
             cards_mixed_apart=sum(any(frozenset(pair) in different for pair in combinations(sorted(gs), 2)) for gs in gold_of.values()),
             cards_unmapped=sum(not gs for gs in gold_of.values()))
    last = max((r['episode'] for r in knowledge), default=0)   # 빈 정답표(사건 정답 없음)도 빈 지표로 센다
    for name in mains:
        mine_cards = cards.get(name, [])
        for g in gold:
            w = matches.get(g['id'])
            for p in range(g['episode'], min(g['episode'] + AFTER_SPAN, last) + 1):
                truth = any(knows(knowledge, n, g, p) for n in members.get(name, [name]))
                said = w is not None and any(w['experienced'].get(card, p + 1) <= p or w['heard'].get(card, p + 1) <= p for card in mine_cards)   # 짝은 같은 회차(p는 사건 회차 이후)라 사건 회차 조건은 필요 없다
                wide = said or any(card in memory.get(g['id'], {}) for card in mine_cards)   # 서술은 사건 회차의 기억이라 p(사건 회차 이후)에는 늘 지났다
                c['tp' if truth and said else 'fp' if said else 'fn' if truth else 'tn'] += 1
                c['wtp' if truth and wide else 'wfp' if wide else 'wfn' if truth else 'wtn'] += 1
    return c


def ratio(k: int, n: int) -> dict:
    """비율과 Wilson 95% 구간(n이 0이면 둘 다 None)."""
    return {'k': k, 'n': n, 'rate': k / n if n else None, 'ci': list(wilson_interval(k, n)) if n else None}


def f1(tp: int, fp: int, fn: int) -> float | None:
    """정밀·재현의 조화평균 2tp/(2tp+fp+fn)(셋이 모두 0이면 None)."""
    return 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else None


def derive(c: Counter) -> dict:
    """개수 → 지표 묶음."""
    return {'event_recall': ratio(c['matched'], c['gold_events']),
            'experienced_precision': ratio(c['exp_correct'], c['exp_linked']), 'experienced_recall': ratio(c['exp_found'], c['exp_gold']), 'experienced_unmapped': c['exp_unmapped'],
            'heard_precision': ratio(c['heard_correct'], c['heard_linked']), 'heard_precision_known': ratio(c['heard_known'], c['heard_linked']),
            'heard_recall': ratio(c['heard_found'], c['learned_gold']), 'heard_recall_episode': ratio(c['heard_found_ep'], c['learned_gold']),
            'heard_same_known': ratio(c['heard_same_known'], c['heard_same_linked']), 'heard_later_precision': ratio(c['heard_later_correct'], c['heard_later_linked']),
            'heard_later_known': ratio(c['heard_later_known'], c['heard_later_linked']), 'heard_later_recall': ratio(c['heard_found_later'], c['learned_gold']),
            'persons_found': ratio(c['persons_found'], c['persons']), 'persons_split': ratio(c['persons_split'], c['persons_found']),
            'cards_per_person': c['person_cards'] / c['persons_found'] if c['persons_found'] else None,
            'main_found': ratio(c['main_found'], c['main_persons']), 'main_split': ratio(c['main_split'], c['main_found']),
            'cards_mixed': ratio(c['cards_mixed'], c['cards']), 'cards_mixed_apart': ratio(c['cards_mixed_apart'], c['cards']), 'cards_unmapped': ratio(c['cards_unmapped'], c['cards']),
            'knowledge_precision': ratio(c['tp'], c['tp'] + c['fp']), 'knowledge_recall': ratio(c['tp'], c['tp'] + c['fn']),
            'knowledge_counts': {k: c[k] for k in ('tp', 'fp', 'fn', 'tn')}, 'knowledge_f1': f1(c['tp'], c['fp'], c['fn']),
            'knowledge_precision_wide': ratio(c['wtp'], c['wtp'] + c['wfp']), 'knowledge_recall_wide': ratio(c['wtp'], c['wtp'] + c['wfn']),
            'knowledge_f1_wide': f1(c['wtp'], c['wfp'], c['wfn']), 'knowledge_counts_wide': {k: c[k] for k in ('wtp', 'wfp', 'wfn', 'wtn')}}


def aggregate(per_work: dict[str, tuple[str, Counter]]) -> dict:
    """작품별 (종류, 개수) → 전체·웹소설/고전별·작품별 지표."""
    total, kinds = Counter(), {}
    for kind, c in per_work.values():
        total.update(c)
        kinds.setdefault(kind, Counter()).update(c)
    return {'all': derive(total), 'by_kind': {kind: derive(c) for kind, c in sorted(kinds.items())}, 'by_work': {wid: derive(c) for wid, (_, c) in per_work.items()}}


def prototype_stats(stats: list[dict]) -> dict:
    """시제품 통계(kt_world2의 <name>_stats.json)에서 근거 통과율(사건·관계·말투 대사 인용)과 버린 건수. 통계가 없으면 {}."""
    if not stats:
        return {}
    checked = sum(s['counts'].get(f'{part}_quote_checked', 0) for s in stats for part in ('event', 'relation', 'speech'))
    ok = sum(s['counts'].get(f'{part}_quote_ok', 0) for s in stats for part in ('event', 'relation', 'speech'))
    dropped: Counter = Counter()
    for s in stats:
        dropped.update(s['dropped'])
    return {'quote_checked': checked, 'quote_ok': ok, 'quote_pass': ok / checked if checked else None, 'dropped': sum(dropped.values()), 'dropped_by_code': dict(sorted(dropped.items()))}


def service_stats(stats: list[dict]) -> dict:
    """서비스 기준선 통계(kt_world_svc의 world_svc_stats.json)에서 항목 통과율(남은 / 제안)·빠진 건수의 코드별 합·추출에 실패한 회차 수·모델 호출 수. 통계가 없으면 {}."""
    if not stats:
        return {}
    skipped: Counter = Counter()
    for s in stats:
        skipped.update(s['extraction']['skipped'])
    kept, dropped = sum(s['extraction']['kept'] for s in stats), sum(s['extraction']['dropped'] for s in stats)
    return {'kept': kept, 'dropped': dropped, 'item_pass': kept / (kept + dropped) if kept + dropped else None, 'skipped': dict(sorted(skipped.items())),
            'failed_episodes': sum(len(s['failures']) for s in stats), 'calls': sum(s['calls'] for s in stats)}


# ---- 실행(실제 데이터가 필요해 단위 테스트하지 않는다) ----

def load_inputs(wid: str) -> dict:
    """한 작품의 정답표·종류·주요 인물(질문 대상 인물은 기존 world.json 기준이라 세계관 셋이 같은 인물을 잰다)."""
    knowledge, folder = load_knowledge(wid), KT / 'works' / wid
    work = load_works([wid])[wid]
    return {'knowledge': knowledge, 'kind': work['kind'], 'mains': main_characters(knowledge, load_world(folder / 'world.json')), 'folder': folder}


def common_and_missing(wids: list[str], have: dict[str, list[str]]) -> tuple[list[str], dict[str, list[str]]]:
    """세계관마다 가진 작품(have)에서 (모든 세계관이 가진 작품, 세계관별로 요청한 작품 중 그 세계관에 없는 작품). 둘 다 wids 순이다."""
    return [wid for wid in wids if all(wid in mine for mine in have.values())], {name: [wid for wid in wids if wid not in mine] for name, mine in have.items()}


def evaluate(wids: list[str], worlds: tuple[str, ...]) -> dict:
    """세계관마다 같은 작품 집합(모든 세계관이 가진 작품)으로 재고, 세계관별로 빠진 작품(요청한 작품 중 그 세계관 파일이 없는 것)을 따로 남긴다:
    한 세계관만 일부 작품이 빠지면 작품 구성 차이가 성능 차이로 읽히기 때문이다."""
    inputs = {wid: load_inputs(wid) for wid in wids}
    common, missing = common_and_missing(wids, {name: [wid for wid in wids if (inputs[wid]['folder'] / f'{name}.json').exists()] for name in worlds})
    out = {'works': wids, 'common': common, 'text_min': TEXT_MIN, 'worlds': {}}
    for name in worlds:
        loaded = {wid: load_world(inputs[wid]['folder'] / f'{name}.json') for wid in common}
        quoted = any(m['quote'] for world in loaded.values() for m in world.get('events', {}).values())
        rules = {}
        for rule in (('quote', 'text') if quoted else ('text',)):
            rules[rule] = aggregate({wid: (inputs[wid]['kind'], work_counts(inputs[wid]['knowledge'], world, inputs[wid]['mains'], rule))
                                     for wid, world in loaded.items()})
        stats = [json.loads(p.read_text(encoding='utf-8')) for wid in loaded if (p := inputs[wid]['folder'] / f'{name}_stats.json').exists()]
        out['worlds'][name] = {'works': sorted(loaded), 'missing': missing[name], 'rules': rules, 'prototype': service_stats(stats) if name == 'world_svc' else prototype_stats(stats)}   # world.json(기존)은 통계 파일이 없어 {}
    return out


def show(result: dict) -> None:
    pct = lambda r: '-' if r['rate'] is None else f"{r['rate']:.3f}"  # noqa: E731
    print(f"공통 작품 {len(result['common'])}편(요청 {len(result['works'])}편): " + ' '.join(result['common']))
    for name, block in result['worlds'].items():
        if block['missing']:
            print(f"{name:10s} 세계관이 없어 뺀 작품 {len(block['missing'])}편: " + ' '.join(block['missing']))
        for rule, agg in block['rules'].items():
            m = agg['all']
            print(f"{name:10s} {rule:5s} 사건 재현 {pct(m['event_recall'])}({m['event_recall']['k']}/{m['event_recall']['n']}) · 겪음 정확 {pct(m['experienced_precision'])} 재현 {pct(m['experienced_recall'])} · "
                  f"들음 정확 {pct(m['heard_precision'])} 재현 {pct(m['heard_recall'])} 회차일치 {pct(m['heard_recall_episode'])} (같은 회차 {m['heard_same_known']['n']}건 · 뒤 회차 {m['heard_later_precision']['n']}건, "
                  f"뒤 회차 정확 {pct(m['heard_later_precision'])} 재현 {pct(m['heard_later_recall'])}) · 인물 쪼개짐 {pct(m['persons_split'])} 섞임 {pct(m['cards_mixed'])} "
                  f"· 지식 정밀 {pct(m['knowledge_precision'])} 재현 {pct(m['knowledge_recall'])} F1 {pct({'rate': m['knowledge_f1']})} (넓힘 {pct(m['knowledge_precision_wide'])}·{pct(m['knowledge_recall_wide'])} F1 {pct({'rate': m['knowledge_f1_wide']})})")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    parser.add_argument('works', nargs='*', help='작품 id(없으면 world2.json이 있는 작품 전부)')
    parser.add_argument('--worlds', default=','.join(WORLDS), help='재는 세계관 파일 이름(쉼표, 기본 world,world2,world_svc)')
    parser.add_argument('--name', required=True, help='결과 이름: results/ko-timechara-linkeval-<name>.json')
    args = parser.parse_args(argv)
    worlds = check_worlds(tuple(filter(None, args.worlds.split(','))))
    wids = args.works or sorted(p.parent.name for p in (KT / 'works').glob('*/world2.json'))
    result = evaluate(wids, worlds)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'ko-timechara-linkeval-{args.name}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True), encoding='utf-8')
    show(result)


if __name__ == '__main__':
    main()
