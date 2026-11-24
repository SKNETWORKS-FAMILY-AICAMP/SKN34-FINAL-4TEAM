"""ai-jobs-worker(큐 jobs)의 Celery 태스크: 회귀 평가·프롬프트 자동 개선 실행과 운영 정기 작업 실행 요청(계약 operations-funnel-credit-contract §4).

Celery 앱·설정(acks_late·prefetch 1·결과 저장 없음)은 전처리의 것을 그대로 가져다 쓰고 전처리 태스크·큐(preprocessing)는 건드리지 않는다.
워커는 이 모듈을 -A로 불러 jobs 큐만 받는다: celery -A app.jobs.worker worker -Q jobs --concurrency=${AI_JOBS_CONCURRENCY:-4}
"""
import logging
import os

import httpx

from app.evaluation import service as evaluation
from app.jobs.models import JobRunRequest
from app.optimization import service as optimization
from app.preprocessing.worker import celery

log = logging.getLogger(__name__)


@celery.task(name="evaluation.run", queue="jobs")
def run_evaluation(job: dict) -> None:
    evaluation.run_job(job)


@celery.task(name="optimization.run", queue="jobs", acks_late=False)
def run_optimization(job: dict) -> None:
    """프롬프트 자동 개선(#823). 수십 분 걸려 RabbitMQ 확인 제한(기본 30분)을 넘기면 늦은 확인(acks_late) 때문에 같은 작업이 다시 배달돼 중복 실행·과금이 되므로 받자마자 확인한다.

    ponytail: 죽은 워커의 개선은 자동으로 이어 받지 않는다(끝나지 않은 trace가 남고 다시 누르면 처음부터 돈다).
    """
    optimization.run_job(job)


@celery.task(name="operations.run_job", queue="jobs")
def run_operations_job(payload: dict) -> None:
    """운영 서버에 이 기록의 실행을 맡긴다. 운영이 queued 기록을 선점해 기존 handler를 실행하고 상태를 기록한다(같은 runId가 다시 배달돼도 운영이 거절).

    ponytail: 운영이 거절·장애로 답하면 예외로 올려 태스크를 실패로 남길 뿐 자동으로 다시 하지 않는다(재시도로 숨기지 않는다).
    """
    request = JobRunRequest.model_validate(payload)
    log.info("operations job run %s (%s) executing", request.runId, request.kind)
    base = os.environ["OPERATIONS_SERVICE_BASE_URL"].rstrip("/")
    # 운영의 execute는 정기 작업 핸들러를 동기로 실행하고 끝나서야 답한다.
    # ponytail: 읽기 제한 600초 고정. 더 오래 걸리는 정기 작업이 생기면 운영이 202로 바꾸고 상태를 기록하게 한다.
    response = httpx.post(f"{base}/internal/v1/jobs/runs/{request.runId}/execute",
                          headers={"X-Internal-Token": os.environ["INTERNAL_TOKEN"]}, timeout=httpx.Timeout(600, connect=5))
    response.raise_for_status()
