"""#659 HTTP 경계: 내부 토큰, 고정 문구 오류와 code, 요청 하나 = trace 하나."""

import json

import pytest
from fastapi import HTTPException

from app.main import create_app
from app.serial import router
from app.serial.models import EpisodeRequest, EpisodeResponse, SimulationRequest, SimulationResponse

from traced import attrs, status_of

from .stubs import DRAFT, FAIL, PASS, PLAN, REWRITE, SUMMARY, answers, episode, simulation

TOKEN = 'serial-token'
SIMULATE = lambda **overrides: router.simulate(SimulationRequest.model_validate(simulation(**overrides)), TOKEN)  # noqa: E731
RUN = lambda **overrides: router.episode(EpisodeRequest.model_validate(episode(**overrides)), TOKEN)  # noqa: E731


@pytest.fixture(autouse=True)
def internal_token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)


@pytest.mark.parametrize('call', [
    lambda: router.simulate(SimulationRequest.model_validate(simulation()), 'wrong'),
    lambda: router.episode(EpisodeRequest.model_validate(episode()), 'wrong')], ids=['simulation', 'episode'])
def test_wrong_token_is_403_and_never_calls_the_model(monkeypatch, call):
    calls = answers(monkeypatch)
    with pytest.raises(HTTPException) as error:
        call()
    assert error.value.status_code == 403 and calls == []


def test_a_served_simulation_is_returned_as_one_trace_root_with_work_and_reservation(monkeypatch, spans):
    answers(monkeypatch, ('서윤이 입을 열었다.', 100, 50))

    result = SIMULATE(creditReservationId='res-1')

    assert isinstance(result, SimulationResponse) and result.scene == '서윤이 입을 열었다.'
    [root] = [s for s in spans() if s.parent is None]
    found = attrs(root)
    assert root.name == 'serial.simulation' and found['langfuse.trace.tags'] == ['feature:serial.simulation']
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.credit_reservation_id'] == 'res-1'
    assert status_of(root) == 'success'


def test_a_served_episode_is_returned_as_one_trace_root(monkeypatch, spans):
    answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    result = RUN(creditReservationId='res-2')

    assert isinstance(result, EpisodeResponse) and result.title == '진실의 밤'
    [root] = [s for s in spans() if s.parent is None]
    found = attrs(root)
    assert root.name == 'serial.episode' and found['langfuse.trace.tags'] == ['feature:serial.episode'] and status_of(root) == 'success'
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.credit_reservation_id'] == 'res-2'
    assert len([s for s in spans() if s.parent is not None and s.name.endswith('generation')]) >= 1  # 모델 호출은 루트 아래 generation


@pytest.mark.parametrize('replies, overrides, status, body', [
    ([SUMMARY, PLAN], {'creditLimit': 0.2}, 402, {'detail': '크레딧 상한을 넘었습니다.', 'code': 'CREDIT_LIMIT_EXCEEDED'}),
    ([SUMMARY, PLAN, DRAFT, FAIL, REWRITE, FAIL], {}, 422, {'detail': '검수를 통과하지 못했습니다.', 'code': 'SERIAL_REVIEW_FAILED'}),
    ([SUMMARY, ({'wrong': 1}, 10, 5)], {}, 502, {'detail': '기획 모델 응답을 확인할 수 없습니다.'}),  # 재사용한 Writing 기능의 실패도 같은 모양
], ids=['credit-limit', 'review-failed', 'writing-failure'])
def test_feature_failures_keep_the_fixed_phrase_and_add_a_code_for_the_two_contract_cases(monkeypatch, spans, replies, overrides, status, body):
    answers(monkeypatch, *replies)

    response = RUN(**overrides)

    assert response.status_code == status and json.loads(response.body) == body
    [root] = [s for s in spans() if s.parent is None]
    assert status_of(root) == 'failed' and root.attributes['langfuse.observation.level'] == 'ERROR'


def test_both_routes_are_registered_and_ask_for_the_internal_token():
    spec = create_app().openapi()
    for path in ['/internal/v1/serial/simulations', '/internal/v1/serial/episodes']:
        header = next(p for p in spec['paths'][path]['post']['parameters'] if p['name'] == 'x-internal-token')
        assert header['in'] == 'header' and not header['required'], path
