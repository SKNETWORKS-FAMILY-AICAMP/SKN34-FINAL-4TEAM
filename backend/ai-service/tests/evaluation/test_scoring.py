import asyncio
import importlib
import os
import sys
import types
from types import SimpleNamespace

import pytest

from app.evaluation import scoring
from app.evaluation.errors import EvaluationFailure


def modules(monkeypatch, **attrs):
    """ragas·deepeval을 설치하지 않아도 되도록 import 경로를 대역 모듈로 바꾼다."""
    for name, members in attrs.items():
        module = types.ModuleType(name)
        module.__dict__.update(members)
        monkeypatch.setitem(sys.modules, name, module)


@pytest.fixture(autouse=True)
def model_env(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')
    monkeypatch.setenv('OPENAI_MODEL', 'judge-model')


def fake_ragas(monkeypatch, *, faithfulness=0.5, precision=1.0, explode=None):
    seen = {}

    def llm_factory(model, client=None, **kwargs):
        seen['llm'] = (model, type(client).__name__, kwargs)
        seen['client'] = (client.max_retries, client.timeout)
        return 'llm'

    def metric(key, value):
        class Metric:
            def __init__(self, llm):
                seen[key + '_llm'] = llm

            async def ascore(self, **arguments):
                if explode:
                    raise explode
                seen[key] = arguments
                return SimpleNamespace(value=value)
        return Metric
    modules(monkeypatch, ragas={}, **{'ragas.llms': {'llm_factory': llm_factory}, 'ragas.metrics': {},
            'ragas.metrics.collections': {'Faithfulness': metric('faithfulness', faithfulness),
                                          'ContextPrecisionWithoutReference': metric('precision', precision)}})
    return seen


def fake_deepeval(monkeypatch, *, score=0.8, reason='근거'):
    seen = {}

    class SingleTurnParams:
        INPUT, ACTUAL_OUTPUT, EXPECTED_OUTPUT = 'input', 'actual_output', 'expected_output'

    class LLMTestCase:
        def __init__(self, **kwargs):
            seen['case'] = kwargs

    class OpenAIModel:
        def __init__(self, **kwargs):
            seen['model'] = kwargs

    class GEval:
        def __init__(self, **kwargs):
            seen['geval'] = kwargs

        async def a_measure(self, case, **kwargs):
            seen['measure'] = kwargs
            self.score, self.reason = score, reason
    modules(monkeypatch, deepeval={}, **{'deepeval.metrics': {'GEval': GEval}, 'deepeval.models': {'OpenAIModel': OpenAIModel},
            'deepeval.test_case': {'LLMTestCase': LLMTestCase, 'SingleTurnParams': SingleTurnParams}})
    return seen


def test_ragas_scores_faithfulness_and_context_precision_of_the_response(monkeypatch):
    seen = fake_ragas(monkeypatch)

    scores = asyncio.run(scoring.ragas_scores('질문', ['문맥1', '문맥2'], '답'))

    assert scores == {'faithfulness': 0.5, 'context_precision': 1.0}
    arguments = {'user_input': '질문', 'response': '답', 'retrieved_contexts': ['문맥1', '문맥2']}
    assert seen['faithfulness'] == seen['precision'] == arguments
    model, client, _ = seen['llm']
    assert (model, client) == ('judge-model', 'AsyncOpenAI')
    assert seen['client'] == (0, scoring.TIMEOUT)  # 자동 재시도로 실패를 숨기지 않는다
    assert seen['faithfulness_llm'] == seen['precision_llm'] == 'llm'


@pytest.mark.parametrize('faithfulness, precision', [(float('nan'), 1.0), (1.0, float('nan')), (1.5, 1.0), (-0.1, 1.0)])
def test_ragas_scores_outside_zero_to_one_or_nan_are_failures(monkeypatch, faithfulness, precision):
    fake_ragas(monkeypatch, faithfulness=faithfulness, precision=precision)

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.ragas_scores('질문', ['문맥'], '답'))

    assert (error.value.status, str(error.value)) == (502, scoring.SCORING_FAILED)


def test_library_errors_become_a_fixed_failure_without_the_input(monkeypatch, caplog):
    fake_ragas(monkeypatch, explode=ValueError('질문과 응답 본문이 담긴 메시지'))

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.ragas_scores('질문', ['문맥'], '답'))

    assert (error.value.status, str(error.value)) == (502, scoring.SCORING_FAILED)
    assert error.value.__suppress_context__ and '본문' not in caplog.text and 'ValueError' in caplog.text


def test_missing_eval_extra_is_a_503(monkeypatch):
    monkeypatch.setitem(sys.modules, 'ragas.llms', None)  # import하면 ImportError

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.ragas_scores('질문', ['문맥'], '답'))

    assert error.value.status == 503 and 'eval' in str(error.value)


def test_geval_scores_the_response_against_the_criteria(monkeypatch):
    seen = fake_deepeval(monkeypatch)

    result = asyncio.run(scoring.geval('기준', '입력', '응답', '기대 응답'))

    assert result == (0.8, '근거')
    assert seen['case'] == {'input': '입력', 'actual_output': '응답', 'expected_output': '기대 응답'}
    assert seen['geval']['criteria'] == '기준' and seen['geval']['evaluation_params'] == ['input', 'actual_output', 'expected_output']
    assert seen['geval']['async_mode'] is True and seen['measure'] == {'_show_indicator': False}
    # 모델 이름이 DeepEval 목록에 없어도 되도록 단가는 0으로 준다.
    assert seen['model'] == {'model': 'judge-model', 'api_key': 'sk-test', 'cost_per_input_token': 0.0, 'cost_per_output_token': 0.0}


def test_geval_without_an_expected_output_does_not_compare_with_one(monkeypatch):
    seen = fake_deepeval(monkeypatch)

    asyncio.run(scoring.geval('기준', '입력', '응답'))

    assert seen['geval']['evaluation_params'] == ['input', 'actual_output'] and seen['case']['expected_output'] is None


def test_geval_score_outside_zero_to_one_is_a_failure(monkeypatch):
    fake_deepeval(monkeypatch, score=7)

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.geval('기준', '입력', '응답'))

    assert error.value.status == 502


@pytest.mark.parametrize('missing', ['OPENAI_API_KEY', 'OPENAI_MODEL'])
def test_scoring_needs_the_model_settings(monkeypatch, missing):
    fake_deepeval(monkeypatch)
    monkeypatch.delenv(missing)

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.geval('기준', '입력', '응답'))

    assert error.value.status == 503


def test_libraries_do_not_send_telemetry_or_write_to_disk(monkeypatch):
    for name in ('DEEPEVAL_TELEMETRY_OPT_OUT', 'DEEPEVAL_FILE_SYSTEM', 'RAGAS_DO_NOT_TRACK'):
        monkeypatch.delenv(name, raising=False)

    importlib.reload(scoring)

    assert (os.environ['DEEPEVAL_TELEMETRY_OPT_OUT'], os.environ['DEEPEVAL_FILE_SYSTEM'], os.environ['RAGAS_DO_NOT_TRACK']) == ('1', 'READ_ONLY', 'true')
