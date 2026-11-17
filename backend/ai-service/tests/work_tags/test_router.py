"""#372 HTTP 경계. 내부 토큰 검증과 기능 실패의 HTTP 변환을 확인한다."""
import pytest
from fastapi import HTTPException

from app.work_tags import router
from app.work_tags.models import Input, Output

from .stubs import data, fake_openai, output

TOKEN = 'work-tags-token'


def test_returns_candidates(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    fake_openai(monkeypatch, output())
    assert router.suggest_work_tags(Input.model_validate(data()), TOKEN) == Output.model_validate(output())


def test_wrong_token_is_403_and_never_calls_provider(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    seen = fake_openai(monkeypatch, output())
    with pytest.raises(HTTPException) as error:
        router.suggest_work_tags(Input.model_validate(data()), 'wrong')
    assert error.value.status_code == 403 and 'messages' not in seen


def test_rule_violation_is_502(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    fake_openai(monkeypatch, output(genres=['무협']))
    with pytest.raises(HTTPException) as error:
        router.suggest_work_tags(Input.model_validate(data()), TOKEN)
    assert error.value.status_code == 502
