import json
import logging
import re

import pytest

from app.evaluation import service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import LeakCheckRequest, LeakCheckResponse

from .stubs import CRITERIA, GEVAL_REQUEST, QA, QA_REQUEST, FakeDataset, experiment, install, item, prepared, prompt, stub_models

PRODUCTION = {('qa.answer', 'production'): prompt('옛 지시문', 2)}


@pytest.mark.parametrize('averages, baseline, failed, passed, deltas', [
    ({'a': 0.8}, None, 0, True, {}),  # 기준 Run이 없으면 통과(한계는 점수 메타데이터에 남긴다)
    ({'a': 0.8}, {'a': 0.8}, 0, True, {'a': 0.0}),
    ({'a': 0.75}, {'a': 0.8}, 0, True, {'a': -0.05}),  # 허용 오차 경계는 통과
    ({'a': 0.74}, {'a': 0.8}, 0, False, {'a': -0.06}),
    ({'a': 0.9, 'b': 0.5}, {'a': 0.9, 'b': 0.8}, 0, False, {'a': 0.0, 'b': -0.3}),  # 지표 하나라도 기준 아래면 불통과
    ({'a': 0.95}, {'a': 0.8}, 1, False, {'a': 0.15}),  # 지표가 올라도 실패한 항목이 있으면 불통과
    ({}, {'a': 0.8}, 2, False, {}),
    ({}, None, 2, False, {}),
])
def test_judge(averages, baseline, failed, passed, deltas):
    assert service.judge(averages, baseline, 0.05, failed) == (passed, deltas)


def test_prepare_names_the_run_and_reads_the_requested_prompt_version(monkeypatch):
    _, _, plan = prepared(monkeypatch, [item(1, QA)])

    assert re.fullmatch(r'qa\.answer@v3-\d{8}T\d{6}Z-[0-9a-f]{6}', plan.run_name)
    assert (plan.instructions, plan.tolerance, plan.baseline) == ('지시문', 0.05, None)  # production 라벨이 없으면 기준 Run도 없다


@pytest.mark.parametrize('case, status', [
    ('no_langfuse', 503), ('no_model', 503), ('bad_tolerance', 503), ('negative_tolerance', 503),
    ('no_dataset', 404), ('empty_dataset', 422), ('no_prompt_version', 404), ('chat_prompt', 422),
])
def test_prepare_rejects_before_anything_starts(monkeypatch, case, status):
    dataset = None if case == 'no_dataset' else FakeDataset([] if case == 'empty_dataset' else [item(1, QA)])
    chat = [{'role': 'system', 'content': '지시문'}]
    install(monkeypatch, dataset, {} if case == 'no_prompt_version' else {('qa.answer', 3): prompt(chat if case == 'chat_prompt' else '지시문', 3)})
    if case == 'no_langfuse':
        monkeypatch.delenv('LANGFUSE_SECRET_KEY')
    if case == 'no_model':
        monkeypatch.delenv('OPENAI_MODEL')
    if case in ('bad_tolerance', 'negative_tolerance'):
        monkeypatch.setenv('EVAL_TOLERANCE', 'abc' if case == 'bad_tolerance' else '-0.1')

    with pytest.raises(EvaluationFailure) as error:
        service.prepare(QA_REQUEST)

    assert error.value.status == status


def test_langfuse_failure_is_502_without_the_original_message(monkeypatch):
    client = install(monkeypatch, FakeDataset([item(1, QA)]), {('qa.answer', 3): prompt('지시문', 3)})

    def down(*_, **__):
        raise RuntimeError('원고 본문 일부')
    client.get_dataset = down

    with pytest.raises(EvaluationFailure) as error:
        service.prepare(QA_REQUEST)

    assert error.value.status == 502 and '원고 본문 일부' not in str(error.value) and error.value.__suppress_context__


def test_baseline_is_the_latest_completed_run_of_the_production_version(monkeypatch):
    metrics = {'faithfulness': 0.95, 'context_precision': 0.85}
    runs = [experiment('qa.answer@v2-running', metrics, passed=None),  # 아직 끝나지 않은 Run
            experiment('qa.answer@v3-new', metrics),  # 다른 버전
            experiment('qa.answer@v20-new', metrics),  # 버전 번호가 2로 시작하는 다른 버전
            experiment('other@v2-new', metrics),  # 다른 프롬프트
            experiment('qa.answer@v2-latest', metrics),
            experiment('qa.answer@v2-older', {'faithfulness': 0.1, 'context_precision': 0.1})]

    _, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION)

    assert plan.baseline == service.Baseline(run='qa.answer@v2-latest', version=2, metrics=metrics)
    assert client.listed['dataset_id'] == 'ds-1' and client.listed['fields'] == 'core,scores'


