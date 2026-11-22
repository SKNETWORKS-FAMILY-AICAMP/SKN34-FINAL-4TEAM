"""평가 원천(Corpus): 회차 목록, 판별 후보 이름, 기준 회차 시점 세계관, 금지 사실(정답표).

두 가지가 있다. 공개 세트(PublicCorpus)는 작품 여러 편을 기존 KoTimeChara 방식 파일(work.json·world.json·knowledge.jsonl)로, 해리 포터(HpCorpus)는 이미 만든 world.json과
장 덩어리(chapters/)로 읽는다. 둘 다 세계관은 기존 sim_worlds의 읽기 경로(tc_world·_world_at)를 그대로 쓴다.
"""

import json
import re
import threading
from pathlib import Path

from orig_common import HP_DIR, ORIG
import orig_turns
from kt_label import knows
from kt_world import load_world
import sim_worlds

HEADING = re.compile(r'^\s*(?:제\s*\d+\s*장|chapter\s*\d+|에필로그|epilogue)', re.I)


def names_in(text: str, people: list[dict], n: int = 40, upto: int | None = None) -> dict[str, str]:
    """본문에 제목·별칭이 나오는 인물의 {이름: 카드 id}(판별 후보). 많이 나온 순으로 n명까지이고 upto가 있으면 그 회차까지 공개된 카드만이다."""
    count = {}
    for p in people:
        if upto is not None and (p.get('reveal') or 0) > upto:
            continue
        hits = sum(text.count(w) for w in {p['title'], *(a for a in p.get('aliases', []) if len(a) >= 2)})   # 한 글자 이름(론)은 제목일 때만 센다
        if hits:
            count.setdefault(p['title'], (hits, p['id']))
    return {title: pid for title, (hits, pid) in sorted(count.items(), key=lambda kv: -kv[1][0])[:n]}


def episode_names(corpus, ep: dict) -> dict[str, str]:
    """그 회차 본문에 나오는 인물 {이름: 인물 id}. 그 회차까지 공개된 카드만이다(판별 후보·문항 자격 검사에 쓴다)."""
    return names_in(ep['text'], corpus.people(ep['work']), upto=ep['n'])


