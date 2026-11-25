from types import SimpleNamespace
import json
import logging
import re

import pytest

from app.evaluation import service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationRequest, LeakCheckRequest, LeakCheckResponse
from app.intent import service as intent
from app.intent.models import DecisionResult

from .stubs import (ACT_INPUT, ACT_REQUEST, CRITERIA, DATASET_ID, GEVAL_REQUEST, JUDGE, NARRATE_REQUEST, QA, QA_REQUEST, FakeDataset, experiment, install, item, prepared,
                    prompt, stub_models, stub_simulation)

PRODUCTION = {('qa.answer', 'production'): prompt('옛 지시문', 2)}


@pytest.fixture(autouse=True)
def slept(monkeypatch):
    """Run 조회 재시도의 대기를 건너뛰고 기록한다."""
    waits = []
    monkeypatch.setattr(service, 'sleep', waits.append, raising=False)
    return waits


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
    assert (plan.instructions, plan.tolerance, plan.baseline, plan.base_version) == ('지시문', 0.1, None, None)  # 기본 허용 오차는 0.1이고, production 라벨이 없으면 기준 Run도 먼저 만들 평가도 없다


@pytest.mark.parametrize('blank', ['', '  '])
def test_a_blank_tolerance_is_the_default_like_the_other_blank_settings(monkeypatch, blank):
    install(monkeypatch, FakeDataset([item(1, QA)]), {('qa.answer', 3): prompt('지시문', 3)})
    monkeypatch.setenv('EVAL_TOLERANCE', blank)   # .env에서 비워 둔 값은 설정하지 않은 것과 같다(503이 아니다)

    assert service.prepare(QA_REQUEST).tolerance == 0.1


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


def test_baseline_is_the_latest_run_that_finished_with_passed_and_every_metric_average(monkeypatch):
    metrics = {'faithfulness': 0.95, 'context_precision': 0.85}
    runs = [experiment('qa.answer@v2-running', metrics, passed=None),  # 아직 끝나지 않은 Run
            experiment('qa.answer@v2-failed', {}),  # 모든 항목이 실패해 passed만 남은 Run: 지표를 비교할 수 없다
            experiment('qa.answer@v2-partial', {'faithfulness': 0.9}),  # 지표 평균이 일부뿐인 Run
            experiment('qa.answer@v3-new', metrics),  # 다른 버전
            experiment('qa.answer@v20-new', metrics),  # 버전 번호가 2로 시작하는 다른 버전
            experiment('other@v2-new', metrics),  # 다른 프롬프트
            experiment('qa.answer@v2-latest', metrics),
            experiment('qa.answer@v2-older', {'faithfulness': 0.1, 'context_precision': 0.1})]

    _, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION)

    assert plan.baseline == service.Baseline(run='qa.answer@v2-latest', version=2, metrics=metrics) and plan.base_version is None   # 기준이 있으면 먼저 평가할 것이 없다
    query = client.requests[-1].url.params  # 실제 SDK가 Experiments API(GET /api/public/experiments)로 보낸 쿼리
    assert (query['datasetId'], query['fields'], query['limit']) == (DATASET_ID, 'core,scores', '100') and 'fromStartTime' in query


