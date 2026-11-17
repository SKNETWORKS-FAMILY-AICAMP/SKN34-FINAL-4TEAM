import json

import pytest
from openai import OpenAIError

from app.rating import agent
from app.rating.errors import RatingFailure

from .stubs import adult, fake_openai, general

EPISODE = {'title': '2화', 'authorNote': None, 'draft': '그는 칼로 손가락을 하나씩 잘랐다.',
           'characters': [{'ref': 'card:hana', 'name': '하나', 'text': '17세 고등학생.'}], 'signals': {'profanityCount': 0}}


def test_rate_sends_episode_as_data_with_guidelines_and_returns_meta(monkeypatch):
    seen = fake_openai(monkeypatch, adult())

    result, meta = agent.rate(EPISODE)

    assert seen['init']['store'] is False and seen['init']['model'] == 'test-model' and seen['init']['max_tokens'] == 16000
    assert seen['response_format']['json_schema']['name'] == 'RatingResult'
    assert json.loads(seen['messages'][-1].content) == EPISODE
    # 저장소의 심의 기준 평가표가 지시문에 들어간다.
    instructions = seen['messages'][0].content
    assert all(text in instructions for text in ('청소년 보호법', '`gambling`', '`other`', '## 수준', '## 금지 표현'))
    assert result == adult()
    assert meta == {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': {'inputTokens': 10, 'outputTokens': 5}}


def test_rate_is_traced_with_character_refs_only(monkeypatch, spans):
    fake_openai(monkeypatch, adult())

    agent.rate(EPISODE)

    [span] = [s for s in spans() if s.name == 'rating.generation']
    # 원고 본문은 팀 결정으로 남기고, 인물 설정 본문은 참조만 남긴다.
    assert json.loads(span.attributes['langfuse.observation.input']) == {**EPISODE, 'characters': ['card:hana']}


def test_missing_model_settings_is_503(monkeypatch):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(RatingFailure) as error:
        agent.rate(EPISODE)
    assert (error.value.status, str(error.value)) == (503, '심의 판별 모델 설정이 필요합니다.')


@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'text': '{"prohibited": false, "assessments": []}'}, 502),  # 항목을 평가하지 않은 응답
    ({'status': 'incomplete', 'parsed': general()}, 502),
    ({'text': ''}, 502),
])
def test_provider_failure_and_unreadable_output_are_errors(monkeypatch, kwargs, code):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(RatingFailure) as error:
        agent.rate(EPISODE)
    assert error.value.status == code