def sample_units(episodes: list[dict], per_book: int) -> list[dict]:
    """해리 포터 회차에서 권마다 per_book개를 고르게(같은 간격) 뽑는다. 기준 회차가 0인 첫 덩어리는 문항을 못 만들어 뺀다."""
    books: dict[str, list[dict]] = {}
    for ep in episodes:
        if ep['base'] >= 1:
            books.setdefault(ep['id'].split('-')[0], []).append(ep)
    return [units[i * len(units) // min(per_book, len(units))] for units in books.values() for i in range(min(per_book, len(units)))]


def hp_units(index: dict, ordinals: dict) -> list[dict]:
    """chapters/index.json의 장 덩어리 → [{id, file, book, n(덩어리 마지막 장의 회차), base(첫 장의 회차 − 1)}]. 묶인 장의 기억은 마지막 장의 것으로 센다(world.json 규칙)."""
    units = []
    for book, info in index.items():
        for unit in info['units']:
            first, last = unit['chapters'][0], unit['chapters'][-1]
            name = f'b{book}-{first:02d}' + (f'-{last:02d}' if last != first else '')
            units.append({'id': name, 'file': f'{name}.txt', 'book': int(book), 'n': ordinals[f'{book}-{last}'], 'base': ordinals[f'{book}-{first}'] - 1})
    return units


def hp_strip_heading(text: str) -> str:
    """덩어리 첫 줄이 장 머리(제 N장…·Chapter N·에필로그)면 그 줄과 뒤의 빈 줄을 뺀다."""
    lines = text.split('\n')
    return '\n'.join(lines[1:]).strip() if lines and HEADING.match(lines[0]) else text.strip()


def hp_facts(data: dict, key: str | None, last: int, base: int) -> list[dict]:
    """금지 사실(정답표): 그 인물이 모를 사건. future = last회차 뒤의 사건, absent = base회차 이하인데 그 인물이 참여하지 않은 사건. last회차 안의 사건은 직전 줄이 일부를 드러내서 뺀다.
    key가 None(전지적 나레이터)이면 future만이다."""
    present = {r['target'] for r in data['relationships'] if r['source'] == key and r['label'] == '참여' and r['from'] <= base}
    facts = []
    for card in data['cards']:
        if card['cardType'] != 'event':
            continue
        episode = card['revealFromEpisode']
        kind = 'future' if episode > last else ('absent' if key is not None and episode <= base and card['key'] not in present else None)
        if kind:
            facts.append({'id': card['key'], 'episode': episode, 'kind': kind, 'text': f"{card['title']}: {card['body']}", 'body': card['body']})
    return facts


def kt_facts(knowledge: list[dict], name: str | None, last: int, base: int) -> list[dict]:
    """공개 세트의 금지 사실(정답표 = knowledge.jsonl): future = last회차 뒤의 사건, absent = base회차 이하인데 그 인물이 참여·목격·전해 듣지 못한 사건. name이 None(나레이터)이면 future만이다."""
    facts = []
    for record in knowledge:
        for event in record['events']:
            kind = 'future' if event['episode'] > last else ('absent' if name is not None and event['episode'] <= base and not knows(knowledge, name, event, base) else None)
            if kind:
                facts.append({'id': event['id'], 'episode': event['episode'], 'kind': kind, 'text': event['summary'], 'body': event['summary']})
    return facts


def _bigrams(text: str) -> set[str]:
    folded = re.sub(r'[\W_]+', '', text)
    return {folded[i:i + 2] for i in range(len(folded) - 1)}


def shared(a: str, b: str) -> int:
    """두 글이 함께 가진 두 글자 조각의 수(낱말 겹침의 어림)."""
    return len(_bigrams(a) & _bigrams(b))


def top_facts(text: str, facts: list[dict], k: int) -> list[dict]:
    """text와 겹침이 큰 사실 k개(같으면 입력 순서). 판정 모델에 보일 후보를 줄이는 데 쓴다."""
    marks = _bigrams(text)
    return sorted(facts, key=lambda f: -len(_bigrams(f['text']) & marks))[:k]


class PublicCorpus:
    """공개 세트: ORIG/works/<id>/{work.json, world.json, knowledge.jsonl}(label 단계 산출물). 회차 n의 기준 회차는 n − 1이다."""
    name = 'public'

    def __init__(self, root: Path = ORIG / 'works'):
        self.root, self._works, self._worlds, self._lock = root, {}, {}, threading.Lock()

    def _load(self, wid: str) -> dict:
        if wid not in self._works:
            folder = self.root / wid
            work = json.loads((folder / 'work.json').read_text())
            narration = ' '.join(t['text'] for e in work['episodes'] for t in orig_turns.split_turns(e['text']) if t['kind'] == 'narration')
            work['person'] = work.get('person') or orig_turns.person_of(narration)
            work['world'] = load_world(folder / 'world.json')
            work['knowledge'] = [json.loads(line) for line in (folder / 'knowledge.jsonl').read_text().splitlines() if line.strip()]
            self._works[wid] = work
        return self._works[wid]

    def work_ids(self) -> list[str]:
        return sorted(p.parent.name for p in self.root.glob('*/world.json'))

    def works(self) -> dict[str, dict]:
        return {wid: {k: v for k, v in self._load(wid).items() if k in ('id', 'kind', 'title', 'author', 'license', 'source', 'person')} for wid in self.work_ids()}

    def episodes(self) -> list[dict]:
        return [{'id': f"{wid}#{e['number']}", 'work': wid, 'n': e['number'], 'base': e['number'] - 1, 'text': e['text']}
                for wid in self.work_ids() for e in self._load(wid)['episodes']]

    def people(self, wid: str) -> list[dict]:
        return [{'id': c.id, 'title': c.title, 'aliases': [], 'reveal': c.revealFromEpisode} for c in self._load(wid)['world']['cards'] if c.cardType == 'character']

    def world(self, wid: str, base: int):
        """(기준 회차 시점 service.World, 인물 id → World 카드 id). 같은 회차는 한 번만 만든다."""
        with self._lock:
            if (wid, base) not in self._worlds:
                self._worlds[wid, base] = (sim_worlds.tc_world(self._load(wid)['world'], base), None)
            world, _ = self._worlds[wid, base]
        return world, {p['id']: p['id'] for p in self.people(wid)}

    def facts(self, wid: str, person: dict | None, ep: dict) -> list[dict]:
        return kt_facts(self._load(wid)['knowledge'], person and person['title'], ep['n'], ep['base'])


class HpCorpus:
    """해리 포터 번역본: HP_DIR/{world.json, chapters/}. 한 작품(hp)이고 회차 = 장 덩어리(world.json의 회차 번호)다. 원문·카드는 .data 전용이다."""
    name = 'hp'

    def __init__(self, folder: Path = HP_DIR):
        self.folder, self._worlds, self._lock = folder, {}, threading.Lock()
        self.data = json.loads((folder / 'world.json').read_text(encoding='utf-8'))
        self._people = [{'id': c['key'], 'title': c['title'], 'aliases': c.get('aliases', []), 'reveal': c.get('revealFromEpisode') or 0}
                        for c in self.data['cards'] if c['cardType'] == 'character']

    def work_ids(self) -> list[str]:
        return ['hp']

    def works(self) -> dict[str, dict]:
        return {'hp': {'id': 'hp', 'kind': 'hp', 'title': '해리 포터 번역본(평가용·로컬 전용)', 'author': '조앤 K. 롤링(번역본 저작권 있음)', 'license': '저작권 있음: .data에만 둔다',
                       'source': 'eval/simulation/.data/hp', 'person': 'third'}}

    def episodes(self) -> list[dict]:
        index = json.loads((self.folder / 'chapters' / 'index.json').read_text())
        return [{'id': u['id'], 'work': 'hp', 'n': u['n'], 'base': u['base'], 'text': hp_strip_heading((self.folder / 'chapters' / u['file']).read_text(encoding='utf-8'))}
                for u in hp_units(index, self.data['ordinals'])]

    def people(self, wid: str = 'hp') -> list[dict]:
        return self._people

    def world(self, wid: str, base: int):
        """(기준 회차 시점 service.World, 인물 key → World 카드 id)."""
        with self._lock:
            if base not in self._worlds:
                self._worlds[base] = sim_worlds._world_at(self.data, base)
            return self._worlds[base]

    def facts(self, wid: str, person: dict | None, ep: dict) -> list[dict]:
        return hp_facts(self.data, person and person['id'], ep['n'], ep['base'])