def test_run_scores_each_item_and_records_the_run_result(monkeypatch):
    other = {**QA, 'question': '초낭은 누구인가?'}
    dataset, client, plan = prepared(monkeypatch, [item(1, QA), item(2, other)])
    calls = stub_models(monkeypatch, ragas=lambda question, contexts, answer: {'faithfulness': 1.0 if question == QA['question'] else 0.5,
                                                                              'context_precision': 0.8})

    service.run(plan)

    assert calls.generate == [('지시문', QA), ('지시문', other)]  # 지정 버전의 프롬프트로 항목 입력을 실행한다
    assert calls.ragas == [(QA['question'], QA['contexts'], '답: ' + QA['question']), (other['question'], other['contexts'], '답: ' + other['question'])]
    assert dataset.experiment['run_name'] == plan.run_name
    assert dataset.experiment['metadata'] == {'prompt': 'qa.answer', 'version': '3', 'dataset': 'qa.grounding', 'tolerance': '0.1',
                                              'baselineRun': '', 'baselineVersion': ''}
    scores = {s['name']: s for s in client.scores}
    assert {s['dataset_run_id'] for s in client.scores} == {FakeDataset.RUN_ID}
    assert (scores['faithfulness']['value'], scores['context_precision']['value']) == (0.75, 0.8)
    assert scores['passed']['value'] == 1.0 and scores['passed']['data_type'] == 'BOOLEAN'
    assert scores['passed']['metadata'] == {'failedItems': 0, 'totalItems': 2, 'tolerance': 0.1, 'baselineRun': None, 'baselineVersion': None}
    assert client.flushed == 1


def test_run_compares_each_metric_with_the_baseline_run(monkeypatch):
    runs = [experiment('qa.answer@v2-a', {'faithfulness': 0.95, 'context_precision': 0.7})]
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION)
    stub_models(monkeypatch, ragas=lambda *_: {'faithfulness': 0.8, 'context_precision': 0.9})  # 0.8 < 0.95 - 0.1

    service.run(plan)

    scores = {s['name']: s for s in client.scores}
    assert scores['faithfulness']['metadata'] == {'baseline': 0.95, 'delta': -0.15, 'tolerance': 0.1}
    assert scores['context_precision']['metadata'] == {'baseline': 0.7, 'delta': 0.2, 'tolerance': 0.1}
    assert scores['passed']['value'] == 0.0
    assert scores['passed']['metadata']['baselineRun'] == 'qa.answer@v2-a' and scores['passed']['metadata']['baselineVersion'] == 2
    assert (dataset.experiment['metadata']['baselineRun'], dataset.experiment['metadata']['baselineVersion']) == ('qa.answer@v2-a', '2')


def test_tolerance_comes_from_the_environment(monkeypatch):
    runs = [experiment('qa.answer@v2-a', {'faithfulness': 0.95, 'context_precision': 0.8})]
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION, tolerance='0.2')
    stub_models(monkeypatch, ragas=lambda *_: {'faithfulness': 0.8, 'context_precision': 0.8})  # -0.15는 기본 0.1이면 불통과, 0.2면 통과

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


def refuse(*_):
    raise EvaluationFailure(503, '모델 호출에 실패했습니다.')


def test_a_run_whose_items_all_failed_records_the_failure_on_the_run_found_by_name(monkeypatch):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA), item(2, QA)])
    stub_models(monkeypatch, generate=refuse)

    service.run(plan)

    # 모든 항목이 task 단계에서 실패하면 SDK는 dataset_run_id를 알려 주지 못하고 experiment_id는 어떤 Run도 가리키지 않는 임의 ID다.
    # passed=false는 Run 이름으로 찾은 서버의 실제 Run에 붙어야 운영이 끝난 Run으로 읽는다.
    assert [(s['name'], s['value'], s['dataset_run_id'], s['metadata']['failedItems']) for s in client.scores] == [('passed', 0.0, FakeDataset.RUN_ID, 2)]
    query = client.requests[-1].url.params  # Run은 Experiments API에서 이름으로 찾는다(v3의 dataset runs 경로는 서버가 404다)
    assert (query['name'], query['fields']) == (plan.run_name, 'core') and 'fromStartTime' in query


