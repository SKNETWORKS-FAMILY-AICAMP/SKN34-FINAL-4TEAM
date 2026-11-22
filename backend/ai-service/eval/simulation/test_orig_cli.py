"""평가 실행기(orig_cli): act 제공사(SIMULATION_ACT_*) 실행이 OpenAI 장부와 따로 세고 단가·표기를 남기는 것을 가짜 문항·가짜 평가로 확인한다. 호출 없음."""

import argparse
import json
from types import SimpleNamespace

import pytest

import orig_cli as oc
import orig_run as rn
import orig_variants as ov
import sim_via

ACT_ENV = {'SIMULATION_ACT_BASE_URL': 'https://hemmingway.io/v1', 'SIMULATION_ACT_API_KEY': 'hem-key', 'SIMULATION_ACT_MODEL': 'hemmingway-1', 'SIMULATION_ACT_THINKING': 'off'}
ACT = {'provider': 'hemmingway.io', 'model': 'hemmingway-1', 'thinking': 'off'}
ITEMS = [{'id': 'hp-1-0001', 'base': 1}, {'id': 'hp-1-0002', 'base': 2}]
JUDGES = []   # sim_via.ocx_llm 대역이 받은 (캐시 폴더, 장부, 채점 모델)


def args(**changes):
    return argparse.Namespace(**{'corpus': 'hp', 'dev': False, 'sets': '1', 'limit': None, 'limit_usd': 5.0, 'judge': 'ocx', 'judge_model': 'gpt-6-luna', 'via': 'openai',
                                 'variant': 'P1', 'tag': 'H1', 'workers': 1, **changes})


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


