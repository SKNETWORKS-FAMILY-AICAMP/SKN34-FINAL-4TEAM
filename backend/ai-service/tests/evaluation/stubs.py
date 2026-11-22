"""평가 테스트 대역. 응답 픽스처는 실서버(Langfuse 4.78.0 events_only)가 돌려준 JSON이나 그 OpenAPI 모양이고, SDK의 실제 응답 파싱을 거친다.
데이터셋 항목은 실측 JSON(fixtures/dataset-item.json), Experiments API는 실제 SDK 클라이언트가 보낸 요청을 받는 httpx 대역 서버다
(v3 경로는 서버처럼 404). 채점 라이브러리와 모델은 부르지 않는다."""

import asyncio
import inspect
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
from langfuse.api import DatasetItem, LangfuseAPI, NotFoundError
from langfuse.api.core.pydantic_utilities import parse_obj_as
from langfuse.experiment import ExperimentItemResult, ExperimentResult

from app import tracing
from app.evaluation import service
from app.evaluation.models import EvaluationRequest

REAL_ITEM = json.loads((Path(__file__).parent / 'fixtures' / 'dataset-item.json').read_text(encoding='utf-8'))
DATASET_ID = REAL_ITEM['datasetId']
ISO = '2026-11-19T01:05:00.000Z'
QA = {'question': '길동의 어머니는 누구인가?', 'contexts': ['길동의 어머니는 시비 춘섬이다.', '초낭은 홍문의 총첩이다.']}
QA_REQUEST = EvaluationRequest(dataset='qa.grounding', prompt='qa.answer', version=3)
GEVAL_REQUEST = EvaluationRequest(dataset='world.conflict', prompt='world.check', version=1)
ACT_REQUEST = EvaluationRequest(dataset='simulation.act', prompt='character_simulation.act', version=2)
NARRATE_REQUEST = EvaluationRequest(dataset='simulation.narrate', prompt='character_simulation.narrate', version=2)
ACT_INPUT = {'set': 'dialogue', 'data': {'self': {'id': 'c1', 'name': '길동'}, 'scene': [{'ref': 'scene:0', 'by': '길동', 'text': '"가자."'}]}}
JUDGE = {'character': '길동', 'scene': [{'by': '길동', 'text': '"가자."'}], 'facts': [{'id': 'f1', 'text': '미래 사건'}]}
CRITERIA = {'criteria': '충돌 지점을 짚으면 높은 점수'}


def item(number, input, expected=None, metadata=None, dataset='qa.grounding') -> DatasetItem:
    """실서버가 돌려준 데이터셋 항목 JSON에 값만 바꿔 SDK 모델로 읽는다."""
    return parse_obj_as(DatasetItem, {**REAL_ITEM, 'id': f'{dataset}-{number}', 'datasetName': dataset, 'input': input, 'expectedOutput': expected,
                                      'metadata': metadata})


def prompt(text, version):
    return SimpleNamespace(prompt=text, version=version)


def _score(name, value, data_type):
    """Experiment에 직접 붙은 점수(ScoreV3) JSON. 필수 필드는 OpenAPI의 NumericScoreV3·BooleanScoreV3와 같다."""
    return {'id': f'score-{name}', 'projectId': 'project-1', 'name': name, 'value': value, 'dataType': data_type, 'source': 'API',
            'timestamp': ISO, 'environment': 'default', 'createdAt': ISO, 'updatedAt': ISO}


def experiment(name, metrics, *, passed=True, id=None) -> dict:
    """GET /api/public/experiments 응답 항목(Experiment) JSON. 끝난 Run은 지표 평균 점수와 passed 점수를 가진다. passed=None이면 아직 끝나지 않은 Run이다."""
    scores = [_score(metric, value, 'NUMERIC') for metric, value in metrics.items()]
    if passed is not None:
        scores.append(_score('passed', passed, 'BOOLEAN'))
    return {'id': id or f'exp-{name}', 'name': name, 'description': None, 'startTime': ISO, 'endTime': ISO, 'itemCount': 2, 'datasetId': DATASET_ID,
            'scores': scores}


