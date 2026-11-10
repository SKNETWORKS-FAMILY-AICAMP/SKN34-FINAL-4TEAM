"""5-B HTTP 경계. CI에서만 실행하고 제공사는 항상 대역으로 교체한다."""
import json

import pytest
from openai import OpenAIError, APITimeoutError
from fastapi.testclient import TestClient
from app.main import create_app
from test_initial_world import data, proposed, provider

pytestmark = pytest.mark.integration
URL = '/internal/v1/initial-world/extractions'
HEADERS = {'X-Internal-Token': 'test-internal-token'}


def test_internal_extraction_returns_only_contract_output(monkeypatch, data):
    monkeypatch.setenv('INTERNAL_TOKEN', HEADERS['X-Internal-Token'])
    provider(monkeypatch, json.dumps(proposed(data), ensure_ascii=False))
    with TestClient(create_app()) as client:
        response = client.post(URL, headers=HEADERS, json=data['input'])
    assert response.status_code == 200
    assert response.json() == data['output']


@pytest.mark.parametrize('token', [None, '', 'wrong', 'test-internal-token'])
def test_auth_failure_never_calls_provider(monkeypatch, data, token):
    calls = provider(monkeypatch, '')
    if token == 'test-internal-token': monkeypatch.delenv('INTERNAL_TOKEN', raising=False)
    else: monkeypatch.setenv('INTERNAL_TOKEN', 'test-internal-token')
    headers = {} if token is None else {'X-Internal-Token': token}
    with TestClient(create_app()) as client:
        assert client.post(URL, headers=headers, json=data['input']).status_code == 403
    assert calls == []


def test_bad_input_and_missing_config_are_explicit(monkeypatch, data):
    monkeypatch.setenv('INTERNAL_TOKEN', HEADERS['X-Internal-Token'])
    calls = provider(monkeypatch, '')
    with TestClient(create_app()) as client:
        original_hash = data['input']['basis']['inputHash']
        data['input']['basis']['inputHash'] = '0' * 64
        assert client.post(URL, headers=HEADERS, json=data['input']).status_code == 422
        data['input']['basis']['inputHash'] = original_hash
        monkeypatch.delenv('OPENAI_API_KEY')
        response = client.post(URL, headers=HEADERS, json=data['input'])
        assert response.status_code == 503
        assert response.json() == {'detail': 'MODEL_NOT_CONFIGURED'}
    assert calls == []


@pytest.mark.parametrize('body,status', [('{', 'completed'), ('{}', 'incomplete')])
def test_bad_provider_response_is_502_without_partial_candidates(monkeypatch, data, body, status):
    monkeypatch.setenv('INTERNAL_TOKEN', HEADERS['X-Internal-Token'])
    provider(monkeypatch, body, status)
    with TestClient(create_app()) as client:
        response = client.post(URL, headers=HEADERS, json=data['input'])
    assert response.status_code == 502
    assert set(response.json()) == {'detail'}


@pytest.mark.parametrize('timeout', [False, True])
def test_provider_failures_map_to_explicit_http_status(monkeypatch, data, timeout):
    monkeypatch.setenv('INTERNAL_TOKEN', HEADERS['X-Internal-Token'])
    error = APITimeoutError(request=None) if timeout else OpenAIError('private upstream detail')
    provider(monkeypatch, '', error=error)
    with TestClient(create_app()) as client:
        response = client.post(URL, headers=HEADERS, json=data['input'])
    assert response.status_code == (504 if timeout else 503)
    assert response.json() == {'detail': 'MODEL_TIMEOUT' if timeout else 'MODEL_UNAVAILABLE'}
