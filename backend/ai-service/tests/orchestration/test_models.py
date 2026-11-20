import pytest
from pydantic import ValidationError

from app.orchestration.models import OrchestrationRequest, OrchestrationResponse, Resume, StepResult, WritingInput
from app.simulation.models import SimulationPlan, SimulationResult
from app.world_review.models import EnrichResponse, ImpactResponse, WorldReviewResponse

from .stubs import DRAFT, PATCH, SCENE, WEB, WORLD_ENRICH, WORLD_IMPACT, WORLD_REVIEW


@pytest.mark.parametrize('body', [{}, {**DRAFT, **PATCH}])
def test_writing_input_needs_exactly_one_of_draft_or_patch(body):
    with pytest.raises(ValidationError):
        WritingInput.model_validate(body)


def test_target_may_name_a_base_episode_that_is_not_the_episode_it_reflects_into():
    plain = OrchestrationRequest(request='요청', target={'workId': 'w', 'episode': 4})
    assert plain.target.baseEpisode is None and plain.target.model_dump(exclude_none=True) == {'workId': 'w', 'episode': 4}
    split = OrchestrationRequest(request='요청', target={'workId': 'w', 'episode': 5, 'baseEpisode': 4})
    assert (split.target.episode, split.target.baseEpisode) == (5, 4)
    with pytest.raises(ValidationError):
        OrchestrationRequest(request='요청', target={'workId': 'w', 'episode': 5, 'baseEpisode': 0})


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


@pytest.mark.parametrize('task, result, kind', [('check', WORLD_REVIEW, WorldReviewResponse), ('enrich', WORLD_ENRICH, EnrichResponse),
                                                 ('impact', WORLD_IMPACT, ImpactResponse)])
def test_world_results_are_step_results_that_keep_their_task(task, result, kind):
    step = StepResult.model_validate({'feature': 'world', 'when': 'always', 'task': task, 'status': 'completed', 'result': result.model_dump(mode='json')})
    assert (step.feature, step.task) == ('world', task) and type(step.result) is kind and step.result == result


def test_a_step_task_is_one_of_the_known_tasks():
    with pytest.raises(ValidationError):
        StepResult.model_validate({'feature': 'world', 'when': 'always', 'task': 'audit', 'status': 'not_started'})


def test_world_can_be_chosen_as_an_operation_but_takes_no_step_input():
    assert OrchestrationRequest(request='설정집 검토', operation='world').operation == 'world'
    with pytest.raises(ValidationError):
        OrchestrationRequest(request='설정집 검토', inputs={'world': {}})


@pytest.mark.parametrize('operation', ['world_review', 'world_plot'])
def test_the_old_world_operations_are_no_longer_accepted(operation):
    with pytest.raises(ValidationError):
        OrchestrationRequest(request='설정집 검토', operation=operation)


@pytest.mark.parametrize('operation', ['manuscript_review', 'review'])
def test_manuscript_review_operations_use_the_new_feature(operation):
    request = OrchestrationRequest(request='원고 검수', operation=operation, inputs={operation: {'check': 'semantic'}})
    assert request.operation == 'manuscript_review'
    assert request.inputs.model_dump(exclude_none=True) == {'manuscript_review': {'check': 'semantic'}}


# [시뮬레이션] 버튼의 시작 양식(simulation): operation이 character_simulation인 새 요청에서만 받고 한도는 SimulationPlan이 지킨다.
FORM = {'mode': 'if', 'premise': '만약 북문이 열려 있었다면?', 'characterIds': ['k']}
BUTTON = {'request': '흐름 모드 시뮬레이션: 장면 계획 3개', 'operation': 'character_simulation', 'simulation': FORM}
CONVERSATION = {'threadId': 't', 'scope': 's'}


def test_simulation_form_comes_with_the_simulation_operation_of_a_new_request():
    assert OrchestrationRequest.model_validate(BUTTON).simulation == SimulationPlan(**FORM)
    assert OrchestrationRequest.model_validate({**BUTTON, 'conversation': CONVERSATION, 'fromTurn': 0}).simulation is not None
    assert OrchestrationRequest.model_validate({'request': '요청'}).simulation is None


@pytest.mark.parametrize('body', [
    {'request': '시뮬레이션', 'simulation': FORM},                                    # operation 없음
    {**BUTTON, 'operation': 'writing_editing'},                                       # 다른 기능
    {'conversation': CONVERSATION, 'operation': 'character_simulation', 'simulation': FORM, 'resume': {'approved': True}},  # 이어가기
])
def test_simulation_form_needs_the_simulation_operation_and_a_new_request(body):
    with pytest.raises(ValidationError):
        OrchestrationRequest.model_validate(body)


@pytest.mark.parametrize('form', [
    {**FORM, 'premise': 'x' * 501}, {**FORM, 'beats': ['비트'] * 9}, {**FORM, 'beats': ['b' * 201]}, {**FORM, 'beats': ['']},
    {**FORM, 'characterIds': [str(i) for i in range(7)]}, {**FORM, 'characterIds': ['i' * 101]},
    {**FORM, 'mode': 'story'}, {**FORM, 'unknown': 1},
])
def test_simulation_form_keeps_the_plan_limits(form):
    with pytest.raises(ValidationError):
        OrchestrationRequest.model_validate({**BUTTON, 'simulation': form})


# 옛 web_research 키(#545 전): 요청·재개 입력, 단계, 입력 대기 목록, 선택 기능을 모두 research로 읽는다.
@pytest.mark.parametrize('key', ['web_research', 'research'])
def test_the_old_web_research_input_is_read_as_research(key):
    request = OrchestrationRequest(request='고증', operation=key, inputs={key: WEB})
    assert request.operation == 'research'
    assert request.inputs.research.question == WEB['question']
    assert Resume(approved=True, inputs={key: WEB}).inputs.research.question == WEB['question']


def test_a_step_and_a_waiting_input_recorded_as_web_research_still_load():
    step = StepResult.model_validate({'feature': 'web_research', 'when': 'always', 'status': 'not_started'})
    reply = OrchestrationResponse.model_validate({'status': 'waiting', 'steps': [step.model_dump(mode='json')], 'missingInputs': ['web_research']})
    assert (reply.steps[0].feature, reply.missingInputs) == ('web_research', ['research'])
