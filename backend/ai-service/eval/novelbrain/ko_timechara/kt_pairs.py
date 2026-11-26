"""KoTimeChara 시점 쌍 정확도: 정답표(지식표)만으로 '시간 쌍'과 '자리 쌍' 문항을 코드로 만들고(호출 없음), 인물 응답이 고른 선택지를 정답과 코드로 대조한다(채점 모델 없음).

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py build        # 호출 없음: .data/ko_timechara/pairs.jsonl·pairs_stats.json
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py run --gen-model=gpt-6-luna --gen-effort=low --name=pairs-luna --limit-usd=3 [--configs=zero,s2,s3,no_vector,link_bm25,link_ppr,link2_bm25] [--limit=8]
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py report --name=pairs-luna        # 호출 없음: results/ko_timechara-pairs-<name>.json

쌍(같은 사건 e)은 두 가지다. 한 쌍의 두 문항은 같은 질문 문형·사건 요약을 쓰고 정답이 서로 다르다.
- 시간 쌍: 사건에 참여·목격한 인물 c. 기준 회차만 다르다. 사건 전(c가 이미 등장했고 사건보다 1~6회 앞)은 정답 unknown, 사건 후(사건 회차 이후 0~3회)는 정답 direct.
- 자리 쌍: 기준 회차 p(사건 이후 0~3회)가 같고 인물만 다르다. 참여·목격한 인물 A는 direct, 참여·목격하지 않았고 p회까지 전해 듣지도 않았으며 사건 회차까지 이미 등장한 인물 B는 unknown
  (kt_questions의 past-absence 규칙 그대로: 사건~p회 사이에 '전해 들은 인물' 추출이 실패한 회차가 끼면 제외).
선택지는 direct(직접 겪었거나 보았다)·hearsay(전해 들어 안다)·unknown(모른다) 셋이고 순서는 문항마다 고정 시드로 섞는다. hearsay는 어느 문항에서도 정답이 아니다(늘 오답 선택지).
쌍 정확도는 두 문항이 모두 정답인 쌍의 비율이다: 무조건 '모른다'나 '안다'로 답하는 모델은 0점이라 시점·자리를 실제로 가려야 오른다.
응답은 구조화 출력(선택지 번호 하나)이고, 스키마에 안 맞거나 잘린 응답은 고쳐 쓰지 않고 실패로 센다(오답과 구분). 채점은 번호 → 키 → 정답 일치로 코드가 한다.
문맥은 kt_run.build_contexts 그대로(기본 구성 zero·s2·s3: 검색 없음·전체−필터·전체)이고 시스템 프롬프트는 kt_run.ko_system_prompt, 사용자 메시지는 context_message + 선택지다.
--configs는 kt_context.ALL_CONFIGS 중에서 고른다. 벡터(원고 발췌) 없는 구성은 no_vector(그래프+카드 BM25를 RRF로 합쳐 필터)와 인물에 연결된 카드 안에서만 고르는 변형
link_bm25(카드 BM25에 필터만)·link_ppr(그래프 PPR에 필터만)·link2_bm25(link_bm25 + 인물로부터 관계 2홉 안의 인물이 아닌 카드, kt_context 설명)·
link_cells(link_bm25 + 인물이 아닌 카드의 회차 칸)·link_known(link_cells 중 인물이 아는 사건에 기댄 문장만)이다. 같은 --name에 구성을 더해 다시 돌리면
이미 낸 응답은 응답 캐시에서 읽힌다(문맥이 같을 때). 집계는 구성마다 쌍·문항 정확도, 누설 지표(future·foreign·unseen·asked_ep)와 문맥 항목 종류 분포·평균 항목 수를 내고,
쌍 단위 비교는 s3|zero·s3|s2에 더해 나머지 구성 각각 대 zero·대 s3(기록에 있는 구성끼리)다.
한계: 전해 들음은 추출된 것만 안다(추출이 놓친 전해 들음은 unknown 정답에 섞일 수 있다). 인물은 kt_questions.main_characters(세계관 카드가 있고 3개 회차 이상 등장)만 쓴다.
질문·응답은 `KT`(.data, git 무시)에만 두고 results/에는 집계 수치만 쓴다. --name은 kt_run의 --name과 겹치지 않게 준다(응답 캐시 cache-<name>·장부 cost-<name>.jsonl이 같은 이름을 쓴다).
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json
import random
from collections import Counter
from typing import Literal

from pydantic import BaseModel

from batch import Round, cost_report, run_rounds
from kt_common import KT, RESULTS, SEED
from kt_context import ALL_CONFIGS, ITEM_KINDS, item_kind
from kt_exec import EFFORTS, load_works, make_executor, make_gen_llm
from kt_label import appearances, knows, learn_gap
from kt_linkeval import character_ids, check_worlds
from kt_questions import load_knowledge, main_characters
from kt_run import build_contexts, build_data, check_name, ko_system_prompt, leak_rates
from kt_world import load_world
from metrics import sign_test, wilson_interval
from prepare import stratified_sample
from run_timechara import context_message, models_of

PER_KIND = 16   # 작품당 시간 쌍·자리 쌍 각각의 목표 수(문항은 2배, 모자란 작품은 있는 만큼)
KINDS = ('time', 'place')
SIDES = {'time': ('before', 'after'), 'place': ('present', 'absent')}
GOLD = {'before': 'unknown', 'after': 'direct', 'present': 'direct', 'absent': 'unknown'}   # hearsay는 어느 쪽의 정답도 아니다
BEFORE_SPAN, AFTER_SPAN = 6, 3   # 사건 전 1~6회·사건 후 0~3회(kt_questions의 future·past 질문과 같은 범위)
LABELS = {'direct': '직접 겪었거나 그 자리에서 보았다', 'hearsay': '그 자리에 없었지만 다른 사람에게 전해 들어 안다', 'unknown': '모른다(아직 일어나지 않았거나 알지 못한다)'}
KEYS = tuple(LABELS)
PAIR_CONFIGS = ('zero', 's2', 's3')   # 기본 구성: 검색 없음·전체−필터·전체
COMPARES = (('s3', 'zero'), ('s3', 's2'))   # 쌍 단위 정확 부호 검정의 기본 짝(다른 구성은 compare_pairs가 대 zero·대 s3로 더한다)
PICK_TOKENS = 1000   # 번호 하나라 짧다. 생각 토큰이 한도를 넘어 잘린 응답은 실패로 센다


class Pick(BaseModel):
    """구조화 출력: 고른 선택지의 번호 하나."""

    answer: Literal['1', '2', '3']


# ---- 쌍 고르기(정답표만 읽는다) ----

def present_at(event: dict) -> set[str]:
    """사건에 참여·목격한 인물."""
    return {p['name'] for p in event['participants'] + event['witnesses']}


def absent_ok(knowledge: list[dict], seen: dict[str, list[int]], name: str, event: dict, p: int) -> bool:
    """자리 쌍의 '없던' 쪽: kt_questions의 past-absence 규칙 그대로. 사건에 참여·목격하지 않았고, 사건 회차까지 이미 등장했고, p회까지 전해 듣지 않았고,
    사건~p회 사이에 '전해 들은 인물' 추출이 실패한 회차가 없다(있으면 그 사이에 알게 됐는지 알 수 없다)."""
    return (name not in present_at(event) and min(seen[name]) <= event['episode'] <= p and not knows(knowledge, name, event, p)
            and not learn_gap(knowledge, event['episode'], p))


def pick_pairs(knowledge: list[dict], mains: list[str], kind: str, count: int, rng: random.Random) -> list[dict]:
    """kind('time'|'place')의 쌍을 count개까지 뽑는다. 쌍 = {'kind', 'event', 'members': [{'side', 'character', 'cutoff'} × 2]}.
    인물(시간 쌍은 그 인물, 자리 쌍은 '있던' 인물)을 돌아가며 뽑고 같은 종류 안에서 같은 사건은 한 번만 쓴다. 조건에 맞는 쌍이 모자라면 있는 만큼만 돌려준다."""
    events = {e['id']: e for r in knowledge for e in r['events']}
    seen = appearances(knowledge)
    last = max(r['episode'] for r in knowledge)
    pools = {}
    for name in mains:
        options = []
        for event in events.values():
            if name not in present_at(event):
                continue
            after = range(event['episode'], min(event['episode'] + AFTER_SPAN, last) + 1)
            if kind == 'time':
                before = range(max(min(seen[name]), event['episode'] - BEFORE_SPAN), event['episode'])   # 인물이 이미 등장했고 사건은 1~6회 뒤
                if before:
                    options.append({'kind': kind, 'event': event['id'], 'members': [
                        {'side': 'before', 'character': name, 'cutoff': rng.choice(before)}, {'side': 'after', 'character': name, 'cutoff': rng.choice(after)}]})
            else:
                for p in after:
                    if others := [b for b in mains if absent_ok(knowledge, seen, b, event, p)]:
                        options.append({'kind': kind, 'event': event['id'], 'members': [
                            {'side': 'present', 'character': name, 'cutoff': p}, {'side': 'absent', 'character': rng.choice(others), 'cutoff': p}]})
        rng.shuffle(options)
        pools[name] = options
    used, specs = set(), []
    while len(specs) < count and any(pools.values()):
        for name in list(pools):
            while pools[name] and pools[name][-1]['event'] in used:
                pools[name].pop()
            if pools[name] and len(specs) < count:
                spec = pools[name].pop()
                used.add(spec['event'])
                specs.append(spec)
    return specs


# ---- 문항 ----

def shuffled(question_id: str) -> list[str]:
    """선택지 키(direct·hearsay·unknown)의 보이는 순서: 문항마다 고정 시드로 섞는다(위치 편향을 정답에 묶지 않으려고). 기록에 그대로 남긴다."""
    return random.Random(f'{SEED}-{question_id}').sample(KEYS, len(KEYS))


def question_text(summary: str) -> str:
    return f'다음 사건을 당신은 어떻게 알고 있나요? {summary}'


def prompt_text(row: dict) -> str:
    """사용자 메시지의 질문 부분: 질문(검색 질의와 같은 글) 다음에 기록된 순서의 번호 붙은 선택지."""
    return '\n'.join([row['question'], *(f'{n}. {LABELS[key]}' for n, key in enumerate(row['options'], 1)), '선택지 번호 하나만 고르라.'])


def pair_rows(meta: dict, knowledge: list[dict], specs: dict[str, list[dict]]) -> list[dict]:
    """뽑은 쌍으로 문항 행을 만든다(쌍마다 두 문항, 시간 쌍 다음 자리 쌍). id는 쌍 id + side, 질문에는 선택지가 없다(검색 질의가 흐려지지 않게). idx는 파일에 쓸 때 매긴다."""
    events = {e['id']: e for r in knowledge for e in r['events']}
    rows = []
    for kind in KINDS:
        for number, spec in enumerate(specs.get(kind, []), 1):
            event = events[spec['event']]
            pair_id = f"{meta['id']}-{kind[0]}{number:02d}"
            for member in spec['members']:
                question_id = f"{pair_id}-{member['side']}"
                rows.append({'id': question_id, 'pair_id': pair_id, 'kind': kind, 'side': member['side'], 'work': meta['id'], 'work_kind': meta['kind'],
                             'genre': meta['genre'], 'character': member['character'], 'cutoff': member['cutoff'], 'event_id': event['id'],
                             'event_episode': event['episode'], 'question': question_text(event['summary']), 'options': shuffled(question_id),
                             'gold': GOLD[member['side']]})
    return rows


def pair_stats(rows: list[dict], wids: list[str], per_kind: int = PER_KIND) -> dict:
    """쌍 수 통계: wids = 대상 작품 id(쌍이 하나도 없는 작품도 0으로 남긴다). 작품별 쌍 수·목표(per_kind)에 모자란 작품·정답 키와 정답 위치 분포(위치 편향 점검)."""
    by_work = {wid: {kind: 0 for kind in KINDS} for wid in wids}
    for first in {r['pair_id']: r for r in rows}.values():
        by_work[first['work']][first['kind']] += 1
    return {'seed': SEED, 'per_kind': per_kind, 'works': len(wids), 'questions': len(rows),
            'pairs': {kind: sum(counts[kind] for counts in by_work.values()) for kind in KINDS}, 'by_work': by_work,
            'short': {wid: counts for wid, counts in by_work.items() if any(counts[kind] < per_kind for kind in KINDS)},
            'gold': dict(Counter(r['gold'] for r in rows)), 'gold_position': {str(n): c for n, c in sorted(Counter(r['options'].index(r['gold']) + 1 for r in rows).items())}}


def pilot(rows: list[dict], limit: int | None) -> list[dict]:
    """파일럿: 쌍 limit개만(종류 time·place 비율을 지키며 고정 시드로), 한 쌍의 두 문항은 함께 남기고 문항 파일 순서대로. limit이 없거나 전체 쌍 수 이상이면 rows 그대로."""
    if limit is not None and limit < 1:
        raise SystemExit('--limit은 1 이상이어야 한다.')
    kinds = {r['pair_id']: r['kind'] for r in rows}
    if limit is None or limit >= len(kinds):
        return rows
    chosen = {p['id'] for p in stratified_sample([{'id': pair_id, 'kind': kind} for pair_id, kind in kinds.items()], lambda p: p['kind'], limit, SEED)}
    return [r for r in rows if r['pair_id'] in chosen]


def load_pairs() -> list[dict]:
    path = KT / 'pairs.jsonl'
    if not path.exists():
        raise SystemExit('pairs.jsonl이 없다: kt_pairs.py build를 먼저 실행한다.')
    return [json.loads(line) for line in path.read_text().splitlines()]


def build() -> None:
    """모든 작품의 정답표로 쌍 문항을 만들어 pairs.jsonl·pairs_stats.json에 쓴다(호출 없음, 고정 시드라 다시 만들어도 같다). 기존 질문 파일은 건드리지 않는다."""
    rows, wids = [], []
    for wid, work in load_works().items():
        knowledge = load_knowledge(wid)
        mains = main_characters(knowledge, load_world(KT / 'works' / wid / 'world.json'))
        specs = {kind: pick_pairs(knowledge, mains, kind, PER_KIND, random.Random(f'{SEED}-{wid}-{kind}')) for kind in KINDS}
        rows += pair_rows({'id': wid, 'kind': work['kind'], 'genre': work['genre']}, knowledge, specs)
        wids.append(wid)
        print(f"{wid} 시간 쌍 {len(specs['time'])} · 자리 쌍 {len(specs['place'])} (질문 대상 인물 {len(mains)}명)")
    rows = [dict(r, idx=n) for n, r in enumerate(rows)]
    stats = pair_stats(rows, wids)
    KT.mkdir(parents=True, exist_ok=True)
    (KT / 'pairs.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))
    (KT / 'pairs_stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"쌍 {stats['pairs']} · 문항 {stats['questions']} · 목표({PER_KIND})에 모자란 작품 {len(stats['short'])}편 {stats['short']}")


# ---- 응답과 채점(코드) ----

def make_work(contexts: dict):
    """run_rounds용 work(task, llm). task = (문항 행, 구성). 구조화 출력(선택지 번호)을 받아 번호 → 키 → 정답 일치로 채점한다.
    스키마에 안 맞거나 잘린 응답은 영구 실패라 picked·correct가 None인 채로 남고 집계가 실패로 센다(오답이 아니다)."""
    def work(task, llm):
        r, config = task
        ctx = contexts[r['idx']][config]
        record = {'idx': r['idx'], 'id': r['id'], 'pair_id': r['pair_id'], 'kind': r['kind'], 'side': r['side'], 'work': r['work'], 'work_kind': r['work_kind'],
                  'config': config, 'gold': r['gold'], 'choice': None, 'picked': None, 'correct': None,
                  'future_ctx': ctx['future'], 'foreign_ctx': ctx['foreign'], 'unseen_ctx': ctx['unseen'], 'asked_ep_ctx': ctx['asked_ep'],
                  'kinds_ctx': dict(Counter(item_kind(i['ref']) for i in ctx['items']))}
        step = Round()
        pick, failed = step.get(lambda: llm.ask('gen', ko_system_prompt(r['character'], r['cutoff']),
                                                context_message(prompt_text(r), [i['text'] for i in ctx['items']]), schema=Pick, max_output_tokens=PICK_TOKENS))
        step.done()
        if not failed:
            picked = r['options'][int(pick.answer) - 1]
            record.update(choice=pick.answer, picked=picked, correct=picked == r['gold'])
        return record
    return work


def rows_path(name: str):
    return KT / 'runs' / f'pairs-rows-{name}.json'


def run(configs: tuple[str, ...], *, gen_model: str, gen_effort: str | None = None, name: str, limit_usd: float | None, limit: int | None = None,
        works: tuple[str, ...] = (), world: str = 'world') -> None:
    """쌍 문항(pairs.jsonl)에 구성별 문맥으로 응답을 내고(게이트웨이 gen_model, 응답 캐시 cache-<name>·장부 cost-<name>.jsonl, 금액 상한 limit_usd 필수)
    채점해 runs/pairs-rows-<name>.json에 쓴다. limit은 파일럿(쌍 N개, 한 쌍의 두 문항은 함께)이다. 질문 임베딩 묶음은 전체 문항으로 정해 파일럿도 전체 실행과 같은 문맥을 낸다.
    works를 주면 그 작품의 쌍만, world는 읽을 세계관 파일 이름(KT/works/<작품 id>/<world>.json, 기본 world)이다. 같은 쌍 문항을 다른 전처리 결과(world2 등)로 돌릴 때 쓴다:
    문항의 인물은 정답표 이름이라 그 세계관의 카드에 이름으로 잇고(kt_linkeval.character_ids) 카드가 없으면 문맥이 빈다. 기록에는 world가 남는다."""
    check_name(name)
    check_worlds((world,))
    if not configs:
        raise SystemExit('--configs가 비었다: 구성을 하나 이상 준다(빈 실행이 같은 이름의 기록을 덮지 않게).')
    if bad := [c for c in configs if c not in ALL_CONFIGS]:
        raise SystemExit(f"--configs에 모르는 구성 {','.join(bad)}가 있다: {','.join(ALL_CONFIGS)} 중에서 고른다.")
    llm = make_gen_llm(gen_model, name, limit_usd, gen_effort)   # 금액 상한이 없거나 단가표 밖의 모델이면 폴더·장부를 만들기 전에 여기서 멈춘다
    executor = make_executor(llm, 'sync')
    every = load_pairs()
    rows = pilot([r for r in every if not works or r['work'] in works], limit)
    data = build_data(sorted({r['work'] for r in rows}), world=world)
    if world != 'world':   # 정답표 이름 → 그 세계관의 카드(기존 연결 위에 덮는다)
        for wid, d in data.items():
            d['world'] = {**d['world'], 'character_id': {**d['world']['character_id'], **character_ids(d['world'], sorted({r['character'] for r in rows if r['work'] == wid}))}}
    contexts = build_contexts(every, data, only={r['idx'] for r in rows})
    tasks = [(r, c) for r in rows for c in configs]
    stamp = {'gen_model': llm.model, 'gen_via': getattr(llm, 'via', 'openai'), 'world': world}
    print(f"쌍 {len({r['pair_id'] for r in rows})}개(문항 {len(rows)}) × 구성 {len(configs)} = {len(tasks)} 과제 · 응답 {stamp['gen_model']}({stamp['gen_via']}) · 장부 ${llm.cost.spent():.3f}", flush=True)
    records = [{**r, **stamp} for r in run_rounds(tasks, make_work(contexts), llm, executor)]
    print(f"완료: 응답 없음(실패) {sum(r['correct'] is None for r in records)}/{len(records)}")
    (KT / 'runs').mkdir(exist_ok=True)
    rows_path(name).write_text(json.dumps(records, ensure_ascii=False))
    cost_report(llm)


# ---- 집계 ----

def accuracy(correct: int, n: int) -> dict:
    """정확도와 Wilson 95% 구간(n이 0이면 둘 다 None)."""
    return {'n': n, 'correct': correct, 'accuracy': correct / n if n else None, 'ci': list(wilson_interval(correct, n)) if n else None}


def question_block(records: list[dict]) -> dict:
    """문항 정확도: 응답이 있는 문항(n)만 센다. 실패(응답 없음)는 failed로 따로 센다."""
    scored = [r for r in records if r['correct'] is not None]
    return {**accuracy(sum(r['correct'] for r in scored), len(scored)), 'failed': len(records) - len(scored)}


def pair_outcomes(records: list[dict]) -> dict[str, bool | None]:
    """한 구성의 쌍별 결과: 두 문항 모두 정답이면 True, 오답이 하나라도 있으면 False(응답 없는 문항이 섞여도 이미 틀렸다), 오답 없이 응답 없는 문항이 있으면 None(채점 못 함).
    문항이 둘이 아닌 쌍은 건너뛴다."""
    marks: dict[str, list] = {}
    for r in records:
        marks.setdefault(r['pair_id'], []).append(r['correct'])
    return {pair_id: False if False in m else None if None in m else True for pair_id, m in marks.items() if len(m) == 2}


def pair_block(records: list[dict]) -> dict:
    """쌍 정확도(두 문항 모두 정답): 채점한 쌍(n)만 센다. 채점 못 한 쌍은 failed로 따로 센다."""
    outcomes = pair_outcomes(records)
    scored = [o for o in outcomes.values() if o is not None]
    return {**accuracy(sum(scored), len(scored)), 'failed': len(outcomes) - len(scored)}


def blocks(records: list[dict]) -> dict:
    return {'questions': question_block(records), 'pairs': pair_block(records)}


def compare(records: list[dict], a: str, b: str) -> dict:
    """같은 쌍에서 두 구성의 쌍 정확(0/1)을 짝지어 센다: a만 맞음·b만 맞음과 정확 부호 검정(양측) p. 한쪽이라도 채점 못 한 쌍은 빼고, 비긴 쌍은 검정에 세지 않는다(n에는 든다)."""
    outcome = {config: pair_outcomes([r for r in records if r['config'] == config]) for config in (a, b)}
    both = [(outcome[a][i], outcome[b][i]) for i in sorted(outcome[a].keys() & outcome[b].keys()) if outcome[a][i] is not None and outcome[b][i] is not None]
    out = sign_test([x for x, _ in both], [y for _, y in both])
    return {'n': len(both), 'a_only': out['up'], 'b_only': out['down'], 'p': out['p']}


def compare_pairs(configs: list[str]) -> list[tuple[str, str]]:
    """쌍 단위 부호 검정의 짝(앞|뒤): 기본 s3|zero·s3|s2에 더해 나머지 구성 각각 대 zero·대 s3(기록에 있는 구성끼리만, 거울 짝은 뺀다)."""
    base = [pair for pair in COMPARES if set(pair) <= set(configs)]
    extra = [(c, ref) for c in configs if c not in ('zero', 's3') for ref in ('zero', 's3') if ref in configs]
    return base + [pair for pair in extra if pair[::-1] not in base]


def context_block(records: list[dict]) -> dict:
    """구성의 문맥 항목: 기록 수(n)·평균 항목 수·종류별 개수 합(인물 본문·회차 기억·사건 카드·관계·원고 발췌)."""
    kinds: Counter = Counter()
    for r in records:
        kinds.update(r['kinds_ctx'])
    return {'n': len(records), 'items': sum(kinds.values()) / len(records), 'kinds': {kind: kinds[kind] for kind in ITEM_KINDS}}


def aggregate(records: list[dict]) -> dict:
    """구성별: 문항·쌍 정확도(Wilson 95% 구간·실패 수), 쌍 종류(시간·자리)별·side별·웹소설/고전별, 고른 키 분포, 문맥 항목(평균 항목 수·종류별 개수).
    구성 사이 쌍 단위 부호 검정(compare_pairs, 기록에 있는 구성끼리만)과 문맥 누설 보조 지표(future·unseen·foreign·asked_ep)."""
    configs = list(dict.fromkeys(r['config'] for r in records))
    compares = compare_pairs(configs)
    kinds = [kind for kind in KINDS if any(r['kind'] == kind for r in records)]
    work_kinds = sorted({r['work_kind'] for r in records})
    out: dict = {'questions': len({r['idx'] for r in records}), 'pairs': len({r['pair_id'] for r in records}), 'configs': {}}
    for config in configs:
        mine = [r for r in records if r['config'] == config]
        picked = Counter(r['picked'] for r in mine if r['picked'])
        out['configs'][config] = {
            **blocks(mine), 'by_kind': {kind: blocks([r for r in mine if r['kind'] == kind]) for kind in kinds},
            'by_side': {side: question_block([r for r in mine if r['side'] == side]) for kind in kinds for side in SIDES[kind]},
            'by_work_kind': {wk: blocks([r for r in mine if r['work_kind'] == wk]) for wk in work_kinds}, 'picked': {key: picked[key] for key in KEYS},
            'context': context_block(mine)}
    out['leak'] = leak_rates(records, names=('future_ctx', 'unseen_ctx', 'foreign_ctx', 'asked_ep_ctx'))
    out['paired'] = {f'{a}|{b}': compare(records, a, b) for a, b in compares}
    out['paired_by_kind'] = {kind: {f'{a}|{b}': compare([r for r in records if r['kind'] == kind], a, b) for a, b in compares} for kind in kinds}
    out['paired_by_work_kind'] = {wk: {f'{a}|{b}': compare([r for r in records if r['work_kind'] == wk], a, b) for a, b in compares} for wk in work_kinds}
    if models := models_of(records):   # 응답 모델 기록이 있으면 남긴다
        out['models'] = models
    return out


def report(name: str) -> None:
    """runs/pairs-rows-<name>.json을 집계해 results/ko_timechara-pairs-<name>.json에 쓰고 표를 출력한다(호출 없음)."""
    check_name(name)
    if not rows_path(name).exists():
        raise SystemExit(f'{rows_path(name).name}이 없다: kt_pairs.py run --name={name}을 먼저 실행한다.')
    result = aggregate(json.loads(rows_path(name).read_text()))
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'ko_timechara-pairs-{name}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))

    def cell(block: dict | None) -> str:
        return '-' if not block or block['accuracy'] is None else f"{block['accuracy']:.3f}"

    for config, block in result['configs'].items():
        pairs, questions, leak, context = block['pairs'], block['questions'], result['leak'][config], block['context']
        interval = '-' if pairs['ci'] is None else f"[{pairs['ci'][0]:.3f}, {pairs['ci'][1]:.3f}]"
        print(f"{config:10s} 쌍 {cell(pairs)} {interval} (n={pairs['n']}, 실패 {pairs['failed']}) · 문항 {cell(questions)} (n={questions['n']}, 실패 {questions['failed']}) · "
              f"시간 쌍 {cell(block['by_kind'].get('time', {}).get('pairs'))} 자리 쌍 {cell(block['by_kind'].get('place', {}).get('pairs'))} · 선택 "
              + ' '.join(f'{key} {count}' for key, count in block['picked'].items()))
        print(f"{'':10s} 누설 future {leak['future_ctx']:.2f} foreign {leak['foreign_ctx']:.2f} unseen {leak['unseen_ctx']:.2f} asked_ep {leak['asked_ep_ctx']:.2f} · 항목 평균 {context['items']:.1f} ("
              + ' '.join(f"{kind} {count / context['n']:.2f}" for kind, count in context['kinds'].items()) + ')')
    for key, test in result['paired'].items():
        print(f"{key:16s} 쌍 {test['n']}개 중 앞만 맞음 {test['a_only']} · 뒤만 맞음 {test['b_only']} · p={test['p']:.4f}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    sub = parser.add_subparsers(dest='command', required=True)

    def command(name: str, help_: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, help=help_, allow_abbrev=False)   # 철자 틀린 옵션이 조용히 무시돼 엉뚱한 모델로 도는 일을 막는다

    def names(text: str) -> tuple[str, ...]:
        return tuple(filter(None, text.split(',')))

    command('build', '쌍 문항 만들기(호출 없음)')
    run_ = command('run', '응답 생성·채점(코드)')
    run_.add_argument('--configs', type=names, default=PAIR_CONFIGS)
    run_.add_argument('--gen-model', required=True, help='응답을 낼 게이트웨이 모델 id(단가표 kt_exec.GEN_RATES에 있는 모델)')
    run_.add_argument('--gen-effort', choices=EFFORTS, help='응답 호출의 reasoning.effort(응답 캐시 열쇠와 기록의 gen_model에 들어간다)')
    run_.add_argument('--name', required=True, help='결과 이름: runs/pairs-rows-<name>.json·응답 캐시 cache-<name>·장부 cost-<name>.jsonl')
    run_.add_argument('--limit-usd', type=float, required=True, help='응답 장부의 금액 상한(달러, 구독 경로 모델은 정가 환산 금액)')
    run_.add_argument('--limit', type=int, help='파일럿: 쌍 N개만(시간·자리 비율대로, 한 쌍의 두 문항은 함께)')
    run_.add_argument('--works', type=names, default=(), help='이 작품의 쌍만(작품 id 쉼표, 기본 전체)')
    run_.add_argument('--world', default='world', help='읽을 세계관 파일 이름(KT/works/<작품 id>/<world>.json, 기본 world = 기존 평가용 세계관, world2 = 시제품)')
    command('report', '집계(호출 없음)').add_argument('--name', required=True, help='runs/pairs-rows-<name>.json을 집계해 results/ko_timechara-pairs-<name>.json에 쓴다')
    args = parser.parse_args(argv)
    if args.command == 'build':
        build()
    elif args.command == 'run':
        run(args.configs, gen_model=args.gen_model, gen_effort=args.gen_effort, name=args.name, limit_usd=args.limit_usd, limit=args.limit, works=args.works, world=args.world)
    else:
        report(args.name)


if __name__ == '__main__':
    main()
