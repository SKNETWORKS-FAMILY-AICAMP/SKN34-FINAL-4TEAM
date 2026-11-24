"""추출 평가 세트(extraction.extract)의 서비스 틀: 짝 확인, 서비스 호출 생성, 코드 채점 지표의 Run 점수, 기준 Run 비교. 모델 호출은 대역이고 채점 모델은 없다."""

import json
from types import SimpleNamespace

import pytest

from app.evaluation import service
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationRequest
from app.manuscript_extraction.errors import PreprocessingFailure

from .stubs import FakeDataset, experiment, install, item, prepared, prompt

REQUEST = EvaluationRequest(dataset='extraction.extract', prompt='manuscript_extraction.extract', version=2)
Q1, Q2 = '김 첨지는 새벽부터 인력거를 끌고 나갔다.', '치삼이는 김 첨지의 오랜 친구였다.'
INPUT = {'number': 1, 'title': '운수 좋은 날', 'body': '\n'.join((Q1, Q2))}
GOLD = {'mentions': [{'name': '김 첨지', 'kind': 'character', 'aliases': [], 'core': True}, {'name': '치삼', 'kind': 'character', 'aliases': [], 'core': True}],
        'statements': [{'kind': 'event', 'quote': Q1, 'core': True}], 'relationships': []}
FULL = {'mentions': [{'id': 'a', 'name': '김 첨지', 'kind': 'character', 'quote': Q1}, {'id': 'b', 'name': '치삼', 'kind': 'character', 'quote': Q2}],
        'statements': [{'id': 's', 'kind': 'event', 'quote': Q1}], 'relationships': [], 'skipped': {}}   # 재현율 1, 인용 통과율 1
LOSSY = {'mentions': FULL['mentions'][:1], 'statements': FULL['statements'], 'relationships': [], 'skipped': {'UNKNOWN_ENTITY': 1}}   # 대상 재현율 0.5·진술 1 → 0.75, 통과 2 ÷ 3
PRODUCTION = {('manuscript_extraction.extract', 'production'): prompt('옛 추출 지시문', 1)}


def items(count=2):
    return [item(n, INPUT, GOLD, {}, 'extraction.extract') for n in range(1, count + 1)]


def stub_extraction(monkeypatch, *, generate=None):
    """서비스 호출 생성 대역과 채점 모델 금지. 호출 기록을 돌려준다. generate(instructions, input)는 기본 응답(FULL)을 바꾸는 함수다."""
    calls = SimpleNamespace(generate=[], models=[])

    def run(instructions, data, model=None):
        calls.generate.append((instructions, data))
        calls.models.append(model)
        return generate(instructions, data) if generate else FULL

    async def never(*_, **__):
        raise AssertionError('추출 평가는 채점 모델을 부르지 않는다')
    monkeypatch.setattr(service.extraction, 'generate', run)
    for judge in ('rubric_grade', 'geval', 'ragas_scores'):
        monkeypatch.setattr(service.scoring, judge, never)
    return calls


def test_an_extraction_run_generates_with_the_service_call_and_records_the_code_scored_metrics(monkeypatch):
    dataset, client, plan = prepared(monkeypatch, items(), request=REQUEST)
    answers = iter([FULL, LOSSY])
    calls = stub_extraction(monkeypatch, generate=lambda instructions, data: next(answers))

    service.run(plan)

    assert calls.generate == [('지시문', INPUT)] * 2   # 지정 버전의 본문과 항목 입력(회차 한 편) 그대로
    scores = {s['name']: s for s in client.scores}
    assert set(scores) == {'recall', 'quote_ok', 'passed'}   # 참고 지표(정밀도·종류 일치 등)는 Run 점수로 남기지 않는다
    assert scores['recall']['value'] == pytest.approx((1.0 + 0.75) / 2) and scores['quote_ok']['value'] == pytest.approx((1.0 + 2 / 3) / 2)
    assert scores['passed']['value'] == 1.0 and scores['passed']['metadata']['failedItems'] == 0
    assert dataset.experiment['metadata']['dataset'] == 'extraction.extract'


