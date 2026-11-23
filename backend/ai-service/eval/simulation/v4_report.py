"""V4 비교 집계(순수): 장면 기록·채점 → 장면별 값 → 조건별 요약 → 조건 사이 비교. 원문·응답 글은 다루지 않고 숫자만 낸다(결과 파일에 글이 들어가지 않는다)."""

import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, stdev

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from cost import request_usd  # noqa: E402
from metrics import wilson_interval  # noqa: E402

from app.simulation import service  # noqa: E402
from sim_scene_judge import scene_metrics  # noqa: E402

GRADED = ('overall', 'plan', 'voice', 'follows', 'voiceDrift', 'leakShare')   # 채점이 있어야 나오는 장면별 값
SHAPE = ('calls', 'serialSteps', 'tokensIn', 'tokensOut', 'elapsedMs', 'firstTurnMs', 'costUsd', 'retryShare')   # 기록만으로 나오는 값


def scene_row(record: dict, grade: dict | None) -> dict:
    """장면 기록(+채점)을 장면 한 줄로: 상태, 턴·호출·토큰·시간, 다시 쓴 턴 수, 같은 인물의 되풀이 대사 비율, 채점 값(없으면 None)."""
    turns, calls = record['turns'], record['calls']
    spoken = [t for t in record['transcript']['turns'] if t['kind'] == 'character']
    earlier, repeats = defaultdict(list), 0
    for line in spoken:
        repeats += service.repeated_line(line['text'], earlier[line['by']])
        earlier[line['by']].append(line['text'])
    metrics = scene_metrics(grade) if grade else {}
    n = len(turns)
    return {'id': record['id'], 'scene': record['id'].split('#')[0], 'engine': record.get('engine'), 'status': record['status'], 'stop': record.get('stopReason'),
            'completed': record['status'] == 'completed', 'turns': n, 'charTurns': len(spoken), 'retryTurns': sum(t['regenerated'] > 0 for t in turns),
            'retryShare': sum(t['regenerated'] > 0 for t in turns) / n if n else None, 'repeat': repeats / len(spoken) if spoken else None,
            'calls': len(calls), 'serialSteps': record['serialSteps'], 'tokensIn': sum(c['inputTokens'] or 0 for c in calls), 'tokensOut': sum(c['outputTokens'] or 0 for c in calls),
            'costUsd': sum(request_usd(c['inputTokens'] or 0, c['outputTokens'] or 0) for c in calls), 'elapsedMs': record['elapsedMs'], 'firstTurnMs': record.get('firstTurnMs'),
            **{key: metrics.get(key) for key in ('overall', 'plan', 'voice', 'follows', 'voiceDrift')}, 'leakTurns': metrics.get('leakTurns'),
            'leakShare': metrics['leakTurns'] / metrics['turns'] if metrics else None}


def pctl(xs: list[float], q: float) -> float | None:
    """가장 가까운 순위의 백분위(데이터가 없으면 None)."""
    ordered = sorted(xs)
    return ordered[round((len(ordered) - 1) * q)] if ordered else None


def mean_ci(xs: list) -> dict:
    """None을 뺀 평균과 정규 근사 95% 구간 반폭(표본이 둘 미만이면 None). 값이 없으면 평균도 꾸미지 않는다."""
    vals = [x for x in xs if x is not None]
    return {'mean': mean(vals) if vals else None, 'n': len(vals), 'ci': 1.96 * stdev(vals) / math.sqrt(len(vals)) if len(vals) >= 2 else None}


def fisher_exact(a: int, b: int, c: int, d: int) -> float:
    """2×2표 [[a, b], [c, d]]의 양측 Fisher 정확 검정 p."""
    n, row, col = a + b + c + d, a + b, a + c
    lf = lambda k: math.lgamma(k + 1)  # noqa: E731
    prob = lambda x: math.exp(lf(row) + lf(n - row) + lf(col) + lf(n - col) - lf(n) - lf(x) - lf(row - x) - lf(col - x) - lf(n - row - col + x))  # noqa: E731
    observed = prob(a)
    return min(1.0, sum(p for x in range(max(0, row + col - n), min(row, col) + 1) if (p := prob(x)) <= observed * (1 + 1e-9)))


