import pytest
from pydantic import ValidationError

from app.orchestration.models import OrchestrationRequest, StepResult, WritingInput
from app.simulation.models import SimulationResult

from .stubs import DRAFT, PATCH, SCENE


@pytest.mark.parametrize('body', [{}, {**DRAFT, **PATCH}])
def test_writing_input_needs_exactly_one_of_draft_or_patch(body):
    with pytest.raises(ValidationError):
        WritingInput.model_validate(body)


@pytest.mark.parametrize('body', [
    {},                                                                   # 요청도 재개도 없음
    {'request': '요청', 'resume': {'approved': True}, 'conversation': {'threadId': 't', 'scope': 's'}},
    {'resume': {'approved': True}},                                       # 재개는 대화가 필요
])
def test_request_is_either_a_new_turn_or_a_resume_of_a_conversation(body):
    with pytest.raises(ValidationError):
        OrchestrationRequest.model_validate(body)


def test_simulation_result_is_a_step_result():
    step = StepResult.model_validate({'feature': 'character_simulation', 'when': 'always', 'status': 'completed',
                                      'result': SCENE.model_dump(mode='json')})
    assert isinstance(step.result, SimulationResult) and len(step.result.turns) == 2