@pytest.mark.parametrize('how, logged', [('not_found', 'Run을 찾지 못'), ('api_error', 'Langfuse 요청에 실패')])
def test_a_run_that_cannot_be_found_is_logged_with_a_fixed_message_and_scores_nothing(monkeypatch, caplog, slept, how, logged):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)])
    stub_models(monkeypatch, generate=refuse)
    dataset.links = how != 'not_found'  # 서버에 Run이 만들어지지 않아 이름으로 찾을 수 없다
    if how == 'api_error':
        client.experiments_status = 400  # 오류 응답 본문에 원문이 섞여 있어도 로그에는 남지 않는다(5xx는 SDK가 재시도하며 몇 초 걸린다)

    with caplog.at_level(logging.ERROR):
        service.run(plan)

    assert client.scores == []  # 어떤 Run도 가리키지 않는 임의 ID에는 점수를 붙이지 않는다
    assert plan.run_name in caplog.text and logged in caplog.text and '원고 본문 일부' not in caplog.text
    # 안 보이면 정해진 횟수만 기다려 다시 묻고, 서버 오류는 기다려도 소용없어 바로 실패로 올린다
    assert slept == ([service.LOOKUP_WAIT] * (service.LOOKUP_ATTEMPTS - 1) if how == 'not_found' else [])


def test_a_run_that_shows_up_after_the_ingestion_lag_still_gets_the_failure(monkeypatch, slept):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA), item(2, QA)])
    stub_models(monkeypatch, generate=refuse)
    client.lag = 2  # v4는 이벤트를 비동기로 수집해 방금 만든 실험이 처음 두 번은 안 보인다

    service.run(plan)

    assert [(s['name'], s['dataset_run_id']) for s in client.scores] == [('passed', FakeDataset.RUN_ID)]
    assert slept == [service.LOOKUP_WAIT] * 2 and len(client.requests) == 3


def test_a_server_without_the_experiments_api_is_a_502_instead_of_a_crash(monkeypatch):
    client = install(monkeypatch, FakeDataset([item(1, QA)]), {('qa.answer', 3): prompt('지시문', 3), **PRODUCTION})
    client.experiments_status = 404  # 기준 Run을 찾으려 해도 이 서버에는 Experiments API가 없다

    with pytest.raises(EvaluationFailure) as error:
        service.prepare(QA_REQUEST)

    assert (error.value.status, str(error.value)) == (502, 'Langfuse 요청에 실패했습니다.') and error.value.__suppress_context__


def test_without_server_side_run_links_scores_follow_the_sdk_experiment_id(monkeypatch):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)])
    dataset.links = False  # 서버가 run item을 받지 않아 dataset_run_id가 없다
    stub_models(monkeypatch)

    service.run(plan)

    # 결과가 있으면 experiment_id가 항목 span이 싣는 실험 ID라 그대로 쓴다(Run을 조회하지 않는다).
    assert {s['dataset_run_id'] for s in client.scores} == {'sdk-fallback-id'} and client.requests == []


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


def test_a_plan_travels_to_the_worker_as_json_without_the_dataset_items(monkeypatch):
    runs = [experiment('qa.answer@v2-a', {'faithfulness': 0.95, 'context_precision': 0.7})]
    _, _, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION)

    job = service.to_job(plan)

    assert json.loads(json.dumps(job)) == job  # 브로커를 지나도 같다
    assert job == {'request': {'dataset': 'qa.grounding', 'prompt': 'qa.answer', 'version': 3}, 'runName': plan.run_name, 'instructions': '지시문',
                   'model': None, 'tolerance': 0.1, 'baseline': {'run': 'qa.answer@v2-a', 'version': 2, 'metrics': {'faithfulness': 0.95, 'context_precision': 0.7}},
                   'baseVersion': None}
    assert QA['question'] not in json.dumps(job, ensure_ascii=False)  # 채점 입력은 싣지 않는다: 워커가 평가 세트를 이름으로 읽는다


