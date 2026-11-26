"""KoTimeChara 실행 공용 단위 테스트: 응답 모델 단가표·게이트웨이 Llm 생성·Batch 제한(호출 없음)."""

import hashlib
import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

import kt_exec


def test_gen_rate_finds_the_price_by_the_name_after_the_last_slash_and_counts_cached_input_as_input():
    assert kt_exec.gen_rate('gemini-3.8-flash') == (0.825, 0.825, 4.125)                                        # OpenRouter 일반 경로
    assert kt_exec.gen_rate('google/gemini-3.8-flash') == kt_exec.gen_rate('gemini-3.8-flash')
    assert kt_exec.gen_rate('anthropic-apikey/claude-haiku-5-5') == (0.10, 0.10, 0.50)
    assert kt_exec.gen_rate('gemini-4-argon') == (2.00, 2.00, 10.00) and kt_exec.gen_rate('claude-sonnet-5-5') == (2.00, 2.00, 10.00)
    assert kt_exec.gen_rate('gpt-6-luna') == (0.05, 0.05, 0.25) and kt_exec.gen_rate('gpt-6.1-terra') == (0.50, 0.50, 2.50)      # 구독 경로: 정가 환산 단가


def test_a_batch_id_is_priced_by_its_own_row_first_and_any_other_tail_falls_back_to_the_name_without_it():
    assert kt_exec.gen_rate('openrouter/google/gemini-3.8-flash:batch') == (0.375, 0.375, 1.875)      # 게이트웨이의 실제 Gemini id는 :batch 행의 단가로 센다
    assert kt_exec.gen_rate('openrouter/google/gemini-4-argon:batch') == (1.00, 1.00, 5.00)
    assert kt_exec.gen_rate('openrouter/google/gemini-3.8-flash:thinking') == kt_exec.gen_rate('gemini-3.8-flash')   # 표에 없는 꼬리는 꼬리를 뗀 이름의 행


@pytest.mark.parametrize('model', ['gpt-5.6-luna', 'google/mystery-1', 'openrouter/google/mystery-1:batch', 'gemini-3.8-flash-lite', 'gemini-3.8-flash/', ':batch', ''])
def test_a_model_missing_from_the_price_table_stops_instead_of_being_counted_as_free_or_as_luna(model):
    with pytest.raises(SystemExit):
        kt_exec.gen_rate(model)


def test_the_gen_llm_needs_a_cap_and_a_price_before_anything_is_built(tmp_path, monkeypatch):
    monkeypatch.setattr(kt_exec, 'KT', tmp_path / 'kt')
    with pytest.raises(SystemExit):
        kt_exec.make_gen_llm('gemini-3.8-flash', 'g', None)
    with pytest.raises(SystemExit):
        kt_exec.make_gen_llm('mystery-1', 'g', 5.0)
    assert not (tmp_path / 'kt').exists()                                       # 폴더도 장부도 만들지 않았다


@pytest.mark.parametrize('limit', [float('nan'), float('inf'), 0.0, -1.0])
def test_a_cap_that_can_never_stop_a_call_is_refused_before_anything_is_built(limit, tmp_path, monkeypatch):
    monkeypatch.setattr(kt_exec, 'KT', tmp_path / 'kt')
    with pytest.raises(SystemExit):
        kt_exec.make_gen_llm('gemini-3.8-flash', 'g', limit)
    with pytest.raises(SystemExit):
        kt_exec.make_llm(tmp_path / 'cache', tmp_path / 'cost.jsonl', limit)
    assert not (tmp_path / 'kt').exists() and not (tmp_path / 'cache').exists()                                         # nan·inf는 비교식이 늘 거짓이라 상한이 안 걸린다


def test_the_gen_llm_calls_the_gateway_with_its_own_cache_and_a_ledger_priced_by_the_table(tmp_path, monkeypatch):
    monkeypatch.setattr(kt_exec, 'KT', tmp_path / 'kt')
    gateway_id = 'openrouter/google/gemini-3.8-flash'
    llm = kt_exec.make_gen_llm(gateway_id, 'g1', 5.0)
    assert (llm.model, llm.via, llm.limit_usd, llm.cache_dir) == (gateway_id, 'ocx', 5.0, tmp_path / 'kt' / 'cache-g1')
    assert llm.client._inner.base_url.host == '127.0.0.1' and llm.client._inner.base_url.port == 10100 and llm.client.responses._model == gateway_id
    assert llm.cost.record('gen', 1_000_000, 1_000_000, cached=500_000) == pytest.approx(0.825 + 4.125)      # 일반 경로 행의 단가, 캐시 입력도 입력 단가(상한 쪽 어림)
    (row,) = llm.cost.rows()
    assert row['model'] == gateway_id and llm.cost.path == tmp_path / 'kt' / 'cost-g1.jsonl' and 'via' not in row


@pytest.mark.parametrize('effort,expected', [(None, 180), ('minimal', 180), ('low', 180), ('medium', 600), ('high', 600), ('max', 600)])
def test_the_gateway_timeout_is_longer_for_higher_reasoning_efforts(effort, expected, tmp_path, monkeypatch):
    import sim_via
    seen = {}
    monkeypatch.setattr(kt_exec, 'KT', tmp_path / 'kt')
    monkeypatch.setattr(sim_via, 'client', lambda model, **options: seen.update(options) or Recorder())
    kt_exec.make_gen_llm('gpt-6-luna', 'g', 5.0, effort)
    assert seen['timeout'] == expected                                                  # 생각이 긴 호출이 180초 안에 끝나지 않아 실패로 세지 않게


