"""CLI(simulation.py)의 순수 부분 단위 테스트: 설정 목록 파싱·예상 금액 표·결과 JSON 조립·데이터 없이 도는 estimate. 호출·내려받기가 없다."""

import json
import os
from types import SimpleNamespace

import pytest

import sim_config as cfg
import sim_worlds
import sim_cli as cli
from cost import CostLog
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
    monkeypatch.setattr(cli, 'sizes', lambda per_type: ([{'type': 'future', 'act_in': 1, 'check_in': 1, 'judge_in': 1}], [{'act_in': 1, 'check_in': 1, 'narrate_in': 1}], '대역'))
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

    def run_quality(rows, worlds, llm, templates, personalities, limit_usd, workers, out):
        seen.append((out.name, os.environ.get('SIMULATION_REASONING_EFFORT'), workers))
        return [{'idx': r['idx'], 'data_type': 'future', 'attempts': 1, 'blocked': False, 'error': None, 'flagged': False, 'leakFlagged': False,
                 'first': {'score': 1, 'personality': 5}, 'final': {'score': 1, 'personality': 5}} for r in rows]

    monkeypatch.setattr(cli.sim_quality, 'run_quality', run_quality)
    cli.main(['run', '--suite', 'quality', '--configs', 'A,B,C,D,E', '--workers', '3'])
    assert seen == [('quality-A.jsonl', None, 3), ('quality-B.jsonl', 'low', 3)]  # 추론 강도만 인물 턴 경로에 닿는다: C·D·E는 B와 같은 실행
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
