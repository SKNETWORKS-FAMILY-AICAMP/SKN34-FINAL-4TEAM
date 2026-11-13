import pytest

from app.intent.errors import IntentFailure
from app.orchestration import service
from app.orchestration.models import OrchestrationRequest
from app.research.errors import ResearchFailure

from .stubs import DRAFT, PATCH, QA, WEB, fake_agents, plan


def run(request='요청', **body):
    return service.run(OrchestrationRequest(request=request, **body))


def names(calls):
    return [name for name, *_ in calls]


@pytest.mark.parametrize('routed', [
    plan(status='clarify', message='어떤 작업을 원하시나요?'),
    plan(status='rejected', reason='greeting', message='안녕하세요.'),
])
def test_clarify_and_rejected_run_nothing_and_keep_router_message(monkeypatch, routed):
    calls = fake_agents(monkeypatch, routed)
    result = run(inputs={'story_context': QA})
    assert (result.status, result.message, result.steps) == (routed.status, routed.message, [])
    assert names(calls) == ['route']


def test_router_receives_request_operation_and_materials(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context'))
    run('규칙 알려줘', operation='story_context', materials=['자료'], inputs={'story_context': QA})
    assert calls[0][1] == ('규칙 알려줘', 'story_context', ['자료'])


@pytest.mark.parametrize('steps, unsupported', [
    (['review'], ['review']),
    (['story_development', 'writing_editing'], ['story_development']),
    (['character_simulation'], ['character_simulation']),
    (['web_research', ('writing_editing', 'if_issues_found')], ['writing_editing']),
])
def test_plan_with_unimplemented_or_conditional_step_runs_nothing(monkeypatch, steps, unsupported):
    calls = fake_agents(monkeypatch, plan(*steps))
    result = run(inputs={'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'unsupported' and result.unsupported == unsupported
    assert [s.status for s in result.steps] == ['not_started'] * len(steps)
    assert names(calls) == ['route']


def test_missing_input_of_any_step_runs_nothing(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research'))
    result = run(inputs={'story_context': QA})
    assert (result.status, result.missingInputs) == ('needs_input', ['web_research'])
    assert names(calls) == ['route']


def test_independent_steps_run_in_plan_order_with_own_inputs(monkeypatch):
    calls = fake_agents(monkeypatch, plan('web_research', 'story_context', 'writing_editing'))
    result = run(inputs={'story_context': QA, 'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'completed'
    assert names(calls) == ['route', 'web_research', 'story_context', 'draft']
    assert [s.feature for s in result.steps] == ['web_research', 'story_context', 'writing_editing']
    assert result.steps[1].result.claims[0].sourceIds == ['a']
    assert calls[1][1][0].question == WEB['question']


def test_writing_patch_input_runs_patch(monkeypatch):
    calls = fake_agents(monkeypatch, plan('writing_editing'))
    result = run(inputs={'writing_editing': PATCH})
    assert names(calls) == ['route', 'patch']
    assert result.steps[0].result.after == '그는 차갑게 웃었다.'


def test_failed_step_keeps_earlier_result_and_starts_no_new_step(monkeypatch):
    calls = fake_agents(monkeypatch, plan('story_context', 'web_research', 'writing_editing'),
                        fail={'web_research': ResearchFailure(503, '웹 검색에 실패했습니다.')})
    result = run(inputs={'story_context': QA, 'web_research': WEB, 'writing_editing': DRAFT})
    assert result.status == 'failed'
    assert [(s.status, s.error) for s in result.steps] == [
        ('completed', None), ('failed', '웹 검색에 실패했습니다.'), ('not_started', None)]
    assert names(calls) == ['route', 'story_context', 'web_research']


def test_router_failure_propagates(monkeypatch):
    fake_agents(monkeypatch, plan('story_context'), fail={'route': IntentFailure()})
    with pytest.raises(IntentFailure):
        run(inputs={'story_context': QA})
