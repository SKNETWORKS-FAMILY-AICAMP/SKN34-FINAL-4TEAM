"""#659 HTTP 경계: 내부 토큰, 고정 문구 오류와 code, 요청 하나 = trace 하나."""

import asyncio
import json

import pytest
from fastapi import HTTPException

from app.main import create_app
from app.serial import router
from app.serial.models import (ChoicesRequest, ChoicesResponse, EpisodeRequest, EpisodeResponse, SimulationRequest, SimulationResponse,
                               SummaryRequest, SummaryResponse)

from app.simulation import service as simulation_engine

from traced import MEMBER, attrs, bearer, status_of

from .stubs import (CHOICES, DRAFT, EPISODE_SUMMARY, FAIL, PASS, PLAN, REWRITE, SUMMARY, WORLD, answers, choices_request, episode, simulation,
                    staged_engine, summaries_request)

TOKEN = 'serial-token'
SIMULATE = lambda **overrides: router.simulate(SimulationRequest.model_validate(simulation(**overrides)), TOKEN)  # noqa: E731
RUN = lambda **overrides: asyncio.run(router.episode(EpisodeRequest.model_validate(episode(**overrides)), TOKEN))  # noqa: E731


@pytest.fixture(autouse=True)
def internal_token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)


@pytest.mark.parametrize('call', [
    lambda: router.choices(ChoicesRequest.model_validate(choices_request()), 'wrong'),
    lambda: router.summaries(SummaryRequest.model_validate(summaries_request()), 'wrong'),
    lambda: router.simulate(SimulationRequest.model_validate(simulation()), 'wrong'),
    lambda: asyncio.run(router.episode(EpisodeRequest.model_validate(episode()), 'wrong'))], ids=['choices', 'summaries', 'simulation', 'episode'])
def test_wrong_token_is_403_and_never_calls_the_model(monkeypatch, call):
    calls = answers(monkeypatch)
    with pytest.raises(HTTPException) as error:
        call()
    assert error.value.status_code == 403 and calls == []


def test_served_choices_are_returned_as_one_trace_root_with_work_and_reservation(monkeypatch, spans):
    answers(monkeypatch, CHOICES)

    result = router.choices(ChoicesRequest.model_validate(choices_request(creditReservationId='res-3')), TOKEN)

    assert isinstance(result, ChoicesResponse) and result.choices == CHOICES[0]['choices']
    [root] = [s for s in spans() if s.parent is None]
    found = attrs(root)
    assert root.name == 'serial.choices' and found['langfuse.trace.tags'] == ['feature:serial.choices'] and status_of(root) == 'success'
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.credit_reservation_id'] == 'res-3'


def test_unusable_choices_are_a_fixed_502_without_a_code(monkeypatch, spans):
    answers(monkeypatch, ({'choices': ['하나']}, 10, 5))

    response = router.choices(ChoicesRequest.model_validate(choices_request()), TOKEN)

    assert response.status_code == 502 and json.loads(response.body) == {'detail': '선택지 모델 응답을 확인할 수 없습니다.'}
    [root] = [s for s in spans() if s.parent is None]
    assert status_of(root) == 'failed' and root.attributes['langfuse.observation.level'] == 'ERROR'


def test_served_summaries_are_returned_as_one_trace_root_with_work_and_reservation(monkeypatch, spans):
    answers(monkeypatch, EPISODE_SUMMARY)

    result = router.summaries(SummaryRequest.model_validate(summaries_request(creditReservationId='res-4')), TOKEN)

    assert isinstance(result, SummaryResponse) and result.summary == EPISODE_SUMMARY[0]['summary']
    [root] = [s for s in spans() if s.parent is None]
    found = attrs(root)
    assert root.name == 'serial.summaries' and found['langfuse.trace.tags'] == ['feature:serial.summaries'] and status_of(root) == 'success'
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.credit_reservation_id'] == 'res-4'


def test_an_unusable_summary_is_a_fixed_502_without_a_code(monkeypatch, spans):
    answers(monkeypatch, ({'summary': '가' * 401}, 10, 5))

    response = router.summaries(SummaryRequest.model_validate(summaries_request()), TOKEN)

    assert response.status_code == 502 and json.loads(response.body) == {'detail': '회차 요약 모델 응답을 확인할 수 없습니다.'}
    [root] = [s for s in spans() if s.parent is None]
    assert status_of(root) == 'failed' and root.attributes['langfuse.observation.level'] == 'ERROR'


def test_a_served_simulation_is_returned_as_one_trace_root_with_work_and_reservation(monkeypatch, spans):
    answers(monkeypatch, ('서윤이 입을 열었다.', 100, 50))

    result = SIMULATE(creditReservationId='res-1')

    assert isinstance(result, SimulationResponse) and result.scene == '서윤이 입을 열었다.'
    [root] = [s for s in spans() if s.parent is None]
    found = attrs(root)
    assert root.name == 'serial.simulation' and found['langfuse.trace.tags'] == ['feature:serial.simulation']
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.credit_reservation_id'] == 'res-1'
    assert status_of(root) == 'success'


