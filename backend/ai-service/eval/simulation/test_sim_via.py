"""sim_via: ocx(로컬 게이트웨이) 어댑터의 입력 변환·429 대기·장부·환경 전환을 가짜 클라이언트로 검사한다. 네트워크 호출 없음."""

from types import SimpleNamespace

import httpx
import openai
import pytest
from pydantic import BaseModel

import sim_via as via
from app.simulation import agent
from cost import CostLog


def rate_limit():
    return openai.RateLimitError('limit', response=httpx.Response(429, request=httpx.Request('POST', 'http://gateway/v1/responses')), body=None)


class FakeResponses:
    def __init__(self, failures=0, error=None):
        self.calls, self.failures, self.error = [], failures, error

    def _answer(self, method, options):
        self.calls.append((method, options))
        if self.failures:
            self.failures -= 1
            raise (self.error or rate_limit())
        return 'ok'

    def create(self, **options):
        return self._answer('create', options)

    def parse(self, **options):
        return self._answer('parse', options)


class FakeOpenAI:
    def __init__(self, responses):
        self.responses = responses


def test_a_string_input_becomes_a_message_list_and_store_model_are_forced_without_touching_the_original():
    original = {'model': 'gpt-5.6-luna', 'store': True, 'input': '질문', 'instructions': '지시', 'max_output_tokens': 10, 'text_format': dict}
    adapted = via.adapt(original)
    assert adapted == {'model': via.MODEL, 'store': False, 'input': [{'role': 'user', 'content': '질문'}], 'instructions': '지시', 'max_output_tokens': 10, 'text_format': dict}
    assert original['store'] is True and original['input'] == '질문' and original['model'] == 'gpt-5.6-luna'
    messages = [{'role': 'user', 'content': '이미 목록'}]
    assert via.adapt({'input': messages})['input'] is messages


def test_create_and_parse_send_the_adapted_options_to_the_gateway_client():
    inner = FakeResponses()
    client = via.Client(FakeOpenAI(inner))
    assert client.responses.parse(model='gpt-5.6-luna', input='a', text_format=dict) == 'ok' and client.responses.create(model='m', input='b') == 'ok'
    assert [(m, o['input'], o['store'], o['model']) for m, o in inner.calls] == [('parse', [{'role': 'user', 'content': 'a'}], False, via.MODEL), ('create', [{'role': 'user', 'content': 'b'}], False, via.MODEL)]


def test_a_rate_limit_waits_with_growing_delays_and_then_succeeds_or_gives_up_after_ten_minutes():
    waits = []
    inner = FakeResponses(failures=2)
    assert via.Client(FakeOpenAI(inner), waits.append).responses.parse(input='x') == 'ok' and waits == [15, 30] and len(inner.calls) == 3
    waits.clear()
    endless = FakeResponses(failures=99)
    with pytest.raises(openai.RateLimitError):
        via.Client(FakeOpenAI(endless), waits.append).responses.parse(input='x')
    assert waits == list(via.WAITS) and sum(waits) < 600 and len(endless.calls) == len(via.WAITS) + 1


def test_errors_other_than_a_rate_limit_are_not_retried():
    inner = FakeResponses(failures=1, error=openai.APIConnectionError(request=httpx.Request('POST', 'http://gateway')))
    waits = []
    with pytest.raises(openai.APIConnectionError):
        via.Client(FakeOpenAI(inner), waits.append).responses.create(input='x')
    assert waits == [] and len(inner.calls) == 1


def test_ocx_rows_cost_nothing_and_say_via_so_the_openai_total_and_cap_ignore_them(tmp_path):
    path = tmp_path / 'cost.jsonl'
    paid, free = CostLog(path), via.OcxCostLog(path)
    paid.record('a', 100_000, 0)   # 입력 10만 토큰 = $0.02
    assert free.record('b', 5_000_000, 5_000_000, chars=7) == 0.0
    rows = paid.rows()
    assert 'via' not in rows[0] and rows[1] == {**rows[1], 'usd': 0.0, 'via': 'ocx', 'in': 5_000_000, 'out': 5_000_000, 'chars': 7}
    assert round(paid.spent(), 6) == round(free.spent(), 6) == 0.02
    assert paid.summary()['b']['usd'] == 0 and paid.summary()['b']['in'] == 5_000_000   # 토큰은 남는다


def test_the_ocx_llm_keeps_the_openai_cache_key_but_sends_the_gateway_model_and_has_no_cap(tmp_path):
    llm = via.ocx_llm(tmp_path / 'cache', tmp_path / 'cost.jsonl')
    assert llm.via == 'ocx' and llm.model == 'gpt-5.6-luna' and llm.limit_usd is None and isinstance(llm.client, via.Client)
    assert llm.client._inner.base_url.host == '127.0.0.1' and llm.client._inner.base_url.port == 10100


