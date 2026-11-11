"""CI 전용 실제 HTTP 시스템 회귀. 기동·readiness·항상 정리는 ci.yml이 소유한다.

기존 AI dev extra의 pytest/httpx2를 사용한다. 로컬 개발에서는 실행하지 않는다.
이메일·비밀번호·JWT·메일 본문은 출력하지 않으며 보고서는 CI에서 정제한다.
"""
import os
import json
import hashlib
import re
import subprocess
import time
import uuid

import httpx2
import pytest


def compose(*args):
    assert os.environ.get("GITHUB_ACTIONS") == "true", "GitHub CI only"
    assert re.fullmatch(r"storyfork-ci-\d+-\d+", os.environ.get("COMPOSE_PROJECT_NAME", "")), "Owned CI project required"
    assert os.environ.get("COMPOSE_FILE") == (
        "infrastructure/docker-compose.yaml:infrastructure/docker-compose.local.yaml:infrastructure/ci/compose.test.yaml"
    ), "CI source-build overlays required"
    return subprocess.check_output(["docker", "compose", "--env-file", ".env.example", *args], text=True).strip()


def scalar(sql):
    return compose("exec", "-T", "postgres", "psql", "--no-psqlrc", "-U", os.environ["DATABASE_USER"],
                   "-d", "storyfork_test", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql)


def refresh_csrf(client):
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    client.headers["X-CSRF-TOKEN"] = response.json()["csrfToken"]


@pytest.fixture(scope="session")
def web():
    # 조회·DB 검사도 배포 프로젝트나 임의 외부 서버를 대상으로 실행하지 않는다.
    compose("version", "--short")
    base = os.environ["HTTP_BASE_URL"]
    assert re.fullmatch(r"http://127\.0\.0\.1:\d+", base), "Loopback CI URL required"
    with httpx2.Client(base_url=base, timeout=15, trust_env=False) as client:
        yield client


@pytest.fixture(scope="session")
def signed_in(web):
    email = str(uuid.uuid4()) + "@example.invalid"
    password = "ci-only-signup-password"
    refresh_csrf(web)
    response = web.post("/api/v1/auth/signup", json={"email": email, "password": password, "nickname": "CI Reader"})
    assert response.status_code == 202
    base = os.environ["MAILPIT_API_URL"]
    assert re.fullmatch(r"http://127\.0\.0\.1:\d+", base), "Loopback Mailpit URL required"
    message = None
    deadline = time.monotonic() + 20
    with httpx2.Client(base_url=base, timeout=5, trust_env=False) as mailpit:
        while message is None and time.monotonic() < deadline:
            response = mailpit.get("/api/v1/messages")
            assert response.status_code == 200
            for item in response.json()["messages"]:
                if any(recipient["Address"] == email for recipient in item["To"]):
                    response = mailpit.get("/api/v1/message/" + item["ID"])
                    assert response.status_code == 200
                    message = response.json()
                    break
            if message is None:
                time.sleep(1)
    assert message is not None, "Verification mail not received"
    token = re.search(r"#token=([A-Za-z0-9_-]+)", message["Text"])
    assert token is not None, "Verification link missing"
    refresh_csrf(web)
    response = web.post("/api/v1/auth/verify-email", json={"token": token.group(1), "password": password})
    assert response.status_code == 204
    refresh_csrf(web)
    response = web.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    login = response.json()
    web.headers["Authorization"] = "Bearer " + login["accessToken"]
    return {"client": web, "email": email, "id": str(uuid.UUID(login["user"]["id"]))}


@pytest.fixture(scope="session")
def draft_work(signed_in):
    client = signed_in["client"]
    refresh_csrf(client)
    response = client.post("/api/v1/works", json={"title": "CI work"})
    assert response.status_code == 201
    work_id = str(uuid.UUID(response.json()["id"]))
    # Real login -> Core verification -> Content ownership, not a mocked principal.
    assert scalar(f"SELECT owner_id FROM work WHERE id='{work_id}'") == signed_in["id"]
    path = "/api/v1/works/" + work_id + "/episodes/1"
    response = client.get(path)
    assert response.status_code == 200
    draft = {"title": "CI chapter", "body": "CI persisted manuscript", "revision": response.json()["draft"]["revision"]}
    refresh_csrf(client)
    response = client.put(path + "/draft", json=draft)
    assert response.status_code == 200
    saved = response.json()["draft"]
    return {"client": client, "id": work_id, "path": path, "request": draft, "saved": saved}