def permutation_p(xs: list[float], ys: list[float], seed: int = 1, perms: int = 20000) -> float:
    """평균 차이의 양측 순열 검정 p((센 횟수 + 1) / (횟수 + 1))."""
    rng, pooled, observed = random.Random(seed), list(xs) + list(ys), abs(mean(ys) - mean(xs))
    hits = 0
    for _ in range(perms):
        rng.shuffle(pooled)
        hits += abs(mean(pooled[len(xs):]) - mean(pooled[:len(xs)])) >= observed - 1e-12
    return (hits + 1) / (perms + 1)


def _spread(xs: list) -> dict:
    vals = [x for x in xs if x is not None]
    return {'mean': mean(vals) if vals else None, 'p50': pctl(vals, 0.5), 'p95': pctl(vals, 0.95)}


def summarize(rows: list[dict]) -> dict:
    """한 조건의 요약: 완료율(Wilson), 멈춘 이유, 채점 평균(±95%), 누설·다시 쓴 턴·되풀이 비율, 호출·직렬 단계·토큰·시간 분포."""
    n, done = len(rows), sum(r['completed'] for r in rows)
    graded = [r for r in rows if r['leakTurns'] is not None]
    turns = sum(r['turns'] for r in graded)
    return {'n': n, 'completed': {'k': done, 'n': n, 'rate': done / n if n else None, 'ci': list(wilson_interval(done, n))},
            'stops': dict(Counter(r['stop'] or r['status'] for r in rows if not r['completed'])),
            'mean': {key: mean_ci([r[key] for r in rows]) for key in ('overall', 'plan', 'voice', 'follows', 'voiceDrift')},
            'leakTurnRate': sum(r['leakTurns'] for r in graded) / turns if turns else None, 'graded': len(graded),
            'retryRate': sum(r['retryTurns'] for r in rows) / sum(r['turns'] for r in rows) if sum(r['turns'] for r in rows) else None,
            'repeatRate': mean_ci([r['repeat'] for r in rows])['mean'],
            **{key: _spread([r[key] for r in rows]) for key in ('calls', 'serialSteps', 'tokensIn', 'tokensOut', 'costUsd', 'elapsedMs', 'firstTurnMs', 'turns')}}


def compare(a: list[dict], b: list[dict], seed: int = 1, perms: int = 20000) -> dict:
    """조건 a와 b(b − a)의 비교: 완료 수의 Fisher 정확 검정, 장면별 값마다 평균 차이와 순열 검정 p(한쪽에 값이 없으면 None)."""
    ka, kb = sum(r['completed'] for r in a), sum(r['completed'] for r in b)
    out = {'completed': {'a': ka, 'na': len(a), 'b': kb, 'nb': len(b), 'p': fisher_exact(ka, len(a) - ka, kb, len(b) - kb)}, 'metrics': {}}
    for key in (*GRADED, *SHAPE):
        xs, ys = [r[key] for r in a if r[key] is not None], [r[key] for r in b if r[key] is not None]
        out['metrics'][key] = ({'diff': mean(ys) - mean(xs), 'p': permutation_p(xs, ys, seed, perms)} if xs and ys else {'diff': None, 'p': None})
    return out


PAIRS = (('base', 'P1+N3'), ('base', 'v4'), ('P1+N3', 'v4'), ('base', 'P1'), ('base', 'N3'), ('base', 'P1b'), ('base', 'P1b+N3'), ('P1+N3', 'P1b+N3'))   # 조건 쌍(없는 조건은 건너뛴다)


def build_summary(records: dict[str, list[dict]], grades: dict[str, dict[str, dict | None]], pairs=PAIRS, perms: int = 20000) -> dict:
    """조건별 장면 기록(조건 → 기록들)과 채점(조건 → 장면 id → 채점)으로 조건별 요약과 쌍별 비교(키 '<b> vs <a>' = b − a)를 만든다."""
    rows = {cond: [scene_row(record, grades.get(cond, {}).get(record['id'])) for record in recs] for cond, recs in records.items()}
    return {'conditions': {cond: summarize(data) for cond, data in rows.items()},
            'comparisons': {f'{b} vs {a}': compare(rows[a], rows[b], perms=perms) for a, b in pairs if a in rows and b in rows}}
