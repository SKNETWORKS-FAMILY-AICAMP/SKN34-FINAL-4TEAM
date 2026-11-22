"""두 채점 모델(채점 모델 교체 전후)의 일치: 같은 생성 글을 두 번 채점한 값을 문항별로 견주고(상관·일치율·평균 차이), 후보의 순위와 기준선 대비 짝 비교 방향이 같은지 본다. 순수 함수다.

한 채점 모델이 같은 글을 다시 채점해도 값이 흔들려서(채점 시험-재시험) 일치의 상한은 1이 아니다. 같은 모델의 재채점을 한 번 더 두면 그 상한을 어림할 수 있다.
"""

from statistics import StatisticsError, correlation, mean

from orig_common import SEED  # noqa: F401,I001  경로 설정이 import보다 먼저여야 한다
import orig_run as rn

ALPHA = 0.05


def item_agreement(a: dict, b: dict) -> dict:
    """같은 문항(id)의 두 값을 견준다: 문항 수, Pearson r(한쪽이 상수면 None), 값이 같은 문항 비율, 두 평균과 평균 차이(b − a). 값이 없는 문항은 뺀다."""
    keys = [k for k in a if a[k] is not None and b.get(k) is not None]
    xs, ys = [a[k] for k in keys], [b[k] for k in keys]
    if not keys:
        return {'n': 0, 'r': None, 'exact': None, 'meanA': None, 'meanB': None, 'bias': None}
    try:
        r = correlation(xs, ys)
    except StatisticsError:
        r = None
    return {'n': len(keys), 'r': r, 'exact': sum(x == y for x, y in zip(xs, ys, strict=True)) / len(keys), 'meanA': mean(xs), 'meanB': mean(ys), 'bias': mean(ys) - mean(xs)}


def _ranks(values: dict) -> dict:
    """값이 큰 쪽이 1위(같은 값은 평균 순위)."""
    ordered = sorted(values, key=lambda k: -values[k])
    return {k: mean(i + 1 for i, other in enumerate(ordered) if values[other] == values[k]) for k in values}


def ranking(means_a: dict, means_b: dict) -> dict:
    """후보 이름 → 평균 두 벌의 순위 비교: 순위, Spearman ρ(후보가 둘 미만이거나 한쪽이 모두 같으면 None), 순서가 뒤바뀐 쌍([A에서 높은 쪽, 낮은 쪽])."""
    tags = [t for t in means_a if t in means_b]
    rank_a, rank_b = _ranks({t: means_a[t] for t in tags}), _ranks({t: means_b[t] for t in tags})
    try:
        rho = correlation([rank_a[t] for t in tags], [rank_b[t] for t in tags])
    except StatisticsError:
        rho = None
    flips = [[x, y] for i, x in enumerate(tags) for y in tags[i + 1:] if (means_a[x] - means_a[y]) * (means_b[x] - means_b[y]) < 0]
    flips = [pair if means_a[pair[0]] > means_a[pair[1]] else pair[::-1] for pair in flips]
    return {'rankA': rank_a, 'rankB': rank_b, 'spearman': rho, 'flips': flips}


def pair_direction(a: dict, b: dict) -> dict:
    """같은 후보-기준선 짝 비교(rn.paired 결과)가 두 채점에서 같은 방향인가: 평균 차이의 부호가 같으면 True·다르면 False·한쪽이 0(방향 없음)이면 None, 유의(p<0.05) 판정이 같은가."""
    da, db = a['meanDiff'], b['meanDiff']
    return {'a': a, 'b': b, 'sameDirection': None if not da or not db else (da > 0) == (db > 0), 'sigAgree': (a['p'] < ALPHA) == (b['p'] < ALPHA)}


def report(key: str, runs_a: dict[str, list[dict]], runs_b: dict[str, list[dict]], base: str) -> dict:
    """한 세트의 두 채점(runs_x: 실행 이름 → 그 채점으로 채점한 기록)을 비교한다: 모든 실행을 합친 문항별 일치(items)와 실행별 일치(byRun), 지표별 후보 순위(ranking),
    후보마다 기준선(base) 대비 짝 비교 방향의 일치(pairs)."""
    ma, mb = ({tag: rn.metrics_of(key, records) for tag, records in runs.items()} for runs in (runs_a, runs_b))
    tags = [t for t in ma if t in mb]
    names = sorted({m for t in tags for m in ma[t]})
    pooled = lambda m, src: {f'{t}/{i}': v for t in tags for i, v in src[t].get(m, {}).items()}   # noqa: E731
    means = lambda m, src: {t: mean(vs) for t in tags if (vs := [v for v in src[t].get(m, {}).values() if v is not None])}   # noqa: E731
    return {'items': {m: item_agreement(pooled(m, ma), pooled(m, mb)) for m in names},
            'byRun': {t: {m: item_agreement(ma[t].get(m, {}), mb[t].get(m, {})) for m in names} for t in tags},
            'ranking': {m: ranking(means(m, ma), means(m, mb)) for m in names},
            'pairs': {t: {m: pair_direction(rn.paired(ma[t][m], ma[base].get(m, {})), rn.paired(mb[t][m], mb[base].get(m, {}))) for m in names if m in ma[t] and m in mb[t]}
                      for t in tags if t != base}}