def test_the_worker_runs_the_plan_it_received_on_the_dataset_it_reads_at_that_moment(monkeypatch):
    runs = [experiment('qa.answer@v2-a', {'faithfulness': 0.95, 'context_precision': 0.7})]
    _, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=runs, prompts=PRODUCTION)
    job = json.loads(json.dumps(service.to_job(plan)))  # 브로커를 지난 인자
    other = {**QA, 'question': '초낭은 누구인가?'}
    client.dataset = FakeDataset([item(2, other)])  # 큐에서 기다리는 동안 평가 세트가 바뀌었다
    calls = stub_models(monkeypatch, ragas=lambda *_: {'faithfulness': 0.8, 'context_precision': 0.9})

    service.run_job(job)

    assert calls.generate == [('지시문', other)]
    assert client.dataset.experiment['run_name'] == plan.run_name  # 응답한 Run 이름 그대로
    assert client.dataset.experiment['metadata']['baselineRun'] == 'qa.answer@v2-a'
    scores = {s['name']: s for s in client.scores}
    assert scores['faithfulness']['metadata'] == {'baseline': 0.95, 'delta': -0.15, 'tolerance': 0.1}  # 기준 Run도 인자로 받은 그대로 비교한다
    assert scores['passed']['value'] == 0.0


@pytest.mark.parametrize('case, logged', [('no_dataset', '평가 세트를 찾을 수 없어요.'), ('empty_dataset', '평가 세트에 항목이 없어요.')])
def test_a_plan_whose_dataset_is_gone_by_run_time_fails_the_task_with_a_fixed_message_and_runs_nothing(monkeypatch, caplog, case, logged):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)])
    job = service.to_job(plan)
    client.dataset = None if case == 'no_dataset' else FakeDataset([])
    calls = stub_models(monkeypatch)

    with caplog.at_level(logging.ERROR), pytest.raises(EvaluationFailure) as error:
        service.run_job(job)  # Run을 만들기 전 실패는 태스크 실패로 올린다(고정 문구)

    assert str(error.value) == logged
    assert plan.run_name in caplog.text and logged in caplog.text and '지시문' not in caplog.text
    assert (dataset.experiment, client.scores, calls.generate) == (None, [], [])


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


# --- 기준 Run 무효화와 production 선평가(#868): 기준 Run은 세트의 마지막 문항보다 뒤에 시작한 Run뿐이다 ---

METRICS = {'faithfulness': 0.95, 'context_precision': 0.85}
NEWEST = '2026-11-19T05:00:00.000Z'   # 세트의 마지막 문항이 만들어진 시각
PRODUCTION_V2 = {**PRODUCTION, ('qa.answer', 2): prompt('옛 지시문', 2)}   # production 라벨과 그 버전(v2) 본문


def test_a_baseline_run_counts_only_if_it_started_after_the_newest_item_of_the_set(monkeypatch):
    runs = [experiment('qa.answer@v2-same', METRICS, started=NEWEST),   # 마지막 문항과 같은 시각은 뒤가 아니다
            experiment('qa.answer@v2-before', METRICS, started='2026-11-19T04:59:59.999Z')]   # 마지막 문항을 보지 못한 점수라 기준이 아니다

    _, _, plan = prepared(monkeypatch, [item(1, QA), item(2, QA, created=NEWEST)], experiments=runs, prompts=PRODUCTION)

    assert (plan.baseline, plan.base_version) == (None, 2)   # 유효한 기준이 없으면 같은 작업에서 production(v2)을 먼저 평가한다


def test_a_baseline_run_that_started_before_an_item_was_changed_is_invalid(monkeypatch):
    # 올라간 문항의 내용이 바뀌면(upsert) 만들어진 시각이 그대로여도 마지막으로 바뀐 시각이 기준이다: 그 전에 시작한 Run은 바뀐 문항을 보지 못했다.
    changed = item(2, QA, created='2026-11-19T04:00:00.000Z', updated=NEWEST)
    between = experiment('qa.answer@v2-between', METRICS, started='2026-11-19T04:30:00.000Z')   # 만들어진 뒤지만 바뀌기 전에 시작
    after = experiment('qa.answer@v2-after', METRICS, started='2026-11-19T05:00:00.001Z')

    _, _, plan = prepared(monkeypatch, [item(1, QA), changed], experiments=[between], prompts=PRODUCTION)
    assert (plan.baseline, plan.base_version) == (None, 2)

    _, _, plan = prepared(monkeypatch, [item(1, QA), changed], experiments=[between, after], prompts=PRODUCTION)
    assert plan.baseline.run == 'qa.answer@v2-after' and plan.base_version is None


