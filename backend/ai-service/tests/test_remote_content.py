"""실제 Content 위임 HTTP 계약. 원격 전송은 대역이며 원고·모델은 사용하지 않는다."""
import asyncio
from datetime import datetime, timedelta, timezone
import io
import json
from urllib.error import HTTPError
from unittest.mock import Mock

import pytest

from test_mock_retrievers import story, content
from test_run_service import binding
from app.runs.remote_content import RemoteContent
from app.runs.service import RunError, RunService


def authority(content):
    request, _, _ = binding(content)
    remote = RemoteContent("http://content-service:8081", "fixture-service-token")
    body = {"runId": request.run_id, "threadRef": request.thread_ref,
            "scopeRef": "scope-hash", "expiresAt": (datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()}
    remote.opener.open = Mock(side_effect=lambda *a, **kw: io.BytesIO(json.dumps(body).encode()))
    return request, remote, body


def test_remote_authority_receives_bound_request_and_service_credential(content):
    request, remote, _ = authority(content)
    grant = remote.authorize(request)
    assert grant.scope_ref == "scope-hash"
    call = remote.opener.open.call_args
    sent = call.args[0]
    assert sent.full_url.endswith("/internal/v1/ai/runs/run1/verify")
    assert json.loads(sent.data)["grantRef"] == request.grant_ref
    assert sent.get_header("X-internal-token") == "fixture-service-token"
    assert remote.restore(request.run_id, request.grant_ref, request.thread_ref).scope_ref == grant.scope_ref
    assert remote.opener.open.call_count == 2


@pytest.mark.parametrize("change", [{"runId": "other"}, {"threadRef": "other"},
    {"expiresAt": "2000-01-01T00:00:00Z"}])
def test_authority_mismatch_is_denied(content, change):
    request, remote, body = authority(content)
    body.update(change)
    with pytest.raises(RunError, match="invalid_scope"):
        remote.authorize(request)


def test_transport_failure_never_falls_back_to_mock_success(content):
    request, remote, _ = authority(content)
    remote.opener.open.side_effect = TimeoutError("secret")
    with pytest.raises(RunError, match="content_unavailable"):
        remote.authorize(request)
    remote.opener.open.side_effect = HTTPError("http://content",403,"denied",{},None)
    with pytest.raises(RunError, match="invalid_scope"):
        remote.authorize(request)


def test_verified_real_run_reports_unconnected_executor_without_model_call(content):
    async def scenario():
        request, remote, _ = authority(content)
        service = RunService(remote)
        service.start(request)
        await service.records[request.run_id].task
        result = service.status(request.run_id, request.grant_ref, request.thread_ref)
        assert result.status == "failed" and not result.is_mock
        assert result.error.code == "dependency_unavailable"
        assert result.result is None and not result.tasks
        await service.close()
    asyncio.run(scenario())


def test_content_committed_cancellation_prevents_start_and_converges_existing_record(content):
    async def scenario():
        request,remote,body=authority(content)
        service=RunService(remote)
        service.start(request)
        await service.records[request.run_id].task
        body["cancelled"]=True
        assert service.cancel(request.run_id,request.grant_ref,request.thread_ref).status=="cancelled"
        assert service.cancel(request.run_id,request.grant_ref,request.thread_ref).status=="cancelled"
        fresh=RunService(remote)
        with pytest.raises(RunError,match="run_cancelled"):
            fresh.start(request)
        assert not fresh.records
        await service.close()
    asyncio.run(scenario())
