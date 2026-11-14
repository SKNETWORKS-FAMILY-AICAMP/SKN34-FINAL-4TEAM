"""OpenAI 호출 장부(상한)·캐시·재시도 단위 테스트. 실제 네트워크·키를 쓰지 않고 대역 클라이언트를 쓴다."""

import threading
import time
from types import SimpleNamespace

import httpx
import openai
import pytest
from pydantic import BaseModel

from llm import CallCapExceeded, Ledger, Llm, LlmFailure


class Fake:
    """responses.create/parse를 흉내 내는 대역. 앞 failures개는 일시 오류를 던진다."""

    def __init__(self, failures=0, status='completed', delay=0.0):
        self.calls, self.failures, self.status, self.delay = 0, failures, status, delay
        self.responses = SimpleNamespace(create=self._create, parse=self._parse)

    def _result(self, **extra):
        time.sleep(self.delay)
        self.calls += 1
        if self.calls <= self.failures:
            raise openai.APIConnectionError(request=httpx.Request('POST', 'http://x'))
        return SimpleNamespace(status=self.status, usage=SimpleNamespace(input_tokens=3, output_tokens=4),
                               model='m', id='r', **extra)

    def _create(self, **kw):
        return self._result(output_text=f'answer-{self.calls + 1}')

    def _parse(self, **kw):
        return self._result(output_parsed=kw['text_format'](value=self.calls + 1))


class Out(BaseModel):
    value: int


def make(tmp_path, cap=100, **fake):
    client = Fake(**fake)
    return Llm(Ledger(tmp_path / 'ledger.jsonl', cap), tmp_path / 'cache', model='m', client=client, backoff=0), client


def test_ledger_stops_at_cap_and_persists_across_instances(tmp_path):
    path = tmp_path / 'ledger.jsonl'
    ledger = Ledger(path, cap=2)
    ledger.charge('a')
    ledger.charge('b')
    with pytest.raises(CallCapExceeded):
        ledger.charge('c')
    assert Ledger(path, cap=2).used() == 2
    with pytest.raises(CallCapExceeded):
        Ledger(path, cap=2).charge('d')


def test_ledger_is_exact_under_threads(tmp_path):
    ledger = Ledger(tmp_path / 'ledger.jsonl', cap=30)
    refused = []

    def work():
        try:
            ledger.charge('x')
        except CallCapExceeded:
            refused.append(1)

    threads = [threading.Thread(target=work) for _ in range(50)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert ledger.used() == 30 and len(refused) == 20
    assert len((tmp_path / 'ledger.jsonl').read_text().splitlines()) == 30


def test_same_request_is_served_from_cache_without_charge(tmp_path):
    llm, client = make(tmp_path)
    assert llm.ask('k', 'ins', 'in') == 'answer-1'
    assert llm.ask('k', 'ins', 'in') == 'answer-1'
    assert client.calls == 1 and llm.ledger.used() == 1
    assert llm.ask('k', 'ins', 'other input') == 'answer-2'
    assert llm.ledger.used() == 2


def test_structured_result_round_trips_through_cache(tmp_path):
    llm, client = make(tmp_path)
    first = llm.ask('k', 'ins', 'in', schema=Out)
    again = llm.ask('k', 'ins', 'in', schema=Out)
    assert first == again == Out(value=1)
    assert client.calls == 1


def test_transient_errors_are_retried_and_every_attempt_is_charged(tmp_path):
    llm, client = make(tmp_path, failures=2)
    assert llm.ask('k', 'ins', 'in') == 'answer-3'
    assert llm.ledger.used() == 3


def test_gives_up_after_attempts_and_still_counts_them(tmp_path):
    llm, client = make(tmp_path, failures=10)
    with pytest.raises(LlmFailure):
        llm.ask('k', 'ins', 'in')
    assert llm.ledger.used() == 3  # attempts=3, 모두 장부에 남는다


def test_incomplete_response_is_a_failure_and_is_not_cached(tmp_path):
    llm, client = make(tmp_path, status='incomplete')
    with pytest.raises(LlmFailure):
        llm.ask('k', 'ins', 'in')
    assert llm.ledger.used() == 1
    client.status = 'completed'
    assert llm.ask('k', 'ins', 'in').startswith('answer-')


def test_cap_blocks_before_the_provider_is_called(tmp_path):
    llm, client = make(tmp_path, cap=1)
    llm.ask('k', 'ins', 'a')
    with pytest.raises(CallCapExceeded):
        llm.ask('k', 'ins', 'b')
    assert client.calls == 1


def test_concurrent_identical_requests_call_the_provider_once(tmp_path):
    # 같은 요청을 동시에 보내면 하나만 호출하고 나머지는 그 응답을 읽는다(둘 다 부르면 호출이 낭비되고 캐시에 마지막 응답만 남아 재현이 어긋난다).
    llm, client = make(tmp_path, delay=0.05)
    results = []
    threads = [threading.Thread(target=lambda: results.append(llm.ask('k', 'ins', 'same'))) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert client.calls == 1 and llm.ledger.used() == 1 and len(set(results)) == 1 and len(results) == 8


def test_is_cached_tells_whether_a_request_would_call_the_provider(tmp_path):
    llm, client = make(tmp_path)
    assert not llm.is_cached('ins', 'in')
    llm.ask('k', 'ins', 'in')
    assert llm.is_cached('ins', 'in') and not llm.is_cached('ins', 'other')
    assert not llm.is_cached('ins', 'in', schema=Out)  # 같은 입력이라도 구조화 요청은 다른 요청이다
