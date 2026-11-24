from unittest.mock import Mock
from uuid import UUID

from fastapi import HTTPException
import pytest

from app.images import router
from app.images.models import JobRequest
from traced import attrs, status_of


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
