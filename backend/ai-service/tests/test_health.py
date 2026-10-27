from fastapi.testclient import TestClient

from app.main import create_app


def test_health_without_openai_key_or_client(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    def forbidden_client(*args, **kwargs):
        raise AssertionError("health must not construct an OpenAI client")

    monkeypatch.setattr("openai.AsyncOpenAI", forbidden_client)
    monkeypatch.setattr("openai.OpenAI", forbidden_client)
    with TestClient(create_app()) as client:
        response = client.get("/internal/v1/health")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert response.json() == {"status": "up", "service": "storyfork-ai-service"}
        assert client.post("/internal/v1/support-program-rankings/rank", json={}).status_code == 404
