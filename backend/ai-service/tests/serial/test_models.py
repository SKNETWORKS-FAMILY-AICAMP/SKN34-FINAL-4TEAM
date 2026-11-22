"""#659 요청 한도(계약)와 검수 결과 불변식."""

import pytest
from pydantic import ValidationError

from app.serial.models import EpisodeRequest, Review, SimulationRequest

from .stubs import episode, simulation

OPINION = {'kind': 'general', 'body': '의견', 'votes': 0, 'scene': None}


def test_the_limits_themselves_are_accepted():
    SimulationRequest.model_validate(simulation(premise='가' * 500, beats=['나' * 200] * 5, context='x' * 60000, creditLimit=0.0001))
    EpisodeRequest.model_validate(episode(direction='가' * 2000, context='x' * 60000, opinions=[
        {'kind': 'general', 'body': '나' * 1000, 'votes': 0, 'scene': None},
        {'kind': 'simulation', 'body': '다' * 1000, 'votes': 9, 'scene': '라' * 1500}, OPINION]))


def test_beats_opinions_and_direction_may_be_empty():
    assert SimulationRequest.model_validate(simulation(beats=[])).beats == []
    request = EpisodeRequest.model_validate(episode(opinions=[], direction=''))
    assert request.opinions == [] and request.direction == ''


@pytest.mark.parametrize('field, value', [
    ('workId', ''), ('episodeNumber', 0), ('premise', ''), ('premise', '가' * 501), ('beats', ['가'] * 6), ('beats', ['가' * 201]), ('beats', ['']),
    ('context', ''), ('context', 'x' * 60001), ('creditLimit', 0), ('creditLimit', -1)])
def test_simulation_request_over_the_limits_is_rejected(field, value):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate(simulation(**{field: value}))


@pytest.mark.parametrize('field, value', [
    ('workId', ''), ('episodeNumber', 0), ('direction', '가' * 2001), ('context', ''), ('context', 'x' * 60001), ('creditLimit', 0),
    ('opinions', [OPINION] * 4),
    ('opinions', [OPINION | {'kind': 'setting'}]),  # 설정 제안은 범위 밖: 의견은 일반·시뮬레이션뿐
    ('opinions', [OPINION | {'body': ''}]), ('opinions', [OPINION | {'body': '가' * 1001}]),
    ('opinions', [OPINION | {'votes': -1}]), ('opinions', [OPINION | {'scene': '가' * 1501}])])
def test_episode_request_over_the_limits_is_rejected(field, value):
    with pytest.raises(ValidationError):
        EpisodeRequest.model_validate(episode(**{field: value}))


def test_a_review_that_did_not_pass_must_say_what_to_fix():
    assert Review(passed=True, issues=[]).passed is True
    assert Review(passed=False, issues=['설정 충돌']).issues == ['설정 충돌']
    with pytest.raises(ValidationError):
        Review(passed=False, issues=[])
