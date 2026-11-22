"""세트 생성: 정렬된 회차(턴 + 화자·독백 판별)에서 ①~④ 문항을 자격 검사·정답 유출 검사·편중 없는 뽑기로 만든다. 모델 호출이 없는 순수 로직이다.

문항 하나는 한 줄(정답)과 그 앞 원문 줄(context), 장면의 인물(cast), 출처 메타데이터를 담은 JSON이고 실행기가 이것으로 서비스 입력을 다시 조립한다.
"""

import random
from collections import Counter

from orig_common import SEED  # noqa: I001  경로 설정이 kt_text import보다 먼저여야 한다
from kt_text import squash

import orig_turns
from orig_corpus import _bigrams, episode_names

MIN_BEFORE = 3                     # 정답 앞에 같은 회차의 원문 줄이 이만큼은 있어야 한다
ACT_LEN, NARRATE_LEN, MONOLOGUE_LEN = (8, 200), (40, 600), (20, 400)   # 정답 글자 수(따옴표 제외)
REVEALED = 0.6                     # 사실의 두 글자 조각이 직전 줄에 이만큼 있으면 이미 드러난 사실로 본다


def _plain(text: str) -> str:
    return squash(text).replace('"', '')


def leaked(gold: str, text: str, min_chars: int = 6) -> bool:
    """정답 문장이 입력 글에 글자 그대로(공백·따옴표 모양 무시) 있는가. 너무 짧은 정답은 우연히 겹쳐 유출로 보지 않는다."""
    folded = _plain(gold)
    return len(folded) >= min_chars and folded in _plain(text)


def balanced(cands: list[dict], n: int, seed: int = SEED, speaker_cap: int | None = None, work_cap: int | None = None, sub: str = 'speaker') -> list[dict]:
    """작품 → 하위 그룹(기본 화자)을 돌려 가며 n개를 뽑는다(덜 뽑힌 쪽부터, 고정 시드). 상한에 닿은 그룹은 건너뛰고 후보가 모자라면 있는 만큼이다."""
    rng = random.Random(seed)
    groups: dict[str, dict[str, list]] = {}
    for c in sorted(cands, key=lambda c: c['id']):
        groups.setdefault(c['work'], {}).setdefault(c[sub], []).append(c)
    for subs in groups.values():
        for items in subs.values():
            rng.shuffle(items)
    picked, by_work, by_sub = [], Counter(), Counter()
    while len(picked) < n:
        moved = False
        for work in sorted(groups):
            if len(picked) >= n or (work_cap is not None and by_work[work] >= work_cap):
                continue
            open_ = [s for s, items in groups[work].items() if items and (speaker_cap is None or by_sub[work, s] < speaker_cap)]
            if open_:
                s = min(open_, key=lambda s: (by_sub[work, s], s))
                picked.append(groups[work][s].pop())
                by_work[work] += 1
                by_sub[work, s] += 1
                moved = True
        if not moved:
            break
    return picked


def inject(prose: str, fact: str) -> str:
    """원작 대사의 마지막 따옴표 안, 말 끝에 사실 한 문장을 끼워 넣는다(정답표 문장이 그대로 들어간다)."""
    i = prose.rfind('"')
    return f'{prose[:i]} {fact}"{prose[i + 1:]}' if i > 0 else f'{prose} "{fact}"'


def pick_fact(facts: list[dict], context: list[str], rng: random.Random) -> dict | None:
    """주입할 사실 하나(고정 시드). 직전 줄이 이미 드러낸 사실(두 글자 조각 대부분이 직전 줄에 있다)은 쓰지 않는다."""
    seen = _bigrams(' '.join(context))
    fresh = [f for f in facts if (grams := _bigrams(f.get('body') or f['text'])) and len(grams & seen) / len(grams) < REVEALED]
    return rng.choice(fresh) if fresh else None