def test_the_optional_bearer_identifies_the_member_who_submitted_the_simulation(monkeypatch, spans):
    answers(monkeypatch, ('서윤이 입을 열었다.', 100, 50))

    router.simulate(SimulationRequest.model_validate(simulation()), TOKEN, bearer())

    [root] = [s for s in spans() if s.parent is None]
    assert attrs(root)['user.id'] == MEMBER


def test_without_a_bearer_the_simulation_is_served_and_the_trace_stays_anonymous(monkeypatch, spans):
    answers(monkeypatch, ('서윤이 입을 열었다.', 100, 50))

    assert router.simulate(SimulationRequest.model_validate(simulation()), TOKEN, '').scene == '서윤이 입을 열었다.'

    [root] = [s for s in spans() if s.parent is None]
    assert 'user.id' not in root.attributes


def test_a_served_episode_is_returned_as_one_trace_root(monkeypatch, spans):
    staged_engine(monkeypatch)
    answers(monkeypatch, SUMMARY, PLAN, DRAFT, PASS)

    result = RUN(creditReservationId='res-2')

    assert isinstance(result, EpisodeResponse) and result.title == '진실의 밤'
    [root] = [s for s in spans() if s.parent is None]
    found = attrs(root)
    assert root.name == 'serial.episode' and found['langfuse.trace.tags'] == ['feature:serial.episode'] and status_of(root) == 'success'
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.credit_reservation_id'] == 'res-2'
    # 모델 호출(종합·기획·집필·검수)은 스레드로 보내도 같은 루트 아래 generation이다(시뮬레이션 엔진의 호출은 엔진이 따로 추적한다).
    generations = [s.name for s in spans() if s.parent is not None and attrs(s).get('langfuse.observation.type') == 'generation']
    assert generations == ['serial.summary', 'writing.plan', 'serial.draft', 'serial.review']
    assert {s.context.trace_id for s in spans()} == {root.context.trace_id}


@pytest.mark.parametrize('replies, overrides, status, body', [
    ([SUMMARY, PLAN], {'creditLimit': 0.2}, 402, {'detail': '크레딧 상한을 넘었습니다.', 'code': 'CREDIT_LIMIT_EXCEEDED'}),
    ([SUMMARY, PLAN, DRAFT, FAIL, REWRITE, FAIL], {}, 422, {'detail': '검수를 통과하지 못했습니다.', 'code': 'SERIAL_REVIEW_FAILED'}),
    ([SUMMARY, ({'wrong': 1}, 10, 5)], {}, 502, {'detail': '기획 모델 응답을 확인할 수 없습니다.'}),  # 재사용한 Writing 기능의 실패도 같은 모양
], ids=['credit-limit', 'review-failed', 'writing-failure'])
def test_feature_failures_keep_the_fixed_phrase_and_add_a_code_for_the_two_contract_cases(monkeypatch, spans, replies, overrides, status, body):
    staged_engine(monkeypatch)
    answers(monkeypatch, *replies)

    response = RUN(**overrides)

    assert response.status_code == status and json.loads(response.body) == body
    [root] = [s for s in spans() if s.parent is None]
    assert status_of(root) == 'failed' and root.attributes['langfuse.observation.level'] == 'ERROR'


def test_a_failure_of_the_simulation_engine_keeps_its_own_status_and_phrase_without_a_code(monkeypatch, spans):
    staged_engine(monkeypatch)
    calls = answers(monkeypatch)

    response = RUN(world={**WORLD, 'cards': []})

    assert response.status_code == 409 and json.loads(response.body) == {'detail': simulation_engine.NO_CHARACTERS} and calls == []
    [root] = [s for s in spans() if s.parent is None]
    assert status_of(root) == 'failed'


ROUTES = ['/internal/v1/serial/choices', '/internal/v1/serial/summaries', '/internal/v1/serial/simulations', '/internal/v1/serial/episodes']


def test_all_routes_ask_for_the_internal_token_and_only_the_simulation_route_takes_the_optional_member_bearer():
    """시뮬레이션에는 글을 쓴 회원이 있고, 선택지 생성·회차 요약·회차 실행은 일정 점검이 불러 사용자 토큰이 없다."""
    paths = create_app().openapi()['paths']
    for path in ROUTES:
        headers = {p['name']: p for p in paths[path]['post']['parameters']}
        assert headers['x-internal-token']['in'] == 'header' and not headers['x-internal-token']['required'], path
        assert ('x-user-authorization' in headers) == path.endswith('simulations'), path
        if 'x-user-authorization' in headers:
            assert headers['x-user-authorization']['in'] == 'header' and not headers['x-user-authorization']['required']