def test_an_extraction_run_compares_each_gate_metric_with_the_baseline_run(monkeypatch):
    runs = [experiment('manuscript_extraction.extract@v1-partial', {'recall': 0.1}),   # 지표 하나뿐인 Run은 기준이 아니다
            experiment('manuscript_extraction.extract@v1-a', {'recall': 0.95, 'quote_ok': 1.0}),
            experiment('manuscript_extraction.extract@v1-old', {'geval': 0.9})]   # 지표 이름이 다른 옛 Run도 아니다
    dataset, client, plan = prepared(monkeypatch, items(), request=REQUEST, experiments=runs, prompts=PRODUCTION)
    stub_extraction(monkeypatch, generate=lambda instructions, data: LOSSY)   # recall 0.75 < 0.95 - 0.1

    service.run(plan)

    assert plan.baseline == service.Baseline('manuscript_extraction.extract@v1-a', 1, {'recall': 0.95, 'quote_ok': 1.0})
    scores = {s['name']: s for s in client.scores}
    assert scores['recall']['metadata'] == {'baseline': 0.95, 'delta': -0.2, 'tolerance': 0.1}
    assert scores['quote_ok']['metadata']['delta'] == pytest.approx(2 / 3 - 1.0, abs=1e-6)
    assert scores['passed']['value'] == 0.0 and scores['passed']['metadata']['baselineVersion'] == 1


@pytest.mark.parametrize('where', ['generate', 'score'])
def test_a_failed_extraction_item_stays_a_failure_instead_of_a_zero_score(monkeypatch, where):
    broken = item(2, INPUT, None if where == 'score' else GOLD, {}, 'extraction.extract')   # 정답표가 없는 항목은 채점 단계에서 실패한다
    _, client, plan = prepared(monkeypatch, [items(1)[0], broken], request=REQUEST)

    def generate(instructions, data):
        if where == 'generate' and len(calls.generate) == 2:
            raise PreprocessingFailure('MODEL_TIMEOUT', 504)
        return FULL
    calls = stub_extraction(monkeypatch, generate=generate)

    service.run(plan)

    scores = {s['name']: s for s in client.scores}
    assert scores['recall']['value'] == 1.0   # 실패한 항목을 0점으로 평균에 섞지 않는다
    assert scores['passed']['value'] == 0.0 and (scores['passed']['metadata']['failedItems'], scores['passed']['metadata']['totalItems']) == (1, 2)


@pytest.mark.parametrize('dataset, prompt_name', [('extraction.extract', 'manuscript_extraction.resolve'), ('extraction.extract', 'character_simulation.act'),
                                                  ('extraction.extract', 'qa.answer'), ('simulation.act', 'manuscript_extraction.extract')])
def test_an_extraction_set_only_evaluates_its_own_instruction_and_no_other_set_evaluates_it(monkeypatch, dataset, prompt_name):
    install(monkeypatch, FakeDataset(items(), dataset), {(prompt_name, 1): prompt('지시문', 1)})

    with pytest.raises(EvaluationFailure) as error:
        service.prepare(EvaluationRequest(dataset=dataset, prompt=prompt_name, version=1))

    assert error.value.status == 422   # 다른 호출의 지시문으로 돌리면 점수가 뜻이 없다


def test_the_evaluated_version_runs_on_the_model_chosen_in_that_version_even_through_the_worker(monkeypatch):
    request = EvaluationRequest(dataset='extraction.extract', prompt='manuscript_extraction.extract', version=3)
    install(monkeypatch, FakeDataset(items(1), 'extraction.extract'), {('manuscript_extraction.extract', 3): prompt('지시문', 3, 'gpt-chosen')})
    plan = service.prepare(request)
    calls = stub_extraction(monkeypatch)

    service.run_job(json.loads(json.dumps(service.to_job(plan))))

    assert plan.model == 'gpt-chosen' and calls.models == ['gpt-chosen']
