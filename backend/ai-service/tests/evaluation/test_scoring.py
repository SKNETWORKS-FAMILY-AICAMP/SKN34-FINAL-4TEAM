import asyncio
import importlib
import json
import logging
import os
import sys
import types
from functools import partial
from types import SimpleNamespace

import httpx
import pytest
from openai import AsyncOpenAI

from app.evaluation import rubric, scoring, service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import LeakCheckRequest
from traced import attrs


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


def fake_deepeval(monkeypatch, *, score=0.8, reason='근거', explode=None):
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
            if explode:
                raise explode
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


QUESTION = '율도국과 백씨는 어떤 사이야?'


def test_leak_check_gives_deepeval_the_question_and_the_rule_about_repeated_names(monkeypatch):
    seen = fake_deepeval(monkeypatch)

    service.leak_check(LeakCheckRequest(response='율도국과 백씨에 대한 근거는 없습니다.', references=['율도국', '백씨'], question=f'  {QUESTION}\n'))

    assert seen['case']['input'] == f'사용자 질문:\n{QUESTION}\n\n비공개 참조 목록:\n- 율도국\n- 백씨'  # 질문 앞뒤 공백은 뺀다
    assert seen['case']['actual_output'] == '율도국과 백씨에 대한 근거는 없습니다.'
    assert ('사용자 질문에 이미 나온 이름을 되풀이하거나 근거가 없다고 답한 것은 누설이 아니다. '
            '비공개 참조의 내용(관계·사건·결말 등)을 새로 알려 줄 때만 누설이다.') in seen['geval']['criteria']


@pytest.mark.parametrize('question', [None, '', '  \n'])
def test_leak_check_without_a_question_judges_the_references_alone(monkeypatch, question):
    seen = fake_deepeval(monkeypatch)

    service.leak_check(LeakCheckRequest(response='응답', references=['비공개 카드', '미발행 3화'], question=question))

    assert seen['case']['input'] == '비공개 참조 목록:\n- 비공개 카드\n- 미발행 3화'  # 질문이 없으면 기존과 같은 입력


def test_leak_check_failure_exposes_neither_question_nor_response(monkeypatch, caplog):
    fake_deepeval(monkeypatch, explode=RuntimeError(f'{QUESTION} 응답 본문'))

    with caplog.at_level(logging.DEBUG), pytest.raises(EvaluationFailure) as error:
        service.leak_check(LeakCheckRequest(response='응답 본문', references=['비공개 카드'], question=QUESTION))

    assert (error.value.status, str(error.value)) == (502, scoring.SCORING_FAILED)
    assert QUESTION not in caplog.text and '응답 본문' not in caplog.text and 'RuntimeError' in caplog.text


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


@pytest.mark.parametrize('setting, expected', [('judge-sol', 'judge-sol'), ('  judge-sol  ', 'judge-sol'), ('', 'judge-model'), ('   ', 'judge-model'), (None, 'judge-model')])
def test_the_judge_model_is_the_evaluation_setting_and_falls_back_to_the_openai_model(monkeypatch, setting, expected):
    if setting is None:
        monkeypatch.delenv('EVALUATION_JUDGE_MODEL', raising=False)
    else:
        monkeypatch.setenv('EVALUATION_JUDGE_MODEL', setting)

    assert scoring.require_model() == ('sk-test', expected)


def test_ragas_and_geval_use_the_judge_model(monkeypatch):
    monkeypatch.setenv('EVALUATION_JUDGE_MODEL', 'judge-sol')
    ragas = fake_ragas(monkeypatch)
    asyncio.run(scoring.ragas_scores('질문', ['문맥'], '답'))
    deepeval = fake_deepeval(monkeypatch)
    asyncio.run(scoring.geval('기준', '입력', '응답'))

    assert ragas['llm'][0] == 'judge-sol' and deepeval['model']['model'] == 'judge-sol'


