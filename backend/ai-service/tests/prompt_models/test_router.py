"""GET /internal/v1/prompts/default-models. 내부 토큰 검증 뒤 기본 모델 표를 돌려준다(TestClient 없이 함수로)."""
import pytest
from fastapi import HTTPException

from app.prompt_models import router, service
from app.prompt_models.models import DefaultModels

TOKEN = 'models-token'
ANSWER = DefaultModels(models={'character_simulation.act': 'gpt-6.1-terra', 'orchestration.main': None})


def test_returns_the_table_for_the_internal_token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    monkeypatch.setattr(service, 'default_models', lambda: ANSWER)

    assert router.default_models(TOKEN) == ANSWER


def test_wrong_or_missing_token_is_403_and_reads_nothing(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)

    def never():
        raise AssertionError('토큰이 틀리면 읽지 않는다')
    monkeypatch.setattr(service, 'default_models', never)

    for token in ('wrong', ''):
        with pytest.raises(HTTPException) as error:
            router.default_models(token)
        assert error.value.status_code == 403


def test_route_is_the_contract_path_with_get():
    (route,) = router.router.routes
    assert (route.path, route.methods) == ('/internal/v1/prompts/default-models', {'GET'})
