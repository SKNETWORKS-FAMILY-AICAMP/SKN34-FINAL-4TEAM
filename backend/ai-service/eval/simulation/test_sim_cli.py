"""CLI(simulation.py)의 순수 부분 단위 테스트: 설정 목록 파싱·예상 금액 표·결과 JSON 조립·데이터 없이 도는 estimate. 호출·내려받기가 없다."""

import json
import math
import os
import sys
from types import SimpleNamespace

import pytest

import hp_build as hb
import sim_config as cfg
import sim_worlds
import sim_cli as cli
from cost import CostLog
from llm import CallCapExceeded
from sim_stats import summarize_speed


def test_configs_are_parsed_in_the_given_order_and_unknown_ones_stop_the_run():
    assert cli.parse_configs('a, C,E') == ['A', 'C', 'E']
    for bad in ('', 'A,F', 'AB'):
        with pytest.raises(SystemExit):
            cli.parse_configs(bad)


def test_the_estimate_table_lists_every_config_the_reused_ones_and_the_total_of_what_actually_runs():
    rows = {'A': {'calls': {'act': 100.0, 'check': 100.0}, 'usd': 1.5, 'reusedFrom': None}, 'B': {'calls': {}, 'usd': 0, 'reusedFrom': 'A'}}
    lines = cli.format_estimate('품질', rows, '가정 입력 크기', limit_usd=10).splitlines()
    assert lines[0].startswith('품질') and '가정 입력 크기' in lines[0]
    assert any(l.startswith('A') and 'act 100' in l and '1.50' in l for l in lines) and any(l.startswith('B') and 'A와 같은 실행' in l for l in lines)
    assert '합계 $1.50' in lines[-1] and '상한 $10.00' in lines[-1] and '넘' not in lines[-1]
    assert '넘는다' in cli.format_estimate('품질', rows, '', limit_usd=1).splitlines()[-1]  # 예상이 상한을 넘으면 알린다


def test_results_json_has_the_summaries_only_for_the_configs_that_ran_and_names_the_reused_ones():
    speed = summarize_speed([{'id': 's', 'status': 'completed', 'stopReason': None, 'turns': [{'kind': 'narration', 'regenerated': 0}],
                              'steps': [{'ms': 10, 'wallMs': 12, 'modelCalls': 1, 'failures': 0, 'inputTokens': 1, 'outputTokens': 1, 'usd': 0.0, 'calls': ['check']}]}])
    out = cli.results('speed', {'C': speed}, {'C': 'C', 'D': 'C'}, {'model': 'm', 'usd': 0.5})
    assert out['configs'] == {'C': speed, 'D': None} and out['ranAs'] == {'C': 'C', 'D': 'C'}
    assert (out['suite'], out['model'], out['usd']) == ('speed', 'm', 0.5)
    json.dumps(out)  # 저장할 수 있다


