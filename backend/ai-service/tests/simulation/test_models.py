import pytest
from pydantic import ValidationError

from app.simulation.models import (Beat, Check, Decision, Evidence, Note, Scene, SceneAction, SimulationPlan, SimulationResult, Trail,
                                   Turn)


@pytest.mark.parametrize('plan, gaps', [
    (SimulationPlan(), ['mode', 'characterIds']),
    (SimulationPlan(mode='if', characterIds=['k']), ['premise']),
    (SimulationPlan(mode='if', premise='만약 성문이 열려 있었다면?'), ['characterIds']),
    (SimulationPlan(mode='flow', premise='IF 전제는 흐름에 쓰이지 않는다', characterIds=['k']), ['beats']),
    (SimulationPlan(mode='if', premise='만약 성문이 열려 있었다면?', characterIds=['k']), []),
    (SimulationPlan(mode='flow', beats=['성문 대면'], characterIds=['k', 'l']), []),
])
def test_plan_gaps_are_what_the_author_still_has_to_tell(plan, gaps):
    assert plan.gaps() == gaps


@pytest.mark.parametrize('body', [
    {'mode': 'story'},                             # 모드는 if·flow뿐
    {'beats': ['비트'] * 9},                       # 한도 8개
    {'beats': ['']},                               # 빈 비트
    {'characterIds': [str(i) for i in range(7)]},  # 한도 6명
    {'premise': 'x' * 501},
    {'unknown': 1},                                # 모르는 필드는 거절
])
def test_plan_limits(body):
    with pytest.raises(ValidationError):
        SimulationPlan.model_validate(body)


def test_result_dumps_the_contract_json_shape():
    result = SimulationResult(
        mode='flow', premise=None, beats=[Beat(index=0, text='성문 대면', status='done')],
        turns=[Turn(index=0, kind='narration', characterId=None, characterName='나레이션', prose='성문 위로 비가 내렸다.',
                    checks=[], regenerated=0, evidence=[]),
               Turn(index=1, kind='monologue', characterId='k', characterName='카엘', prose='리나를 믿어도 될까.',
                    checks=[], regenerated=0, evidence=[], pov='first:k'),
               Turn(index=2, characterId='k', characterName='카엘', prose='"멈춰."',
                    checks=[Check(kind='beat', passed=True, detail='비트를 따랐어요.')], regenerated=1,
                    evidence=[Evidence(ref='card:g', source='graph')], pov='limited:k', editedByAuthor=True)],
        notes=[Note(afterTurn=0, text='비가 쏟아진다')], status='paused', stopReason=None)
    assert result.model_dump(mode='json') == {
        'mode': 'flow', 'premise': None, 'beats': [{'index': 0, 'text': '성문 대면', 'status': 'done'}],
        'turns': [{'index': 0, 'kind': 'narration', 'characterId': None, 'characterName': '나레이션', 'prose': '성문 위로 비가 내렸다.',
                   'checks': [], 'regenerated': 0, 'evidence': [], 'pov': 'omniscient', 'editedByAuthor': False},
                  {'index': 1, 'kind': 'monologue', 'characterId': 'k', 'characterName': '카엘', 'prose': '리나를 믿어도 될까.',
                   'checks': [], 'regenerated': 0, 'evidence': [], 'pov': 'first:k', 'editedByAuthor': False},
                  {'index': 2, 'kind': 'character', 'characterId': 'k', 'characterName': '카엘', 'prose': '"멈춰."',
                   'checks': [{'kind': 'beat', 'passed': True, 'detail': '비트를 따랐어요.'}], 'regenerated': 1,
                   'evidence': [{'ref': 'card:g', 'source': 'graph'}], 'pov': 'limited:k', 'editedByAuthor': True}],
        'notes': [{'afterTurn': 0, 'text': '비가 쏟아진다'}], 'status': 'paused', 'stopReason': None, 'notice': None}


def test_turn_is_a_character_turn_in_the_omniscient_view_unless_it_says_otherwise():
    turn = Turn(index=0, characterId='k', characterName='카엘', prose='p', checks=[], regenerated=0, evidence=[])
    assert (turn.kind, turn.pov, turn.editedByAuthor) == ('character', 'omniscient', False)


@pytest.mark.parametrize('pov', ['omniscient', 'limited:card-1', 'first:card-1'])
def test_decision_takes_the_three_points_of_view(pov):
    assert Decision(turn='speech', speaker='card-1', pov=pov).pov == pov


@pytest.mark.parametrize('body', [
    {'turn': 'shout', 'pov': 'omniscient'}, {'turn': 'speech', 'pov': 'second:card-1'}, {'turn': 'speech', 'pov': 'limited:'},
    {'turn': 'speech', 'pov': 'omniscient:card-1'},
])
def test_decision_refuses_turns_and_points_of_view_outside_the_contract(body):
    with pytest.raises(ValidationError):
        Decision.model_validate(body)


def test_scene_survives_a_json_round_trip_for_the_checkpoint():
    decision = Decision(turn='narration', pov='omniscient')
    scene = Scene(result=SimulationResult(mode='if', premise='p', beats=[], turns=[], status='running', stopReason=None),
                  trail=[Trail(decision=decision, observed='카엘이 막아섰다.', beat=0, done=True)], memo='비가 쏟아진다', hint='더 차갑게',
                  redo=decision, error='멈췄어요.', declined=True)
    assert Scene.model_validate(scene.model_dump(mode='json')) == scene
    assert Scene(result=scene.result).result.notes == []


@pytest.mark.parametrize('body', [
    {'action': 'next'}, {'action': 'next', 'note': '비가 쏟아진다'}, {'action': 'next', 'note': ''},
    {'action': 'edit', 'turn': 2, 'text': '고친 글'}, {'action': 'redo', 'turn': 0}, {'action': 'redo', 'turn': 1, 'note': '더 차갑게'},
    {'action': 'stop'},
])
def test_scene_action_takes_the_fields_its_action_needs(body):
    SceneAction.model_validate(body)


@pytest.mark.parametrize('body', [
    {'action': 'jump'}, {'action': 'edit', 'turn': 1}, {'action': 'edit', 'text': '글'}, {'action': 'edit', 'turn': 1, 'text': '  '},
    {'action': 'edit', 'turn': -1, 'text': '글'}, {'action': 'edit', 'turn': 1, 'text': 'x' * 2001},
    {'action': 'edit', 'turn': 1, 'text': '글', 'note': '메모'}, {'action': 'redo'}, {'action': 'redo', 'turn': 1, 'text': '글'},
    {'action': 'next', 'turn': 1}, {'action': 'next', 'text': '글'}, {'action': 'stop', 'note': '메모'},
    {'action': 'next', 'note': 'x' * 301}, {'action': 'next', 'unknown': 1},
])
def test_scene_action_refuses_fields_that_do_not_fit_or_exceed_the_limits(body):
    with pytest.raises(ValidationError):
        SceneAction.model_validate(body)


@pytest.mark.parametrize('build', [
    lambda: Check(kind='setting', passed=True, detail=''),     # 오류 4~6은 이번 범위 밖
    lambda: Evidence(ref='x', source='web'),
    lambda: Beat(index=0, text='b', status='running'),
    lambda: SimulationResult(mode='if', premise='p', beats=[], turns=[], status='done', stopReason=None),
    lambda: Turn(index=0, kind='system', characterId=None, characterName='n', prose='p', checks=[], regenerated=0, evidence=[]),
])
def test_result_values_outside_the_contract_are_refused(build):
    with pytest.raises(ValidationError):
        build()
