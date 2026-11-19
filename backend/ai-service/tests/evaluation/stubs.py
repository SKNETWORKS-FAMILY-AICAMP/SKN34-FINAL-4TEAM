"""평가 테스트 대역. Langfuse SDK의 실제 타입(DatasetItem·Evaluation·ExperimentResult·Experiment)으로 모양을 맞추고,
채점 라이브러리와 모델은 부르지 않는다."""

import asyncio
import inspect
from datetime import datetime, timezone
from types import SimpleNamespace

from langfuse.api import DatasetItem, NotFoundError
from langfuse.api.experiments.types.experiment import Experiment
from langfuse.api.scores_v3.types.score_v3 import ScoreV3_Boolean, ScoreV3_Numeric
from langfuse.experiment import ExperimentItemResult, ExperimentResult

from app import tracing
from app.evaluation import service
from app.evaluation.models import EvaluationRequest

NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)
QA = {'question': '길동의 어머니는 누구인가?', 'contexts': ['길동의 어머니는 시비 춘섬이다.', '초낭은 홍문의 총첩이다.']}
QA_REQUEST = EvaluationRequest(dataset='qa.grounding', prompt='qa.answer', version=3)
GEVAL_REQUEST = EvaluationRequest(dataset='world.conflict', prompt='world.check', version=1)
CRITERIA = {'criteria': '충돌 지점을 짚으면 높은 점수'}


def item(number, input, expected=None, metadata=None, dataset='qa.grounding') -> DatasetItem:
    return DatasetItem(id=f'{dataset}-{number}', status='ACTIVE', input=input, expected_output=expected, metadata=metadata,
                       media_references=[], dataset_id='ds-1', dataset_name=dataset, created_at=NOW, updated_at=NOW)


def prompt(text, version):
    return SimpleNamespace(prompt=text, version=version)


def _score(kind, name, value):
    return kind(value=value, id=f'score-{name}', project_id='p', name=name, source='API', timestamp=NOW, environment='default',
                created_at=NOW, updated_at=NOW)


def experiment(name, metrics, *, passed=True, id=None) -> Experiment:
    """끝난 Run은 지표 평균 점수와 passed 점수를 가진다. passed=None이면 아직 끝나지 않은 Run이다."""
    scores = [_score(ScoreV3_Numeric, metric, value) for metric, value in metrics.items()]
    if passed is not None:
        scores.append(_score(ScoreV3_Boolean, 'passed', passed))
    return Experiment(id=id or f'exp-{name}', name=name, start_time=NOW, end_time=NOW, item_count=2, dataset_id='ds-1', scores=scores)


class FakeDataset:
    """Langfuse DatasetClient 대역. run_experiment는 SDK 4.18처럼 동작한다: 항목마다 task를 돌리기 전에 서버에 run item을 만들어 Run id를 받고
    (links=False는 서버가 run item을 받지 않는 환경), task가 실패한 항목은 결과에서 빠지며, 평가자가 실패하면 그 평가자의 점수만 빠진다.
    결과의 dataset_run_id는 결과에 남은 항목이 알려 주는 값이라 모든 항목이 실패하면 None이고, 그때 experiment_id는 서버의 어떤 Run도
    가리키지 않는 임의 ID다."""

    RUN_ID = 'run-real'  # 서버가 정한 Run id

    def __init__(self, items, name='qa.grounding', *, links=True):
        self.id, self.name, self.items, self.links = 'ds-1', name, items, links
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
    def __init__(self, dataset, prompts, experiments):
        self.dataset, self.prompts, self.experiments = dataset, prompts, list(experiments)
        self.scores, self.flushed, self.listed = [], 0, None
        self.api = SimpleNamespace(experiments=SimpleNamespace(list=self._list))

    def get_dataset(self, name, **_):
        if self.dataset is None:
            raise NotFoundError(body='missing')
        return self.dataset

    def get_prompt(self, name, *, version=None, label=None, **_):
        found = self.prompts.get((name, version if version is not None else label))
        if found is None:
            raise NotFoundError(body='missing')
        return found

    def _list(self, *, from_start_time, **kwargs):  # SDK처럼 시작 시각 하한이 필수다
        self.listed = kwargs
        name = kwargs.get('name')
        found = [e for e in self.experiments if name in (None, e.name)]
        runs = getattr(self.dataset, 'runs', {})  # 서버에 만들어진 Run은 이름으로 찾을 수 있다
        if name in runs:
            found.append(experiment(name, {}, passed=None, id=runs[name]))
        return SimpleNamespace(data=found)

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
