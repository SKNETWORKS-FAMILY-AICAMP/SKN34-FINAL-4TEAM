"""공통 모듈 단위 테스트: OpenAI 응답 사용량 읽기, 비용 장부 상한, HTTP 계측(호출 없이 httpx MockTransport)."""

import httpx
import pytest

import common as c


def test_usage_is_read_from_responses_chat_and_decisions_shapes():
    assert c.usage_of({'usage': {'input_tokens': 100, 'output_tokens': 20, 'input_tokens_details': {'cached_tokens': 40}}}) == (100, 20, 40)
    assert c.usage_of({'usage': {'prompt_tokens': 50, 'completion_tokens': 5, 'prompt_tokens_details': {'cached_tokens': 0}}}) == (50, 5, 0)
    assert c.usage_of({'usage': {'input_tokens': 7, 'output_tokens': 1}}) == (7, 1, 0)
    assert c.usage_of({'results': []}) == (0, 0, 0)


def test_ledger_prices_calls_and_refuses_once_the_limit_is_reached(tmp_path):
    ledger = c.Ledger(tmp_path / 'cost.jsonl', limit=0.001)
    cost = ledger.charge((1000, 100, 0), 'gpt-6-luna', 'responses')
    assert cost == pytest.approx((1000 * 0.20 + 100 * 1.20) / 1_000_000)
    ledger.check()
    ledger.charge((10_000, 0, 0), 'gpt-6-luna', 'responses')
    with pytest.raises(c.BudgetExceeded):
        ledger.check()
    assert c.Ledger(tmp_path / 'cost.jsonl', limit=1).spent() == pytest.approx(ledger.spent())


def test_openai_http_calls_are_metered_and_other_hosts_are_not(tmp_path):
    ledger = c.Ledger(tmp_path / 'cost.jsonl', limit=1)
    body = {'model': 'gpt-6-luna', 'usage': {'input_tokens': 10, 'output_tokens': 2}}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    with c.metered(ledger):
        with httpx.Client(transport=transport) as client:
            client.post('https://api.openai.com/v1/responses', json={})
            client.get('http://127.0.0.1:8081/health')
    assert [(r['in'], r['out'], r['model']) for r in ledger.rows()] == [(10, 2, 'gpt-6-luna')]


def test_metered_calls_stop_before_sending_when_over_budget(tmp_path):
    ledger = c.Ledger(tmp_path / 'cost.jsonl', limit=0)
    sent = []
    transport = httpx.MockTransport(lambda request: sent.append(1) or httpx.Response(200, json={}))
    with c.metered(ledger), httpx.Client(transport=transport) as client, pytest.raises(c.BudgetExceeded):
        client.post('https://api.openai.com/v1/responses', json={})
    assert sent == []


def test_openai_sdk_transport_httpx2_is_metered_too(tmp_path):
    httpx2 = pytest.importorskip('httpx2')
    ledger = c.Ledger(tmp_path / 'cost.jsonl', limit=1)
    transport = httpx2.MockTransport(lambda request: httpx2.Response(200, json={'model': 'm', 'usage': {'input_tokens': 3, 'output_tokens': 1}}))
    with c.metered(ledger), httpx2.Client(transport=transport) as client:
        client.post('https://api.openai.com/v1/decisions', json={})
    assert [(r['kind'], r['in']) for r in ledger.rows()] == [('decisions', 3)]
