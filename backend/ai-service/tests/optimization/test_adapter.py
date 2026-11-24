"""GEPA 어댑터: 항목마다 서비스 호출로 만들고 루브릭으로 채점한다(Langfuse Run 없이 직접 호출). 모델·채점은 대역이다."""

import time

import pytest

from app import tracing
from app.evaluation import simulation
from app.evaluation.errors import EvaluationFailure
from app.optimization import adapter as module
from app.optimization.adapter import SimulationAdapter
from app.optimization.errors import OptimizationFailure
from app.simulation.errors import SimulationFailure

from .stubs import FACTS, install_gepa, row

CANDIDATE = {'instructions': '평가할 지시문'}


def fakes(monkeypatch, scores=None, fail=(), leaked=None):
    """generate는 지시문·모델·입력을 모으고 항목 번호가 fail에 있으면 서비스 실패, grade는 scores를 돌려준다."""
    calls = []

    def generate(kind, instructions, item_input, model=None):
        n = int(item_input['data']['scene'][0]['text'][1:-6])
        calls.append((kind, instructions, n, model))
        if n in fail:
            raise SimulationFailure(502, '시뮬레이션 모델 응답을 확인할 수 없습니다.')
        return f'생성 {n}'

    async def grade(kind, item_input, output, expected, metadata):
        return dict(scores or {'voice': 0.5, 'intent': 1.0, 'pov_ok': 1.0}), list(leaked or [])
    monkeypatch.setattr(simulation, 'generate', generate)
    monkeypatch.setattr(simulation, 'grade', grade)
    install_gepa(monkeypatch)
    return calls


def test_each_item_is_generated_with_the_candidate_text_and_scored_as_the_mean_of_the_metrics(monkeypatch):
    calls = fakes(monkeypatch, {'voice': 0.5, 'intent': 1.0, 'pov_ok': 0.0})

    batch = SimulationAdapter('act', 'gpt-6.1-terra').evaluate([row(1), row(2)], CANDIDATE)

    assert batch.outputs == ['생성 1', '생성 2'] and batch.scores == [0.5, 0.5] and batch.trajectories is None   # (0.5 + 1 + 0) / 3 = 0.5
    assert sorted(calls) == [('act', '평가할 지시문', 1, 'gpt-6.1-terra'), ('act', '평가할 지시문', 2, 'gpt-6.1-terra')]


def test_scores_stay_in_the_order_of_the_batch_whichever_item_finishes_first(monkeypatch):
    fakes(monkeypatch)

    def generate(kind, instructions, item_input, model=None):
        n = int(item_input['data']['scene'][0]['text'][1:-6])
        time.sleep(0.05 * (4 - n))   # 뒤 항목이 먼저 끝난다
        return f'생성 {n}'
    monkeypatch.setattr(simulation, 'generate', generate)

    assert SimulationAdapter('act', None).evaluate([row(1), row(2), row(3)], CANDIDATE).outputs == ['생성 1', '생성 2', '생성 3']


def test_the_trajectories_carry_what_the_reflection_needs_when_asked(monkeypatch):
    fakes(monkeypatch, {'voice': 0.25, 'intent': 0.75, 'pov_ok': 0.0}, leaked=['f1'])

    batch = SimulationAdapter('act', None).evaluate([row(1)], CANDIDATE, capture_traces=True)

    [trajectory] = batch.trajectories
    assert trajectory['output'] == '생성 1' and trajectory['scores'] == {'voice': 0.25, 'intent': 0.75, 'pov_ok': 0.0}
    assert trajectory['leaked'] == ['f1'] and trajectory['error'] is None and trajectory['row']['id'] == row(1)['id']


def test_a_failed_item_is_a_zero_with_an_error_and_a_failure_count_not_a_hidden_success(monkeypatch):
    fakes(monkeypatch, fail={2})
    adapter = SimulationAdapter('act', None)

    batch = adapter.evaluate([row(n) for n in range(1, 11)], CANDIDATE, capture_traces=True)   # 10개 중 1개: 20%를 넘지 않는다

    assert batch.scores[1] == 0.0 and batch.outputs[1] == '' and batch.trajectories[1]['error']
    assert (adapter.calls, adapter.failures) == (10, 1)


def test_scoring_failures_count_the_same_as_generation_failures(monkeypatch):
    fakes(monkeypatch)

    async def grade(*_):
        raise EvaluationFailure(502, '평가 채점에 실패했습니다.')
    monkeypatch.setattr(simulation, 'grade', grade)
    adapter = SimulationAdapter('act', None)

    with pytest.raises(OptimizationFailure) as error:
        adapter.evaluate([row(1)], CANDIDATE)

    assert error.value.status == 502 and adapter.failures == 1


