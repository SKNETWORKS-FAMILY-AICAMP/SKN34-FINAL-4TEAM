"""회귀 평가(DEC-55, docs/design/operations-llmops-contract.md): Langfuse 평가 세트(Dataset)의 항목마다 지정한 프롬프트 버전으로 기능을
실행하고 채점해 Run(experiment)에 점수를 남긴다. 누설 판정(DeepEval GEval 한 번)도 여기서 한다.

평가 세트 이름이 qa.로 시작하면 Ragas(faithfulness·context precision), 그 밖은 DeepEval GEval(항목 metadata.criteria)로 채점한다.
항목 input은 객체이며 프롬프트 본문(지시문)과 함께 업무 Agent와 같은 실행 틀(app/agent_runtime.py)로 모델에 보낸다.
끝나면 Run 수준 점수로 지표 평균(점수 metadata에 기준 평균·차이)과 통과 여부(passed)를 남긴다. 통과 기준은 실패한 항목이 없고 모든 지표가
기준 Run 평균 - EVAL_TOLERANCE(기본 0.05) 이상인 것이다. 기준 Run은 현재 production 버전의 가장 최근에 끝나고 지표 평균이 남은 Run이며 없으면 지표를 비교하지 않는다.
실패한 항목(모델·채점 실패, 입력 형식 오류)은 0점으로 평균에 섞지 않고 점수 없는 실패로 두며 passed는 false다.
입력·응답 본문은 오류와 로그에 넣지 않는다.
"""

import asyncio
import json
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from statistics import fmean
from time import sleep

from langfuse import Evaluation
from langfuse.api import NotFoundError

from app import tracing
from app.evaluation import agent, scoring
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationRequest, LeakCheckRequest, LeakCheckResponse

logger = logging.getLogger(__name__)

QA_PREFIX = 'qa.'
QA_METRICS = ('faithfulness', 'context_precision')
GEVAL_METRICS = ('geval',)
MAX_CONCURRENCY = 5  # 항목마다 모델을 두 번 이상 부르므로 제공사 한도를 넘지 않게 동시 항목 수를 낮게 둔다
LOOKUP_WINDOW = timedelta(days=180)  # Langfuse 실험 조회는 시작 시각 하한이 필수다
LOOKUP_ATTEMPTS = 10  # v4는 이벤트를 비동기로 수집해 방금 만든 실험이 바로 안 보일 수 있다: 이 횟수까지 LOOKUP_WAIT초씩 기다린다
LOOKUP_WAIT = 3
LEAK_THRESHOLD = 0.5
LEAK_CRITERIA = ('input의 참조 목록은 독자에게 공개되지 않은 설정 카드 제목과 미발행 회차 제목이다. '
                 'actual_output(응답)이 참조 목록 항목의 존재나 내용을 독자에게 드러내면 높은 점수를, '
                 '참조와 무관하거나 공개된 일반 정보만 말하면 낮은 점수를 준다. '
                 '다만 사용자 질문에 이미 나온 이름을 되풀이하거나 근거가 없다고 답한 것은 누설이 아니다. '
                 '비공개 참조의 내용(관계·사건·결말 등)을 새로 알려 줄 때만 누설이다.')
LANGFUSE_FAILED = 'Langfuse 요청에 실패했습니다.'


@dataclass(frozen=True)
class Baseline:
    run: str  # 기준 Run 이름
    version: int  # 기준 프롬프트 버전(production)
    metrics: dict[str, float]  # 지표별 평균


@dataclass(frozen=True)
class Plan:
    """prepare가 확인을 마친 평가 한 건. run이 이 계획대로 실행한다."""
    request: EvaluationRequest
    run_name: str
    dataset: object  # Langfuse DatasetClient
    instructions: str  # 요청한 버전의 프롬프트 본문
    tolerance: float
    baseline: Baseline | None


def prepare(request: EvaluationRequest) -> Plan:
    """평가를 시작하기 전에 확인한다: Langfuse·모델 설정, 허용 오차, 평가 세트, 요청한 프롬프트 버전. 어긋나면 Run을 만들지 않고 오류로 돌려준다."""
    client = _client()
    scoring.require_model()
    tolerance = _tolerance()
    dataset = _fetch(client.get_dataset, request.dataset, missing='평가 세트를 찾을 수 없어요.')
    if not dataset.items:
        raise EvaluationFailure(422, '평가 세트에 항목이 없어요.')
    prompt = _fetch(client.get_prompt, request.prompt, version=request.version, missing='프롬프트 버전을 찾을 수 없어요.')
    if not isinstance(prompt.prompt, str):  # 채팅 프롬프트는 메시지 목록이라 지시문으로 쓸 수 없다
        raise EvaluationFailure(422, '텍스트 프롬프트만 평가할 수 있어요.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    return Plan(request, f'{request.prompt}@v{request.version}-{stamp}-{secrets.token_hex(3)}', dataset, prompt.prompt, tolerance,
                _baseline(client, dataset, request))


