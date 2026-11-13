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


def test_user_authorization_header_reaches_the_service(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    seen = []

    async def run(data, authorization=''):
        seen.append(authorization)
        return service.OrchestrationResponse(status='completed')

    monkeypatch.setattr(service, 'run', run)
    asyncio.run(router.orchestrate(OrchestrationRequest(request='요청'), 'test-token', 'Bearer user'))
    assert seen == ['Bearer user']


@pytest.mark.parametrize('call', [
    lambda: router.list_sessions('user:1/work:1', 'wrong'),
    lambda: router.read_session('t', 'user:1/work:1', 'wrong'),
    lambda: router.rename_session('t', router.RenameRequest(scope='user:1/work:1', title='제목'), 'wrong'),
    lambda: router.delete_session('t', 'user:1/work:1', 'wrong'),
    lambda: router.truncate_session('t', 0, 'user:1/work:1', 'wrong'),
])
def test_session_endpoints_need_the_internal_token(monkeypatch, call):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    with pytest.raises(HTTPException) as error:
        asyncio.run(call())
    assert error.value.status_code == 403


@pytest.mark.parametrize('failure, status', [
    (service.ConversationNotFound(), 404), (service.ConversationBusy(), 409), (service.ConversationUnavailable(), 503)])
def test_session_failures_become_http_status(monkeypatch, failure, status):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')

    async def fail(*_):
        raise failure

    monkeypatch.setattr(service, 'rename', fail)
    with pytest.raises(HTTPException) as error:
        asyncio.run(router.rename_session('t', router.RenameRequest(scope='s', title='제목'), 'test-token'))
    assert error.value.status_code == status