def test_the_newest_item_decides_not_the_first_one(monkeypatch):
    old = experiment('qa.answer@v2-old', METRICS, started='2026-11-19T04:00:00.000Z')   # 첫 문항(03:55)보다는 뒤지만 둘째 문항(05:00)보다 앞

    _, _, plan = prepared(monkeypatch, [item(1, QA), item(2, QA, created=NEWEST)], experiments=[old], prompts=PRODUCTION)

    assert (plan.baseline, plan.base_version) == (None, 2)


def test_a_run_after_the_newest_item_is_the_baseline_and_older_runs_are_skipped(monkeypatch):
    runs = [experiment('qa.answer@v2-after', METRICS, started='2026-11-19T05:00:00.001Z'),
            experiment('qa.answer@v2-before', {'faithfulness': 0.1, 'context_precision': 0.1}, started='2026-11-19T04:00:00.000Z')]

    _, _, plan = prepared(monkeypatch, [item(1, QA), item(2, QA, created=NEWEST)], experiments=runs, prompts=PRODUCTION)

    assert plan.baseline == service.Baseline('qa.answer@v2-after', 2, METRICS) and plan.base_version is None


def test_the_newest_valid_run_is_found_even_behind_invalid_newer_ones(monkeypatch):
    runs = [experiment('qa.answer@v2-newest-but-before', METRICS, started='2026-11-19T04:00:00.000Z'),   # 목록은 최근 활동 순: 더 최근 활동이어도 시작이 문항보다 앞이면 건너뛴다
            experiment('qa.answer@v2-valid', METRICS, started='2026-11-19T06:00:00.000Z')]

    _, _, plan = prepared(monkeypatch, [item(1, QA, created=NEWEST)], experiments=runs, prompts=PRODUCTION)

    assert plan.baseline.run == 'qa.answer@v2-valid'


def test_evaluating_the_production_version_itself_has_no_baseline_and_makes_none_first(monkeypatch):
    valid = experiment('qa.answer@v3-valid', METRICS)   # 요청 v3이 production이면 유효한 옛 Run이 있어도 그 Run과 비교하지 않는다: 이 Run이 곧 기준이다

    _, client, plan = prepared(monkeypatch, [item(1, QA)], experiments=[valid], prompts={('qa.answer', 'production'): prompt('지시문', 3)})

    assert (plan.baseline, plan.base_version) == (None, None) and client.requests == []   # 기준 Run을 찾으러 가지도 않는다


def test_a_plan_without_a_valid_baseline_travels_with_the_production_version_to_evaluate_first(monkeypatch):
    _, _, plan = prepared(monkeypatch, [item(1, QA)], prompts=PRODUCTION_V2)

    job = service.to_job(plan)

    assert json.loads(json.dumps(job)) == job and (job['baseline'], job['baseVersion']) == (None, 2)


def test_the_worker_evaluates_the_production_version_first_and_compares_the_candidate_with_that_run(monkeypatch):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)], prompts=PRODUCTION_V2)
    job = json.loads(json.dumps(service.to_job(plan)))
    calls = stub_models(monkeypatch, generate=lambda instructions, data: instructions + ':' + data['question'],
                        ragas=lambda question, contexts, answer: {'faithfulness': 0.9 if answer.startswith('옛') else 0.7, 'context_precision': 0.8})

    service.run_job(job)

    assert [instructions for instructions, _ in calls.generate] == ['옛 지시문', '지시문']   # production(옛 지시문)이 먼저, 후보가 나중
    base, candidate = dataset.history
    assert re.fullmatch(r'qa\.answer@v2-\d{8}T\d{6}Z-[0-9a-f]{6}', base['run_name']) and candidate['run_name'] == plan.run_name
    assert (base['metadata']['version'], base['metadata']['baselineRun']) == ('2', '')   # 기준 Run 자신은 비교하지 않는다
    assert (candidate['metadata']['baselineRun'], candidate['metadata']['baselineVersion']) == (base['run_name'], '2')
    first, second = client.scores[:3], client.scores[3:]   # Run마다 지표 둘과 passed를 남긴다
    assert {s['name']: s['value'] for s in first} == {'faithfulness': 0.9, 'context_precision': 0.8, 'passed': 1.0}
    scores = {s['name']: s for s in second}
    assert scores['faithfulness']['metadata'] == {'baseline': 0.9, 'delta': -0.2, 'tolerance': 0.1}   # 방금 만든 기준 평균과 비교한다
    assert scores['passed']['value'] == 0.0 and scores['passed']['metadata']['baselineRun'] == base['run_name']