def run(plan: Plan) -> None:
    """백그라운드 실행(예외를 올리지 않는다). 결과는 Langfuse의 Run 점수로만 남는다.

    ponytail: FastAPI BackgroundTasks라 서버를 재시작하면 진행 중이던 평가가 끊기고 그 Run은 passed 점수 없이 남는다. Celery 병합 후 작업으로 옮긴다.
    """
    try:
        _run(plan)
    except Exception as error:  # 입력·응답 본문이 섞일 수 있어 고정 문구(EvaluationFailure)가 아니면 예외 이름만 남긴다
        logger.error('회귀 평가 %s 실패: %s', plan.run_name, error if isinstance(error, EvaluationFailure) else type(error).__name__)


def judge(averages: dict[str, float], baseline: dict[str, float] | None, tolerance: float, failed: int) -> tuple[bool, dict[str, float]]:
    """통과 판정과 지표별 기준 대비 차이. 실패한 항목이 있거나 지표 하나라도 기준 평균 - tolerance 아래면 불통과, 기준이 없으면 실패 항목만 본다."""
    deltas = {metric: round(average - baseline[metric], 6) for metric, average in averages.items() if baseline and metric in baseline}
    return failed == 0 and all(delta >= -tolerance for delta in deltas.values()), deltas


def leak_check(data: LeakCheckRequest) -> LeakCheckResponse:
    """응답이 참조 목록의 비공개 설정·미발행 회차 내용을 드러내는지 GEval 한 번으로 판정한다. 점수가 높을수록 누설이다.
    사용자 질문이 있으면 입력에 함께 주어, 질문에 이미 나온 이름을 되풀이한 응답을 누설로 보지 않게 한다."""
    references = '비공개 참조 목록:\n' + '\n'.join(f'- {reference}' for reference in data.references)
    question = (data.question or '').strip()
    input_text = f'사용자 질문:\n{question}\n\n{references}' if question else references
    score, reason = asyncio.run(scoring.geval(LEAK_CRITERIA, input_text, data.response))
    return LeakCheckResponse(suspected=score >= LEAK_THRESHOLD, reason=reason)


def _run(plan: Plan) -> None:
    request, baseline = plan.request, plan.baseline
    qa = request.dataset.startswith(QA_PREFIX)

    async def execute(*, item, **_):
        # 모델 호출은 블로킹이라 스레드로 보내 항목을 동시에 돌린다(추적 문맥은 to_thread가 복사한다).
        return await asyncio.to_thread(agent.generate, plan.instructions, _input(item))

    result = plan.dataset.run_experiment(
        name=f'{request.prompt} v{request.version} 회귀 평가', run_name=plan.run_name,
        description=f'프롬프트 {request.prompt} 버전 {request.version}을 평가 세트 {request.dataset}로 평가',
        task=execute, evaluators=[_ragas_evaluator if qa else _geval_evaluator], max_concurrency=MAX_CONCURRENCY,
        metadata={'prompt': request.prompt, 'version': str(request.version), 'dataset': request.dataset, 'tolerance': str(plan.tolerance),
                  'baselineRun': baseline.run if baseline else '', 'baselineVersion': str(baseline.version) if baseline else ''})
    _record(tracing.client(), plan, result, QA_METRICS if qa else GEVAL_METRICS)


def _record(client, plan: Plan, result, metrics: tuple[str, ...]) -> None:
    """Run 수준 점수를 남긴다. 지표를 모두 채점받은 항목만 평균에 넣고 나머지는 실패로 센다."""
    run_id = _run_id(client, plan, result)
    done = [r for r in result.item_results if set(metrics) <= {e.name for e in r.evaluations}]
    total = len(plan.dataset.items)
    averages = {m: fmean(e.value for r in done for e in r.evaluations if e.name == m) for m in metrics} if done else {}
    baseline = plan.baseline
    passed, deltas = judge(averages, baseline.metrics if baseline else None, plan.tolerance, total - len(done))
    for name, average in averages.items():
        client.create_score(dataset_run_id=run_id, name=name, value=average, data_type='NUMERIC',
                            metadata={'baseline': baseline.metrics.get(name) if baseline else None, 'delta': deltas.get(name), 'tolerance': plan.tolerance})
    client.create_score(dataset_run_id=run_id, name='passed', value=float(passed), data_type='BOOLEAN',
                        comment=None if baseline else '기준 Run이 없어 지표를 비교하지 않았습니다.',
                        metadata={'failedItems': total - len(done), 'totalItems': total, 'tolerance': plan.tolerance,
                                  'baselineRun': baseline.run if baseline else None, 'baselineVersion': baseline.version if baseline else None})
    client.flush()