def candidates(corpus, rec: dict, names: dict[str, str] | None = None) -> list[dict]:
    """한 회차(rec = {ep, turns})에서 문항이 될 수 있는 턴: {id, use(act·direct·narrate·monologue), t, kind, speaker, speaker_id, gold, …}.
    act(①·④) = 기준 회차 이전에 처음 나온 카드가 있는 인물의 8~200자 대사, direct(②) = 카드가 있는 인물의 대사·독백 또는 독백이 아닌 지문,
    narrate(③) = 문단 전체가 독백이 아닌 40~600자 지문, monologue(③) = 기준 회차 이전에 나온 인물의 20~400자 독백. 앞 줄이 3개 미만이거나 기준 회차가 0이면 없다."""
    ep, turns = rec['ep'], rec['turns']
    if ep['base'] < 1:
        return []
    names = names if names is not None else episode_names(corpus, ep)
    reveal = {p['title']: p.get('reveal') or 0 for p in corpus.people(ep['work'])}
    out = []

    def add(use: str, t: int, kind: str, who: str = '') -> None:
        out.append({'id': f"{ep['id']}:{t}:{use}", 'use': use, 'work': ep['work'], 'ep': ep['id'], 'n': ep['n'], 'base': ep['base'], 't': t, 'kind': kind,
                    'speaker': who, 'speaker_id': names.get(who, ''), 'gold': turns[t]['text']})

    for t, turn in enumerate(turns):
        if t < MIN_BEFORE or turn.get('status') != 'agreed':
            continue
        size = len(turn['text'].strip('"'))
        if turn['kind'] == 'dialogue':
            who = turn['speaker']
            if who in names:
                add('direct', t, 'dialogue', who)
                if reveal.get(who, 0) <= ep['base'] and ACT_LEN[0] <= size <= ACT_LEN[1]:
                    add('act', t, 'dialogue', who)
        elif turn['monologue']:
            who = turn['monologue']
            if who in names:
                add('direct', t, 'monologue', who)
                if reveal.get(who, 0) <= ep['base'] and MONOLOGUE_LEN[0] <= size <= MONOLOGUE_LEN[1]:
                    add('monologue', t, 'monologue', who)
        else:
            if size >= 10:
                add('direct', t, 'narration')
            if turn.get('whole') and NARRATE_LEN[0] <= size <= NARRATE_LEN[1]:
                add('narrate', t, 'narration')
    return out


def finish(corpus, rec: dict, cand: dict, names: dict[str, str], works: dict) -> tuple[dict | None, str | None]:
    """뽑힌 후보를 문항으로: 직전 원문 줄·장면 인물·출처를 붙인다. 정답이 직전 줄에 그대로 있으면(유출) 버리고, ②는 장면 인물이 2명 미만이어도 버린다. (문항, 버린 이유)."""
    turns, t = rec['turns'], cand['t']
    context = orig_turns.context_lines(turns, t)
    if len(context) < MIN_BEFORE:
        return None, 'context'
    if leaked(cand['gold'], ' '.join(line['text'] for line in context)):
        return None, 'leak'
    cast = orig_turns.cast_around(turns, t, only=set(names))
    if cand['use'] == 'direct' and len(cast) < 2:
        return None, 'cast'
    work = works[cand['work']]
    keep = {name: names[name] for name in {*cast, *(line['speaker'] for line in context if line['speaker'] in names)} | ({cand['speaker']} if cand['speaker'] else set())}
    return {**cand, 'context': context, 'cast': cast, 'ids': keep, 'person': work['person'], 'source': {k: work.get(k) for k in ('title', 'author', 'license', 'source', 'kind')}}, None


