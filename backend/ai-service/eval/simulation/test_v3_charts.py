"""v3 보고서 그림이 읽는 값(v3_charts): 결과 집계 JSON에서 버전별 ①·후보 판정 점·장면 속도·비용 구성을 뽑는 순수 함수만 확인한다(그림은 그리지 않는다)."""

import pytest

import v3_charts as c


def entry(voice, intent, p50, p95, usd, diff=None):
    summary = {'voice': {'mean': voice}, 'intent': {'mean': intent}, 'callMs': {'p50': p50, 'p95': p95}, 'usdPerCall': usd}
    return {'summary': summary, **({'vsBase': {'metrics': {'voice': {'meanDiff': diff}}}} if diff is not None else {})}


SUMMARY = {'base': 'base2', 'sets': {'1': {
    'A': entry(3.07, 2.30, 5200, 8000, 0.0018, 0.08), 'base2': entry(2.99, 2.24, 2400, 4500, 0.0015), 'P1': entry(3.07, 2.23, 2100, 3200, 0.0015, 0.08), 'P1+M1': entry(3.28, 2.53, 2800, 4300, 0.0073, 0.30),
    **{tag: entry(3.0, 2.2, 3000, 5000, 0.002, 0.01) for tag in ('E1', 'E2', 'P1+E1', 'P1b', 'V1', 'V3', 'V5')}}}}


def test_version_rows_follow_v1_v2_v2_with_p1_and_v3_in_seconds():
    rows = c.version_rows(SUMMARY)
    assert [r['label'] for r in rows] == ['v1', 'v2', 'v2+P1', 'v3']
    assert rows[3] == {'label': 'v3', 'voice': 3.28, 'intent': 2.53, 'actP50': 2.8, 'actP95': 4.3, 'usdPerCall': 0.0073}   # 지연은 밀리초 → 초


def test_candidate_points_mark_only_p1_and_the_act_terra_as_adopted_and_compare_each_with_its_own_base():
    points = {p['tag']: p for p in c.candidate_points(SUMMARY)}
    assert {tag for tag, p in points.items() if p['adopted']} == {'P1', 'P1+M1'} and set(points) >= {'E1', 'E2', 'V1', 'V3', 'V5', 'P1b', 'P1+E1'}
    assert points['P1+M1']['dLatency'] == pytest.approx(0.4) and points['P1+M1']['dVoice'] == pytest.approx(0.29) and points['E1']['dLatency'] == pytest.approx(0.6)   # v2(base2)와 견준다
    assert points['V1']['base'] == 'A' and points['V1']['dLatency'] == pytest.approx(-2.2) and points['V1']['dVoice'] == pytest.approx(-0.07)   # V1·V3·V5는 v1 요청(A)으로 만든 실행이라 A와 견준다


def test_scene_rows_read_speed_and_the_cost_per_scene_by_call_kind():
    runs = {'orig-hp-scenes-base': {'speed': {'scenes': 4, 'turns': 20, 'turnMs': {'p50': 5000.0, 'p95': 11000.0}, 'usdPerScene': 0.03}, 'byCall': {'act': {'usd': 0.04}, 'check': {'usd': 0.08}}}}
    rows = c.scene_rows(runs.__getitem__, (('v2', 'base'),))
    assert rows == [{'label': 'v2', 'scenes': 4, 'turnP50': 5.0, 'turnP95': 11.0, 'usdPerScene': 0.03, 'perScene': {'act': 0.01, 'check': 0.02}}]   # 호출 종류별 금액은 장면 수로 나눈다
    runs['orig-hp-scenes-old'] = {'speed': runs['orig-hp-scenes-base']['speed']}   # 옛 기록은 호출 종류별 합계가 없어 장면당 합계만 있다
    assert c.scene_rows(runs.__getitem__, (('old', 'old'),))[0]['perScene'] is None
