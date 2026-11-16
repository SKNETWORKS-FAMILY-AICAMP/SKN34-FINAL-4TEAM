"""비용 장부 단위 테스트: 단가 계산(캐시·Batch·긴 입력)과 호출 기록의 합계."""

import threading

import pytest

from cost import CostLog, calibrate, request_usd, usd


def test_usd_uses_the_official_prices_per_million_tokens():
    assert usd(1_000_000, 0) == pytest.approx(0.20)
    assert usd(0, 1_000_000) == pytest.approx(1.20)
    # 이전 실행(입력 2,295,259·출력 1,483,197 토큰)의 추정 실비 약 $2.24
    assert usd(2_295_259, 1_483_197) == pytest.approx(2.24, abs=0.01)


def test_cached_input_is_billed_at_the_cached_price_and_batch_is_half():
    assert usd(1_000_000, 0, cached=1_000_000) == pytest.approx(0.02)
    assert usd(1_000_000, 0, cached=400_000) == pytest.approx(0.6 * 0.20 + 0.4 * 0.02)
    assert usd(1_000_000, 1_000_000, batch=True) == pytest.approx(0.5 * (0.20 + 1.20))


def test_requests_with_more_than_272k_input_tokens_cost_double_input_and_one_and_a_half_output():
    assert request_usd(300_000, 1_000) == pytest.approx(2 * 0.20 * 0.3 + 1.5 * 1.20 * 0.001)
    assert request_usd(272_000, 0) == pytest.approx(0.20 * 0.272)            # 272K 이하는 그대로
    assert request_usd(300_000, 0, batch=True) == pytest.approx(0.5 * 2 * 0.20 * 0.3)
    assert usd(1_000_000, 0) == pytest.approx(0.20)                           # 합계 계산에는 할증이 없다


def test_cost_log_sums_by_kind_and_persists(tmp_path):
    log = CostLog(tmp_path / 'cost.jsonl')
    log.record('gen', 1000, 500)
    log.record('judge', 2000, 800, cached=1000, batch=True)
    log.record('gen', 1000, 500, failed=True)  # 잘린 응답도 청구되므로 센다
    total = request_usd(1000, 500) * 2 + request_usd(2000, 800, cached=1000, batch=True)
    assert log.spent() == pytest.approx(total)
    assert CostLog(tmp_path / 'cost.jsonl').spent() == pytest.approx(total)   # 다른 인스턴스(재실행)도 같은 합계
    summary = log.summary()
    assert summary['gen'] == {'calls': 2, 'in': 2000, 'out': 1000, 'usd': pytest.approx(request_usd(1000, 500) * 2), 'failed': 1, 'batch': 0,
                              'chars': 0}
    assert summary['judge']['batch'] == 1


def test_cost_log_is_exact_under_threads(tmp_path):
    log = CostLog(tmp_path / 'cost.jsonl')
    threads = [threading.Thread(target=lambda: log.record('x', 100, 100)) for _ in range(40)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert log.spent() == pytest.approx(40 * request_usd(100, 100))
    assert len((tmp_path / 'cost.jsonl').read_text().splitlines()) == 40


def test_calibrate_measures_chars_per_token_and_output_per_call_from_the_ledger(tmp_path):
    log = CostLog(tmp_path / 'cost.jsonl')
    log.record('label', 1000, 400, chars=1600)
    log.record('label', 3000, 600, chars=4400, batch=True)
    log.record('judge', 500, 300)                       # 글자 수가 없는 줄은 비 계산에서 뺀다
    ratio, out = calibrate(log.summary())
    assert ratio == pytest.approx(6000 / 4000) and out == {'label': 500, 'judge': 300}
    assert calibrate({})[0] == 1.5
