import asyncio
from unittest.mock import Mock
from uuid import UUID

from fastapi import HTTPException, Request
import pytest

from app.images import router
from app.images.models import JobRequest
from traced import MEMBER, attrs, bearer, status_of


@pytest.mark.parametrize(("error", "status"), [
    (None, "success"),
    (ConnectionError("private broker message"), "failed"),
    (TimeoutError("private broker message"), "timeout"),
])
def test_traces_queue_submission_without_broker_details(monkeypatch, spans, error, status):
    monkeypatch.setenv("INTERNAL_TOKEN", "test-only-token")
    job_id = UUID("2f5c1784-b753-4893-9dc7-fbbeb3b14eb0")
    publish = Mock(side_effect=error)
    monkeypatch.setattr(router.execute, "apply_async", publish)

    if error is None:
        assert router.submit(JobRequest(jobId=job_id), "test-only-token").jobId == job_id
    else:
        with pytest.raises(HTTPException) as raised:
            router.submit(JobRequest(jobId=job_id), "test-only-token")
        assert raised.value.status_code == 503
        assert raised.value.detail == "이미지 작업 접수 실패"

    publish.assert_called_once_with(args=[str(job_id)], task_id=str(job_id), argsrepr="(<jobId>,)")
    [root] = spans()
    assert root.name == "image_job_submit" and root.parent is None
    assert status_of(root) == status
    fields = attrs(root)
    assert fields["session.id"] == str(job_id)
    assert fields["langfuse.trace.tags"] == ["feature:image_job_submit"]
    assert fields.get("langfuse.observation.level") == (None if error is None else "ERROR")
    assert "private broker message" not in str(fields)
    assert "test-only-token" not in str(fields)
    assert not root.events


@pytest.mark.parametrize(("member_token", "failure", "http_status", "trace_status"), [
    (bearer(), None, 204, "success"),
    (bearer(), router.moderation.OutputBlocked("private OCR"), 422, "failed"),
    (bearer(), router.moderation.OutputModerationUnavailable("private OCR"), 503, "failed"),
    (bearer(), router.moderation.InvalidCover("private image bytes"), 400, "failed"),
    ("", None, 204, "success"),
], ids=["allowed", "blocked", "unavailable", "invalid", "anonymous"])
def test_traces_cover_moderation_without_image_or_ocr(monkeypatch, spans, member_token, failure, http_status, trace_status):
    monkeypatch.setenv("INTERNAL_TOKEN", "test-only-token")
    image = b"private image bytes"
    check_cover = Mock(side_effect=failure)
    monkeypatch.setattr(router.moderation, "check_cover", check_cover)

    async def receive():
        return {"type": "http.request", "body": image}

    headers = [(b"content-type", b"image/png")]
    if member_token:
        headers.append((b"x-user-authorization", member_token.encode()))
    request = Request({"type": "http", "headers": headers}, receive)
    if failure is None:
        assert asyncio.run(router.moderate_cover(request, "test-only-token")).status_code == http_status
    else:
        with pytest.raises(HTTPException) as raised:
            asyncio.run(router.moderate_cover(request, "test-only-token"))
        assert raised.value.status_code == http_status

    check_cover.assert_called_once_with(image, "image/png")
    [root] = spans()
    assert root.name == "cover_moderation" and root.parent is None
    assert status_of(root) == trace_status
    fields = attrs(root)
    assert fields.get("user.id") == (MEMBER if member_token else None)
    assert fields["langfuse.trace.tags"] == ["feature:cover_moderation"]
    assert fields.get("langfuse.observation.status_message") == (type(failure).__name__ if failure else None)
    assert "private image bytes" not in str(fields)
    assert "private OCR" not in str(fields)
    assert "test-only-token" not in str(fields)
    if member_token:
        assert member_token not in str(fields)
    assert not root.events