def test_health(web):
    response = web.get("/")
    assert response.status_code == 200
    assert "STORYFORK" in response.text
    response = web.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "up", "service": "storyfork-core-api"}
    response = web.get("/api/v1/health/ai-service")
    assert response.status_code == 200
    assert response.json() == {"status": "up", "service": "storyfork-ai-service"}


def test_health_worldstudio_startup_migration():
    """Content 시작 시 WorldStudio 전용 schema가 자기 이력으로 적용되고 Auth/Content 이력과 공존하는지 확인한다."""
    assert scalar("SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename <> 'world_studio_schema_history'") == "18"
    assert scalar("SELECT string_agg(version, ',' ORDER BY installed_rank) FROM worldstudio.world_studio_schema_history WHERE success AND type='SQL'") == "1,2,3,4,5"
    for table in ("flyway_schema_history", "content_schema_history"):
        assert scalar(f"SELECT count(*) FROM public.{table} WHERE NOT success") == "0"
        assert int(scalar(f"SELECT count(*) FROM public.{table} WHERE success")) > 0


def test_auth(signed_in):
    client = signed_in["client"]
    with httpx2.Client(base_url=client.base_url, timeout=15, trust_env=False) as anonymous:
        assert anonymous.get("/api/v1/me").status_code == 401
        assert anonymous.post("/api/v1/auth/signup", json={"email": "csrf@example.invalid", "password": "ci-only-password", "nickname": "CSRF"}).status_code == 403
    refresh_csrf(client)
    response = client.post("/api/v1/auth/login", json={"email": signed_in["email"], "password": "wrong-password"})
    assert response.status_code == 401
    response = client.get("/api/v1/me")
    assert response.status_code == 200
    assert response.json()["email"] == signed_in["email"]
    assert response.json()["id"] == signed_in["id"]
    assert scalar(f"SELECT count(*) FROM auth_member WHERE id='{signed_in['id']}'") == "1"


def test_content(draft_work):
    client, path = draft_work["client"], draft_work["path"]
    assert draft_work["saved"]["body"] == draft_work["request"]["body"]
    refresh_csrf(client)
    assert client.put(path + "/draft", json=draft_work["request"]).status_code == 409
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["draft"] == draft_work["saved"]
    with httpx2.Client(base_url=client.base_url, timeout=15, trust_env=False) as anonymous:
        assert anonymous.get(path).status_code == 401
    assert scalar("SELECT count(*) FROM episode_draft d JOIN episode e ON e.id=d.episode_id "
                  f"WHERE e.work_id='{draft_work['id']}' AND e.sequence=1 AND d.content='CI persisted manuscript'") == "1"


def test_content_core_auth_timeout_is_not_an_invalid_user_or_cached_success(draft_work):
    client, path = draft_work["client"], draft_work["path"]
    assert client.get(path).status_code == 200
    # stop의 endpoint/DNS 전환 대신 listener·네트워크를 보존하고 응답만 멈춘다.
    compose("pause", "core-api")
    try:
        response = client.get(path)
        assert response.status_code == 504
        assert response.json()["code"] == "CORE_AUTH_TIMEOUT"
    finally:
        compose("unpause", "core-api")
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if client.get("/api/v1/health").status_code == 200:
                break
            time.sleep(2)
        else:
            pytest.fail("Core did not recover in the isolated CI project")
    assert client.get(path).status_code == 200


def test_ai_failure(draft_work):
    # CI overlay가 키·모델을 빈 값으로 고정한다. 실제 AI 경계를 거치되 유료 제공사는 호출하지 않는다.
    client, work_id = draft_work["client"], draft_work["id"]
    path = "/api/v1/works/" + work_id
    response = client.get(path)
    assert response.status_code == 200
    before = response.json()["draft"]
    refresh_csrf(client)
    response = client.post(path + "/proposals", json={"revision": before["revision"], "prompt": "Continue", "consent": True})
    assert response.status_code == 503
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["draft"] == before
    assert scalar("SELECT count(*) FROM ai_job j JOIN ai_model_call c ON c.job_id=j.id "
                  f"WHERE j.work_id='{work_id}' AND j.status='failed' AND c.status='failed'") == "1"
    response = client.get(path + "/history")
    assert response.status_code == 200
    assert response.json()["proposals"] == []
    # Content/Core 자체 장애를 AI 제공사 503 통과로 오인하지 않는다. 기본 uvicorn access log에는 본문·토큰이 없다.
    logs = compose("logs", "--no-color", "ai-service")
    assert bool(re.search(r'"POST /internal/v1/proposals HTTP/\S+" 503\b', logs)), "AI did not receive the proposal request"