class FakeDataset:
    """Langfuse DatasetClient 대역. run_experiment는 SDK 4.18처럼 동작한다: 항목마다 task를 돌리기 전에 서버에 run item을 만들어 Run id를 받고
    (links=False는 서버가 run item을 받지 않는 환경), task가 실패한 항목은 결과에서 빠지며, 평가자가 실패하면 그 평가자의 점수만 빠진다.
    결과의 dataset_run_id는 결과에 남은 항목이 알려 주는 값이라 모든 항목이 실패하면 None이고, 그때 experiment_id는 서버의 어떤 Run도
    가리키지 않는 임의 ID다."""

    RUN_ID = 'run-real'  # 서버가 정한 Run id

    def __init__(self, items, name='qa.grounding', *, links=True):
        self.id, self.name, self.items, self.links = DATASET_ID, name, items, links
        self.experiment, self.runs = None, {}  # runs: 서버에 만들어진 Run 이름 → id

    def run_experiment(self, *, name, run_name, description, task, evaluators, max_concurrency, metadata=None):
        self.experiment = {'name': name, 'run_name': run_name, 'description': description, 'max_concurrency': max_concurrency, 'metadata': metadata}
        results = []
        for it in self.items:
            if self.links:
                self.runs[run_name] = self.RUN_ID
            try:
                output = _run(task(item=it))
            except Exception:
                continue
            evaluations = []
            for evaluator in evaluators:
                try:
                    found = _run(evaluator(input=it.input, output=output, expected_output=it.expected_output, metadata=it.metadata))
                except Exception:
                    continue
                evaluations += found if isinstance(found, list) else [found]
            results.append(ExperimentItemResult(item=it, output=output, evaluations=evaluations, trace_id='trace',
                                                dataset_run_id=self.RUN_ID if self.links else None))
        run_id = next((r.dataset_run_id for r in results if r.dataset_run_id), None)
        return ExperimentResult(name=name, run_name=run_name, description=description, item_results=results, run_evaluations=[],
                                experiment_id=run_id or 'sdk-fallback-id', dataset_run_id=run_id)


def _run(value):
    return asyncio.run(value) if inspect.iscoroutine(value) else value


class FakeLangfuse:
    """Langfuse 클라이언트 대역. api는 실제 SDK 클라이언트이고 요청은 _serve가 받는다. lag는 방금 만든 실험이 보이기까지 건너뛸 조회 수(v4는 이벤트를
    비동기로 수집한다), experiments_status는 Experiments API가 돌려줄 오류 상태(서버가 그 API를 모르면 404)다."""

    def __init__(self, dataset, prompts, experiments):
        self.dataset, self.prompts, self.experiments = dataset, prompts, list(experiments)
        self.scores, self.flushed, self.requests, self.lag, self.experiments_status = [], 0, [], 0, 200
        self.api = LangfuseAPI(base_url='http://langfuse.test', x_langfuse_sdk_name='python', x_langfuse_sdk_version='4.18.0', username='pk', password='sk',
                               httpx_client=httpx.Client(transport=httpx.MockTransport(self._serve)))

    def get_dataset(self, name, **_):
        if self.dataset is None:
            raise NotFoundError(body='missing')
        return self.dataset

    def get_prompt(self, name, *, version=None, label=None, **_):
        found = self.prompts.get((name, version if version is not None else label))
        if found is None:
            raise NotFoundError(body='missing')
        return found

    def _serve(self, request: httpx.Request) -> httpx.Response:
        """실서버(4.78.0 events_only)처럼 GET /api/public/experiments만 답하고 v3 경로(dataset runs 등)는 404다."""
        if request.method != 'GET' or request.url.path != '/api/public/experiments':
            return httpx.Response(404, json={'message': 'Not Found'})
        self.requests.append(request)
        query = request.url.params
        if self.experiments_status != 200:
            return httpx.Response(self.experiments_status, json={'message': '원고 본문 일부'})
        if 'fromStartTime' not in query or int(query.get('limit', 50)) > 100:  # 시작 시각 하한 필수, 한 쪽 최대 100
            return httpx.Response(400, json={'message': 'Invalid request'})
        names = query['name'].split(',') if 'name' in query else None
        datasets = query['datasetId'].split(',') if 'datasetId' in query else None
        found = [e for e in self.experiments if (names is None or e['name'] in names) and (datasets is None or e['datasetId'] in datasets)]
        for name in names or []:  # 서버에 만들어진 Run은 이름으로 찾을 수 있다
            if name in getattr(self.dataset, 'runs', {}):
                if self.lag > 0:
                    self.lag -= 1
                else:
                    found.append(experiment(name, {}, passed=None, id=self.dataset.runs[name]))
        with_scores = 'scores' in query.get('fields', 'core').split(',')
        data = [e if with_scores else {k: v for k, v in e.items() if k != 'scores'} for e in found[:int(query.get('limit', 50))]]
        return httpx.Response(200, json={'data': data, 'meta': {}})

    def create_score(self, **kwargs):
        self.scores.append(kwargs)

    def flush(self):
        self.flushed += 1


