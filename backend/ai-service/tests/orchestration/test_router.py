import asyncio

import pytest
from fastapi import HTTPException

from app.intent.errors import IntentFailure
from app.orchestration import router, service
from app.orchestration.models import OrchestrationRequest

from .stubs import fake_agents, plan


def test_internal_token_is_required(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    with pytest.raises(HTTPException) as error:
        asyncio.run(router.orchestrate(OrchestrationRequest(request='요청'), 'wrong'))
    assert error.value.status_code == 403
    with pytest.raises(HTTPException) as error:
        router.internal_token('wrong')
    assert error.value.status_code == 403


def test_router_failure_becomes_503(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agents(monkeypatch, plan('story_context'), fail={'route': IntentFailure()})
    with pytest.raises(HTTPException) as error:
        asyncio.run(router.orchestrate(OrchestrationRequest(request='요청'), 'test-token'))
    assert error.value.status_code == 503


@pytest.mark.parametrize('failure, status', [
    (service.ConversationMismatch(), 409), (service.NothingToResume(), 409), (service.ConversationUnavailable(), 503)])
def test_conversation_failures_become_http_status(monkeypatch, failure, status):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agents(monkeypatch, plan('story_context'), fail={'route': failure})
    with pytest.raises(HTTPException) as error:
        asyncio.run(router.orchestrate(OrchestrationRequest(request='요청'), 'test-token'))
    assert error.value.status_code == status