def test_when_the_production_evaluation_leaves_no_score_the_candidate_is_not_evaluated(monkeypatch, caplog):
    dataset, client, plan = prepared(monkeypatch, [item(1, QA)], prompts=PRODUCTION_V2)
    stub_models(monkeypatch, generate=refuse)   # 모든 항목이 실패해 기준이 될 지표 평균이 없다

    with caplog.at_level(logging.ERROR):
        service.run(plan)

    assert len(dataset.history) == 1 and dataset.history[0]['run_name'] != plan.run_name   # 후보 Run은 만들지 않는다(기준 없이 지표 비교를 건너뛰지 않는다)
    assert plan.run_name in caplog.text and '기준(production) 평가' in caplog.text and '지시문' not in caplog.text
    assert [(s['name'], s['value']) for s in client.scores] == [('passed', 0.0)]   # production Run의 실패만 남는다


# --- 시뮬레이션 세트(simulation.act·simulation.narrate): 서비스 호출로 만들고 원문 평가 루브릭으로 채점한다 ---

GOLD = '"가자."'
SIM_META = {'judge': JUDGE}
ACT_PRODUCTION = {('character_simulation.act', 'production'): prompt('옛 act 지시문', 1)}


def act_items(count=2):
    return [item(n, ACT_INPUT, GOLD, SIM_META, 'simulation.act') for n in range(1, count + 1)]


def test_a_simulation_run_generates_with_the_service_call_and_records_the_rubric_metrics(monkeypatch):
    dataset, client, plan = prepared(monkeypatch, act_items(), request=ACT_REQUEST)
    evaluation = stub_models(monkeypatch)
    calls = stub_simulation(monkeypatch, grade=lambda payload: {'voice': 5 if payload['generated'] == '"갑시다."' else 1, 'intent': 3, 'leaked': ['f1'] if len(calls.grade) == 1 else []})

    service.run(plan)

    assert calls.generate == [('act', '지시문', ACT_INPUT)] * 2 and evaluation.generate == [] and evaluation.geval == []   # 업무 Agent 틀·G-Eval은 쓰지 않는다
    scores = {s['name']: s for s in client.scores}
    assert set(scores) == {'voice', 'intent', 'pov_ok', 'passed'}  # G-Eval 점수 하나가 아니라 지표 셋을 따로 남긴다
    assert (scores['voice']['value'], scores['intent']['value'], scores['pov_ok']['value']) == (1.0, 0.5, 0.5)   # (점수-1)/4로 0~1에 기록한다. 시점 위반 없음 1·있음 0의 평균
    assert scores['passed']['value'] == 1.0 and scores['passed']['metadata']['failedItems'] == 0
    assert dataset.experiment['metadata']['dataset'] == 'simulation.act'


def test_a_narration_run_scores_style_info_and_pov_ok(monkeypatch):
    items = [item(1, {'set': 'narration', 'data': ACT_INPUT['data']}, '다음 문단', SIM_META, 'simulation.narrate'),
             item(2, {'set': 'monologue', 'data': ACT_INPUT['data']}, '독백', SIM_META, 'simulation.narrate')]
    _, client, plan = prepared(monkeypatch, items, request=NARRATE_REQUEST)
    calls = stub_simulation(monkeypatch, grade=lambda payload: {'style': 4, 'info': 2, 'leaked': []})

    service.run(plan)

    assert [(kind, data['set']) for kind, _, data in calls.generate] == [('narrate', 'narration'), ('narrate', 'monologue')]
    assert {s['name']: s['value'] for s in client.scores} == {'style': 0.75, 'info': 0.25, 'pov_ok': 1.0, 'passed': 1.0}


