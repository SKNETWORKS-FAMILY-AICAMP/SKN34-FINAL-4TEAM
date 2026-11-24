import pytest
from langchain_core.messages import AIMessage

from app.evaluation import agent
from app.evaluation.errors import EvaluationFailure


def test_generate_runs_the_prompt_text_on_the_item_input(monkeypatch):
    seen = {}

    def run(name, label, failure, instructions, data, **options):
        seen.update(name=name, failure=failure, instructions=instructions, data=data, options=options)
        return AIMessage('모델 응답'), None
    monkeypatch.setattr(agent.agent_runtime, 'run', run)

    assert agent.generate('프롬프트 버전 본문', {'question': '질문'}) == '모델 응답'
    assert (seen['name'], seen['failure'], seen['instructions'], seen['data']) == ('evaluation.generate', EvaluationFailure, '프롬프트 버전 본문', {'question': '질문'})
    assert seen['options']['trace'] == {'question': '질문'} and 'schema' not in seen['options']  # 항목 입력을 추적에 남기고 구조화 출력은 쓰지 않는다


def test_blank_model_output_is_a_failure(monkeypatch):
    monkeypatch.setattr(agent.agent_runtime, 'run', lambda *a, **k: (AIMessage('  '), None))

    with pytest.raises(EvaluationFailure) as error:
        agent.generate('지시문', {'question': '질문'})

    assert error.value.status == 502


def test_generate_runs_on_the_model_of_the_evaluated_version(monkeypatch):
    seen = {}
    monkeypatch.setattr(agent.agent_runtime, 'run', lambda *a, **options: seen.update(options) or (AIMessage('응답'), None))
    agent.generate('본문', {}, 'gpt-chosen')
    assert seen['model'] == 'gpt-chosen'