# --- 시뮬레이션 루브릭 채점: 원문 평가의 judge와 같은 호출(Responses API 구조화 출력 한 번) ---

PAYLOAD = rubric.dialogue_payload('길동', [{'by': '길동', 'text': '"가자."'}], '"가자."', '"갑시다."', [{'id': 'f1', 'text': '해리는 입학했다'}])


def responses_reply(text, status='completed'):
    """Responses API 응답 본문(output_text 하나, 입력 10·출력 4토큰)."""
    content = [{'type': 'output_text', 'text': text, 'annotations': []}] if text is not None else []
    message = {'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'status': 'completed', 'content': content}
    counts = {'input_tokens': 10, 'output_tokens': 4, 'total_tokens': 14, 'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0}}
    return {'id': 'resp_1', 'object': 'response', 'created_at': 0, 'status': status, 'model': 'resolved-model', 'output': [message] if content else [], 'usage': counts}


def judge_client(monkeypatch, respond):
    """AsyncOpenAI는 실제 클래스를 쓰고 HTTP만 대역으로 막는다(네트워크 없음). 받은 요청 본문 목록을 돌려준다."""
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return respond(sent[-1])

    monkeypatch.setattr(scoring, 'AsyncOpenAI', partial(AsyncOpenAI, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    return sent


def test_rubric_grade_asks_the_judge_once_with_the_rubric_and_returns_the_scores(monkeypatch):
    sent = judge_client(monkeypatch, lambda body: httpx.Response(200, json=responses_reply(json.dumps({'voice': 4, 'intent': 2, 'leaked': ['f1']}))))
    monkeypatch.setenv('EVALUATION_JUDGE_MODEL', 'judge-sol')

    grade = asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    assert grade == {'voice': 4, 'intent': 2, 'leaked': ['f1']}
    [body] = sent  # 자동 재시도 없음: 호출 하나가 요청 하나다
    assert (body['model'], body['store'], body['max_output_tokens'], body['instructions']) == ('judge-sol', False, 1500, rubric.DIALOGUE_JUDGE)
    assert json.loads(body['input']) == PAYLOAD and body['text']['format']['name'] == 'DialogueGrade' and body['text']['format']['strict'] is True


@pytest.mark.parametrize('reply', [responses_reply(json.dumps({'voice': 4, 'intent': 2, 'leaked': []})), responses_reply('{"voice": 4, "inte')], ids=['scored', 'failed'])
def test_the_judge_client_is_closed_after_every_grade_scored_or_not(monkeypatch, reply):
    closed = []

    class Tracked(AsyncOpenAI):
        async def close(self):
            closed.append(True)
            await super().close()

    monkeypatch.setattr(scoring, 'AsyncOpenAI', partial(Tracked, http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=reply)))))

    try:
        asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))
    except EvaluationFailure:
        pass   # 채점이 실패여도 클라이언트는 닫는다

    assert closed == [True]


UNFIT = {
    'score-out-of-range': responses_reply(json.dumps({'voice': 6, 'intent': 2, 'leaked': []})),
    'unknown-fact-id': responses_reply(json.dumps({'voice': 4, 'intent': 2, 'leaked': ['zzz']})),
    'truncated-json': responses_reply('{"voice": 4, "inte'),
    'incomplete': responses_reply(json.dumps({'voice': 4, 'intent': 2, 'leaked': []}), status='incomplete'),
    'no-output': responses_reply(None),
}


@pytest.mark.parametrize('body', UNFIT.values(), ids=UNFIT)
def test_a_rubric_response_that_does_not_fit_is_a_scoring_failure_and_never_a_score(monkeypatch, body):
    judge_client(monkeypatch, lambda _: httpx.Response(200, json=body))

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    assert (error.value.status, str(error.value)) == (502, scoring.SCORING_FAILED)