def build_items(corpus, records: list[dict], size: dict[str, int], seed: int = SEED) -> tuple[dict[str, list[dict]], dict]:
    """세트 이름 → 문항. size = {'act': ①, 'direct': ②, 'narrate': ③나레이션, 'monologue': ③독백, 'check_pass': ④원작, 'check_fail': ④주입}.
    각 세트는 작품·인물(나레이션은 회차)로 돌려 뽑고, 정답 유출·장면 인물 부족·주입할 사실 없음으로 버린 수를 stats에 센다. 후보가 모자라면 있는 만큼이다."""
    works, pools = corpus.works(), {use: [] for use in ('act', 'direct', 'narrate', 'monologue')}
    recs, name_of = {r['ep']['id']: r for r in records}, {r['ep']['id']: episode_names(corpus, r['ep']) for r in records}
    for rec in records:
        for c in candidates(corpus, rec, name_of[rec['ep']['id']]):
            if c['use'] != 'narrate' or works[c['work']]['person'] != 'first':   # 1인칭 작품은 서술자 카드가 없어 나레이션 문항을 만들지 않는다
                pools[c['use']].append(c)
    stats, sets, rng = {'dropped': Counter(), 'pool': {use: len(p) for use, p in pools.items()}}, {}, random.Random(seed)

    def take(pool, n, sub='speaker', cap=None, avoid=()):
        """pool에서 n개를 뽑되 finish에서 버려지면 다음 후보로 채운다. avoid(이미 쓴 후보 id)는 뒤로 미룬다."""
        rest = [c for c in pool if c['id'] not in avoid] + [c for c in pool if c['id'] in avoid]
        out, picked = [], set()
        while len(out) < n:
            batch = [c for c in balanced([c for c in rest if c['id'] not in picked], n - len(out), seed, cap, sub=sub)]
            if not batch:
                break
            for c in batch:
                picked.add(c['id'])
                item, why = finish(corpus, recs[c['ep']], c, name_of[c['ep']], works)
                if item:
                    out.append(item)
                else:
                    stats['dropped'][why] += 1
        return out

    cap = lambda n, pool: max(3, -(-n // max(1, len({c['speaker'] for c in pool}))) * 2)   # noqa: E731  인물마다 평균의 두 배까지
    sets['1'] = take(pools['act'], size['act'], cap=cap(size['act'], pools['act']))
    used = {c['id'] for c in sets['1']}
    sets['3n'] = take(pools['narrate'], size['narrate'], sub='ep')
    sets['3m'] = take(pools['monologue'], size['monologue'], cap=cap(size['monologue'], pools['monologue']))
    direct = pools['direct']
    quota = {'dialogue': size['direct'] // 2, 'narration': size['direct'] // 3, 'monologue': size['direct'] - size['direct'] // 2 - size['direct'] // 3}
    sets['2'] = []
    for kind, n in quota.items():
        sets['2'] += take([c for c in direct if c['kind'] == kind], n, sub='speaker' if kind != 'narration' else 'ep')
    short = size['direct'] - len(sets['2'])   # 독백이 모자라면 대사로 메운다
    if short > 0:
        have = {c['id'] for c in sets['2']}
        sets['2'] += take([c for c in direct if c['kind'] == 'dialogue' and c['id'] not in have], short)
    passed = take(pools['act'], size['check_pass'], cap=cap(size['check_pass'], pools['act']), avoid=used)
    taken = used | {c['id'] for c in passed}
    failed = []
    for item in take(pools['act'], size['check_fail'] * 2, cap=cap(size['check_fail'], pools['act']), avoid=taken):   # 주입할 사실이 없는 문항을 버릴 여유를 둔다
        person = {'id': item['speaker_id'], 'title': item['speaker']}
        fact = pick_fact(corpus.facts(item['work'], person, recs[item['ep']]['ep']), [line['text'] for line in item['context']], rng)
        if fact is None:
            stats['dropped']['no_fact'] += 1
        elif len(failed) < size['check_fail']:
            failed.append({**item, 'inject': {'id': fact['id'], 'kind': fact['kind'], 'text': fact.get('body') or fact['text']}, 'original': item['gold'], 'gold': inject(item['gold'], fact.get('body') or fact['text'])})
    sets['4'] = [{**c, 'label': 'pass'} for c in passed] + [{**c, 'label': 'reject'} for c in failed]
    for number, items in sets.items():
        for i, item in enumerate(items, 1):
            item['id'] = f"{corpus.name}-{number}-{i:04d}"
    stats['dropped'] = dict(stats['dropped'])
    return sets, stats