def test_the_judge_llm_is_a_gateway_model_with_a_cache_per_judge_and_a_free_ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(kt_exec, 'KT', tmp_path / 'kt')
    cost = tmp_path / 'kt' / 'cost-g1.jsonl'
    llm = kt_exec.make_judge_llm('gpt-6.2-sol', cost)
    assert (llm.model, llm.via, llm.limit_usd, llm.cache_dir) == ('gpt-6.2-sol', 'ocx', None, tmp_path / 'kt' / 'cache-judge-gpt-6.2-sol')
    assert llm.cost.record('judge', 5_000_000, 5_000_000) == 0.0 and llm.cost.rows()[0]['via'] == 'ocx'
    assert kt_exec.make_judge_llm('anthropic-apikey/some-judge', cost).cache_dir == tmp_path / 'kt' / 'cache-judge-some-judge'


class Recorder:
    """sim_via.client 대역: 받은 Responses 호출 인자를 모으고 완성된 응답을 돌려준다(게이트웨이를 부르지 않는다)."""

    def __init__(self):
        self.options = []
        self.responses = SimpleNamespace(create=self._create, parse=self._parse)

    def _create(self, **options):
        self.options.append(options)
        return SimpleNamespace(status='completed', usage=SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=None), model='m', output_text='응답')

    def _parse(self, **options):
        self.options.append(options)
        return SimpleNamespace(status='completed', usage=SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=None), model='m',
                               output_parsed=options['text_format'](value=7))


@pytest.fixture
def clients(tmp_path, monkeypatch):
    """sim_via.client가 만들 때마다 새 Recorder를 돌려주게 하고(만든 순서대로 목록에 쌓인다) KT를 임시 폴더로 옮긴다."""
    import sim_via

    made = []
    monkeypatch.setattr(kt_exec, 'KT', tmp_path / 'kt')
    monkeypatch.setattr(sim_via, 'client', lambda model, **kw: made.append(Recorder()) or made[-1])
    return made


GEMINI = 'openrouter/google/gemini-3.8-flash'
SENT = {'model': GEMINI, 'store': False, 'max_output_tokens': 3000, 'instructions': 'sys', 'input': 'q'}


def test_gen_effort_goes_only_into_the_gen_request_and_every_other_request_stays_exactly_as_before(clients, tmp_path):
    plain, low, high = (kt_exec.make_gen_llm(GEMINI, tag, 5.0, effort) for tag, effort in (('p', None), ('l', 'low'), ('h', 'high')))
    judge = kt_exec.make_judge_llm('gpt-6.2-sol', tmp_path / 'kt' / 'cost-l.jsonl')
    for llm, kind in ((plain, 'gen'), (low, 'gen'), (high, 'gen'), (judge, 'judge')):
        assert llm.ask(kind, 'sys', 'q', max_output_tokens=3000) == '응답'
    assert [c.options for c in clients] == [[SENT],                                                       # 옵션 없는 응답: reasoning 없이 예전 그대로
                                            [{**SENT, 'reasoning': {'effort': 'low'}}], [{**SENT, 'reasoning': {'effort': 'high'}}],   # 요청의 model은 게이트웨이 id 그대로
                                            [{**SENT, 'model': 'gpt-6.2-sol'}]]                           # 채점 요청에는 강도가 없다


def test_gen_effort_is_part_of_the_cache_key_and_the_model_name_in_the_ledger(clients):
    plain, low, high = (kt_exec.make_gen_llm(GEMINI, 'g', 5.0, effort) for effort in (None, 'low', 'high'))
    assert (plain.model, low.model, high.model) == (GEMINI, GEMINI + '@low', GEMINI + '@high')
    assert len({llm._path('sys', 'q', None, 3000).stem for llm in (plain, low, high)}) == 3      # 강도가 다른 응답은 같은 캐시 열쇠를 쓰지 않는다
    assert plain._path('sys', 'q', None, 3000).stem == hashlib.sha256(json.dumps([GEMINI, 'sys', 'q', None, 3000], ensure_ascii=False).encode()).hexdigest()   # 옵션 없는 실행의 열쇠는 그대로
    low.ask('gen', 'sys', 'q', max_output_tokens=3000)
    (row,) = low.cost.rows()
    assert row['model'] == GEMINI + '@low' and row['usd'] == pytest.approx((10 * 0.825 + 5 * 4.125) / 1e6)   # 장부에도 강도가 든 이름, 단가는 강도 없는 모델 행


class Pick(BaseModel):
    value: int


def test_gen_effort_also_goes_into_a_structured_request_and_the_plain_structured_request_stays_as_before(clients, tmp_path):
    plain, low = (kt_exec.make_gen_llm(GEMINI, tag, 5.0, effort) for tag, effort in (('p', None), ('l', 'low')))
    assert plain.ask('gen', 'sys', 'q', schema=Pick, max_output_tokens=3000) == Pick(value=7)
    assert low.ask('gen', 'sys', 'q', schema=Pick, max_output_tokens=3000) == Pick(value=7)
    assert clients[0].options == [{**SENT, 'text_format': Pick}]                                   # 옵션 없는 구조화 요청: reasoning 없이 그대로
    assert clients[1].options == [{**SENT, 'text_format': Pick, 'reasoning': {'effort': 'low'}}]    # 강도는 구조화(parse) 요청에도 붙고 model은 게이트웨이 id 그대로
