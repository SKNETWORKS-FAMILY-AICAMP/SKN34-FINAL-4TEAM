"""Run one claimed Content snapshot. Content alone persists inputs, results and receipts."""
import logging
import os
import httpx
from celery import Celery

from app import tracing
from app.manuscript_extraction import service
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import EpisodeText, EpisodeExtraction
from app.preprocessing.models import JobRequest

log = logging.getLogger(__name__)

# 모델·검증의 세부 코드를 Content·화면이 아는 실패 사유로 옮긴다. 그 밖의 검증·출력 오류는 모두 AI_OUTPUT_INVALID다.
REASONS = {"MODEL_TIMEOUT": "AI_TIMEOUT", "MODEL_UNAVAILABLE": "AI_RESPONSE_UNCONFIRMED", "MODEL_NOT_CONFIGURED": "AI_REQUEST_REJECTED",
           "MODEL_INPUT_TOO_LARGE": "AI_REQUEST_REJECTED", "NO_SETTINGS_FOUND": "NO_SETTINGS_FOUND"}


def callback(job: str, action: str, data: dict) -> dict:
    base = os.environ["CONTENT_SERVICE_BASE_URL"].rstrip("/")
    response = httpx.post(
        f"{base}/internal/v1/ai/manuscript-build/{job}/{action}",
        json=data, headers={"X-Internal-Token": os.environ["INTERNAL_TOKEN"]},
        timeout=httpx.Timeout(75, connect=5),
    )
    response.raise_for_status()
    return response.json()


def reason_of(job: str, error: Exception) -> str:
    """실패 사유 코드. 세부 코드(고정 코드나 예외 종류 이름: 메시지에는 원고가 섞일 수 있다)는 로그에만 남긴다."""
    detail = str(error) if isinstance(error, PreprocessingFailure) else type(error).__name__
    log.error("manuscript build %s failed: %s", job, detail)
    return REASONS.get(detail, "AI_OUTPUT_INVALID")


def run(request: JobRequest) -> None:
    job = request.jobId
    with tracing.request("manuscript_extraction", session_id=job, work_id=request.workId) as trace:
        claim = callback(job, "claim", {"workId": request.workId})
        if not claim["claimed"]:
            return
        lease = {"token": claim["token"]}

        def post(action: str, data: dict) -> bool:
            # 4xx는 Content가 거절한 것이라 같은 입력은 같은 거절을 되풀이한다(False). 5xx·시간 초과는 일시 장애라 그대로 올려 재개하게 둔다.
            try:
                callback(job, action, {**lease, **data})
            except httpx.HTTPStatusError as error:
                if not 400 <= error.response.status_code < 500:
                    raise
                log.error("manuscript build %s: content rejected %s (%s)", job, action, error.response.status_code)
                return False
            return True

        def fail(episodes: list[int], reason: str) -> None:
            trace.status = "failed"
            post("failed", {"episodes": episodes, "reason": reason})  # 거절되면 Content가 이미 실패로 기록한 것이라(원고·연결 변경) 남길 것이 없다

        def send(action: str, data: dict, episodes: list[int]) -> bool:
            accepted = post(action, data)
            if not accepted:
                fail(episodes, "CONTENT_REJECTED")
            return accepted

        if not claim["loading"]:
            # Content는 failed의 episodes가 결과가 저장되지 않은 회차 전체와 같기를 요구한다.
            unsaved, reason = [raw["number"] for raw in claim["missing"]], "AI_OUTPUT_INVALID"
            for raw in claim["missing"]:
                episode = EpisodeText.model_validate(raw)
                try:
                    result = service.extract(episode)
                except Exception as error:  # 모델·검증 실패도 예상 밖 예외도 그 회차의 실패다
                    reason = reason_of(job, error)
                    continue
                # A lost write response is ambiguous. Never start another job or overwrite its state.
                if not send("result", {"result": result.model_dump(mode="json")}, unsaved):
                    return
                unsaved.remove(episode.number)
            if unsaved:
                fail(unsaved, reason)
                return
            inputs = callback(job, "structure-input", lease)
            if not inputs["prepared"]:
                try:
                    rows = {row.number: row for row in map(EpisodeExtraction.model_validate, inputs["results"])}
                    identity = service.resolve(rows)
                    payload = service.organize(identity, rows)
                except Exception as error:
                    fail([], reason_of(job, error))
                    return
                if not send("structure", {"identity": identity.model_dump(mode="json"), "payload": payload.model_dump(mode="json")}, []):
                    return
        send("load", {}, [])


# 회차 원고 전처리 Celery 태스크(2026-11-20 사용자 결정). 작품 하나가 태스크 하나이고 ai-worker(동시성 1)가 큐 순서대로 하나씩 실행한다.
# ponytail: 순차라 회차별 병렬은 없다. 태스크를 회차 단위로 나누고 Content claim(작업 단위 실행권)을 바꿔야 한다.
# ponytail: acks_late 재배달은 Content claim이 거절(claimed=false)해 무해하지만 죽은 실행의 자동 재개는 아니다. 만료 뒤 사용자가 '같은 작업 재개'를 누른다.
celery = Celery("preprocessing", broker=os.environ.get("AI_CELERY_BROKER_URL"))
celery.conf.update(task_acks_late=True, worker_prefetch_multiplier=1, task_ignore_result=True)


@celery.task(name="preprocessing.run", queue="preprocessing")
def run_job(payload: dict) -> None:
    run(JobRequest.model_validate(payload))
