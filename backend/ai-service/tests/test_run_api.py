"""TASK 09에서 요청한 내부 HTTP·메모리 그래프 통합. 실제 Content·모델 없음."""
import asyncio
import time
from dataclasses import replace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
import pytest

from test_mock_retrievers import story, content, manuscripts, wiki
from test_main_graph import graph, agent
from test_run_service import binding
from app.main import create_app
from app.runs.service import FixtureContent, FixtureGrant, RunService


pytestmark = pytest.mark.integration
BASE = "/internal/v1/ai/runs"


def headers(req):
    return {"X-Internal-Token": "fixture-service-token", "X-Grant-Ref": req.grant_ref,
            "X-Thread-Ref": req.thread_ref}


def terminal(client, req):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"{BASE}/{req.run_id}", headers=headers(req))
        assert response.status_code == 200
        if response.json()["status"] not in ("pending", "running"):
            return response.json()
        time.sleep(.01)
    pytest.fail("fixture run did not finish within 5 seconds")


def test_authorized_mock_graph_duplicate_and_legacy_routes(content, wiki, manuscripts, monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, grant, _ = binding(content)
    g = graph(content, wiki, manuscripts, handlers={"qa": agent})
    service = RunService(FixtureContent((replace(grant, graph=g),)))
    from app.generation import router as generation
    monkeypatch.setattr(generation, "generate", lambda *args: {"text": "합성 이어쓰기"})
    with TestClient(create_app(run_service=service)) as client:
        response = client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=headers(req))
        assert response.status_code == 202 and response.json()["status"] == "pending"
        result = terminal(client, req)
        assert result["status"] == "succeeded" and result["isMock"]
        assert result["result"]["citations"] and result["result"]["is_mock"]
        assert all(c["source_revision"]["document_id"] == req.target_refs[0].document_id
                   for c in result["result"]["citations"])
        assert req.grant_ref not in str(result)
        assert client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=headers(req)).status_code == 409
        assert client.get("/internal/v1/health").status_code == 200
        assert client.post("/internal/v1/proposals", json={"context": {}, "prompt": "이어쓰기"},
                           headers=headers(req)).json()["text"] == "합성 이어쓰기"


def test_authorized_hitl_resume_requires_exact_committed_content_decision(content, wiki, manuscripts, monkeypatch):
    from test_approval_resume import ApprovalFixture
    from app.runs.runner import TaskOutput
    monkeypatch.setenv("INTERNAL_TOKEN","fixture-service-token")
    monkeypatch.delenv("AI_CHECKPOINT_DATABASE_URL",raising=False)
    req,grant,_=binding(content)
    req=req.model_copy(update={"operation":"edit","prompt":"문장 수정"})
    main=grant.main.model_copy(update={"ui_mode":"edit","allowed_operations":("edit",),"prompt":"문장 수정"})
    approvals=ApprovalFixture(content)
    async def edit(s,ctx):
        return TaskOutput(output_schema=s.output_schema,output_ref="changes:run1",is_mock=True)
    g=graph(content,wiki,manuscripts,handlers={"editing":edit},approval=approvals.coordinator)
    service=RunService(FixtureContent((replace(grant,request=req,main=main,graph=g),)))
    with TestClient(create_app(run_service=service)) as client:
        assert client.post(BASE,json=req.model_dump(mode="json",by_alias=True),headers=headers(req)).status_code==202
        waiting=terminal(client,req)
        assert waiting["status"]=="awaiting_approval"
        assert client.post(f"{BASE}/run1/cancel",headers=headers(req)).status_code==409
        signal={"decision_ref":"decision1","interrupt_ref":waiting["result"]["interrupt_ref"]}
        assert client.post(f"{BASE}/run1/resume",headers=headers(req),json=signal).status_code==409
        approvals.decide("revision_requested")
        result=client.post(f"{BASE}/run1/resume",headers=headers(req),json=signal)
        assert result.status_code==200 and result.json()["status"]=="revision_requested"
        assert client.post(f"{BASE}/run1/resume",headers=headers(req),json=signal).json()==result.json()
        assert client.post(f"{BASE}/run1/resume",headers=headers(req),json={**signal,"interrupt_ref":"other"}).status_code==409
        assert client.post(f"{BASE}/run1/resume",json=signal).status_code==403
        assert approvals.prepares==1


@pytest.mark.parametrize("token", [None, "wrong", "", " "])
def test_service_credentials_required_for_every_route(content, monkeypatch, token):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, _, service = binding(content)
    auth = headers(req)
    if token is None:
        del auth["X-Internal-Token"]
    else:
        auth["X-Internal-Token"] = token
    with TestClient(create_app(run_service=service)) as client:
        assert client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=auth).status_code == 403
        assert client.get(f"{BASE}/run1", headers=auth).status_code == 403
        assert client.post(f"{BASE}/run1/cancel", headers=auth).status_code == 403