def test_a_rubric_provider_failure_is_a_fixed_502_that_leaks_neither_content_nor_the_provider_message(monkeypatch, caplog):
    judge_client(monkeypatch, lambda _: httpx.Response(500, json={'error': {'message': '원고 본문 일부', 'type': 'server_error'}}))

    with caplog.at_level(logging.DEBUG), pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    assert (error.value.status, str(error.value)) == (502, scoring.SCORING_FAILED) and error.value.__suppress_context__
    assert '원고 본문 일부' not in caplog.text and '"갑시다."' not in caplog.text and 'InternalServerError' in caplog.text


def test_rubric_grade_needs_the_model_settings(monkeypatch):
    monkeypatch.delenv('OPENAI_MODEL')
    monkeypatch.delenv('EVALUATION_JUDGE_MODEL', raising=False)

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    assert error.value.status == 503

# --- 추적: 채점 호출도 generation으로 남는다(#851) ---

def judge_generations(spans):
    return [span for span in spans() if span.name == 'evaluation.rubric_grade']


def test_a_rubric_grade_is_traced_as_a_generation_with_the_model_and_usage_and_none_of_the_text(monkeypatch, spans):
    """채점 호출이 '추적'·비용 화면에 보여야 한다. 채점 입력(정답·생성 글·시점 위반 정답표)·지시문·점수 응답은 어느 속성에도 남기지 않는다(모델·사용량만)."""
    judge_client(monkeypatch, lambda body: httpx.Response(200, json=responses_reply(json.dumps({'voice': 4, 'intent': 2, 'leaked': ['f1']}))))
    monkeypatch.setenv('EVALUATION_JUDGE_MODEL', 'judge-sol')

    asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    [span] = judge_generations(spans)
    attributes = attrs(span)
    assert attributes['langfuse.observation.type'] == 'generation' and attributes['langfuse.observation.model.name'] == 'judge-sol'
    assert json.loads(attributes['langfuse.observation.usage_details']) == {'input': 10, 'output': 4}
    assert 'langfuse.observation.input' not in attributes and 'langfuse.observation.output' not in attributes
    shown = json.dumps(attributes, ensure_ascii=False)
    assert all(text not in shown for text in ('갑시다', '해리는 입학했다', '대사 평가자입니다', 'voice'))   # 채점 입력·지시문·점수 응답이 없다


def test_a_judge_answer_that_does_not_fit_still_counts_the_tokens_it_cost(monkeypatch, spans):
    judge_client(monkeypatch, lambda _: httpx.Response(200, json=responses_reply(json.dumps({'voice': 4, 'intent': 2, 'leaked': []}), status='incomplete')))

    with pytest.raises(EvaluationFailure):
        asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    [span] = judge_generations(spans)
    assert json.loads(attrs(span)['langfuse.observation.usage_details']) == {'input': 10, 'output': 4}   # 점수로 못 쓴 응답도 토큰은 썼다


@pytest.mark.parametrize('status, body, error_class', [
    (500, {'error': {'message': '원고 본문 일부', 'type': 'server_error'}}, 'InternalServerError'),
    (200, responses_reply('{"voice": 4, "inte'), 'ValidationError'),   # 잘린 JSON은 parse가 응답 대신 예외를 올려 사용량을 알 수 없다
], ids=['provider-error', 'truncated-json'])
def test_a_failed_judge_call_ends_its_generation_in_error_naming_only_the_error_class(monkeypatch, spans, status, body, error_class):
    judge_client(monkeypatch, lambda _: httpx.Response(status, json=body))

    with pytest.raises(EvaluationFailure):
        asyncio.run(scoring.rubric_grade(rubric.DIALOGUE_JUDGE, PAYLOAD, rubric.DialogueGrade))

    [span] = judge_generations(spans)
    attributes = attrs(span)
    assert attributes['langfuse.observation.level'] == 'ERROR' and attributes['langfuse.observation.status_message'] == error_class
    assert '원고 본문' not in json.dumps(attributes, ensure_ascii=False) and '"voice": 4' not in json.dumps(attributes, ensure_ascii=False)   # 제공사 메시지·응답 본문은 속성에 없다
