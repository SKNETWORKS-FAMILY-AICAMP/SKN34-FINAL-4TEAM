"""KoTimeChara 층별 점수표: 같은 작품 묶음에서 전처리 버전(열)마다 세 층(행) — 전처리 · NovelBrain 검색 · 인물 시뮬레이션 — 의 점수를 낸다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_layers.py contexts --version=v04 [--groups=dev,hold,ext,new]   # 호출 없음: 문항별 층 값 → .data/ko_timechara/layers
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_layers.py report --name=<이름> [--versions=svc,old,v00,v03,v04]   # 호출 없음: results/ko-timechara-layers-<이름>.json
    … kt_layers.py nbctx [--sets=v2,old,ec]      # 호출 없음: 검색 구성 전부(원고 발췌 s2·s3 포함)의 문항별 층 값, 질문 임베딩을 로컬 E5로 계산 → .data/ko_timechara/layers/nb-<묶음>-<작품 묶음>.json
    … kt_layers.py nbreport --name=<이름>        # 호출 없음: 세계관 묶음 × 구성의 문맥 지표·시점 쌍 정확도·상관 → results/ko-timechara-layers-nb-<이름>.json

열(버전)과 세계관·시점 쌍 기록의 대응은 SOURCES 표 하나다(작품 묶음마다 세계관 파일 이름과 runs/pairs-rows-<이름>.json 목록). 새 응답은 만들지 않고 이미 낸 시점 쌍 기록(gpt-6-luna@low)을 질문 id로 읽는다.
- 전처리(kt_linkeval 그대로, text 짝짓기): 지식 F1·정밀·재현, 사건 재현, 겪음 정밀·재현, 뒤 회차 들음 정확·재현, 인물 쪼개짐·섞임.
- 검색(구성 link_bm25·no_vector): 문맥 겹침 = 정답표 사건 요약의 글자 2-gram(인물 이름 제외)이 문맥 항목 하나의 한 창(문장 하나나 이어진 두 문장, kt_linkeval의 text 짝짓기와 같은 창)에 든 비율의 항목 중 최댓값.
  알아야 하는 쪽(after·present): 문맥 재현 = 상위 6개 문맥의 겹침이 기준(0.5·0.2) 이상인 문항의 비율, 전처리 상한 = 그 인물이 그 시점에 볼 수 있는 카드·문서 전체(상위 6개로 자르기 전, 문맥 항목도 포함)의 겹침이 기준 이상인 비율,
  검색 손실 = 상한에는 있는데 상위 6개에 못 든 비율. 몰라야 하는 쪽(before·absent): 노출 = 물어본 사건의 겹침이 상위 6개 문맥에서 기준 이상인 비율(기존 누설 지표 future·foreign·unseen·asked_ep을 함께 센다).
- 인물 시뮬레이션: 쌍 정확도(Wilson 95% 구간)·side별 문항 정확도, 알아야 하는 쪽을 문맥 겹침으로 나눈 정답률(충분 ≥0.5 · 일부 0.2~0.5 · 없음 <0.2)과 몰라야 하는 쪽의 노출(≥0.5)·없음(<0.2) 정답률.
문맥은 kt_context.contexts_for로 질문마다 다시 만든다(호출 없음, 질문 임베딩은 이 구성들이 안 써서 영벡터). 기록의 kinds_ctx·누설 표지와 맞는지는 report가 함께 센다.
결과는 results/에 집계 수치만 쓰고, 문항별 값(질문 id·숫자뿐, 원문 없음)은 .data에 둔다.
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json
from collections import Counter
from functools import lru_cache

from app.novelbrain.service import _documents
from embed import embed_texts
from kt_common import KT, RESULTS
from kt_context import contexts_for, item_kind
from kt_linkeval import _bigrams, _windows, character_ids, derive, load_inputs, ratio, work_counts
from kt_pairs import SIDES, load_pairs, pair_block, pair_outcomes, question_block
from kt_run import build_data, embed_group
from kt_world import load_world
from metrics import sign_test
from run import filtered
from timechara import snapshot

GROUPS = {'dev': ('w01', 'w13', 'w25', 'w41', 'c01'), 'hold': ('w07', 'w19', 'w31', 'w47', 'c03'), 'ext': ('w05', 'w15', 'w35', 'w45', 'c05'),
          'new': ('w03', 'w09', 'w11', 'w17', 'w21', 'w27', 'w29', 'w43', 'c02', 'c04')}   # 개발 · 옛 보류 · 확장 · 새 보류(변경을 고르는 데 쓴 15편과 코드 동결 뒤 처음 연 10편)
GROUP_OF = {work: group for group, works in GROUPS.items() for work in works}
VERSIONS = ('svc', 'old', 'v00', 'v03', 'v04')   # 열 순서: 왼쪽이 옛 것. ec는 참고 열(개발·새 보류에만 있다)
LABELS = {'svc': '서비스 전처리', 'old': '기존 평가용 세계관', 'v00': '시작 시점 시제품(v00)', 'v03': '1차 개선', 'v04': '2차 개선(현재)', 'ec': '현재 + 회차 칸(참고)'}
CONFIGS = ('link_bm25', 'no_vector')   # 층별로 보는 문맥 구성(벡터=원고 발췌 없는 구성)
KNOW, NOT = ('after', 'present'), ('before', 'absent')   # 알아야 하는 쪽·몰라야 하는 쪽 side
LEVELS = {'50': 0.5, '20': 0.2}   # 문맥 겹침 기준: 충분(≥0.5)·흔적(≥0.2)
LAYERS = KT / 'layers'
FLAGS = ('future', 'foreign', 'unseen', 'asked_ep')


ZERO = 'pairs-luna'   # 기존(old)과 zero는 pairs-luna(7구성 × 52편) 하나로 통일한다(검색 없음은 세계관과 무관해 한 기록을 모든 열의 기준으로 쓴다)

# 열 → 작품 묶음 → (세계관 파일 이름, 시점 쌍 기록 이름들)
SOURCES = {
    'svc': {g: ('world_svc', ('pairs-ly-svc-d', 'pairs-ly-svc-r', 'pairs-ly-svc-n')) for g in GROUPS},
    'old': {g: ('world', (ZERO,)) for g in GROUPS},
    'v00': {'dev': ('world2', ('pairs-w2',)), 'hold': ('sv-h-v00', ('pairs-h-v00',)), 'ext': ('sv-x-v00', ('pairs-ly-v00-x',)), 'new': ('sv-n-v00', ('pairs-ly-v00-n',))},
    'v03': {'dev': ('sv-v03b', ('pairs-v03b',)), 'hold': ('sv-h-final', ('pairs-h-final',)), 'ext': ('sv-x-final', ('pairs-x-final', 'pairs-ly-v03-x')), 'new': ('sv-n-v1', ('pairs-n-v1',))},
    'v04': {'dev': ('sv-rf-d0', ('pairs-rf-d0',)), 'hold': ('sv-h-r2', ('pairs-h-r2',)), 'ext': ('sv-x-r2', ('pairs-x-r2', 'pairs-x-r2-nv')), 'new': ('sv-n-v4', ('pairs-n-v4',))},
    'ec': {'dev': ('sv-ec-d3', ('pairs-ec-d3',)), 'new': ('sv-ec-h3', ('pairs-ec-h3',))},
}
def world_of(version: str, work: str) -> str:
    """열(version)에서 작품의 세계관 파일 이름. 모르는 열이나 그 열에 없는 작품 묶음이면 KeyError."""
    return SOURCES[version][GROUP_OF[work]][0]


def common_works(coverage: dict[str, set[str]]) -> list[str]:
    """모든 열이 가진 작품(id 순)."""
    return sorted(set.intersection(*coverage.values())) if coverage else []


# ---- 문맥 겹침과 층 값(순수 함수) ----

def best_overlap(summary: str, texts: list[str], drop=()) -> float:
    """정답표 사건 요약의 2-gram(drop의 이름 제외)이 texts의 한 항목의 한 창(문장 하나나 이어진 두 문장)에 든 비율의 최댓값. 요약이 비었거나 texts가 없으면 0."""
    grams = _bigrams(summary, drop)
    return max((len(grams & w) / len(grams) for t in texts for w in _windows('', t, drop)), default=0.0) if grams else 0.0


def layer_row(row: dict, summary: str, drop, visible: list[str], contexts: dict[str, dict]) -> dict:
    """질문 하나의 층 값. visible = 그 인물이 그 시점에 볼 수 있는 카드·문서 글 전부(전처리 상한), contexts = {구성: contexts_for의 한 구성}.
    pool = 보이는 글 전체의 겹침, top = 구성의 상위 문맥 항목의 겹침."""
    cfg = {}
    for config, ctx in contexts.items():
        texts = [i['text'] for i in ctx['items']]
        cfg[config] = {'top': best_overlap(summary, texts, drop), 'n': len(texts),
                       'kinds': dict(Counter(item_kind(i['ref']) for i in ctx['items'])), **{k: ctx[k] for k in FLAGS}}
    return {'id': row['id'], 'pair_id': row['pair_id'], 'work': row['work'], 'side': row['side'], 'pool': best_overlap(summary, visible, drop), 'cfg': cfg}


def retrieval_block(rows: list[dict], config: str) -> dict:
    """구성의 검색 지표. 알아야 하는 쪽: 문맥 재현(recall)·전처리 상한(upper = max(보이는 글 전체, 상위 문맥))·검색 손실(상한에는 있고 상위 문맥에는 없음).
    몰라야 하는 쪽: 노출(exposed). 기준 0.5·0.2마다 비율(ratio)이고, leak은 누설 표지가 선 질문 수다."""
    know, other = [r for r in rows if r['side'] in KNOW], [r for r in rows if r['side'] in NOT]
    top = lambda r: r['cfg'][config]['top']  # noqa: E731
    out: dict = {'know_n': len(know), 'not_n': len(other), 'recall': {}, 'upper': {}, 'loss': {}, 'exposed': {}}
    for key, level in LEVELS.items():
        out['recall'][key] = ratio(sum(top(r) >= level for r in know), len(know))
        out['upper'][key] = ratio(sum(max(r['pool'], top(r)) >= level for r in know), len(know))
        out['loss'][key] = ratio(sum(max(r['pool'], top(r)) >= level > top(r) for r in know), len(know))
        out['exposed'][key] = ratio(sum(top(r) >= level for r in other), len(other))
    out['leak'] = {**{k: sum(bool(r['cfg'][config][k]) for r in rows) for k in FLAGS}, 'n': len(rows)}
    return out


def simulation_block(records: list[dict], rows: list[dict], config: str) -> dict:
    """구성의 응답 지표: 쌍·문항 정확도, side별 문항 정확도, 알아야 하는 쪽을 문맥 겹침으로 나눈 정답률(enough ≥0.5 · partial 0.2~0.5 · empty <0.2),
    몰라야 하는 쪽의 노출(exposed ≥0.5)·흔적(trace)·없음(clean <0.2) 정답률(응답 단계만의 품질을 보려고)."""
    top = {r['id']: r['cfg'][config]['top'] for r in rows}
    mine = [r for r in records if r['id'] in top]
    part = lambda sides, lo, hi: question_block([r for r in mine if r['side'] in sides and lo <= top[r['id']] < hi])  # noqa: E731
    sides = [side for kind in SIDES.values() for side in kind]
    return {'pairs': pair_block(records), 'questions': question_block(records), 'sides': {side: question_block([r for r in records if r['side'] == side]) for side in sides},
            'enough': part(KNOW, 0.5, 9), 'partial': part(KNOW, 0.2, 0.5), 'empty': part(KNOW, -1, 0.2),
            'exposed': part(NOT, 0.5, 9), 'trace': part(NOT, 0.2, 0.5), 'clean': part(NOT, -1, 0.2), 'attribution': attribution(records, rows, config)}


def attribution(records: list[dict], rows: list[dict], config: str) -> dict:
    """알아야 하는 쪽 문항의 결과를 원인으로 나눈다(채점한 문항만): 맞음 · 틀림 중 전처리(보이는 카드 전체와 상위 문맥 어디에도 사건 흔적이 0.2 미만) ·
    검색(카드 전체에는 있으나 상위 문맥에 0.2 미만) · 응답(상위 문맥에 흔적이 있는데 틀림)."""
    by_id, level = {r['id']: r for r in rows}, LEVELS['20']
    out = {'n': 0, 'correct': 0, 'pre': 0, 'search': 0, 'response': 0}
    for rec in records:
        row = by_id.get(rec['id'])
        if row is None or rec['side'] not in KNOW or rec['correct'] is None:
            continue
        top = row['cfg'][config]['top']
        out['n'] += 1
        out['correct' if rec['correct'] else 'response' if top >= level else 'search' if row['pool'] >= level else 'pre'] += 1
    return out


KNOW_BINS = (('empty', -1, 0.2), ('partial', 0.2, 0.5), ('enough', 0.5, 9))   # 알아야 하는 쪽: 문맥 겹침 구간
NOT_BINS = (('clean', -1, 0.2), ('trace', 0.2, 0.5), ('exposed', 0.5, 9))   # 몰라야 하는 쪽: 노출 구간


def level_bin(side: str, top: float) -> tuple[str, str]:
    """문항의 (side 묶음, 문맥 겹침 구간 이름)."""
    group, bins = ('know', KNOW_BINS) if side in KNOW else ('not', NOT_BINS)
    return group, next(name for name, lo, hi in bins if lo <= top < hi)


def items_block(rows: list[dict], config: str) -> dict:
    """구성의 문맥 항목: 질문 수·질문당 평균 항목 수·종류별 평균 개수."""
    if not rows:
        return {'n': 0, 'items': None, 'kinds': {}}
    kinds: Counter = Counter()
    for r in rows:
        kinds.update(r['cfg'][config]['kinds'])
    return {'n': len(rows), 'items': sum(r['cfg'][config]['n'] for r in rows) / len(rows), 'kinds': {k: v / len(rows) for k, v in kinds.items()}}


def pearson(xs: list[float], ys: list[float]) -> float | None:
    """피어슨 상관(한쪽이 상수면 None)."""
    if len(xs) < 2:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sx, sy = sum((x - mx) ** 2 for x in xs), sum((y - my) ** 2 for y in ys)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy) ** 0.5 if sx and sy else None


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """스피어만 상관(같은 값은 평균 순위)."""
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        out, i = [0.0] * len(v), 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                out[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return out
    return pearson(ranks(xs), ranks(ys))


def bin_counts(rows: list[dict], records: list[dict], config: str) -> dict:
    """채점한 문항을 (side 묶음, 문맥 겹침 구간)별로 [맞은 수, 문항 수]로 센다."""
    by_id, out = {r['id']: r for r in rows}, {}
    for rec in records:
        if (row := by_id.get(rec['id'])) is not None and rec['correct'] is not None:
            cell = out.setdefault(level_bin(rec['side'], row['cfg'][config]['top']), [0, 0])
            cell[0] += bool(rec['correct'])
            cell[1] += 1
    return out


def loo_model(cells: list[dict], skip: int) -> dict:
    """skip번 칸을 뺀 나머지 칸의 구간별 개수를 합쳐 구간 → 정답률 모델을 만든다."""
    total: dict = {}
    for i, counts in enumerate(cells):
        for key, (k, n) in counts.items():
            if i != skip:
                cell = total.setdefault(key, [0, 0])
                cell[0] += k
                cell[1] += n
    return {key: k / n for key, (k, n) in total.items() if n}


def predict_accuracy(model: dict, rows: list[dict], config: str) -> dict:
    """구간 모델로 문항마다 정답 확률을 어림해 문항 평균(questions)과 쌍(두 문항 확률의 곱의 평균, pairs)을 낸다. 모델에 없는 구간의 문항·쌍은 뺀다."""
    p = {r['id']: model.get(level_bin(r['side'], r['cfg'][config]['top'])) for r in rows}
    by_pair: dict = {}
    for r in rows:
        by_pair.setdefault(r['pair_id'], []).append(p[r['id']])
    scored = [v for v in p.values() if v is not None]
    pairs = [a * b for a, b in (v for v in by_pair.values() if len(v) == 2 and None not in v)]
    return {'questions': sum(scored) / len(scored) if scored else None, 'pairs': sum(pairs) / len(pairs) if pairs else None}


def select_records(records: list[dict], world: str, works, config: str) -> list[dict]:
    """세계관(기록에 world가 없으면 기존 world)·작품·구성의 기록, 질문 id당 앞의 하나."""
    seen, out = set(), []
    for r in records:
        if r['config'] == config and r['work'] in works and (r.get('world') or 'world') == world and r['id'] not in seen:
            seen.add(r['id'])
            out.append(r)
    return out


def _sign(both: list[tuple]) -> dict:
    """짝지은 (a, b) 값에서 a가 높은 수·b가 높은 수와 정확 부호 검정(양측) p. 같은 값은 검정에서 빼고 n에는 든다."""
    out = sign_test([x for x, _ in both], [y for _, y in both])
    return {'n': len(both), 'a_only': out['up'], 'b_only': out['down'], 'p': out['p']}


def compare_pairs(a: list[dict], b: list[dict]) -> dict:
    """같은 쌍에서 a만 맞음·b만 맞음의 정확 부호 검정(양측). 한쪽이라도 채점 못 한 쌍은 뺀다(n에는 안 든다). kt_pairs.compare와 같은 규칙이다."""
    oa, ob = pair_outcomes(a), pair_outcomes(b)
    return _sign([(oa[i], ob[i]) for i in sorted(oa.keys() & ob.keys()) if oa[i] is not None and ob[i] is not None])


def compare_questions(a: list[dict], b: list[dict], sides) -> dict:
    """같은 질문 id(고른 side만)에서 a만 맞음·b만 맞음의 정확 부호 검정(양측)."""
    by_b = {r['id']: r['correct'] for r in b if r['side'] in sides and r['correct'] is not None}
    return _sign([(r['correct'], by_b[r['id']]) for r in a if r['side'] in sides and r['correct'] is not None and r['id'] in by_b])


def merge_layer_rows(old: list[dict], new: list[dict]) -> list[dict]:
    """다시 계산한 작품(new)의 행으로 old의 같은 작품 행을 바꾸고 나머지 작품 행은 둔다."""
    redone = {r['work'] for r in new}
    return [r for r in old if r['work'] not in redone] + new


def compare_values(a: dict[str, float], b: dict[str, float]) -> dict:
    """작품별 값(지식 F1)을 같은 작품끼리 짝지어 a가 높은 작품 수·b가 높은 작품 수와 정확 부호 검정(양측). 같은 값은 검정에서 빼고 n에는 든다."""
    return _sign([(a[k], b[k]) for k in sorted(a.keys() & b.keys())])


# ---- 읽기(실제 데이터가 필요해 단위 테스트하지 않는다) ----

@lru_cache(maxsize=None)
def load_rows(name: str) -> list[dict]:
    return json.loads((KT / 'runs' / f'pairs-rows-{name}.json').read_text())


def split_by_group(works) -> dict[str, tuple[str, ...]]:
    return {group: tuple(w for w in members if w in works) for group, members in GROUPS.items() if any(w in works for w in members)}


def version_records(version: str, config: str, works) -> list[dict]:
    """열·구성의 시점 쌍 응답 기록(작품들). zero는 세계관과 무관해 pairs-luna의 zero다."""
    if config == 'zero':
        return select_records(load_rows(ZERO), 'world', set(works), 'zero')
    out = []
    for group, members in split_by_group(works).items():
        if group in SOURCES[version]:
            world, names = SOURCES[version][group]
            out += select_records([r for name in names if (KT / 'runs' / f'pairs-rows-{name}.json').exists() for r in load_rows(name)], world, set(members), config)
    return out


def covered(version: str) -> set[str]:
    """열이 두 구성(link_bm25·no_vector) 모두 질문 전부에 응답 기록을 가진 작품."""
    need = Counter(r['work'] for r in load_pairs())
    have = {config: Counter(r['work'] for r in version_records(version, config, set(GROUP_OF))) for config in CONFIGS}
    return {w for w in GROUP_OF if GROUP_OF[w] in SOURCES[version] and need[w] and all(have[c][w] == need[w] for c in CONFIGS)}


def layer_path(version: str, group: str):
    return LAYERS / f'ctx-{version}-{group}.json'


def check_layer_rows(version: str, works, questions: list[dict], rows: list[dict]) -> None:
    """집계 전에 작품들의 문항마다 문맥 행(ctx-<열>-<묶음>.json)이 있는지 본다: 빠지면 검색 지표는 문항 0개로, 응답 정확도는 전체 문항으로 계산돼 서로 다른 모집단이 한 블록에 저장된다.
    빠진 작품이 있으면 만들 명령을 알리고 멈춘다."""
    have = {r['id'] for r in rows}
    lost = sorted({q['work'] for q in questions if q['work'] in works and q['id'] not in have})
    if lost:
        groups = ','.join(dict.fromkeys(GROUP_OF[w] for w in lost))
        raise SystemExit(f"{version} 열의 문맥 행이 없는 작품 {' '.join(lost)}: kt_layers.py contexts --version={version} --groups={groups} 로 만든 뒤 report를 다시 돌린다.")


def load_layer_rows(version: str, works) -> list[dict]:
    out = []
    for group in split_by_group(works):
        if layer_path(version, group).exists():
            out += [r for r in json.loads(layer_path(version, group).read_text()) if r['work'] in works]
    return out


def drop_names(knowledge: list[dict], world: dict) -> list[str]:
    """겹침 계산에서 뺄 인물 이름: 정답표 인물(참여·목격·들음)과 세계관 인물 카드의 제목·별칭(2자 이상, 긴 것부터)."""
    names = {p['name'] for rec in knowledge for e in rec['events'] for p in e['participants'] + e['witnesses']} | {i['learner'] for rec in knowledge for i in rec['learned']}
    names |= {n for c in world['cards'] if c.cardType == 'character' for n in [c.title, *world.get('aliases', {}).get(c.id, [])]}
    return sorted((n for n in names if len(n) >= 2), key=len, reverse=True)


def rows_for(works, world_name: str, configs, qvec: dict | None = None) -> list[dict]:
    """작품들·세계관 파일 이름의 질문마다 층 값(호출 없음). 문맥은 kt_pairs.run과 같은 인물 대응으로 contexts_for가 다시 만든다.
    qvec(질문 id → 질문 임베딩)을 주면 원고 발췌 구성(s2·s3)도 기록과 같게 만들고, 없으면 영벡터를 쓴다(link_bm25·no_vector는 발췌를 안 쓴다)."""
    import numpy as np

    data = build_data(list(works), world=world_name)
    questions = [r for r in load_pairs() if r['work'] in works]
    if world_name != 'world':   # kt_pairs.run과 같다: 정답표 이름 → 그 세계관의 카드
        for wid, d in data.items():
            d['world'] = {**d['world'], 'character_id': {**d['world']['character_id'], **character_ids(d['world'], sorted({r['character'] for r in questions if r['work'] == wid}))}}
    out = []
    for wid in works:
        d = data[wid]
        world, knowledge = d['world'], d['knowledge']
        events = {e['id']: e for rec in knowledge for e in rec['events']}
        drop, docs = drop_names(knowledge, world), _documents(world['cards'])
        zero = np.zeros(d['vectors'].shape[1], dtype=d['vectors'].dtype)
        for r in (q for q in questions if q['work'] == wid):
            ctx = contexts_for(r, d, knowledge, zero if qvec is None else qvec[r['id']])
            character_id = world['character_id'].get(r['character'])
            visible = [] if character_id is None else [docs[ref][1] for ref in filtered(list(docs), {}, snapshot(world, r['cutoff']), character_id, r['cutoff'])]
            out.append(layer_row(r, events[r['event_id']]['summary'], drop, visible, {c: ctx[c] for c in configs}))
    return out


def layer_rows_for(version: str, group: str, only=()) -> list[dict]:
    """한 열·작품 묶음(only를 주면 그 작품만)의 질문마다 층 값."""
    return rows_for(tuple(w for w in GROUPS[group] if not only or w in only), SOURCES[version][group][0], CONFIGS)


# ---- NovelBrain 검색 구성 비교(호출 없음): 세계관 묶음(v2·old·ec) × 구성 ----

R3 = ('w02', 'w04', 'w06', 'w08', 'w10', 'w12', 'w14', 'w16', 'w18', 'w20', 'w22', 'w23', 'w24', 'w26', 'w28', 'w30', 'w32', 'w33', 'w34', 'w36', 'w38', 'w39', 'w40', 'w42', 'w44', 'w46', 'w48')   # 3차 27편(웹소설)
NB_GROUPS = {**GROUPS, 'r3': R3}
NB_SETS = {   # 세계관 묶음 → 작품 묶음 → 세계관 파일 이름: v2 = 2차 최종, old = 기존 평가용, ec = 2차 최종 + 회차 칸(42편)
    'v2': {'dev': 'sv-rf-d0', 'hold': 'sv-h-r2', 'ext': 'sv-x-r2', 'new': 'sv-n-v4', 'r3': 'sv-r3'},
    'old': {g: 'world' for g in NB_GROUPS},
    'ec': {'dev': 'sv-ec-d3', 'new': 'sv-ec-h3', 'r3': 'sv-ec-r3'},
}
NB_PAIRS = {   # 세계관 묶음 → 작품 묶음 → 이미 있는 시점 쌍 기록 이름들(zero는 모두 pairs-luna)
    'v2': {'dev': ('pairs-rf-d0',), 'hold': ('pairs-h-r2',), 'ext': ('pairs-x-r2', 'pairs-x-r2-nv'), 'new': ('pairs-n-v4',), 'r3': ('pairs-r3-all',)},
    'old': {g: (ZERO,) for g in NB_GROUPS},
    'ec': {'dev': ('pairs-ec-d3',), 'new': ('pairs-ec-h3',), 'r3': ('pairs-ec-r3-all',)},
}
NB_CONFIGS = ('zero', 'link_bm25', 'link2_bm25', 'link_ppr', 'no_vector', 's2', 's3', 'link_cells', 'link_known')   # 문맥을 만들어 두는 구성
NB_REPORT = {'v2': NB_CONFIGS[:7], 'old': NB_CONFIGS[:7], 'ec': ('link_bm25', 'no_vector', 'link_cells', 'link_known')}   # 묶음마다 보고하는 구성


def nb_path(set_name: str, group: str):
    return LAYERS / f'nb-{set_name}-{group}.json'


def query_vectors() -> dict:
    """전체 질문을 kt_run.build_contexts와 같은 묶음(embed_group)으로 임베딩한다: kt_pairs.run이 쓴 것과 같은 벡터라 기록의 s2·s3 문맥을 그대로 다시 만든다."""
    rows = load_pairs()
    groups: dict = {}
    for n, r in enumerate(rows):
        groups.setdefault(embed_group(r['work']), []).append(n)
    queries = {}
    for numbers in groups.values():
        queries.update(zip(numbers, embed_texts([rows[n]['question'] for n in numbers], 'query')))
    return {r['id']: queries[n] for n, r in enumerate(rows)}


def nb_records(set_name: str, config: str) -> list[dict]:
    """세계관 묶음·구성의 시점 쌍 응답 기록(있는 작품들). zero는 세계관과 무관해 pairs-luna의 zero다."""
    if config == 'zero':
        return select_records(load_rows(ZERO), 'world', {w for g in NB_SETS[set_name] for w in NB_GROUPS[g]}, 'zero')
    out = []
    for group, names in NB_PAIRS[set_name].items():
        out += select_records([r for n in names if (KT / 'runs' / f'pairs-rows-{n}.json').exists() for r in load_rows(n)], NB_SETS[set_name][group], set(NB_GROUPS[group]), config)
    return out


def usable_cell(set_name: str, config: str, cell: dict, bins: dict, records: list[dict]) -> dict | None:
    """응답이 있는 칸 하나의 상관·예측용 값. 쌍·문항 정확도가 없는(응답이 전부 채점 실패한) 칸은 None이다: 합산·뺄셈에 None이 들어가 보고서를 못 저장하지 않게 빼되,
    실패 수는 칸의 simulation에 남고 미실행('응답 실행 필요') 칸으로 바꾸지 않는다."""
    sim, ret = cell['simulation'], cell['retrieval']
    if sim['pairs']['accuracy'] is None or sim['questions']['accuracy'] is None:
        return None
    return {'set': set_name, 'config': config, 'bins': bins, 'records': records, 'pairs': sim['pairs']['accuracy'], 'questions': sim['questions']['accuracy'], 'recall50': ret['recall']['50']['rate'],
            'recall20': ret['recall']['20']['rate'], 'upper50': ret['upper']['50']['rate'], 'exposed20': ret['exposed']['20']['rate'], 'items': cell['items']['items']}


def nb_cell(set_name: str, config: str, rows: list[dict]) -> tuple[dict, dict]:
    """(세계관 묶음, 구성) 칸 하나: 검색 지표·문맥 항목·(시점 쌍 응답이 있으면) 응답 지표·재구성 점검. 두 번째 값은 구간별 [맞은 수, 문항 수](튜플 열쇠, 모델 어림용)."""
    records = nb_records(set_name, config)
    out = {'retrieval': retrieval_block(rows, config), 'items': items_block(rows, config), 'records': len(records)}
    bins = bin_counts(rows, records, config) if records else {}
    if records:
        out['simulation'], out['fidelity'] = simulation_block(records, rows, config), fidelity(rows, records, config)
        out['bins'] = {f'{g}/{b}': v for (g, b), v in sorted(bins.items())}
    return out, bins


def nb_agreement(cells: list[dict]) -> dict:
    """응답이 있는 칸들에서 문맥 지표와 쌍 정확도의 상관(피어슨·스피어만)."""
    ys = [c['pairs'] for c in cells]
    return {'n': len(cells), **{key: {'pearson': pearson([c[key] for c in cells], ys), 'spearman': spearman([c[key] for c in cells], ys)} for key in ('recall50', 'recall20', 'upper50', 'exposed20', 'items')}}


def nb_report(name: str) -> dict:
    """세계관 묶음마다 구성별 문맥 지표·시점 쌍 정확도를 results/ko-timechara-layers-nb-<name>.json에 쓴다(집계 수치만, 호출 없음)."""
    out: dict = {'sets': {}, 'missing': []}
    cells, rows_of = [], {}
    for set_name, configs in NB_REPORT.items():
        rows = rows_of[set_name] = [r for g in NB_SETS[set_name] for r in json.loads(nb_path(set_name, g).read_text())]
        block = {}
        for config in configs:
            block[config], bins = nb_cell(set_name, config, rows)
            if block[config]['records']:
                if (cell := usable_cell(set_name, config, block[config], bins, nb_records(set_name, config))) is not None:
                    cells.append(cell)
            else:
                out['missing'].append([set_name, config])
        out['sets'][set_name] = {'works': sorted({r['work'] for r in rows}), 'questions': len(rows), 'configs': block}
    predicted = []
    for i, c in enumerate(cells):
        pred = predict_accuracy(loo_model([x['bins'] for x in cells], i), rows_of[c['set']], c['config'])
        predicted.append({'set': c['set'], 'config': c['config'], 'pairs': c['pairs'], 'pred_pairs': pred['pairs'], 'questions': c['questions'], 'pred_questions': pred['questions']})
    scored = [p for p in predicted if p['pred_pairs'] is not None]
    out['pairwise'] = [{'set': a['set'], 'a': a['config'], 'b': b['config'], **compare_pairs(a['records'], b['records'])}
                       for i, a in enumerate(cells) for b in cells[i + 1:] if a['set'] == b['set'] and 'zero' not in (a['config'], b['config'])]   # 같은 세계관 묶음의 구성 둘씩 쌍 부호 검정
    out['agreement'] = {'all': nb_agreement(cells), 'no_zero': nb_agreement([c for c in cells if c['config'] != 'zero']),
                        **{s: nb_agreement([c for c in cells if c['set'] == s and c['config'] != 'zero']) for s in NB_REPORT if sum(c['set'] == s and c['config'] != 'zero' for c in cells) >= 3}}
    out['prediction'] = {'cells': predicted, 'mae_pairs': sum(abs(p['pairs'] - p['pred_pairs']) for p in scored) / len(scored) if scored else None,
                         'spearman_pairs': spearman([p['pairs'] for p in scored], [p['pred_pairs'] for p in scored]) if len(scored) > 2 else None}
    full = loo_model([x['bins'] for x in cells], -1)   # 모든 칸을 합친 모델로, 응답 기록이 없는 칸의 정답률을 어림한다(실행 전 예상일 뿐이다)
    out['forecast'] = {f'{s}/{c}': predict_accuracy(full, rows_of[s], c) for s, c in out['missing']}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'ko-timechara-layers-nb-{name}.json').write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True))
    return out


def fidelity(rows: list[dict], records: list[dict], config: str) -> dict:
    """다시 만든 문맥이 응답을 낼 때 쓴 문맥과 같은 질문 수: 항목 종류 분포·누설 표지(future·foreign·unseen)·같은 회차 노출 표지(asked_ep)가 모두 같을 때만 같다."""
    mine = {r['id']: r['cfg'][config] for r in rows}
    same = n = 0
    for rec in records:
        c = mine.get(rec['id'])
        if c is not None:
            n += 1
            same += (c['kinds'] == rec['kinds_ctx'] and [bool(c[k]) for k in FLAGS[:3]] == [rec['future_ctx'], rec['foreign_ctx'], rec['unseen_ctx']] and c['asked_ep'] == rec['asked_ep_ctx'])
    return {'n': n, 'same': same}


PRE_KEYS = ('knowledge_f1', 'knowledge_precision', 'knowledge_recall', 'event_recall', 'experienced_precision', 'experienced_recall',
            'heard_later_precision', 'heard_later_recall', 'persons_split', 'cards_mixed')


def preprocess_block(version: str, works) -> dict:
    """전처리 층(kt_linkeval 그대로, text 짝짓기): 열의 세계관을 작품마다 센 개수를 더해 지표로 낸다. by_work_f1은 작품별 지식 F1(작품 단위 부호 검정용)."""
    total, by_work = Counter(), {}
    for work in sorted(works):
        i = load_inputs(work)
        counts = work_counts(i['knowledge'], load_world(i['folder'] / f'{world_of(version, work)}.json'), i['mains'], 'text')
        total.update(counts)
        by_work[work] = derive(counts)['knowledge_f1']
    metrics = derive(total)
    return {**{k: metrics[k] for k in PRE_KEYS}, 'by_work_f1': by_work}


def version_block(version: str, works) -> dict:
    """열 하나의 세 층 지표(작품들 기준)."""
    works = sorted(works)
    rows = load_layer_rows(version, set(works))
    check_layer_rows(version, set(works), load_pairs(), rows)
    out: dict = {'works': works, 'layer_rows': len(rows), 'preprocess': preprocess_block(version, works), 'retrieval': {}, 'simulation': {}, 'fidelity': {}, 'by_work': {}}
    for config in CONFIGS:
        records = version_records(version, config, set(works))
        for w in works:
            out['by_work'].setdefault(w, {'f1': out['preprocess']['by_work_f1'][w]})[config] = pair_block([r for r in records if r['work'] == w])['accuracy']   # 작품별 쌍 정확도(32쌍이라 잡음이 크다)
        out['retrieval'][config] = retrieval_block(rows, config)
        out['simulation'][config] = simulation_block(records, rows, config)
        out['fidelity'][config] = fidelity(rows, records, config)
    zero = version_records(version, 'zero', set(works))
    out['simulation']['zero'] = {'pairs': pair_block(zero), 'questions': question_block(zero), 'sides': {s: question_block([r for r in zero if r['side'] == s]) for k in SIDES.values() for s in k}}
    return out


STAT_PAIRS = (('svc', 'old'), ('old', 'v00'), ('v00', 'v03'), ('v03', 'v04'), ('svc', 'v04'), ('old', 'v04'))   # 인접 버전과 양 끝(서비스·기존 → 2차)


def stats_block(works, versions) -> dict:
    """인접 버전과 양 끝의 쌍 부호 검정(구성마다: 쌍 정확도·알아야 하는 쪽 문항·몰라야 하는 쪽 문항)과 작품 단위 지식 F1 부호 검정(전처리). a = 앞(옛) 버전."""
    out = {}
    for a, b in (p for p in STAT_PAIRS if set(p) <= set(versions)):
        by_config = {}
        for config in CONFIGS:
            ra, rb = version_records(a, config, set(works)), version_records(b, config, set(works))
            by_config[config] = {'pairs': compare_pairs(ra, rb), 'know': compare_questions(ra, rb, KNOW), 'not': compare_questions(ra, rb, NOT)}
        out[f'{a}>{b}'] = {**by_config, 'f1_by_work': compare_values(*(preprocess_block(v, works)['by_work_f1'] for v in (a, b)))}   # a_only = 앞(옛) 버전이 더 높은 작품 수
    return out


def report(name: str, versions: tuple[str, ...]) -> dict:
    """열마다 자기 작품 전부와 공통 작품(주 다섯 열 모두 있는 작품)의 층 지표·통계를 results/ko-timechara-layers-<name>.json에 쓴다(집계 수치만, 호출 없음)."""
    cover = {v: covered(v) for v in versions}
    common = common_works({v: cover[v] for v in versions if v in VERSIONS})
    out = {'versions': list(versions), 'labels': {v: LABELS[v] for v in versions}, 'works': {'common': common, 'by_version': {v: sorted(cover[v]) for v in versions}},
           'own': {}, 'common': {}, 'stats': stats_block(common, [v for v in versions if v in VERSIONS]) if common else {}}
    for v in versions:
        if cover[v]:
            out['own'][v] = version_block(v, cover[v])
        if common and cover[v] >= set(common):
            out['common'][v] = version_block(v, common)
    out['groups'] = {g: {v: version_block(v, set(GROUPS[g])) for v in versions if cover[v] >= set(GROUPS[g])} for g in GROUPS}   # 작품 묶음별: 그 묶음 전체를 가진 열만(변경을 고르는 데 쓴 묶음과 안 쓴 새 보류를 나눠 본다)
    if cover.get('ec') and cover.get('v04', set()) >= cover['ec']:   # 참고 열: 회차 칸 판은 개발·새 보류에만 있어 현재(v04)와 그 작품들만으로 견준다
        out['ref'] = {'works': sorted(cover['ec']), 'v04': version_block('v04', cover['ec']), 'ec': version_block('ec', cover['ec'])}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f'ko-timechara-layers-{name}.json').write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True))
    return out


def show(result: dict) -> None:
    pct = lambda r: '-' if r is None or r['rate'] is None else f"{100 * r['rate']:.1f}"  # noqa: E731
    print(f"공통 작품 {len(result['works']['common'])}편: " + ' '.join(result['works']['common']))
    for v, block in result['common'].items():
        pre, sim = block['preprocess'], block['simulation']
        print(f"{v:4s} 지식 F1 {100 * pre['knowledge_f1']:.1f} · 문맥 재현≥0.5 {pct(block['retrieval']['link_bm25']['recall']['50'])} 상한 {pct(block['retrieval']['link_bm25']['upper']['50'])} · "
              f"쌍 link_bm25 {pct({'rate': sim['link_bm25']['pairs']['accuracy']})} no_vector {pct({'rate': sim['no_vector']['pairs']['accuracy']})} zero {pct({'rate': sim['zero']['pairs']['accuracy']})}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    sub = parser.add_subparsers(dest='command', required=True)
    contexts = sub.add_parser('contexts', help='문항별 층 값(호출 없음)', allow_abbrev=False)
    contexts.add_argument('--version', required=True, choices=tuple(SOURCES))
    contexts.add_argument('--groups', default=','.join(GROUPS), help='작품 묶음(쉼표, 기본 전부)')
    contexts.add_argument('--works', default='', help='이 작품만(쉼표, 기존 파일의 다른 작품 행은 둔다)')
    nbctx = sub.add_parser('nbctx', help='검색 구성 비교용 문항별 층 값(호출 없음, 질문 임베딩 계산)', allow_abbrev=False)
    nbctx.add_argument('--sets', default=','.join(NB_SETS), help='세계관 묶음(쉼표, 기본 v2,old,ec)')
    nbreport = sub.add_parser('nbreport', help='검색 구성 비교 집계(호출 없음)', allow_abbrev=False)
    nbreport.add_argument('--name', required=True, help='results/ko-timechara-layers-nb-<이름>.json')
    report_ = sub.add_parser('report', help='층별 점수표 집계(호출 없음)', allow_abbrev=False)
    report_.add_argument('--name', required=True, help='results/ko-timechara-layers-<이름>.json')
    report_.add_argument('--versions', default=','.join(VERSIONS), help='열(쉼표, 기본 주 다섯 열, ec는 참고 열)')
    args = parser.parse_args(argv)
    if args.command == 'nbctx':
        LAYERS.mkdir(parents=True, exist_ok=True)
        qvec = query_vectors()
        for set_name in filter(None, args.sets.split(',')):
            for group, world in NB_SETS[set_name].items():
                rows = rows_for(NB_GROUPS[group], world, NB_CONFIGS, qvec)
                nb_path(set_name, group).write_text(json.dumps(rows, ensure_ascii=False))
                print(f'{set_name}-{group}: 질문 {len(rows)}개 → {nb_path(set_name, group).name}', flush=True)
    elif args.command == 'nbreport':
        res = nb_report(args.name)
        print('응답 실행 필요한 칸:', res['missing'])
    elif args.command == 'contexts':
        LAYERS.mkdir(parents=True, exist_ok=True)
        for group in filter(None, args.groups.split(',')):
            if group not in SOURCES[args.version]:
                print(f'{args.version}: 작품 묶음 {group}은 이 열에 없다(건너뜀)')
                continue
            path, only = layer_path(args.version, group), set(filter(None, args.works.split(',')))
            rows = layer_rows_for(args.version, group, only)
            if path.exists():
                rows = merge_layer_rows(json.loads(path.read_text()), rows)
            path.write_text(json.dumps(rows, ensure_ascii=False))
            print(f'{args.version}-{group}: 질문 {len(rows)}개 → {path.name}', flush=True)
    else:
        if bad := [v for v in args.versions.split(',') if v not in SOURCES]:
            raise SystemExit(f"--versions에 모르는 열 {','.join(bad)}가 있다: {','.join(SOURCES)} 중에서 고른다.")
        show(report(args.name, tuple(filter(None, args.versions.split(',')))))


if __name__ == '__main__':
    main()