@pytest.mark.parametrize("change", [{"grantRef": "forged"}, {"workId": "other"},
    {"forkId": "other"}, {"targetRefs": [{"work_id": "other", "kind": "manuscript",
                                         "document_id": "other", "revision": "r1"}]}])
def test_forged_scope_rejected_before_read(content, monkeypatch, change):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, grant, service = binding(content)
    content.manifest = AsyncMock()
    with TestClient(create_app(run_service=service)) as client:
        response = client.post(BASE, json=req.model_dump(mode="json", by_alias=True) | change, headers=headers(req))
        assert response.status_code == 403 and response.json()["detail"] == "invalid_scope"
    content.manifest.assert_not_called()
    grant.graph.run.assert_not_called()


def test_input_errors_redact_secrets_and_unconfigured_service_is_explicit(content, monkeypatch):
    monkeypatch.delenv("CONTENT_AI_RUN_BASE_URL", raising=False)
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, _, service = binding(content)
    body = req.model_dump(mode="json", by_alias=True)
    with TestClient(create_app(run_service=service)) as client:
        for change in ({"grantRef": "secret manuscript / invalid ref"}, {"budget": {"modelCalls": -1}},
                       {"prompt": "x" * 2001}, {"targetRefs": []}):
            response = client.post(BASE, json=body | change, headers=headers(req))
            assert response.status_code == 422 and response.json() == {"detail": "invalid_request"}
        response = client.post(BASE, json=body | {"prompt": "secret manuscript"}, headers=headers(req))
        assert response.status_code == 403 and response.json() == {"detail": "invalid_scope"}
        duplicate = list(headers(req).items()) + [("X-Internal-Token", "fixture-service-token")]
        assert client.post(BASE, json=body, headers=duplicate).status_code == 403
    with TestClient(create_app()) as client:
        assert client.post(BASE, json=body, headers=headers(req)).status_code == 503


def test_cancel_and_status_reauthorization(content, monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, grant, service = binding(content)
    async def slow(*args, **kwargs):
        await asyncio.sleep(10)
    grant.graph.run.side_effect = slow
    with TestClient(create_app(run_service=service)) as client:
        assert client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=headers(req)).status_code == 202
        assert client.get(f"{BASE}/run1", headers=headers(req) | {"X-Thread-Ref": "foreign"}).status_code == 403
        assert client.post(f"{BASE}/run1/cancel", headers=headers(req)).status_code == 200
        assert terminal(client, req)["status"] == "cancelled"
        content.active = False
        assert client.get(f"{BASE}/run1", headers=headers(req)).status_code == 403
        assert client.post(f"{BASE}/run1/cancel", headers=headers(req)).status_code == 403


def test_timeout_is_failed_status_with_explicit_code(content, monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, grant, service = binding(content, timeout_ms=20)
    async def slow(*args, **kwargs):
        await asyncio.sleep(10)
    grant.graph.run.side_effect = slow
    with TestClient(create_app(run_service=service)) as client:
        assert client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=headers(req)).status_code == 202
        result = terminal(client, req)
        assert result["status"] == "failed" and result["error"]["code"] == "timeout"


def test_granted_budget_reaches_real_graph_before_agent_dispatch(content, wiki, manuscripts, monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, grant, _ = binding(content)
    req = req.model_copy(update={"budget": req.budget.model_copy(update={"model_calls": 0})})
    spy = AsyncMock(side_effect=agent)
    g = graph(content, wiki, manuscripts, handlers={"qa": spy})
    service = RunService(FixtureContent((replace(grant, request=req, graph=g),)))
    with TestClient(create_app(run_service=service)) as client:
        assert client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=headers(req)).status_code == 202
        assert terminal(client, req)["status"] == "failed"
        spy.assert_not_called()


@pytest.mark.parametrize("status,code", [("denied", "refused"), ("failed", "execution_failed"),
                                        ("partial", None), ("clarification", None)])
def test_terminal_status_is_not_replaced_with_success(content, monkeypatch, status, code):
    monkeypatch.setenv("INTERNAL_TOKEN", "fixture-service-token")
    req, grant, service = binding(content)
    result = grant.graph.run.return_value
    grant.graph.run.return_value = result.model_copy(update={
        "state": result.state.model_copy(update={"execution_status": status}),
        "response": result.response.model_copy(update={"status": status})})
    with TestClient(create_app(run_service=service)) as client:
        assert client.post(BASE, json=req.model_dump(mode="json", by_alias=True), headers=headers(req)).status_code == 202
        result = terminal(client, req)
        assert result["status"] == status
        assert (result["error"]["code"] if result["error"] else None) == code