def _run_id(client, plan: Plan, result) -> str:
    """Run 수준 점수를 붙일 실험 id(점수의 datasetRunId). 결과가 있으면 SDK의 experiment_id가 그 항목들이 가진 ID다(서버가 알려 준 dataset_run_id,
    run item을 받지 않는 v4면 항목 span이 싣는 실험 ID). 모든 항목이 task 단계에서 실패하면 experiment_id가 어떤 실험도 가리키지 않는 임의 ID라서
    Experiments API에서 Run 이름으로 찾는다. 수집이 비동기라 안 보이면 정해진 횟수까지 기다려 다시 묻고, 끝내 못 찾으면 점수 없이 실패로 올린다."""
    if result.item_results:
        return result.experiment_id
    for attempt in range(LOOKUP_ATTEMPTS):
        if attempt:
            sleep(LOOKUP_WAIT)
        found = _experiments(client, name=plan.run_name, fields='core', limit=1)
        if found:
            return found[0].id
    raise EvaluationFailure(502, 'Langfuse에서 평가 Run을 찾지 못해 결과를 기록하지 못했습니다.')


async def _ragas_evaluator(*, input, output, **_):
    question, contexts = input.get('question'), input.get('contexts')
    if not (isinstance(question, str) and question.strip() and isinstance(contexts, list) and contexts
            and all(isinstance(context, str) and context.strip() for context in contexts)):
        raise EvaluationFailure(422, 'Q&A 평가 항목의 input에는 question과 contexts(문자열 목록)가 필요합니다.')
    return [Evaluation(name=name, value=value) for name, value in (await scoring.ragas_scores(question, contexts, output)).items()]


async def _geval_evaluator(*, input, output, expected_output=None, metadata=None, **_):
    criteria = (metadata or {}).get('criteria')
    if not isinstance(criteria, str) or not criteria.strip():
        raise EvaluationFailure(422, '평가 항목의 metadata.criteria가 필요합니다.')
    score, reason = await scoring.geval(criteria, json.dumps(input, ensure_ascii=False), output,
                                        expected_output if isinstance(expected_output, str) else None)
    return Evaluation(name='geval', value=score, comment=reason)


def _input(item) -> dict:
    if not isinstance(item.input, dict):
        raise EvaluationFailure(422, '평가 항목의 input은 객체여야 합니다.')
    return item.input


def _client():
    if not (os.environ.get('LANGFUSE_PUBLIC_KEY') and os.environ.get('LANGFUSE_SECRET_KEY')):
        raise EvaluationFailure(503, 'Langfuse 설정이 필요합니다.')
    return tracing.client()


def _tolerance() -> float:
    try:
        tolerance = float(os.environ.get('EVAL_TOLERANCE', '0.05'))
    except ValueError:
        tolerance = -1.0
    if not tolerance >= 0:  # NaN·음수
        raise EvaluationFailure(503, 'EVAL_TOLERANCE 설정이 올바르지 않습니다.')
    return tolerance


def _fetch(call, *args, missing: str | None = None, **kwargs):
    """Langfuse 조회. 없으면 404(missing이 None이면 None), 그 밖의 실패(연결·인증·형식)는 원인 메시지 없이 502로 바꾼다."""
    try:
        return call(*args, **kwargs)
    except NotFoundError:
        if missing is None:
            return None
        raise EvaluationFailure(404, missing) from None
    except Exception:  # 외부 SDK 예외 메시지는 입력을 담을 수 있어 고정 문구로만 알린다
        raise EvaluationFailure(502, LANGFUSE_FAILED) from None


def _experiments(client, **query) -> list:
    """Experiments API(v4, GET /api/public/experiments)로 실험을 조회한다. 어떤 실패든(이 서버에 API가 없어 404인 경우 포함) 원인 메시지 없이 502다."""
    try:
        return client.api.experiments.list(from_start_time=datetime.now(timezone.utc) - LOOKUP_WINDOW, **query).data
    except Exception:  # 외부 SDK 예외 메시지는 입력을 담을 수 있어 고정 문구로만 알린다
        raise EvaluationFailure(502, LANGFUSE_FAILED) from None


def _baseline(client, dataset, request: EvaluationRequest) -> Baseline | None:
    """기준 Run: 현재 production 버전의 가장 최근에 끝나고 지표 평균이 남은(passed 점수와 지표 점수가 모두 있는) Run. production 라벨이나
    그런 Run이 없으면 None이다.

    ponytail: 최근 100개 실험만 본다. 같은 세트의 Run이 그보다 많으면 기준을 못 찾아 비교하지 않으니 그때 cursor 페이지를 더한다.
    """
    production = _fetch(client.get_prompt, request.prompt, label='production')
    if production is None:
        return None
    metrics = QA_METRICS if request.dataset.startswith(QA_PREFIX) else GEVAL_METRICS
    prefix = f'{request.prompt}@v{production.version}-'  # Run 이름(prepare가 정한 형식)으로 찾는다
    for found in _experiments(client, dataset_id=dataset.id, fields='core,scores', limit=100):  # 최근 활동 순
        scores = {s.name: s.value for s in found.scores or []}
        if found.name.startswith(prefix) and 'passed' in scores and set(metrics) <= scores.keys():
            return Baseline(found.name, production.version, {m: float(scores[m]) for m in metrics})
    return None
