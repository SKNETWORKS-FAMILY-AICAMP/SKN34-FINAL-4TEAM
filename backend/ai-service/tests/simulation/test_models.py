import pytest
from pydantic import ValidationError

from app.simulation.models import Beat, Check, Evidence, SimulationPlan, SimulationResult, Turn


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
        turns=[Turn(index=0, characterId='k', characterName='카엘', prose='카엘이 말했다. "멈춰."',
                    checks=[Check(kind='beat', passed=True, detail='비트를 따랐어요.')], regenerated=1,
                    evidence=[Evidence(ref='card:g', source='graph')])],
        status='running', stopReason=None)
    assert result.model_dump(mode='json') == {
        'mode': 'flow', 'premise': None, 'beats': [{'index': 0, 'text': '성문 대면', 'status': 'done'}],
        'turns': [{'index': 0, 'characterId': 'k', 'characterName': '카엘', 'prose': '카엘이 말했다. "멈춰."',
                   'checks': [{'kind': 'beat', 'passed': True, 'detail': '비트를 따랐어요.'}], 'regenerated': 1,
                   'evidence': [{'ref': 'card:g', 'source': 'graph'}]}],
        'status': 'running', 'stopReason': None}


@pytest.mark.parametrize('build', [
    lambda: Check(kind='setting', passed=True, detail=''),     # 오류 4~6은 이번 범위 밖
    lambda: Evidence(ref='x', source='web'),
    lambda: Beat(index=0, text='b', status='running'),
    lambda: SimulationResult(mode='if', premise='p', beats=[], turns=[], status='done', stopReason=None),
])
def test_result_values_outside_the_contract_are_refused(build):
    with pytest.raises(ValidationError):
        build()