def test_content_initial_world_analysis_failure_is_persistent_without_reexecution(signed_in):
    """실제 인증→Content→키 없는 AI→PostgreSQL→재조회. 유료 모델은 호출하지 않는다."""
    client = signed_in["client"]
    refresh_csrf(client)
    created = client.post("/api/v1/world-studios", json={"name": "5-C CI", "description": "보존할 원문"})
    assert created.status_code == 200
    draft = created.json()
    world = str(uuid.UUID(draft["worldId"]))
    path = f"/api/v1/world-studios/{world}/analyses"
    request = {"key": "ci-initial-analysis", "expectedDraftRevision": draft["draftRevision"]}
    refresh_csrf(client)
    result = client.post(path, json=request)
    assert result.status_code == 503
    analysis = result.json()
    assert analysis["executionStatus"] == "unknown"
    assert analysis["output"] is None and analysis["candidateIds"] == {}
    assert result.headers["X-Analysis-Failure-Code"] == "AI_RESPONSE_UNCONFIRMED"
    location = result.headers["Location"]
    assert client.get(location).json() == analysis
    assert client.get(location + "/candidates").json() == []
    assert client.get(path).json() == [analysis]
    refresh_csrf(client)
    assert client.post(path, json=request).json() == analysis
    refresh_csrf(client)
    assert client.post(path, json={**request, "expectedDraftRevision": draft["draftRevision"] + 1}).status_code == 409
    assert client.get(f"/api/v1/world-studios/{world}").json() == draft
    assert scalar(f"SELECT count(*) FROM worldstudio.initial_analysis WHERE world_id='{world}'") == "1"
    assert scalar(f"SELECT count(*) FROM worldstudio.initial_candidate WHERE world_id='{world}'") == "0"
    assert client.get(path + "/" + str(uuid.uuid4())).status_code == 404