def test_estimate_without_the_prepared_data_prints_every_config_with_assumed_input_sizes(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(sim_worlds, 'DATA', tmp_path)
    monkeypatch.setattr(sim_worlds, 'TC', tmp_path / 'timechara')
    cli.main(['estimate', '--suite', 'all'])
    shown = capsys.readouterr().out
    assert 'prepare' in shown and '가정' in shown  # 데이터가 없으면 prepare를 안내하고 가정 크기로 계산한다
    for config in 'ABCDE':
        assert any(line.startswith(config) for line in shown.splitlines())
    assert shown.count('합계') == 2 and 'D' in shown and 'C와 같은 실행' in shown and 'B와 같은 실행' in shown


def test_run_refuses_to_start_without_a_key_and_a_model(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('OPENAI_MODEL', raising=False)
    with pytest.raises(SystemExit, match='OPENAI'):
        cli.main(['run', '--suite', 'speed', '--configs', 'A'])


SCENE = {'id': 's', 'status': 'completed', 'stopReason': None, 'turns': [{'kind': 'narration', 'regenerated': 0}],
         'steps': [{'ms': 10, 'wallMs': 12, 'modelCalls': 1, 'failures': 0, 'inputTokens': 1, 'outputTokens': 1, 'usd': 0.0, 'calls': ['check']}]}


@pytest.fixture
def run_env(monkeypatch, tmp_path):
    """run 명령의 연결(설정 적용·재사용·결과 쓰기)만 보도록 모델 호출과 입력 구성을 대역으로 바꾼다."""
    monkeypatch.setenv('OPENAI_API_KEY', 'key')
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-6-luna')
    monkeypatch.setenv('LANGFUSE_PUBLIC_KEY', 'pk')  # 테스트가 끝나면 원래대로 돌아간다
    monkeypatch.setenv('LANGFUSE_SECRET_KEY', 'sk')
    for name in cfg.SWITCHES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(cli, 'prepared', lambda: True)
    monkeypatch.setattr(cli, 'sizes', lambda per_type, world='thin': ([{'type': 'future', 'act_in': 1, 'check_in': 1, 'judge_in': 1}], [{'act_in': 1, 'check_in': 1, 'narrate_in': 1}], '대역'))
    monkeypatch.setattr(cli, 'sample_rows', lambda worlds: [{'idx': 0}, {'idx': 1}])
    monkeypatch.setattr(cli, 'usd_llm', lambda *args: SimpleNamespace(cost=CostLog(tmp_path / 'cost.jsonl'), model='judge-model'))
    monkeypatch.setattr(cli.sim_worlds.Worlds, 'load', classmethod(lambda cls: object()))
    monkeypatch.setattr(cli.sim_quality, 'load_inputs', lambda rows: ({}, {}))
    monkeypatch.setattr(cli.sim_worlds, 'DATA', tmp_path)
    monkeypatch.setattr(cli, 'RESULTS', tmp_path / 'results')
    return tmp_path


def test_run_speed_applies_each_config_once_reuses_identical_ones_and_writes_only_the_summary(monkeypatch, run_env):
    seen = []

    async def run_speed(specs, worlds, cost, limit_usd, out):
        seen.append((out.name, {k: v for k, v in ((k, os.environ.get(k)) for k in cfg.SWITCHES) if v}, limit_usd))
        return [SCENE]

    monkeypatch.setattr(cli.sim_speed, 'run_speed', run_speed)
    cli.main(['run', '--suite', 'speed', '--configs', 'C,D,E', '--limit-usd', '5'])
    assert [(name, limit) for name, _, limit in seen] == [('speed-C.jsonl', 5.0), ('speed-E.jsonl', 5.0)]  # D는 C와 같은 실행이라 돌리지 않는다
    assert seen[0][1] == cfg.CONFIGS['C'] and seen[1][1] == cfg.CONFIGS['E']
    assert not any(name in os.environ for name in cfg.SWITCHES)  # 끝나면 환경을 되돌린다
    assert 'LANGFUSE_PUBLIC_KEY' not in os.environ and 'LANGFUSE_SECRET_KEY' not in os.environ  # 원문이 Langfuse로 가지 않게 지웠다
    data = json.loads((run_env / 'results' / 'speed.json').read_text())
    assert data['ranAs'] == {'C': 'C', 'D': 'C', 'E': 'E'} and data['configs']['D'] is None and data['configs']['C']['scenes'] == 1
    assert (data['model'], data['judge'], data['scenes']) == ('gpt-6-luna', 'judge-model', 10) and 'responses' not in json.dumps(data)


def test_run_quality_runs_only_the_configs_that_differ_on_the_character_turn_path(monkeypatch, run_env):
    seen = []

    def run_quality(rows, worlds, llm, templates, personalities, limit_usd, workers, out, question_usd):
        seen.append((out.name, os.environ.get('SIMULATION_REASONING_EFFORT'), workers, question_usd))
        return [{'idx': r['idx'], 'data_type': 'future', 'attempts': 1, 'blocked': False, 'error': None, 'flagged': False, 'leakFlagged': False,
                 'first': {'score': 1, 'personality': 5}, 'final': {'score': 1, 'personality': 5}} for r in rows]

    big = {'type': 'past-absence', 'act_in': 50_000, 'check_in': 90_000, 'judge_in': 4_000}
    monkeypatch.setattr(cli, 'sizes', lambda per_type, world='thin': ([{'type': 'future', 'act_in': 1, 'check_in': 1, 'judge_in': 1}, big], [], '대역'))
    monkeypatch.setattr(cli.sim_quality, 'run_quality', run_quality)
    cli.main(['run', '--suite', 'quality', '--configs', 'A,B,C,D,E', '--workers', '3'])
    worst = cfg.question_max_usd(big)  # 가장 큰 질문 하나가 쓸 수 있는 최대 금액을 동시 수만큼 곱해 확인한다
    assert seen == [('quality-A.jsonl', None, 3, worst), ('quality-B.jsonl', 'low', 3, worst)]  # 추론 강도만 인물 턴 경로에 닿는다: C·D·E는 B와 같은 실행
    data = json.loads((run_env / 'results' / 'quality.json').read_text())
    assert data['ranAs'] == {'A': 'A', 'B': 'B', 'C': 'B', 'D': 'B', 'E': 'B'} and [n for n, v in data['configs'].items() if v is None] == ['C', 'D', 'E']
    assert 'B|A' in data['paired'] and data['questions'] == 2 and data['seed'] == sim_worlds.SEED


def test_report_prints_the_tables_of_the_saved_results_and_says_so_when_there_are_none(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, 'RESULTS', tmp_path)
    cli.main(['report', '--suite', 'speed'])
    assert '결과 없음' in capsys.readouterr().out
    saved = cli.results('speed', {'C': summarize_speed([SCENE])}, {'C': 'C', 'D': 'C'}, {'model': 'gpt-6-luna', 'usd': 1.5})
    (tmp_path / 'speed.json').write_text(json.dumps(saved))
    cli.main(['report', '--suite', 'speed'])
    shown = capsys.readouterr().out
    assert '| C |' in shown and 'C와 같은 실행' in shown and 'gpt-6-luna' in shown


def test_prepare_turns_an_expired_login_into_a_clear_message_without_printing_a_token(monkeypatch):
    import urllib.error

    def prepare(per_type):
        raise urllib.error.HTTPError('https://huggingface.co/x', 401, 'Unauthorized', {}, None)

    monkeypatch.setattr(sim_worlds, 'prepare', prepare)
    with pytest.raises(SystemExit, match='HTTP 401.*로그인'):
        cli.main(['prepare'])


UTILS = """
character_period_harry_potter = {"at the end of the scene": ['1-17', '2-18', '3-22', '4-37', '5-38', '6-30', '7-36']}
character_period_the_lord_of_the_rings = {}
character_period_twilight = {}
character_period_hunger_games = {}
"""


def test_estimate_measures_the_real_input_sizes_once_the_data_is_prepared(monkeypatch, tmp_path, capsys):
    everyone = "['Harry Potter', 'Hermione Granger', 'Ronald Weasley']"

    def row(character, period, qp, data_type):
        return {'series': 'harry_potter', 'character': character, 'character_period': period, 'question_period': qp, 'event_summary': f'{character} was there.',
                'participants': everyone, 'question_generation': 'fact-structured', 'data_type': data_type, 'question': 'What happened?',
                'temporal_label': 't', 'spatial_label': 's'}

    rows = [row('Harry Potter', '3rd-year', 'Book3-chapter19', 'past-presence'), row('Hermione Granger', '1st-year', 'Book5-chapter2', 'future'),
            row('Ronald Weasley', '5th-year', 'Book1-chapter9', 'past-only'), row('Harry Potter', '1st-year', 'Book1-chapter3', 'past-absence')]
    tc = tmp_path / 'timechara'
    (tc / 'data').mkdir(parents=True)
    (tc / 'valid.json').write_text(json.dumps(rows))
    (tc / 'utils.py').write_text(UTILS)
    (tc / 'data/spatiotemporal_consistency_evaluation_prompt.txt').write_text('{agent_name}{question_0}{answer_0}{agent_fact_0}')
    (tc / 'data/personality_consistency_evaluation_prompt.txt').write_text('{agent_name}')
    (tmp_path / 'sample.json').write_text(json.dumps({'seed': 1, 'perType': 1, 'idx': [0, 1, 2, 3]}))
    monkeypatch.setattr(sim_worlds, 'DATA', tmp_path)
    monkeypatch.setattr(sim_worlds, 'TC', tc)
    cli.main(['estimate', '--suite', 'all'])
    shown = capsys.readouterr().out
    assert '품질(표본 4문항)' in shown and '속도(고정 장면 10개)' in shown and '실제 입력 크기' in shown and '가정값' not in shown
    assert shown.count('합계') == 2 and any(line.startswith('E') and 'check' in line for line in shown.splitlines())


def test_run_stops_without_any_call_when_the_estimate_is_over_the_limit(monkeypatch, run_env, capsys):
    called = []
    monkeypatch.setattr(cli, 'usd_llm', lambda *args: called.append('llm'))
    monkeypatch.setattr(cli.sim_quality, 'run_quality', lambda *args: called.append('quality'))
    with pytest.raises(SystemExit, match='상한'):
        cli.main(['run', '--suite', 'quality', '--configs', 'A,B', '--limit-usd', '0.001'])
    assert called == [] and '합계' in capsys.readouterr().out  # 예상 표는 보여 주고 호출 없이 멈춘다


# --- 해리 포터 원문 세계관(build-hp·show-hp·seed-hp)과 --via ocx --------------------------------------------------------------

def test_speed_with_ocx_is_refused_before_any_key_or_call(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('OPENAI_MODEL', raising=False)
    with pytest.raises(SystemExit, match='speed.*OpenAI API로만'):
        cli.main(['run', '--suite', 'speed', '--via', 'ocx', '--configs', 'A'])


def test_ocx_needs_only_the_model_name_switches_the_process_and_runs_without_a_money_limit(monkeypatch, run_env):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    switched, limits = [], []
    ocx = SimpleNamespace(cost=CostLog(run_env / 'cost.jsonl'), model='judge-model', via='ocx')
    monkeypatch.setattr(cli.sim_via, 'use_ocx', lambda: switched.append('ocx'))
    monkeypatch.setattr(cli.sim_via, 'ocx_llm', lambda *args: ocx)
    monkeypatch.setattr(cli, 'usd_llm', lambda *args: pytest.fail('ocx는 OpenAI Llm을 만들지 않는다'))
    monkeypatch.setattr(cli.sim_quality, 'run_quality', lambda rows, worlds, llm, templates, personalities, limit_usd, *rest: limits.append((llm.via, limit_usd)) or [])
    monkeypatch.setattr(cli.sim_stats, 'summarize_quality', lambda records: {})
    monkeypatch.setattr(cli.sim_stats, 'paired_quality', lambda by_source: {})
    cli.main(['run', '--suite', 'quality', '--configs', 'A', '--via', 'ocx', '--limit-usd', '1'])
    assert switched == ['ocx'] and limits == [('ocx', math.inf)]


def test_a_quality_run_that_hits_the_openai_cap_tells_how_to_continue_with_ocx_and_ocx_itself_just_fails(monkeypatch, run_env):
    def capped(*args):
        raise CallCapExceeded('비용 상한 $1.00에 도달했다')

    monkeypatch.setattr(cli.sim_quality, 'run_quality', capped)
    with pytest.raises(SystemExit) as stop:
        cli.main(['run', '--suite', 'quality', '--configs', 'A'])
    assert '--via ocx' in str(stop.value) and '비용 상한' in str(stop.value) and 'via가 남아' in str(stop.value)
    monkeypatch.setattr(cli.sim_via, 'use_ocx', lambda: None)
    monkeypatch.setattr(cli.sim_via, 'ocx_llm', lambda *args: SimpleNamespace(cost=CostLog(run_env / 'cost.jsonl'), model='judge-model', via='ocx'))
    with pytest.raises(CallCapExceeded):
        cli.main(['run', '--suite', 'quality', '--configs', 'A', '--via', 'ocx'])


@pytest.fixture
def hp_env(monkeypatch, tmp_path):
    hp = tmp_path / 'hp'
    (hp / 'raw').mkdir(parents=True)
    monkeypatch.setattr(cli.sim_worlds, 'DATA', tmp_path)
    monkeypatch.setattr(cli.sim_worlds, 'HP_DIR', hp)
    monkeypatch.setattr(cli.sim_worlds, 'HP_WORLD', hp / 'world.json')
    monkeypatch.setattr(cli.sim_worlds, 'load_rows', lambda: [{'series': 'harry_potter'}])
    monkeypatch.setattr(cli, 'usd_llm', lambda cache, cost, limit: SimpleNamespace(cost=CostLog(tmp_path / 'cost.jsonl'), model='judge-model', limit=limit))
    monkeypatch.setenv('OPENAI_API_KEY', 'key')
    monkeypatch.setenv('LANGFUSE_PUBLIC_KEY', 'pk')
    monkeypatch.setenv('LANGFUSE_SECRET_KEY', 'sk')
    return hp


def test_build_hp_runs_the_extractor_under_the_openai_limit_prints_only_numbers_and_clears_langfuse(monkeypatch, hp_env, capsys):
    seen = {}

    def build(llm, raw, out, rows, **kwargs):
        seen.update(llm=llm, raw=raw, out=out, rows=rows, **kwargs)
        return {'units': 3, 'usd': 0.5}

    monkeypatch.setattr(cli.hp_build, 'build', build)
    cli.main(['build-hp'])
    assert (seen['raw'], seen['out'], seen['rows'], seen['limit_usd'], seen['workers']) == (hp_env / 'raw', hp_env, [{'series': 'harry_potter'}], 18.0, 12) and seen['llm'].limit == 18.0
    assert json.loads(capsys.readouterr().out) == {'units': 3, 'usd': 0.5} and 'LANGFUSE_PUBLIC_KEY' not in os.environ and 'LANGFUSE_SECRET_KEY' not in os.environ


def test_build_hp_that_hits_the_limit_says_how_to_continue_with_ocx_and_ocx_has_no_money_limit(monkeypatch, hp_env):
    calls = []

    def build(llm, raw, out, rows, *, limit_usd, workers):
        calls.append((getattr(llm, 'via', 'openai'), limit_usd))
        if llm is not ocx:
            raise hb.LimitReached('hp_extract: 비용 상한 $18.00에 닿아 멈췄다')
        return {'units': 3}

    ocx = SimpleNamespace(cost=CostLog(hp_env / 'cost.jsonl'), model='judge-model', via='ocx')
    monkeypatch.setattr(cli.hp_build, 'build', build)
    monkeypatch.setattr(cli.sim_via, 'ocx_llm', lambda *args: ocx)
    with pytest.raises(SystemExit, match='--via ocx') as stop:
        cli.main(['build-hp'])
    assert '비용 상한 $18.00' in str(stop.value)
    cli.main(['build-hp', '--via', 'ocx'])
    assert calls == [('openai', 18.0), ('ocx', math.inf)]


def test_build_hp_needs_the_key_and_the_raw_text(monkeypatch, hp_env):
    monkeypatch.delenv('OPENAI_API_KEY')
    with pytest.raises(SystemExit, match='OPENAI_API_KEY'):
        cli.main(['build-hp'])
    monkeypatch.setenv('OPENAI_API_KEY', 'key')
    (hp_env / 'raw').rmdir()
    with pytest.raises(SystemExit, match='원문'):
        cli.main(['build-hp'])


def test_show_hp_writes_the_preview_next_to_the_world_without_any_call(hp_env, capsys):
    person = lambda name, **f: hb.Person(**{'name': name, 'aliases': [], 'looks': '', 'personality': '', 'speech': '', 'situation': '', 'wants': '', 'memory': '', **f})  # noqa: E731
    infos = [hb.Info(1, (1,), 1, hb.Extraction(events=[], people=[person('해리', situation='소년')], things=[], relations=[]))]
    world = hb.build_world(infos, hb.resolve_persons(infos, {'해리': 'Harry Potter'}.get), hb.resolve_settings(infos), {}, {(1, 1): 1}, [])
    (hp_env / 'world.json').write_text(json.dumps(world, ensure_ascii=False), encoding='utf-8')
    cli.main(['show-hp'])
    text = (hp_env / 'preview.md').read_text(encoding='utf-8')
    assert '## Harry Potter — 해리(첫 등장 1화)' in text and '## Hermione Granger' in text and '## Severus Snape' in text and 'preview.md' in capsys.readouterr().out


def test_seed_hp_hands_the_world_path_and_the_local_address_to_hp_seed(monkeypatch, hp_env):
    got = []
    monkeypatch.setitem(sys.modules, 'hp_seed', SimpleNamespace(main=lambda argv: got.append(argv) or 0))
    with pytest.raises(SystemExit) as done:
        cli.main(['seed-hp'])
    assert done.value.code == 0 and got == [['--world', str(hp_env / 'world.json'), '--base-url', 'http://localhost:5173']]


# --- --world hp: 해리 포터 질문·장면을 원문 기반 세계관으로 ----------------------------------------------------------------------

RECORD = {'data_type': 'future', 'attempts': 1, 'blocked': False, 'error': None, 'flagged': False, 'leakFlagged': False,
          'first': {'score': 1, 'personality': 5}, 'final': {'score': 1, 'personality': 5}, 'via': 'openai'}


def test_a_quality_run_on_the_original_text_world_asks_every_hp_question_and_keeps_files_and_results_apart(monkeypatch, run_env):
    rows = [{'idx': 0, 'series': 'harry_potter'}, {'idx': 1, 'series': 'twilight'}, {'idx': 2, 'series': 'harry_potter'}]
    loaded, seen = [], []
    monkeypatch.setattr(cli.sim_worlds.Worlds, 'load', classmethod(lambda cls, hp=False: loaded.append(hp) or SimpleNamespace(rows=rows)))

    def run_quality(rows_, worlds, llm, templates, personalities, limit_usd, workers, out, question_usd):
        seen.append((out.name, [r['idx'] for r in rows_]))
        return [{**RECORD, 'idx': r['idx']} for r in rows_]

    monkeypatch.setattr(cli.sim_quality, 'run_quality', run_quality)
    cli.main(['run', '--suite', 'quality', '--configs', 'A', '--world', 'hp'])
    assert loaded == [True] and seen == [('quality-A-hp.jsonl', [0, 2])]   # 표본이 아니라 해리 포터 질문 전부, 얇은 세계관의 파일과 섞이지 않는다
    data = json.loads((run_env / 'results' / 'quality-hp.json').read_text())
    assert (data['world'], data['questions'], data['via']) == ('hp', 2, {'A': {'openai': 2}}) and not (run_env / 'results' / 'quality.json').exists()


def test_a_speed_run_on_the_original_text_world_keeps_its_files_apart(monkeypatch, run_env):
    loaded, seen = [], []
    monkeypatch.setattr(cli.sim_worlds.Worlds, 'load', classmethod(lambda cls, hp=False: loaded.append(hp) or object()))

    async def run_speed(specs, worlds, cost, limit_usd, out):
        seen.append(out.name)
        return [SCENE]

    monkeypatch.setattr(cli.sim_speed, 'run_speed', run_speed)
    cli.main(['run', '--suite', 'speed', '--configs', 'C', '--world', 'hp'])
    data = json.loads((run_env / 'results' / 'speed-hp.json').read_text())
    assert loaded == [True] and seen == ['speed-C-hp.jsonl'] and (data['world'], data['via']) == ('hp', 'openai')


def test_the_estimate_for_the_original_text_world_shows_build_quality_and_speed_and_their_total(monkeypatch, tmp_path, capsys):
    hp = tmp_path / 'hp'
    (hp / 'raw').mkdir(parents=True)
    for name, value in (('DATA', tmp_path), ('TC', tmp_path / 'timechara'), ('HP_DIR', hp), ('HP_WORLD', hp / 'world.json')):
        monkeypatch.setattr(sim_worlds, name, value)
    monkeypatch.setattr(cli.hp_chapters, 'split_all', lambda raw: {1: SimpleNamespace(units=[SimpleNamespace(text='가' * 28_001), SimpleNamespace(text='나' * 10)])})
    cli.main(['estimate', '--suite', 'all', '--world', 'hp'])
    shown = capsys.readouterr().out
    assert 'build(원문 → world.json): 추출 3회' in shown and '품질(해리 포터 질문 전부·원문 기반 세계관 150문항)' in shown and '속도(고정 장면' in shown
    assert 'world.json(build-hp)' in shown and '가정' in shown and '세 가지 합계(build + 품질 + 속도)' in shown
    (hp / 'world.json').write_text('{}')
    cli.main(['estimate', '--suite', 'speed', '--world', 'hp'])
    assert '이미 만들었다' in capsys.readouterr().out


def test_the_report_for_the_original_text_world_reads_its_own_results_and_shows_the_mix_of_paths(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, 'RESULTS', tmp_path)
    records = [{**RECORD, 'idx': i} for i in range(5)]
    saved = cli.results('quality', {'A': cli.sim_stats.summarize_quality(records)}, {'A': 'A'},
                        {'model': 'gpt-6-luna', 'judge': 'gpt-5.6-luna', 'usd': 2.0, 'world': 'hp', 'paired': {}, 'via': {'A': {'openai': 3, 'ocx': 2}}})
    (tmp_path / 'quality-hp.json').write_text(json.dumps(saved))
    cli.main(['report', '--suite', 'quality', '--world', 'hp'])
    shown = capsys.readouterr().out
    assert '원문 기반 세계관' in shown and 'via(문항 수): A ocx 2 · openai 3' in shown and '섞여 있다' in shown
    cli.main(['report', '--suite', 'quality'])
    assert '결과 없음' in capsys.readouterr().out   # 얇은 세계관 결과는 따로 있다
    assert cli.format_via('openai') == 'via: openai' and '섞여' not in cli.format_via({'A': {'openai': 4}})