@pytest.fixture
def home(tmp_path, monkeypatch):
    """cmd_run의 바깥(문항·세계관·채점·모델 호출)을 가짜로 두고 장부·기록·집계 경로를 임시 폴더로 바꾼다. 평가 대역은 act 호출 하나(입력 1,000·출력 100토큰)를 settle로 장부에 남긴다."""
    for name in (*ACT_ENV, 'SIMULATION_ACT_BASE_URL'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-6-luna')
    monkeypatch.setattr(oc, 'ORIG', tmp_path / 'orig')
    monkeypatch.setattr(oc, 'COST', tmp_path / 'cost-orig.jsonl')
    monkeypatch.setattr(oc, 'COST_ACT', tmp_path / 'cost-hemmingway.jsonl')
    monkeypatch.setattr(oc, 'RESULTS', tmp_path / 'results')
    monkeypatch.setattr(oc, 'corpus_of', lambda name: SimpleNamespace(name=name))
    monkeypatch.setattr(oc, 'load_items', lambda folder, key: ITEMS)
    monkeypatch.setattr(oc, 'item_chars', lambda *a: 9000)
    JUDGES.clear()
    monkeypatch.setattr(sim_via, 'ocx_llm', lambda *a, **k: JUDGES.append(a) or object())
    monkeypatch.setattr(ov, 'MODEL_CALLS', {})

    def evaluate(item, corpus, llm, cost, variant, variant_name):
        call = {'name': 'act', 'ms': 5, 'failed': False, 'inputTokens': 1000, 'outputTokens': 100}
        return {'id': item['id'], 'variant': variant_name, 'error': None, 'skipped': None, 'usage': rn.settle(cost, SimpleNamespace(calls=[call]))}

    monkeypatch.setattr(rn, 'evaluate_dialogue', evaluate)
    return tmp_path


def test_an_act_provider_run_counts_its_calls_in_its_own_ledger_at_its_own_rate_and_labels_the_records(home, monkeypatch):
    for name, value in ACT_ENV.items():
        monkeypatch.setenv(name, value)
    oc.cmd_run(args())
    records = rows(home / 'orig' / 'hp' / 'runs' / '1-H1.jsonl')   # --tag가 후보 이름(P1)보다 앞선다: 같은 이름의 luna 기록을 건드리지 않는다
    assert not (home / 'orig' / 'hp' / 'runs' / '1-P1.jsonl').exists()
    assert [(r['variant'], r['via']['act']) for r in records] == [('P1', ACT)] * 2 and all(r['via']['sut'] == 'openai' for r in records)
    ledger = rows(home / 'cost-hemmingway.jsonl')
    assert [(r['kind'], r['model'], round(r['usd'], 6)) for r in ledger] == [('act', 'hemmingway-1', 0.00099)] * 2   # 1,000×0.72 + 100×2.70 (100만 토큰당 달러)
    assert [round(u['usd'], 6) for r in records for u in r['usage']] == [0.00099] * 2
    assert not (home / 'cost-orig.jsonl').exists()   # OpenAI 장부는 건드리지 않는다


def test_a_run_without_an_act_provider_keeps_the_openai_ledger_and_the_variant_name_as_the_tag(home):
    oc.cmd_run(args(tag=None))
    records = rows(home / 'orig' / 'hp' / 'runs' / '1-P1.jsonl')
    assert len(records) == 2 and all('act' not in r['via'] for r in records)
    assert [(r['model'] if 'model' in r else None, round(r['usd'], 6)) for r in rows(home / 'cost-orig.jsonl')] == [(None, 0.00032)] * 2   # luna 단가 1,000×0.20 + 100×1.20
    assert not (home / 'cost-hemmingway.jsonl').exists()


@pytest.mark.parametrize('changes, env, message', [
    ({'sets': '1,3n'}, {}, '① 대사만'),
    ({'via': 'ocx'}, {}, '--via ocx'),
    ({'judge': 'openai'}, {}, '--judge openai'),
    ({}, {'SIMULATION_ACT_MODEL': 'mystery-model'}, '단가'),
    ({'limit_usd': 0.005}, {}, '상한'),   # luna 단가 예상(0.0035달러)은 통과하고 Hemmingway 단가 예상(0.0103달러)은 넘는다
])
def test_an_act_provider_run_stops_before_any_call_when_it_would_mix_ledgers_or_has_no_rate_or_exceeds_the_cap(home, monkeypatch, changes, env, message):
    for name, value in {**ACT_ENV, **env}.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(SystemExit, match=message):
        oc.cmd_run(args(**changes))
    assert not (home / 'orig' / 'hp' / 'runs' / '1-H1.jsonl').exists() and not (home / 'cost-hemmingway.jsonl').exists()


def test_a_sol_graded_run_keeps_its_records_and_judge_cache_apart_from_the_luna_ones(home):
    oc.cmd_run(args(judge_model='gpt-6.2-sol', tag=None))
    assert len(rows(home / 'orig' / 'hp' / 'runs-gpt-6.2-sol' / '1-P1.jsonl')) == 2 and not (home / 'orig' / 'hp' / 'runs').exists()
    assert JUDGES == [(home / 'orig' / 'cache-judge-gpt-6.2-sol', home / 'cost-orig.jsonl', 'gpt-6.2-sol')]


def test_the_default_judge_is_sol_and_luna_only_by_name(monkeypatch):
    seen = {}
    for name in ('cmd_run', 'cmd_summary', 'cmd_compare'):
        monkeypatch.setattr(oc, name, lambda args, name=name: seen.update({name: args}))
    oc.main(['run', '--corpus', 'hp'])
    oc.main(['summary', '--corpus', 'hp'])
    oc.main(['compare', '--corpus', 'hp', '--variant', 'H1'])
    assert (seen['cmd_run'].judge_model, seen['cmd_summary'].grader, seen['cmd_compare'].grader) == ('gpt-6.2-sol',) * 3   # 채점은 sol이 기본이다
    oc.main(['run', '--corpus', 'hp', '--judge-model', 'gpt-6-luna'])
    assert seen['cmd_run'].judge_model == 'gpt-6-luna'


def test_the_estimate_prices_input_and_the_assumed_output_at_the_given_rate(home):
    corpus = SimpleNamespace(name='hp')
    tokens = int(9000 / rn.CHARS_PER_TOKEN)
    luna, _ = oc.estimate(corpus, ['1'], 'ocx', None)
    hemmingway, total = oc.estimate(corpus, ['1'], 'ocx', None, rate=ov.RATES['hemmingway-1'])
    assert round(hemmingway['1']['usd'], 6) == round(2 * (tokens * 0.72 + 700 * 2.70) / 1_000_000, 6) == round(total, 6)   # 출력은 700토큰 어림
    assert hemmingway['1']['usd'] != luna['1']['usd'] and hemmingway['1']['itemMaxUsd'] == pytest.approx((int(9000 * 1.3 / rn.CHARS_PER_TOKEN) * 0.72 + rn.GEN_OUT * 2.70) / 1_000_000)


def test_act_provider_reads_the_service_settings_and_is_none_without_a_base_url(home, monkeypatch):
    assert oc.act_provider() is None
    monkeypatch.setenv('SIMULATION_ACT_THINKING', 'off')
    assert oc.act_provider() is None   # base URL이 없으면 서비스도 이 설정을 읽지 않는다
    monkeypatch.setenv('SIMULATION_ACT_BASE_URL', 'https://hemmingway.io/v1')
    monkeypatch.setenv('SIMULATION_ACT_API_KEY', 'hem-key')
    assert oc.act_provider() == {'provider': 'hemmingway.io', 'model': 'gpt-6-luna', 'thinking': 'off'}   # 모델은 비면 OPENAI_MODEL
    monkeypatch.setenv('SIMULATION_ACT_MODEL', 'hemmingway-1.5')
    monkeypatch.delenv('SIMULATION_ACT_THINKING')
    assert oc.act_provider() == {'provider': 'hemmingway.io', 'model': 'hemmingway-1.5', 'thinking': 'default'}


def graded(i, act=None, voice=3):
    return {'id': f'hp-1-000{i}', 'workKind': 'hp', 'error': None, 'skipped': None, 'generated': 'g', 'inChars': 100, 'grade': {'voice': voice, 'intent': 3, 'leaked': []},
            'usage': [{'name': 'act', 'ms': 10, 'failed': False, 'inputTokens': 100, 'outputTokens': 10, 'usd': 0.001}], 'via': {'sut': 'openai', **({'act': act} if act else {})}}


def write_runs(home, **runs):
    folder = home / 'orig' / 'hp' / 'runs'
    folder.mkdir(parents=True)
    for tag, records in runs.items():
        (folder / f'1-{tag}.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in records))


def test_the_summary_and_the_comparison_say_which_provider_and_model_made_a_run(home):
    write_runs(home, base2=[graded(1), graded(2)], H1=[graded(1, ACT, 4), graded(2, ACT, 4)])
    oc.cmd_summary(argparse.Namespace(corpus='hp', dev=False, base='base2', grader=oc.LUNA))
    summary = json.loads((home / 'results' / 'orig-hp-summary-base2.json').read_text())['sets']['1']
    assert summary['H1']['act'] == ACT and 'act' not in summary['base2']   # OpenAI 기본 경로의 기록에는 표기가 없다
    oc.cmd_compare(argparse.Namespace(corpus='hp', dev=False, variant='H1', base='base2', grader=oc.LUNA))
    compare = json.loads((home / 'results' / 'orig-hp-compare-H1-vs-base2.json').read_text())
    assert compare['acts'] == {'variant': ACT}