def test_content_initial_world_review_survives_relogin_and_keeps_original(signed_in):
    # CI-owned PostgreSQL fixture seeds a completed AI result; no model call or shared DB write.
    client = signed_in["client"]
    refresh_csrf(client)
    created = client.post("/api/v1/world-studios", json={"name": "6-A CI", "description": "원문 사실"})
    assert created.status_code == 200
    draft = created.json()
    world = str(uuid.UUID(draft["worldId"]))
    analysis, candidate = str(uuid.uuid4()), str(uuid.uuid4())
    quote = draft["description"]
    content = {"localRef": "fact-1", "type": "fact", "title": "사실", "text": quote,
               "subjectId": None, "relatedEntityIds": [], "provenance": "ai_extraction",
               "evidence": [{"sourceId": f"world:{world}:description", "start": 0, "end": len(quote),
                             "quote": quote, "quoteHash": hashlib.sha256(quote.encode()).hexdigest()}],
               "relation": None, "condition": "", "timeText": "", "polarity": "asserted"}
    # Exact #235 canonical hash (ASCII keys, compact sorted JSON, UTF-8 values).
    source = {"sourceId": f"world:{world}:description", "ownerId": world, "field": "description",
              "text": quote, "textHash": hashlib.sha256(quote.encode()).hexdigest()}
    basis = {"draftRevision": draft["draftRevision"], "relationshipVersion": draft["relationshipVersion"], "currentRevisionId": draft["currentRevisionId"]}
    snapshot = {"schemaVersion": "initial-world.v1", "worldId": world, "basis": basis, "sources": [source], "entities": []}
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    snapshot = {**snapshot, "analysisId": analysis, "basis": {**basis, "inputHash": digest}}
    output = {"schemaVersion": "initial-world.v1", "candidates": [content], "diagnostics": []}
    def sql_json(value):
        return json.dumps(value, ensure_ascii=False).replace("'", "''")
    scalar("INSERT INTO worldstudio.initial_analysis(id,world_id,request_key,request_hash,draft_revision,relationship_version,input_snapshot,execution_token,deadline,execution_status,output) "
           f"VALUES ('{analysis}','{world}','review-fixture',repeat('a',64),{basis['draftRevision']},{basis['relationshipVersion']},'{sql_json(snapshot)}','{uuid.uuid4()}',now()+interval '90 seconds','completed','{sql_json(output)}')")
    scalar("INSERT INTO worldstudio.initial_candidate(id,world_id,analysis_id,local_ref,content) "
           f"VALUES ('{candidate}','{world}','{analysis}','fact-1','{sql_json(content)}')")
    path = f"/api/v1/world-studios/{world}/analyses/{analysis}"
    endpoint = path + f"/candidates/{candidate}/decisions"
    approve = {"key": "approve", "expectedDecisionSequence": 0, "action": "approve", "editedCandidate": None, "comment": "승인 의견"}
    refresh_csrf(client)
    first = client.post(endpoint, json=approve)
    assert first.status_code == 200 and first.json()["state"] == "approved"
    refresh_csrf(client)
    assert client.post(endpoint, json=approve).json() == first.json()
    refresh_csrf(client)
    assert client.post(endpoint, json={**approve, "comment": "다른 의견"}).status_code == 409
    edited = {**content, "text": "작가 수정", "provenance": "author_revision", "evidence": []}
    refresh_csrf(client)
    edit = client.post(endpoint, json={"key": "edit", "expectedDecisionSequence": 1, "action": "edit", "editedCandidate": edited, "comment": "수정 의견"})
    assert edit.status_code == 200 and edit.json()["state"] == "pending"
    refresh_csrf(client)
    approved_edit = client.post(endpoint, json={**approve, "key": "approve-edit", "expectedDecisionSequence": 2})
    assert approved_edit.status_code == 200 and approved_edit.json()["content"] == edited
    # New login issues a new Principal verification path; stored decisions must survive it.
    refresh_csrf(client)
    login = client.post("/api/v1/auth/login", json={"email": signed_in["email"], "password": "ci-only-signup-password"})
    assert login.status_code == 200
    client.headers["Authorization"] = "Bearer " + login.json()["accessToken"]
    detail = client.get(path).json()
    assert detail["output"] == output
    assert [d["sequence"] for d in detail["decisions"]] == [1, 2, 3]
    assert detail["decisions"][-1] == approved_edit.json()
    assert client.get(f"/api/v1/world-studios/{world}").json() == draft
    assert scalar(f"SELECT count(*) FROM worldstudio.initial_decision WHERE candidate_id='{candidate}'") == "3"
    # Separate application request persists approved author content; approval alone did not change draft.
    application_request = {"key": "apply-reviewed", "expectedDraftRevision": draft["draftRevision"],
                           "candidates": [{"candidateId": candidate, "decisionSequence": 3}]}
    refresh_csrf(client)
    applied = client.post(path + "/applications", json=application_request)
    assert applied.status_code == 200
    receipt = applied.json()
    assert receipt["status"] == "applied" and receipt["resultDraftRevision"] == draft["draftRevision"] + 1
    assert len(receipt["createdCardIds"]) == 1 and receipt["createdRelationshipIds"] == []
    assert client.get(applied.headers["Location"]).json() == receipt
    refresh_csrf(client)
    assert client.post(path + "/applications", json=application_request).json() == receipt
    refresh_csrf(client)
    assert client.post(path + "/applications", json={**application_request, "expectedDraftRevision": draft["draftRevision"] + 1}).status_code == 409
    after = client.get(f"/api/v1/world-studios/{world}").json()
    assert after["description"] == draft["description"] and after["currentRevisionId"] == draft["currentRevisionId"]
    assert after["cards"][0]["id"] == receipt["createdCardIds"][0]
    assert after["cards"][0]["body"] == "작가 수정"
    assert after["cards"][0]["semanticMetadata"]["preprocessing"]["provenance"] == "author_revision"
    assert after["cards"][0]["semanticMetadata"]["preprocessing"]["evidence"] == []
    assert client.get(path).json()["output"] == output
    scalar(f"UPDATE worldstudio.world_draft SET draft_revision=draft_revision+1 WHERE world_id='{world}'")
    refresh_csrf(client)
    stale = client.post(endpoint, json={**approve, "key": "stale", "expectedDecisionSequence": 3})
    assert stale.status_code == 409 and stale.json()["code"] == "ANALYSIS_STALE"