def test_switching_to_ocx_changes_this_process_only_and_hands_the_simulation_agent_the_gateway_chat(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-real')
    monkeypatch.setenv('OPENAI_BASE_URL', 'https://api.openai.com/v1')
    monkeypatch.setattr(agent, 'ChatOpenAI', agent.ChatOpenAI)   # 테스트가 끝나면 원래 클래스로 되돌린다
    via.use_ocx()
    import os
    assert os.environ['OPENAI_BASE_URL'] == via.GATEWAY and os.environ['OPENAI_API_KEY'] == 'ocx' and agent.ChatOpenAI is via.chat


def fake_chat(monkeypatch, invoke):
    """sim_via가 만드는 ChatOpenAI 대역: 만든 인자를 목록에 모으고 구조화 출력의 invoke는 주어진 함수다."""
    made = []
    monkeypatch.setattr(via, 'ChatOpenAI', lambda **options: made.append(options) or SimpleNamespace(with_structured_output=lambda schema, **kwargs: SimpleNamespace(invoke=invoke)))
    return made


def test_the_ocx_chat_sends_the_gateway_address_model_and_key_whatever_the_service_asked_for(monkeypatch):
    made = fake_chat(monkeypatch, lambda messages: 'ok')
    chat = via.chat(model='gpt-5.6-luna', api_key='sk-real', base_url='https://api.openai.com/v1', store=False, max_tokens=5, reasoning={'effort': 'low'})
    assert chat.with_structured_output(dict, include_raw=True).invoke(['m']) == 'ok'
    assert made == [{'model': via.MODEL, 'api_key': 'ocx', 'base_url': via.GATEWAY, 'store': False, 'max_tokens': 5, 'reasoning': {'effort': 'low'}}]


def test_the_ocx_chat_waits_out_a_rate_limit_like_the_judge_client_and_does_not_retry_other_errors(monkeypatch):
    outcomes, waits, asked = [rate_limit(), rate_limit(), 'ok'], [], []

    def invoke(messages):
        asked.append(messages)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    fake_chat(monkeypatch, invoke)
    structured = via.chat(wait=waits.append, model='m').with_structured_output(dict)
    assert structured.invoke(['x']) == 'ok' and waits == [15, 30] and asked == [['x']] * 3
    outcomes[:] = [openai.APIConnectionError(request=httpx.Request('POST', 'http://gateway'))]
    waits.clear()
    with pytest.raises(openai.APIConnectionError):
        structured.invoke(['x'])
    assert waits == []
    outcomes[:] = [rate_limit() for _ in range(len(via.WAITS) + 1)]
    with pytest.raises(openai.RateLimitError):
        structured.invoke(['x'])
    assert waits == list(via.WAITS) and sum(waits) < 600   # 10분 안에 포기하고 그 오류를 올린다



class Out(BaseModel):
    answer: str


class ParsedResponses(FakeResponses):
    """Llm._call이 읽는 모양(status·output_parsed·usage·model)의 응답을 돌려주는 가짜."""

    def _answer(self, method, options):
        self.calls.append((method, options))
        return SimpleNamespace(status='completed', output_parsed=Out(answer='ok'), usage=SimpleNamespace(input_tokens=10, output_tokens=2, input_tokens_details=None), model=options['model'])


def test_adapt_and_the_client_send_the_chosen_gateway_model_instead_of_the_default():
    assert via.adapt({'input': 'x', 'model': 'gpt-5.6-luna'}, 'gpt-6.2-sol')['model'] == 'gpt-6.2-sol' and via.adapt({'input': 'x'})['model'] == via.MODEL
    inner = FakeResponses()
    via.Client(FakeOpenAI(inner), model='gpt-6.2-sol').responses.parse(model='gpt-5.6-luna', input='a')
    assert inner.calls[0][1]['model'] == 'gpt-6.2-sol'


def test_a_judge_model_is_sent_keyed_in_the_cache_and_written_to_the_ledger(tmp_path, monkeypatch):
    inner = ParsedResponses()
    monkeypatch.setattr(via.openai, 'OpenAI', lambda **options: FakeOpenAI(inner))
    sol = via.ocx_llm(tmp_path / 'cache', tmp_path / 'cost.jsonl', 'gpt-6.2-sol')
    assert sol.model == 'gpt-6.2-sol' and sol.ask('judge', '지시', '입력', schema=Out).answer == 'ok'
    assert inner.calls[0][1]['model'] == 'gpt-6.2-sol'
    luna = via.ocx_llm(tmp_path / 'cache', tmp_path / 'cost.jsonl')   # 같은 캐시 폴더여도 다른 모델의 답을 재사용하지 않는다
    assert sol.is_cached('지시', '입력', schema=Out) and not luna.is_cached('지시', '입력', schema=Out)
    assert luna.ask('judge', '지시', '입력', schema=Out).answer == 'ok' and inner.calls[1][1]['model'] == via.MODEL and len(inner.calls) == 2
    assert [(r['model'], r['via'], r['usd']) for r in CostLog(tmp_path / 'cost.jsonl').rows()] == [('gpt-6.2-sol', 'ocx', 0.0), (via.MODEL, 'ocx', 0.0)]