def install(monkeypatch, dataset=None, prompts=None, experiments=()) -> FakeLangfuse:
    """Langfuse·모델 설정이 있는 환경에 대역 클라이언트를 건다."""
    for name in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL'):
        monkeypatch.setenv(name, 'x')
    monkeypatch.delenv('EVAL_TOLERANCE', raising=False)
    client = FakeLangfuse(dataset, prompts or {}, experiments)
    monkeypatch.setattr(tracing, 'client', lambda: client)
    return client


def prepared(monkeypatch, items, *, request=QA_REQUEST, experiments=(), prompts=None, tolerance=None):
    """평가 세트와 지정 버전 프롬프트(지시문)가 있는 Langfuse에서 평가를 준비한다."""
    dataset = FakeDataset(items, request.dataset)
    client = install(monkeypatch, dataset, {(request.prompt, request.version): prompt('지시문', request.version), **(prompts or {})}, experiments)
    if tolerance:
        monkeypatch.setenv('EVAL_TOLERANCE', tolerance)
    return dataset, client, service.prepare(request)


def stub_models(monkeypatch, *, generate=None, ragas=None, geval=None):
    """모델 실행과 두 채점기 대역. 호출 기록을 돌려준다. generate·ragas·geval은 기본 응답을 바꾸는 함수다."""
    calls = SimpleNamespace(generate=[], ragas=[], geval=[])

    def run(instructions, data):
        calls.generate.append((instructions, data))
        return generate(instructions, data) if generate else '답: ' + str(data.get('question') or data.get('text'))

    async def ragas_scores(question, contexts, answer):
        calls.ragas.append((question, contexts, answer))
        return ragas(question, contexts, answer) if ragas else {'faithfulness': 0.9, 'context_precision': 0.8}

    async def judge(criteria, input_text, output, expected=None):
        calls.geval.append((criteria, input_text, output, expected))
        return geval(criteria, input_text, output, expected) if geval else (0.7, '이유')

    monkeypatch.setattr(service.agent, 'generate', run)
    monkeypatch.setattr(service.scoring, 'ragas_scores', ragas_scores)
    monkeypatch.setattr(service.scoring, 'geval', judge)
    return calls


def stub_simulation(monkeypatch, *, generate=None, grade=None):
    """시뮬레이션 세트의 서비스 호출 생성과 루브릭 채점 대역. 호출 기록을 돌려준다. generate(kind, instructions, input)·grade(payload)는 기본 응답을 바꾸는 함수다."""
    calls = SimpleNamespace(generate=[], grade=[])

    def run(kind, instructions, data):
        calls.generate.append((kind, instructions, data))
        return generate(kind, instructions, data) if generate else '"갑시다."'

    async def rubric_grade(instructions, payload, schema):
        calls.grade.append((instructions, payload, schema))
        return dict(grade(payload) if grade else {'voice': 4, 'intent': 3, 'leaked': []})

    monkeypatch.setattr(service.simulation, 'generate', run)
    monkeypatch.setattr(service.scoring, 'rubric_grade', rubric_grade)
    return calls