def test_run_scores_each_item_and_records_the_run_result(monkeypatch):
    other = {**QA, 'question': '초낭은 누구인가?'}
    dataset, client, plan = prepared(monkeypatch, [item(1, QA), item(2, other)])
    calls = stub_models(monkeypatch, ragas=lambda question, contexts, answer: {'faithfulness': 1.0 if question == QA['question'] else 0.5,
                                                                              'context_precision': 0.8})

    service.run(plan)

    assert calls.generate == [('지시문', QA), ('지시문', other)]  # 지정 버전의 프롬프트로 항목 입력을 실행한다
    assert calls.ragas == [(QA['question'], QA['contexts'], '답: ' + QA['question']), (other['question'], other['contexts'], '답: ' + other['question'])]
    assert dataset.experiment['run_name'] == plan.run_name
    assert dataset.experiment['metadata'] == {'prompt': 'qa.answer', 'version': '3', 'dataset': 'qa.grounding', 'tolerance': '0.05',
                                              'baselineRun': '', 'baselineVersion': ''}
    scores = {s['name']: s for s in client.scores}
    assert {s['dataset_run_id'] for s in client.scores} == {'exp-1'}
    assert (scores['faithfulness']['value'], scores['context_precision']['value']) == (0.75, 0.8)
    assert scores['passed']['value'] == 1.0 and scores['passed']['data_type'] == 'BOOLEAN'
    assert scores['passed']['metadata'] == {'failedItems': 0, 'totalItems': 2, 'tolerance': 0.05, 'baselineRun': None, 'baselineVersion': None}
    assert client.flushed == 1


def test_run_compares_each_metric_with_the_baseline_run(monkeypatch):
    runs = [experiment('qa.answer@v2-a', {'faithfulness': 0.95, 'context_precision': 0.7})]
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION)
    stub_models(monkeypatch, ragas=lambda *_: {'faithfulness': 0.85, 'context_precision': 0.9})  # 0.85 < 0.95 - 0.05

    service.run(plan)

    scores = {s['name']: s for s in client.scores}
    assert scores['faithfulness']['metadata'] == {'baseline': 0.95, 'delta': -0.1, 'tolerance': 0.05}
    assert scores['context_precision']['metadata'] == {'baseline': 0.7, 'delta': 0.2, 'tolerance': 0.05}
    assert scores['passed']['value'] == 0.0
    assert scores['passed']['metadata']['baselineRun'] == 'qa.answer@v2-a' and scores['passed']['metadata']['baselineVersion'] == 2
    assert (dataset.experiment['metadata']['baselineRun'], dataset.experiment['metadata']['baselineVersion']) == ('qa.answer@v2-a', '2')


def test_tolerance_comes_from_the_environment(monkeypatch):
    runs = [experiment('qa.answer@v2-a', {'faithfulness': 0.95, 'context_precision': 0.8})]
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION, tolerance='0.2')
    stub_models(monkeypatch, ragas=lambda *_: {'faithfulness': 0.8, 'context_precision': 0.8})  # -0.15는 기본 0.05면 불통과, 0.2면 통과

    service.run(plan)

    assert plan.tolerance == 0.2 and dataset.experiment['metadata']['tolerance'] == '0.2'
    assert {s['name']: s['value'] for s in client.scores}['passed'] == 1.0


@pytest.mark.parametrize('where', ['generate', 'ragas'])
def test_a_failed_item_stays_a_failure_instead_of_a_zero_score(monkeypatch, where):
    broken = {**QA, 'question': '실패할 질문'}
    _, client, plan = prepared(monkeypatch, [item(1, QA), item(2, broken)])

    def generate(instructions, data):
        if where == 'generate' and data['question'] == broken['question']:
            raise EvaluationFailure(503, '모델 호출에 실패했습니다.')
        return '답: ' + data['question']

    def ragas(question, contexts, answer):
        if where == 'ragas' and question == broken['question']:
            raise EvaluationFailure(502, '평가 채점에 실패했습니다.')
        return {'faithfulness': 0.9, 'context_precision': 0.8}
    stub_models(monkeypatch, generate=generate, ragas=ragas)

    service.run(plan)

    scores = {s['name']: s for s in client.scores}
    assert scores['faithfulness']['value'] == 0.9  # 실패한 항목을 0점으로 평균에 섞지 않는다
    assert scores['passed']['value'] == 0.0 and (scores['passed']['metadata']['failedItems'], scores['passed']['metadata']['totalItems']) == (1, 2)