def test_more_than_a_fifth_failing_stops_the_run_with_the_fixed_message(monkeypatch):
    fakes(monkeypatch, fail={1, 2})
    adapter = SimulationAdapter('act', None)

    with pytest.raises(OptimizationFailure) as error:
        adapter.evaluate([row(n) for n in range(1, 6)], CANDIDATE)   # 5개 중 2개 = 40%

    assert error.value.status == 502 and '20%' in str(error.value) and (adapter.calls, adapter.failures) == (5, 2)


def test_the_failure_rate_is_over_all_calls_so_far_not_per_batch(monkeypatch):
    fakes(monkeypatch, fail={101, 102})
    adapter = SimulationAdapter('act', None)
    adapter.evaluate([row(n) for n in range(1, 20)], CANDIDATE)   # 19개 성공

    adapter.evaluate([row(101), row(102)], CANDIDATE)   # 이번 묶음은 모두 실패지만 누적 2/21이라 넘지 않는다

    assert (adapter.calls, adapter.failures) == (21, 2)


def test_an_unexpected_error_is_not_swallowed_as_an_item_failure(monkeypatch):
    fakes(monkeypatch)

    def broken(*_, **__):
        raise RuntimeError('코드 버그')
    monkeypatch.setattr(simulation, 'generate', broken)

    with pytest.raises(RuntimeError):
        SimulationAdapter('act', None).evaluate([row(1)], CANDIDATE)


def test_generation_inside_the_workers_stays_under_the_current_trace(monkeypatch, spans):
    fakes(monkeypatch)

    def generate(kind, instructions, item_input, model=None):
        with tracing.observe('simulation.act'):
            return '생성'
    monkeypatch.setattr(simulation, 'generate', generate)

    with tracing.observe('prompt_optimization'):
        SimulationAdapter('act', None).evaluate([row(1), row(2)], CANDIDATE)

    root = next(s for s in spans() if s.name == 'prompt_optimization')
    children = [s for s in spans() if s.name == 'simulation.act']
    assert len(children) == 2 and all(c.parent is not None and c.parent.span_id == root.context.span_id for c in children)   # 스레드로 가도 같은 trace 아래다


def test_the_reflective_dataset_gives_the_output_the_gold_the_scores_and_the_violated_fact_text(monkeypatch):
    fakes(monkeypatch, {'voice': 0.25, 'intent': 0.75, 'pov_ok': 0.0}, leaked=['f1'])
    adapter = SimulationAdapter('act', None)
    batch = adapter.evaluate([row(1)], CANDIDATE, capture_traces=True)

    dataset = adapter.make_reflective_dataset(CANDIDATE, batch, ['instructions'])

    [record] = dataset['instructions']
    assert set(dataset) == {'instructions'} and set(record) == {'Inputs', 'Generated Outputs', 'Feedback'}
    assert '1번 장면' in record['Inputs'] and record['Generated Outputs'] == '생성 1'
    feedback = record['Feedback']
    assert '정답 1' in feedback and 'voice 0.25' in feedback and 'pov_ok 0.0' in feedback
    assert FACTS[0]['text'] in feedback and FACTS[1]['text'] not in feedback   # 위반한 사실만, 본문으로


def test_a_failed_item_reaches_the_reflection_as_a_failure_not_as_a_bad_answer(monkeypatch):
    fakes(monkeypatch, fail={1})
    adapter = SimulationAdapter('act', None)
    batch = adapter.evaluate([row(n) for n in range(1, 11)], CANDIDATE, capture_traces=True)

    [first, *_] = adapter.make_reflective_dataset(CANDIDATE, batch, ['instructions'])['instructions']

    assert '실패' in first['Feedback'] and '정답' not in first['Feedback']


def test_a_long_input_is_cut_so_one_example_cannot_fill_the_reflection_prompt(monkeypatch):
    fakes(monkeypatch)
    monkeypatch.setattr(simulation, 'generate', lambda *a, **k: '생성')
    long = row(1)
    long['input']['data']['scene'][0]['text'] = '"' + 'ㄱ' * 20000 + '"'
    adapter = SimulationAdapter('act', None)
    batch = adapter.evaluate([long], CANDIDATE, capture_traces=True)

    [record] = adapter.make_reflective_dataset(CANDIDATE, batch, ['instructions'])['instructions']

    assert len(record['Inputs']) <= module.MAX_INPUT_CHARS + 20
