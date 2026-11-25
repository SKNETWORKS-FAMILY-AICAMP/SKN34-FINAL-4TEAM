"""프롬프트 자동 개선(#823, docs/design/operations-llmops-contract.md '프롬프트 자동 개선'): GEPA로 시뮬레이션 지시문의 새 버전을 만든다.

접수(accept): 지원 대상·설정·같은 프롬프트의 실행 중 여부를 본다(Postgres advisory lock). 실행(run_job, Celery 태스크 optimization.run): trace prompt_optimization 하나 안에서
기준 평가(production 기준 Run이 없을 때) → GEPA(최적화 풀의 train으로 반성, val로 선택) → 저장 조건 검사 → Langfuse 새 버전(라벨 없음) → 그 버전의 게이트 세트 회귀 평가 Run 1회로 끝난다.
후보 등록·서비스 반영은 사람이 한다. 실패는 trace ERROR와 고정 문구로 남기고(숨기지 않는다) 입력·응답 본문은 로그·trace에 넣지 않는다. gepa는 --extra eval이라 실행할 때 읽는다.
"""

import json
import logging
import os
import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import psycopg
from langfuse.api import NotFoundError

from app import tracing
from app.evaluation import scoring, simulation
from app.evaluation import service as evaluation
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationRequest
from app.optimization import agent, prompt
from app.optimization.adapter import SimulationAdapter
from app.optimization.errors import OptimizationFailure
from app.optimization.models import OptimizationRequest
from app.simulation.prompt import SAFETY

logger = logging.getLogger(__name__)

OPTIMIZABLE = {'character_simulation.act': 'simulation.act', 'character_simulation.narrate': 'simulation.narrate'}   # 프롬프트 → 게이트 세트(최적화 풀 파일 이름도 같다)
POOLS = Path(__file__).parents[1] / 'evaluation' / 'datasets' / 'optimize'   # 풀 파일(seed가 Dataset optimize.<세트>로 올린다). Langfuse 키가 없는 오프라인 평가는 이 파일을 읽는다
MIN_GAIN = 0.05   # 최고 후보가 시드보다 이만큼 나아야 저장한다: 지표 표준오차가 0.03~0.08이라 여럿 중 최고가 잡음만으로 시드를 넘는 일을 막는다
MAX_GROWTH = 2   # 저장할 지시문 길이 상한(기준 본문의 배수)
UNSUPPORTED = '자동 개선을 지원하지 않는 프롬프트예요.'
RUNNING = '이 프롬프트의 자동 개선이 이미 실행 중이에요.'


def accept(request: OptimizationRequest) -> None:
    """접수 확인. 어긋나면 큐에 올리지 않는다: 지원 대상이 아니면 422, 설정이 없으면 503, 같은 프롬프트가 실행 중이면 409."""
    if request.prompt not in OPTIMIZABLE:
        raise OptimizationFailure(422, UNSUPPORTED)
    if not tracing.enabled():
        raise OptimizationFailure(503, 'Langfuse 설정이 필요합니다.')
    scoring.require_model()   # 생성·채점은 기존 OpenAI 설정이다(EvaluationFailure 503)
    agent.settings()
    if running(request.prompt):
        raise OptimizationFailure(409, RUNNING)


def running(prompt_name: str) -> bool:
    """같은 프롬프트의 자동 개선이 실행 중인가: 잠금을 한 번 잡아 보고 잡히면 바로 놓는다."""
    with _connect() as connection:
        if _lock(connection, 'pg_try_advisory_lock', prompt_name):
            _lock(connection, 'pg_advisory_unlock', prompt_name)
            return False
        return True


@contextmanager
def hold(prompt_name: str):
    """워커가 실행 내내 잠금을 잡는다(세션 잠금이라 연결이 닫히면 풀린다). 이미 다른 실행이 잡았으면 False를 내준다."""
    connection = _connect()
    try:
        yield _lock(connection, 'pg_try_advisory_lock', prompt_name)
    finally:
        connection.close()


def load_pool(dataset: str) -> tuple[list[dict], list[dict]]:
    """최적화 풀(게이트 세트와 겹치지 않는 나머지 문항)을 metadata.split으로 (train, val)로 나눈다. 없거나 한쪽이 비면 실행하지 않는다.
    Langfuse 키가 있으면 Dataset optimize.<세트>에서 읽는다(운영 화면에서 올린 문항 포함, #868). 읽지 못하면 저장소 파일로 몰래 바꾸지 않고 실패한다.
    키가 없으면(로컬 오프라인 평가) 지금처럼 저장소 파일이다."""
    rows = _langfuse_pool(dataset) if tracing.enabled() else _file_pool(dataset)
    train, val = ([row for row in rows if row['metadata'].get('split') == split] for split in ('train', 'val'))
    if not train or not val:
        raise OptimizationFailure(503, '최적화 풀에 train·val 문항이 모두 있어야 해요.')
    return train, val