def test_a_run_whose_items_all_failed_records_only_the_failure(monkeypatch):
    _, client, plan = prepared(monkeypatch, [item(1, QA), item(2, QA)])

    def generate(*_):
        raise EvaluationFailure(503, '모델 호출에 실패했습니다.')
    stub_models(monkeypatch, generate=generate)

    service.run(plan)

    assert [(s['name'], s['value'], s['metadata']['failedItems']) for s in client.scores] == [('passed', 0.0, 2)]


@pytest.mark.parametrize('bad', [{'question': '문맥 없는 질문'}, {'question': '', 'contexts': ['문맥']}, {'question': '질문', 'contexts': [3]}])
def test_items_without_the_expected_input_fail(monkeypatch, bad):
    _, client, plan = prepared(monkeypatch, [item(1, QA), item(2, bad)])
    stub_models(monkeypatch)

    service.run(plan)

    passed = {s['name']: s for s in client.scores}['passed']
    assert passed['value'] == 0.0 and passed['metadata']['failedItems'] == 1


def test_a_non_object_input_never_reaches_the_model(monkeypatch):
    _, client, plan = prepared(monkeypatch, [item(1, QA), item(2, '문자열 입력')])
    calls = stub_models(monkeypatch)

    service.run(plan)

    assert calls.generate == [('지시문', QA)]  # 형식이 틀린 항목은 모델을 부르지 않고 실패로 둔다
    assert {s['name']: s for s in client.scores}['passed']['metadata']['failedItems'] == 1


def test_other_datasets_are_scored_by_geval_with_the_item_criteria(monkeypatch):
    conflict = {'settings': ['길동은 서자다.'], 'proposal': '길동은 적장자다.'}
    items = [item(1, conflict, '서자와 적장자가 충돌한다.', CRITERIA, 'world.conflict'), item(2, conflict, None, {}, 'world.conflict')]
    _, client, plan = prepared(monkeypatch, items, request=GEVAL_REQUEST)
    calls = stub_models(monkeypatch, generate=lambda *_: '충돌한다.', geval=lambda *_: (0.6, '이유'))

    service.run(plan)

    assert calls.ragas == []
    assert calls.geval == [(CRITERIA['criteria'], json.dumps(conflict, ensure_ascii=False), '충돌한다.', '서자와 적장자가 충돌한다.')]
    scores = {s['name']: s for s in client.scores}
    assert scores['geval']['value'] == 0.6 and set(scores) == {'geval', 'passed'}
    assert scores['passed']['value'] == 0.0 and scores['passed']['metadata']['failedItems'] == 1  # criteria가 없는 항목은 채점하지 않고 실패로 둔다


def test_run_never_raises_and_logs_no_content(monkeypatch, caplog):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)])

    def crash(**_):
        raise RuntimeError('원고 본문 일부')
    dataset.run_experiment = crash

    with caplog.at_level(logging.ERROR):
        service.run(plan)

    assert plan.run_name in caplog.text and 'RuntimeError' in caplog.text and '원고 본문 일부' not in caplog.text
    assert client.scores == []


@pytest.mark.parametrize('score, suspected', [(0.5, True), (0.49, False), (1.0, True), (0.0, False)])
def test_leak_check_suspects_from_the_geval_threshold(monkeypatch, score, suspected):
    calls = stub_models(monkeypatch, geval=lambda *_: (score, '근거'))

    result = service.leak_check(LeakCheckRequest(response='응답 본문', references=['비공개 카드', '미발행 3화']))

    assert result == LeakCheckResponse(suspected=suspected, reason='근거')
    criteria, input_text, output, expected = calls.geval[0]
    assert '비공개 카드' in input_text and '미발행 3화' in input_text and output == '응답 본문' and expected is None
    assert '높은 점수' in criteria  # 점수가 높을수록 누설


def test_leak_check_failure_keeps_status_and_message(monkeypatch):
    def fail(*_):
        raise EvaluationFailure(502, '평가 채점에 실패했습니다.')
    stub_models(monkeypatch, geval=fail)

    with pytest.raises(EvaluationFailure) as error:
        service.leak_check(LeakCheckRequest(response='응답', references=['카드']))

    assert (error.value.status, str(error.value)) == (502, '평가 채점에 실패했습니다.')
