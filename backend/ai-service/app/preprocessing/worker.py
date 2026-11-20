"""Run one claimed Content snapshot. Content alone persists inputs, results and receipts."""
import os
import httpx

from app.manuscript_extraction import service
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import EpisodeText, EpisodeExtraction
from app.preprocessing.models import JobRequest


def callback(job: str, action: str, data: dict) -> dict:
    base = os.environ["CONTENT_SERVICE_BASE_URL"].rstrip("/")
    response = httpx.post(
        f"{base}/internal/v1/ai/manuscript-build/{job}/{action}",
        json=data, headers={"X-Internal-Token": os.environ["INTERNAL_TOKEN"]},
        timeout=httpx.Timeout(75, connect=5),
    )
    response.raise_for_status()
    return response.json()


def run(request: JobRequest) -> None:
    job = request.jobId
    claim = callback(job, "claim", {"workId": request.workId})
    if not claim["claimed"]:
        return
    lease = {"token": claim["token"]}
    if not claim["loading"]:
        failed = []
        reason = "INVALID_EXTRACTION_OR_PAYLOAD"
        for raw in claim["missing"]:
            episode = EpisodeText.model_validate(raw)
            try:
                result = service.extract(episode)
            except PreprocessingFailure as error:
                failed.append(episode.number)
                reason = str(error)
                continue
            # A lost write response is ambiguous. Never start another job or overwrite its state.
            callback(job, "result", {**lease, "result": result.model_dump(mode="json")})
        if failed:
            callback(job, "failed", {**lease, "episodes": failed, "reason": reason})
            return
        inputs = callback(job, "structure-input", lease)
        if not inputs["prepared"]:
            rows = {row.number: row for row in map(EpisodeExtraction.model_validate, inputs["results"])}
            try:
                identity = service.resolve(rows)
                payload = service.organize(identity, rows)
            except PreprocessingFailure as error:
                callback(job, "failed", {**lease, "episodes": [], "reason": str(error)})
                return
            callback(job, "structure", {**lease, "identity": identity.model_dump(mode="json"),
                                         "payload": payload.model_dump(mode="json")})
    callback(job, "load", lease)