def test_a_simulation_run_compares_each_rubric_metric_with_the_baseline_run(monkeypatch):
    runs = [experiment('character_simulation.act@v1-a', {'voice': 0.875, 'intent': 0.5, 'pov_ok': 1.0}),
            experiment('character_simulation.act@v1-old', {'geval': 0.9})]   # 지표 이름이 다른 옛 Run은 기준이 아니다
    dataset, client, plan = prepared(monkeypatch, act_items(), request=ACT_REQUEST, experiments=runs, prompts=ACT_PRODUCTION)
    stub_simulation(monkeypatch, grade=lambda payload: {'voice': 3, 'intent': 4, 'leaked': []})   # voice 0.5 < 0.875 - 0.1

    service.run(plan)

    assert plan.baseline == service.Baseline('character_simulation.act@v1-a', 1, {'voice': 0.875, 'intent': 0.5, 'pov_ok': 1.0})
    scores = {s['name']: s for s in client.scores}
    assert scores['voice']['metadata'] == {'baseline': 0.875, 'delta': -0.375, 'tolerance': 0.1}
    assert scores['intent']['metadata']['delta'] == 0.25 and scores['pov_ok']['metadata']['delta'] == 0.0
    assert scores['passed']['value'] == 0.0 and scores['passed']['metadata']['baselineVersion'] == 1


@pytest.mark.parametrize('where', ['generate', 'grade'])
def test_a_failed_simulation_item_stays_a_failure_instead_of_a_zero_score(monkeypatch, where):
    _, client, plan = prepared(monkeypatch, [item(1, ACT_INPUT, GOLD, SIM_META, 'simulation.act'), item(2, {**ACT_INPUT, 'data': {'self': {'id': 'c2'}}}, GOLD, SIM_META, 'simulation.act')],
                               request=ACT_REQUEST)

    def generate(kind, instructions, data):
        if where == 'generate' and data['data']['self']['id'] == 'c2':
            raise EvaluationFailure(503, '모델 호출에 실패했습니다.')
        return '"갑시다."'

    def grade(payload):
        if where == 'grade' and len(calls.grade) == 2:
            raise EvaluationFailure(502, '평가 채점에 실패했습니다.')
        return {'voice': 4, 'intent': 3, 'leaked': []}
    calls = stub_simulation(monkeypatch, generate=generate, grade=grade)

    service.run(plan)

    scores = {s['name']: s for s in client.scores}
    assert scores['voice']['value'] == 0.75  # 실패한 항목을 0점으로 평균에 섞지 않는다
    assert scores['passed']['value'] == 0.0 and (scores['passed']['metadata']['failedItems'], scores['passed']['metadata']['totalItems']) == (1, 2)


@pytest.mark.parametrize('dataset, prompt_name', [('simulation.act', 'character_simulation.narrate'), ('simulation.narrate', 'character_simulation.act'), ('simulation.act', 'qa.answer')])
def test_a_simulation_set_only_evaluates_the_instructions_of_its_own_call(monkeypatch, dataset, prompt_name):
    install(monkeypatch, FakeDataset(act_items(), dataset), {(prompt_name, 1): prompt('지시문', 1)})

    with pytest.raises(EvaluationFailure) as error:
        service.prepare(service.EvaluationRequest(dataset=dataset, prompt=prompt_name, version=1))

    assert error.value.status == 422   # 다른 호출의 지시문으로 돌리면 점수가 뜻이 없다


