"""RabbitMQ 작업은 ID만 전달하며 Content의 원자적 선점 뒤 실행한다."""
import os
from time import sleep
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
from celery import Celery
from celery.exceptions import Reject
from openai import APITimeoutError, APIConnectionError
from app.images import agent, moderation, service
from pydantic import BaseModel
from app.images.models import ClaimResponse, JobResponse, ProgressRequest, CompletionRequest, ModerationFailureRequest

broker = "amqp://{}:{}@{}:{}/".format(quote(os.getenv("CORE_RABBITMQ_USER", "storyfork"), safe=""),
    quote(os.getenv("CORE_RABBITMQ_PASSWORD", ""), safe=""), os.getenv("CORE_RABBITMQ_HOST", "rabbitmq"), os.getenv("CORE_RABBITMQ_PORT", "5672"))
app = Celery("images", broker=broker)
app.conf.update(task_default_queue="storyfork.images", task_ignore_result=True,
    task_serializer="json", accept_content=["json"], worker_prefetch_multiplier=1,
    task_publish_retry=False, broker_connection_retry_on_startup=False,
    task_acks_late=True, task_reject_on_worker_lost=False,
    broker_transport_options={"confirm_publish": True})

def report(job_id: str, action: str, body: BaseModel | None = None):
    """내부 토큰·jobId 범위로만 상태를 변경한다. 원문·예외 본문은 로그에 남기지 않는다."""
    base = os.environ["CONTENT_SERVICE_BASE_URL"].rstrip("/")
    request = Request(f"{base}/internal/v1/ai/image-generations/{job_id}/{action}",
        data=(body.model_dump_json() if body else "{}").encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Internal-Token": os.environ["INTERNAL_TOKEN"]})
    with urlopen(request, timeout=15) as response:
        return (ClaimResponse if action == "claim" else JobResponse).model_validate_json(response.read())

def read_reference(job_id: str) -> bytes:
    """선점한 작업에 고정된 참조 이미지만 내부 API에서 읽는다."""
    base = os.environ["CONTENT_SERVICE_BASE_URL"].rstrip("/")
    request = Request(f"{base}/internal/v1/ai/image-generations/{job_id}/reference",
                      headers={"X-Internal-Token": os.environ["INTERNAL_TOKEN"]})
    with urlopen(request, timeout=15) as response:
        return response.read(service.MAX_REFERENCE_BYTES + 1)


def claim_job(job_id: str) -> ClaimResponse:
    try:
        return report(job_id, "claim")
    except HTTPError as error:
        if error.code not in {502, 503, 504}:
            raise
    except OSError:
        pass
    # Content 기동·연결 복구 전까지 메시지를 보존하되 즉시 재배달 루프는 피한다.
    sleep(5)
    raise Reject("IMAGE_CLAIM_UNAVAILABLE", requeue=True)


@app.task(name="images.generate", max_retries=0)
def execute(job_id: str):
    """중복 배달은 선점 실패로 종료한다. 결과가 불명확한 실행은 재생성하지 않는다."""
    try:
        claim = claim_job(job_id)
        if not claim.claimed:
            return
        stage = "generating"
        try:
            raw = agent.generate(claim.input, read_reference(job_id)) if claim.input.referenceRole else agent.generate(claim.input)
            service.validate_image(raw, claim.input)
            moderation.check_output(raw)
            stage = "uploading"
            report(job_id, "progress", ProgressRequest(stage=stage))
            key = service.upload(job_id, raw)
        except moderation.OutputBlocked:
            report(job_id, "failed", ModerationFailureRequest(stage="output_blocked"))
            return
        except moderation.OutputModerationUnavailable:
            report(job_id, "failed", ModerationFailureRequest(stage="moderation_unavailable"))
            return
        except (APITimeoutError, APIConnectionError):
            report(job_id, "interrupted", ProgressRequest(stage=stage))
            return
        except Exception:
            report(job_id, "failed", ProgressRequest(stage=stage))
            return
        # 업로드 뒤 보고 실패는 Content의 interrupted 상태로 남긴다. 모델을 다시 부르지 않는다.
        report(job_id, "complete", CompletionRequest(key=key))
    except Reject:
        raise
    except Exception:
        # Celery가 네트워크 예외 본문·자격을 출력하지 않게 고정된 결과만 남긴다.
        return {"status": "interrupted"}
