"""#659 요청 한도(계약)와 모델 구조화 출력·검수 결과 불변식."""

import pytest
from pydantic import ValidationError

from app.serial.models import ChoicesRequest, EpisodeRequest, Review, SimulationRequest

from .stubs import choices_request, episode, simulation

PROPOSAL = {'title': '제안', 'body': '본문', 'likes': 0, 'scene': None}


def test_the_limits_themselves_are_accepted():
    SimulationRequest.model_validate(simulation(premise='가' * 500, beats=['나' * 200] * 5, context='x' * 60000, creditLimit=0.0001))
    ChoicesRequest.model_validate(choices_request(direction='가' * 2000, context='x' * 60000, creditLimit=0.0001))
    EpisodeRequest.model_validate(episode(direction='가' * 2000, context='x' * 60000, choice={'text': '가' * 300, 'votes': 0}, proposals=[
        {'title': '나' * 100, 'body': '다' * 2000, 'likes': 0, 'scene': '라' * 1500}, PROPOSAL, PROPOSAL]))


def test_beats_choice_proposals_and_direction_may_be_empty():
    assert SimulationRequest.model_validate(simulation(beats=[])).beats == []
    assert ChoicesRequest.model_validate(choices_request(direction='')).direction == ''
    request = EpisodeRequest.model_validate(episode(choice=None, proposals=[], direction=''))
    assert (request.choice, request.proposals, request.direction) == (None, [], '')
    assert EpisodeRequest.model_validate(episode(proposals=[PROPOSAL | {'body': ''}])).proposals[0].body == ''  # 시뮬레이션 제안은 미리보기만 있을 수 있다


@pytest.mark.parametrize('field, value', [
    ('workId', ''), ('episodeNumber', 0), ('premise', ''), ('premise', '가' * 501), ('beats', ['가'] * 6), ('beats', ['가' * 201]), ('beats', ['']),
    ('context', ''), ('context', 'x' * 60001), ('creditLimit', 0), ('creditLimit', -1)])
def test_simulation_request_over_the_limits_is_rejected(field, value):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate(simulation(**{field: value}))


@pytest.mark.parametrize('field, value', [
    ('workId', ''), ('episodeNumber', 0), ('direction', '가' * 2001), ('context', ''), ('context', 'x' * 60001), ('creditLimit', 0)])
def test_choices_request_over_the_limits_is_rejected(field, value):
    with pytest.raises(ValidationError):
        ChoicesRequest.model_validate(choices_request(**{field: value}))


@pytest.mark.parametrize('field, value', [
    ('workId', ''), ('episodeNumber', 0), ('direction', '가' * 2001), ('context', ''), ('context', 'x' * 60001), ('creditLimit', 0),
    ('choice', {'text': '', 'votes': 1}), ('choice', {'text': '가' * 301, 'votes': 1}), ('choice', {'text': '선택', 'votes': -1}),
    ('proposals', [PROPOSAL] * 4),
    ('proposals', [PROPOSAL | {'title': ''}]), ('proposals', [PROPOSAL | {'title': '가' * 101}]), ('proposals', [PROPOSAL | {'body': '가' * 2001}]),
    ('proposals', [PROPOSAL | {'likes': -1}]), ('proposals', [PROPOSAL | {'scene': '가' * 1501}])])
def test_episode_request_over_the_limits_is_rejected(field, value):
    with pytest.raises(ValidationError):
        EpisodeRequest.model_validate(episode(**{field: value}))


def test_a_review_that_did_not_pass_must_say_what_to_fix():
    assert Review(passed=True, issues=[]).passed is True
    assert Review(passed=False, issues=['설정 충돌']).issues == ['설정 충돌']
    with pytest.raises(ValidationError):
        Review(passed=False, issues=[])
