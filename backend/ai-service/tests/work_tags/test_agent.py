"""#372 모델 호출. 제공사는 항상 대역이고 호출 설정·추적·실패 변환을 확인한다."""
import json

import pytest
from openai import APITimeoutError, OpenAIError

from app.work_tags import agent
from app.work_tags.errors import SuggestionFailure
from app.work_tags.models import Input, Output

from .stubs import data, fake_openai, output


def test_proposes_candidates_with_strict_schema(monkeypatch):
    seen = fake_openai(monkeypatch, output())
    result = agent.propose(Input.model_validate(data()))
    assert result == Output.model_validate(output())
    assert seen['init']['store'] is False and seen['init']['max_retries'] == 0 and seen['init']['max_tokens'] >= 2000
    assert json.loads(seen['messages'][-1].content)['allowedGenres'] == ['현대', '드라마', '고전']


def test_trace_keeps_title_and_episode_numbers_but_not_manuscript(monkeypatch, spans):
    fake_openai(monkeypatch, output())
    agent.propose(Input.model_validate(data()))
    [span] = [s for s in spans() if s.name == 'work_tags.generation']
    traced = json.loads(span.attributes['langfuse.observation.input'])
    assert traced == {'title': '메밀꽃 필 무렵', 'episodes': [1]}


@pytest.mark.parametrize('kwargs, status', [
    ({'status': 'incomplete'}, 502),
    ({'error': OpenAIError('down')}, 503),
    ({'error': APITimeoutError(request=None)}, 503),
])
def test_provider_failures_are_explicit(monkeypatch, kwargs, status):
    fake_openai(monkeypatch, output(), **kwargs)
    with pytest.raises(SuggestionFailure) as failure:
        agent.propose(Input.model_validate(data()))
    assert failure.value.status == status


def test_missing_model_config_never_calls_provider(monkeypatch):
    seen = fake_openai(monkeypatch, output())
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(SuggestionFailure) as failure:
        agent.propose(Input.model_validate(data()))
    assert failure.value.status == 503 and 'messages' not in seen
