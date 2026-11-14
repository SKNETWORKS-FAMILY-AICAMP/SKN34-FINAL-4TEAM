"""전처리 Celery 작업: 접수 1건 = task 1개가 LangGraph 그래프를 `invoke`한다. Celery는 작업 실행·큐만 맡는다.

그래프가 올린 실패(`StageFailure`)와 예기치 못한 오류는 Content 작업 상태에 `failed`(고정 사유 문구)로 남긴다.
오류 로그에는 고정 코드와 예외 종류만 남기고 원고·모델 응답·예외 메시지는 남기지 않는다.
"""
import logging

from app.preprocessing import graph
from app.preprocessing.errors import UNEXPECTED, StageFailure, error_code
from app.worker import celery

log = logging.getLogger(__name__)


@celery.task(name='preprocessing.run')
def run_job(job_id: str, work_id: str, episodes: list[int]) -> None:
    """접수한 회차의 전처리 그래프를 끝까지 실행한다. 같은 jobId 재접수는 받은 회차만 다시 추출한다."""
    try:
        graph.run(job_id, episodes)
    except StageFailure as error:
        log.error('stage failed: job=%s work=%s stage=%s code=%s', job_id, work_id, error.stage, error)
        graph.report(job_id, error.stage, 0, len(episodes) if error.stage == 'extracting' else 1, failed=error.reason)
    except Exception as error:
        log.error('job failed: job=%s work=%s code=%s', job_id, work_id, error_code(error))
        graph.report(job_id, 'extracting', 0, len(episodes), failed=UNEXPECTED)
