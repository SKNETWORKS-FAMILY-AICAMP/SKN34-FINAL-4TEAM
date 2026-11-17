import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .stubs import WORLD, fake_agent, finding, fix

pytestmark = pytest.mark.integration


def test_world_review_route_returns_the_contract_shape(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    fake_agent(monkeypatch, finding(card_ids=['seoyun', 'war'], kind='doc_role', message='문서 역할이 섞였다.',
                                    fix=fix(target='episode', episode=0, text='새 00회차')),
               finding(card_ids=['rule'], kind='other', message='규칙이 모자란다.'))
    with TestClient(create_app()) as client:
        denied = client.post('/internal/v1/world-reviews', json=WORLD)
        response = client.post('/internal/v1/world-reviews', headers={'X-Internal-Token': 'test-token'}, json=WORLD)

    assert denied.status_code == 403
    assert response.status_code == 200
    assert response.json() == {
        'findings': [
            {'cardIds': ['seoyun', 'war'], 'kind': 'doc_role', 'message': '문서 역할이 섞였다.',
             'fix': {'cardId': 'seoyun', 'target': 'episode', 'episode': 0, 'text': '새 00회차'}},
            {'cardIds': ['rule'], 'kind': 'other', 'message': '규칙이 모자란다.', 'fix': None},
        ],
        'reviewedCards': 3, 'model': 'resolved-model'}


def test_old_memory_in_the_body_is_accepted_and_a_bad_body_is_422(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'test-token')
    seen = fake_agent(monkeypatch)
    old = {**WORLD, 'cards': [{**WORLD['cards'][0], 'characterDocs': {'soul': 's', 'memory': '옛 기억', 'episodes': {}}}]}
    with TestClient(create_app()) as client:
        accepted = client.post('/internal/v1/world-reviews', headers={'X-Internal-Token': 'test-token'}, json=old)
        rejected = client.post('/internal/v1/world-reviews', headers={'X-Internal-Token': 'test-token'},
                               json={**WORLD, 'cards': [{**WORLD['cards'][0], 'cardType': 'monster'}]})

    assert accepted.status_code == 200 and seen['data'].cards[0].characterDocs.episodes == {0: '옛 기억'}
    assert rejected.status_code == 422
