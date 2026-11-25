"""GET /internal/v1/prompts/default-models HTTP 경계(CI 통합). 라우터 등록·내부 토큰·응답 모양을 TestClient로 확인한다."""
import pytest
from fastapi.testclient import TestClient

from app import prompts
from app.main import create_app

pytestmark = pytest.mark.integration

TOKEN = 't' * 32
PATH = '/internal/v1/prompts/default-models'


def get(token=TOKEN):
    return TestClient(create_app()).get(PATH, headers={'X-Internal-Token': token})


def test_answers_a_model_or_null_for_every_registered_prompt(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-env')

    response = get()

    assert response.status_code == 200
    models = response.json()['models']
    assert set(models) == set(prompts.SEEDS) and models['orchestration.main'] == 'gpt-env'


def test_wrong_token_is_403(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)

    assert get('wrong-token').status_code == 403
