import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.integration


def test_internal_auth_and_limit(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'unit-token')
    with TestClient(create_app()) as client:
        assert client.post('/internal/v1/proposals', json={'context': {}, 'prompt': 'continue'}).status_code == 403
        assert client.post('/internal/v1/proposals', headers={'X-Internal-Token': 'unit-token'},
                           json={'context': {'draft': 'x' * 60001}, 'prompt': 'continue'}).status_code == 422
