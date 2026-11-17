import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.integration


def test_rating_route_is_registered_behind_internal_token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'rating-token')
    response = TestClient(create_app()).post('/internal/v1/ratings', json={'workId': 'work-1', 'episodes': [1]},
                                             headers={'X-Internal-Token': 'wrong-token'})
    assert response.status_code == 403
