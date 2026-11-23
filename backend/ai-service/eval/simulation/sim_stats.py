"""품질·속도 결과의 집계와 표 출력: 순수 함수. 모델·네트워크 호출이 없다.

질문·응답 본문은 다루지 않는다(점수·횟수·시간·토큰만). 시공간 점수의 유형 비중·Wilson 구간·짝 부호 검정은 eval/novelbrain의 것을 쓴다.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from metrics import wilson_interval  # noqa: E402
from run_timechara import TYPES, WEIGHTS  # noqa: E402
from run_timechara import paired as paired_scores  # noqa: E402


def percentile(values: list[float], p: float) -> float | None:
    """선형 보간 백분위(numpy 기본과 같다). 값이 없으면 None."""
    ordered = sorted(values)
    if not ordered:
        return None
    rank = (len(ordered) - 1) * p / 100
    low = int(rank)
    return ordered[low] + (ordered[min(low + 1, len(ordered) - 1)] - ordered[low]) * (rank - low)


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _times(values: list[float]) -> dict:
    return {'p50': percentile(values, 50), 'p95': percentile(values, 95), 'mean': _mean(values)}


def summarize_speed(scenes: list[dict]) -> dict:
    """속도: 장면 기록 [{id, status, stopReason, turns:[{kind, regenerated}], steps:[{ms, wallMs, modelCalls, inputTokens, outputTokens, usd, calls:[이름]}]}]의 집계.
    턴당 수치는 사용량 장부가 턴마다 남긴 단계(step) 하나가 한 턴이다. ms는 그 턴의 모델 호출 시간 합, wallMs는 턴이 끝난 시각 사이(계산 포함)다."""
    steps = [s for scene in scenes for s in scene['steps']]
    turns = [t for scene in scenes for t in scene['turns']]
    names = sorted({name for s in steps for name in s['calls']})
    outcomes = [scene['status'] if scene['status'] == 'completed' or not scene.get('stopReason') else f"{scene['status']}:{scene['stopReason']}" for scene in scenes]
    return {
        'scenes': len(scenes), 'turns': len(turns), 'steps': len(steps),
        'turnMs': _times([s['ms'] for s in steps]), 'turnWallMs': _times([s['wallMs'] for s in steps]),
        'callsPerTurn': _mean([s['modelCalls'] for s in steps]),
        'callsByName': {name: _mean([s['calls'].count(name) for s in steps]) for name in names},
        'tokensPerTurn': {'in': _mean([s['inputTokens'] for s in steps]), 'out': _mean([s['outputTokens'] for s in steps])},
        'usdPerScene': _mean([sum(s['usd'] for s in scene['steps']) for scene in scenes]),
        'firstPassRate': _mean([t['regenerated'] == 0 for t in turns]), 'meanRegenerations': _mean([t['regenerated'] for t in turns]),
        'outcomes': {kind: outcomes.count(kind) / len(scenes) for kind in dict.fromkeys(outcomes)},
        'unpricedCalls': sum(scene.get('unpriced', 0) for scene in scenes),  # 토큰 사용량을 알려 주지 않아 금액에 0으로 센 호출 수(연출 Decisions 응답이 usage를 안 줄 수 있다)
    }


def _scored(records: list[dict], key: str) -> dict:
    """한 응답(first·final)의 유형별 시공간 점수(0/1 평균·Wilson 구간), 공개 유형 비중의 가중 평균, 성격 평균. 채점하지 못한 응답은 평균에서 뺀다."""
    by_type = {}
    for kind in TYPES:
        scores = [r[key]['score'] for r in records if r['data_type'] == kind and r[key]['score'] is not None]
        if scores:
            by_type[kind] = {'n': len(scores), 'score': sum(scores) / len(scores), 'ci': list(wilson_interval(sum(scores), len(scores)))}
    weight = sum(WEIGHTS[k] for k in by_type)
    personality = [r[key]['personality'] for r in records if r[key]['personality'] is not None]
    return {'by_type': by_type, 'weighted': sum(WEIGHTS[k] * v['score'] for k, v in by_type.items()) / weight if weight else None,
            'personality': _mean(personality), 'personalityN': len(personality)}


def _rate(records: list[dict], key: str) -> dict:
    return {'n': len(records), 'rate': _mean([r[key] for r in records])}


def summarize_quality(records: list[dict]) -> dict:
    """품질: 질문마다 {data_type, attempts, blocked, flagged, leakFlagged, first, final, error}의 집계.
    final은 사용자가 보게 될 응답(재생성 뒤), first는 검사 전 첫 응답이다. 검사의 효과는 첫 응답으로 잰다:
    flaggedRate는 검사가 위반으로 본 비율, catch는 심판이 누설(시공간 0)로 본 첫 응답 중 검사가 걸렀던 비율(leakRate는 그중 누설 항목으로 건 것),
    falseAlarm은 심판이 맞다고 본 첫 응답 중 검사가 걸렀던 비율이다."""
    ok = [r for r in records if not r.get('error')]
    leaked = [r for r in ok if r['first']['score'] == 0]
    fine = [r for r in ok if r['first']['score'] == 1]
    return {
        'n': len(records), 'errors': len(records) - len(ok), 'failedJudge': sum(r['final']['score'] is None for r in ok),
        'final': _scored(ok, 'final'), 'first': _scored(ok, 'first'),
        'flaggedRate': _mean([r['flagged'] for r in ok]),
        'catch': {**_rate(leaked, 'flagged'), 'leakRate': _rate(leaked, 'leakFlagged')['rate']},
        'falseAlarm': _rate(fine, 'flagged'),
        'blockedRate': _mean([r['blocked'] for r in ok]), 'meanRegenerations': _mean([r['attempts'] - 1 for r in ok]),
    }


def paired_quality(by_config: dict[str, list[dict]]) -> dict:
    """같은 질문에서 B와 A의 최종 시공간 점수를 짝지어 센다(B만 맞음·A만 맞음·정확 부호 검정 p). 한쪽이 없거나 채점 못 한 질문은 뺀다."""
    if not {'A', 'B'} <= set(by_config):
        return {}
    rows = [{'idx': r['idx'], 'config': name, 'score': None if r.get('error') else r['final']['score']} for name in ('A', 'B') for r in by_config[name]]
    return {'B|A': paired_scores(rows, 'B', 'A')}


def _f(value, digits: int = 2) -> str:
    return '-' if value is None else f'{value:.{digits}f}'


def _table(head: list[str], rows: list[str]) -> str:
    return '\n'.join(['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head), *rows])


def _rows(results: dict, render) -> list[str]:
    """설정 순서대로 한 줄씩. 다른 설정의 결과를 재사용한 설정은 숫자를 되풀이하지 않고 그렇다고 적는다."""
    lines = []
    for name, summary in results['configs'].items():
        source = results['ranAs'].get(name, name)
        lines.append(f'| {name} | {source}와 같은 실행(이 경로에서 스위치 효과 없음) |' if source != name else f'| {name} | {render(summary)} |')
    return lines


def _quality_cells(s: dict) -> str:
    return ' | '.join([_f(s['final']['weighted']), _f(s['first']['weighted']), _f(s['final']['personality']), _f(s['flaggedRate']),
                       f"{_f(s['catch']['rate'])} (n={s['catch']['n']})", f"{_f(s['falseAlarm']['rate'])} (n={s['falseAlarm']['n']})",
                       _f(s['blockedRate']), _f(s['meanRegenerations'])])


def quality_table(results: dict) -> str:
    """품질 결과(results/quality.json) 표."""
    head = ['설정', '시공간 최종', '시공간 첫 응답', '성격', '검사 위반률', '누설 적발률', '오경보율', '멈춤', '평균 재생성']
    return _table(head, _rows(results, _quality_cells))


def _speed_cells(s: dict) -> str:
    return ' | '.join([_f(s['turnMs']['p50'], 0), _f(s['turnMs']['p95'], 0), _f(s['turnWallMs']['p50'], 0), _f(s['callsPerTurn']),
                       f"{_f(s['tokensPerTurn']['in'], 0)} / {_f(s['tokensPerTurn']['out'], 0)}", _f(s['usdPerScene'], 4), _f(s['firstPassRate']),
                       _f(s['meanRegenerations']), ', '.join(f'{k} {v:.0%}' for k, v in s['outcomes'].items())])


def speed_table(results: dict) -> str:
    """속도 결과(results/speed.json) 표."""
    head = ['설정', '턴 p50 ms', '턴 p95 ms', '턴 p50 벽시계 ms', '호출/턴', '토큰/턴 입력·출력', '$/장면', '한 번에 통과', '평균 재생성', '장면 결말']
    return _table(head, _rows(results, _speed_cells))