def _file_pool(dataset: str) -> list[dict]:
    try:
        return [json.loads(line) for line in (POOLS / f'{dataset}.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    except OSError:
        raise OptimizationFailure(503, '최적화 풀을 읽을 수 없어요.') from None


def _langfuse_pool(dataset: str) -> list[dict]:
    """Dataset optimize.<세트>의 항목을 풀 파일 한 줄과 같은 모양({id, input, expectedOutput, metadata})으로 돌려준다."""
    try:
        items = tracing.client().get_dataset(f'optimize.{dataset}').items
    except Exception:   # 없는 Dataset(NotFoundError)도 포함한다. 외부 SDK 예외 메시지는 입력을 담을 수 있어 고정 문구로만 알린다
        raise OptimizationFailure(503, f'최적화 풀(optimize.{dataset})을 Langfuse에서 읽을 수 없어요. 세트가 없으면 ai-eval-seed를 다시 실행해 주세요.') from None
    return [{'id': item.id, 'input': item.input, 'expectedOutput': item.expected_output, 'metadata': item.metadata or {}} for item in items]


def rejection(candidate: str, base: str) -> str | None:
    """저장하면 안 되는 이유(없으면 None): SAFETY 문장이 빠졌거나 기준 본문의 2배를 넘는다."""
    if SAFETY not in candidate:
        return '안전 문장(SAFETY)이 빠진 지시문이에요.'
    if len(candidate) > MAX_GROWTH * len(base):
        return f'지시문이 기준 본문의 {MAX_GROWTH}배보다 길어요.'
    return None


class _Stop(BaseException):
    """반성 모델 호출이 실패했으니 개선을 바로 끝낸다. GEPA는 반성 호출의 Exception을 삼키고 다음 반복을 이어 가며 매 반복마다 평가 호출(OpenAI 비용)을 쓰므로,
    Exception이 아닌 예외로 gepa.optimize 밖까지 올린다(_optimize가 원래 실패로 바꿔 올린다)."""

    def __init__(self, failure: OptimizationFailure):
        super().__init__(str(failure))
        self.failure = failure


def _reflect(text):
    try:
        return agent.reflect(text)
    except OptimizationFailure as failure:
        raise _Stop(failure) from None


def run_job(job: dict) -> None:
    """워커의 진입점(예외를 올리지 않는다). 실패는 trace ERROR로 남고 로그에는 고정 문구(없으면 예외 이름)만 남는다."""
    request = OptimizationRequest.model_validate(job)
    try:
        with tracing.request('prompt_optimization', prompt=request.prompt, baseVersion=str(request.version), maxMetricCalls=str(request.maxMetricCalls)):
            with hold(request.prompt) as acquired:
                if not acquired:   # 접수 뒤 큐에서 기다리는 사이에 다른 실행이 시작했다
                    raise OptimizationFailure(409, RUNNING)
                _optimize(request)
    except Exception as error:   # 입력·응답 본문이 섞일 수 있어 고정 문구(실패 클래스)가 아니면 예외 이름과 난 곳만 남긴다
        known = isinstance(error, (OptimizationFailure, EvaluationFailure))
        logger.error('프롬프트 자동 개선 %s v%s 실패: %s', request.prompt, request.version, error if known else f'{type(error).__name__} ({_where(error)})')


def _where(error: BaseException) -> str:
    """예외가 난 곳(폴더/파일:줄 함수). 메시지에는 입력·응답 본문이 섞일 수 있어 코드 위치만 남긴다(#841 첫 실행: 클래스 이름만으로는 TypeError의 원인을 찾지 못했다)."""
    frame = traceback.extract_tb(error.__traceback__)[-1]
    return f"{'/'.join(Path(frame.filename).parts[-2:])}:{frame.lineno} {frame.name}"


def _optimize(request: OptimizationRequest) -> None:
    client, dataset = tracing.client(), OPTIMIZABLE[request.prompt]
    base = _read(client, request.prompt, version=request.version)
    if not isinstance(base.prompt, str):   # 채팅 프롬프트는 메시지 목록이라 지시문으로 개선할 수 없다
        raise OptimizationFailure(422, '텍스트 프롬프트만 개선할 수 있어요.')
    train, val = load_pool(dataset)   # 풀·gepa 설치·반성 게이트웨이는 기준 평가(OpenAI 호출)를 하기 전에 확인한다
    import gepa
    agent.check()
    _ensure_baseline(client, dataset, request.prompt)
    adapter = SimulationAdapter(simulation.KINDS[dataset], tracing.model_of(base.config))
    try:
        result = gepa.optimize(seed_candidate={'instructions': base.prompt}, trainset=train, valset=val, adapter=adapter, reflection_lm=_reflect,
                               reflection_prompt_template=prompt.REFLECTION, max_metric_calls=request.maxMetricCalls, seed=0, raise_on_exception=True)
    except _Stop as stop:
        raise stop.failure from None
    seed_score, best_score = result.val_aggregate_scores[0], result.val_aggregate_scores[result.best_idx]
    best = result.candidates[result.best_idx]['instructions']
    note = {'seedScore': round(seed_score, 4), 'bestScore': round(best_score, 4), 'failedCalls': adapter.failures, 'totalCalls': adapter.calls}
    if round(best_score - seed_score, 6) < MIN_GAIN:
        return _note(**note, outcome='no_improvement', reason='개선 없음')
    if problem := rejection(best, base.prompt):
        return _note(**note, outcome='rejected', reason=problem)
    expected = _read(client, request.prompt, label='latest').version + 1   # 평가 Run 이름이 새 버전 번호를 품고 commitMessage가 그 이름을 품어서 저장 전에 만든다
    run_name = evaluation.name_run(request.prompt, expected)
    created = client.create_prompt(
        name=request.prompt, prompt=best, labels=[], type='text', config=base.config,
        commit_message=f"GEPA 자동 개선: 기준 v{request.version}, val {note['seedScore']}→{note['bestScore']}, 평가 Run {run_name}")
    _note(**note, outcome='saved', savedVersion=created.version)
    if created.version != expected:   # ponytail: 그사이 다른 새 버전이 생긴 드문 경쟁. 이름을 고칠 수 없어 평가 없이 끝낸다(저장된 라벨 없는 버전은 남는다)
        raise OptimizationFailure(409, '저장된 버전 번호가 예상과 달라 회귀 평가를 하지 못했어요.')
    plan = evaluation.prepare(EvaluationRequest(dataset=dataset, prompt=request.prompt, version=created.version), run_name=run_name)
    _note(evaluationRun=run_name)
    _evaluate(plan)


def _ensure_baseline(client, dataset: str, prompt_name: str) -> None:
    """게이트 세트에 production 버전의 유효한 기준 Run(끝났고, 세트의 마지막 문항이 만들어진 뒤에 시작한 Run)이 없으면 먼저 평가한다: 기준 Run이 없으면 새 버전이
    실패 항목만 없어도 통과해 무엇이든 후보가 된다. production 버전 자신의 평가는 기준과 비교하지 않으니(그 Run이 곧 기준) prepare의 baseline이 아니라 규칙 함수로 묻는다."""
    production = _read(client, prompt_name, label='production', missing=None)
    if production is None:
        return
    plan = evaluation.prepare(EvaluationRequest(dataset=dataset, prompt=prompt_name, version=production.version))
    if evaluation.baseline_run(client, plan.dataset, prompt_name, dataset, production) is None:
        _note(baselineRun=plan.run_name)
        _evaluate(plan)


def _evaluate(plan) -> None:
    """회귀 평가 Run은 정식 평가처럼 자기 trace로 돈다: 새 스레드는 호출한 쪽의 추적 문맥(열린 prompt_optimization 루트·전파 속성)을 물려받지 않아 항목 span이 이 trace에 붙지 않는다
    (concurrent.futures는 asyncio.to_thread와 달리 contextvars를 복사하지 않는다). 실패는 result()가 그대로 올려 trace를 ERROR로 끝낸다. 이 trace에는 Run 이름(_note)만 남긴다."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(evaluation._run, plan).result()


def _read(client, name: str, *, missing: str | None = '프롬프트 버전을 찾을 수 없어요.', **which):
    """Langfuse 프롬프트 한 건(캐시 없이). 없으면 404(missing이 None이면 None), 그 밖의 실패는 원인 없이 502."""
    try:
        return client.get_prompt(name, cache_ttl_seconds=0, **which)
    except NotFoundError:
        if missing is None:
            return None
        raise OptimizationFailure(404, missing) from None
    except Exception:   # 외부 SDK 예외 메시지는 입력을 담을 수 있어 고정 문구로만 알린다
        raise OptimizationFailure(502, evaluation.LANGFUSE_FAILED) from None


def _note(**metadata) -> None:
    """요청 루트 관측(trace prompt_optimization)의 metadata에 값을 더한다."""
    tracing.client().update_current_span(metadata=metadata)


def _lock(connection, function: str, prompt_name: str) -> bool:
    """advisory lock 함수 한 번(pg_try_advisory_lock·pg_advisory_unlock, 키 prompt_optimization:<이름>). 연결 뒤 질의 실패도 접속 정보가 실릴 수 있는 원문 대신 고정 문구 503이다."""
    try:
        return connection.execute(f'SELECT {function}(hashtext(%s))', (f'prompt_optimization:{prompt_name}',)).fetchone()[0]
    except psycopg.Error:
        raise OptimizationFailure(503, '자동 개선 잠금용 데이터베이스 질의에 실패했습니다.') from None


def _connect():
    url = os.environ.get('AI_CHECKPOINT_DATABASE_URL', '').strip()
    if not url:
        raise OptimizationFailure(503, '자동 개선 잠금용 데이터베이스 설정이 필요합니다.')
    try:
        return psycopg.connect(url, autocommit=True)
    except psycopg.Error:   # 예외 메시지에 접속 정보가 실릴 수 있다
        raise OptimizationFailure(503, '자동 개선 잠금용 데이터베이스에 연결하지 못했습니다.') from None
