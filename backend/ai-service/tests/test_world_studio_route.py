from fastapi.testclient import TestClient
from pathlib import Path
from app.main import create_app


def test_initial_route_is_opt_in(monkeypatch):
    monkeypatch.delenv('WORLD_STUDIO_AI_ENABLED', raising=False)
    with TestClient(create_app()) as client:
        assert client.post('/internal/v1/initial-world-knowledge', json={}).status_code == 404


def test_initial_route_uses_existing_minimal_contract_without_provider(monkeypatch):
    monkeypatch.setenv('WORLD_STUDIO_AI_ENABLED', 'true')
    from app.world_wiki import knowledge
    assert Path(knowledge.__file__).resolve().is_relative_to(Path(__file__).resolve().parents[1] / 'app')
    calls = []

    async def fixed(request, *args, **kwargs):
        calls.append(request)
        return {'new_entities': [], 'records': [], 'input_review': [], 'unresolved': [],
                'usage': {'test_transport': 'local_stub'}, 'rawOutput': '{"fixture":"local"}'}

    monkeypatch.setattr(knowledge, 'analyze_knowledge', fixed)
    with TestClient(create_app()) as client:
        response = client.post('/internal/v1/initial-world-knowledge', json={
            'sources': [{'id': 'name', 'text': '항구'}, {'id': 'description', 'text': '항구에 등대가 있다.'}],
            'targets': [],
        })
    assert response.status_code == 200
    assert response.json()['contractVersion'] == 'initial-content-4-minimal'
    assert response.json()['items'] == []
    assert len(calls) == 1


def test_initial_route_keeps_validation_failure_as_422(monkeypatch):
    monkeypatch.setenv('WORLD_STUDIO_AI_ENABLED', 'true')
    from app.world_wiki import knowledge
    from app.world_wiki.minimal_validation import ValidationFailure

    async def invalid(*args, **kwargs):
        error = ValidationFailure([{'record_id': 'r1', 'field': 'evidence', 'code': 'invalid_reference', 'cause': '근거 없음', 'status': 'error'}])
        error.raw_output = '{"fixture":"invalid"}'
        error.usage = {'test_transport': 'local_stub'}
        raise error

    monkeypatch.setattr(knowledge, 'analyze_knowledge', invalid)
    with TestClient(create_app()) as client:
        response = client.post('/internal/v1/initial-world-knowledge', json={
            'sources': [{'id': 'name', 'text': '항구'}, {'id': 'description', 'text': '설명'}], 'targets': [],
        })
    assert response.status_code == 422
    assert response.json()['detail']['contractVersion'] == 'initial-content-4-minimal'
    assert response.json()['detail']['diagnostics'][0]['code'] == 'invalid_reference'
    assert 'items' not in response.json()
