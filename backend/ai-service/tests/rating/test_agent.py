import json

import pytest
from openai import OpenAIError
from pydantic import ValidationError

from app.rating import agent
from app.rating.errors import RatingFailure
from app.rating.models import RatingResult, Usage

from .stubs import adult, fake_openai


def test_rate_sends_draft_as_data_with_guidelines_and_returns_meta(monkeypatch):
    seen = fake_openai(monkeypatch, adult())

    result, meta = agent.rate('그는 칼로 손가락을 하나씩 잘랐다.')

    assert seen['store'] is False and seen['model'] == 'test-model' and seen['text_format'] is RatingResult
    assert json.loads(seen['input']) == {'draft': '그는 칼로 손가락을 하나씩 잘랐다.'}
    # 저장소의 심의 기준 문서가 지시문에 들어간다.
    assert '청소년 보호법' in seen['instructions'] and '`gambling`' in seen['instructions']
    assert result == adult()
    assert meta == {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': Usage(inputTokens=10, outputTokens=5)}


def test_rate_is_traced(monkeypatch, spans):
    fake_openai(monkeypatch, adult())

    agent.rate('원고')

    [span] = [s for s in spans() if s.name == 'rating.generation']
    assert json.loads(span.attributes['langfuse.observation.input']) == {'draft': '원고'}


def test_missing_model_settings_is_503(monkeypatch):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(RatingFailure) as error:
        agent.rate('원고')
    assert error.value.status == 503


@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'error': ValidationError.from_exception_data('RatingResult', [])}, 502),
    ({'status': 'incomplete', 'parsed': RatingResult(adult=False, reasons=[])}, 502),
    ({'parsed': None}, 502),
])
def test_provider_failure_and_unreadable_output_are_errors(monkeypatch, kwargs, code):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(RatingFailure) as error:
        agent.rate('원고')
    assert error.value.status == code