@pytest.mark.parametrize('dataset, prompt_name, stubbed', [('qa.grounding', 'qa.answer', 'models'), ('simulation.act', 'character_simulation.act', 'simulation')])
def test_the_evaluated_version_runs_on_the_model_chosen_in_that_version_even_through_the_worker(monkeypatch, dataset, prompt_name, stubbed):
    """#705: 모델은 프롬프트 버전 config.model이라 회귀 평가도 그 버전의 모델로 돈다(모델만 바꾼 버전도 평가 게이트를 거친다)."""
    request = EvaluationRequest(dataset=dataset, prompt=prompt_name, version=3)
    items = [item(1, QA)] if stubbed == 'models' else act_items(1)
    install(monkeypatch, FakeDataset(items, dataset), {(prompt_name, 3): prompt('지시문', 3, 'gpt-chosen')})
    plan = service.prepare(request)
    calls = stub_models(monkeypatch) if stubbed == 'models' else stub_simulation(monkeypatch)

    service.run_job(json.loads(json.dumps(service.to_job(plan))))

    assert plan.model == 'gpt-chosen' and calls.models == ['gpt-chosen']


def test_a_model_that_is_not_a_name_in_the_version_config_is_the_env_default(monkeypatch):
    install(monkeypatch, FakeDataset([item(1, QA)]), {('qa.answer', 3): SimpleNamespace(prompt='지시문', version=3, config={'model': None})})
    assert service.prepare(QA_REQUEST).model is None


def test_a_caller_can_name_the_run_before_it_exists_with_the_same_format(monkeypatch):
    """자동 개선(app/optimization)은 저장할 새 버전의 commitMessage에 평가 Run 이름을 넣어야 해서 이름을 먼저 만든다."""
    name = service.name_run('qa.answer', 4)
    assert re.fullmatch(r'qa\.answer@v4-\d{8}T\d{6}Z-[0-9a-f]{6}', name)

    install(monkeypatch, FakeDataset([item(1, QA)]), {('qa.answer', 3): prompt('지시문', 3)})
    assert service.prepare(QA_REQUEST, run_name=name).run_name == name
    assert service.prepare(QA_REQUEST).run_name != name   # 안 주면 지금처럼 새로 만든다


# --- 라우팅 세트(decision_guard.routing, #783): 실제 판정으로 만들고 정답과 견줘 모델 없이 채점한다 ---

ROUTING_REQUEST = EvaluationRequest(dataset='decision_guard.routing', prompt='decision_guard.judge', version=2)


def test_a_routing_run_judges_with_the_version_body_and_records_guard_precision_and_recall(monkeypatch):
    items = [item(1, {'request': '검수하고 고쳐줘'}, {'guard': 'none', 'capabilities': ['manuscript_review', 'writing_editing']}, None, 'decision_guard.routing'),
             item(2, {'request': '안녕'}, {'guard': 'none', 'capabilities': []}, None, 'decision_guard.routing')]
    _, client, plan = prepared(monkeypatch, items, request=ROUTING_REQUEST)
    evaluation = stub_models(monkeypatch)
    seen = []

    def judge(request, operation=None, materials=(), history=(), instructions=None):
        seen.append((request, instructions))
        return DecisionResult(allowed=True, capabilities=['manuscript_review'])
    monkeypatch.setattr(intent, 'judge', judge)

    service.run(plan)

    assert sorted(seen) == [('검수하고 고쳐줘', '지시문'), ('안녕', '지시문')] and evaluation.generate == [] and evaluation.geval == []
    assert {s['name']: s['value'] for s in client.scores} == {'guard': 1.0, 'precision': 0.5, 'recall': 0.75, 'passed': 1.0}


def test_the_routing_set_only_evaluates_the_guard_instructions(monkeypatch):
    install(monkeypatch, FakeDataset([item(1, {'request': '안녕'}, {'guard': 'none', 'capabilities': []}, None, 'decision_guard.routing')], 'decision_guard.routing'),
            {('qa.answer', 1): prompt('지시문', 1)})

    with pytest.raises(EvaluationFailure) as error:
        service.prepare(EvaluationRequest(dataset='decision_guard.routing', prompt='qa.answer', version=1))

    assert error.value.status == 422
