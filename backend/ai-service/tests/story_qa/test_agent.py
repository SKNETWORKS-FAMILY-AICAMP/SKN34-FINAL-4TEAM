import json

import pytest

from app.story_qa import agent
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import AnswerRequest, AnswerResponse, Claim, Excerpt, QaTurn
from fake_chat import fake_chat

DATA = AnswerRequest(question='무슨 관계인가요?', excerpts=[
    Excerpt(id='source', episode=1, quote='원문 한 줄', kind='relationship', title='리안 → 카엘'),
])


def provider(monkeypatch, result: AnswerResponse | None = None, **kwargs):
    return fake_chat(monkeypatch, text=result.model_dump_json() if result else '', **kwargs)


def test_answer_uses_structured_outputs_and_only_provided_passages(monkeypatch):
    expected = AnswerResponse(claims=[Claim(text='용이 왔어요.', kind='confirmed', sourceIds=['source'])], gaps=[])
    seen = provider(monkeypatch, expected)

    assert agent.answer(DATA) == expected
    system, human = seen['messages']
    assert seen['init']['store'] is False and seen['response_format']['json_schema']['name'] == 'AnswerResponse'
    assert json.loads(human.content)['excerpts'][0] == {'id': 'source', 'episode': 1, 'quote': '원문 한 줄',
                                                       'kind': 'relationship', 'title': '리안 → 카엘'}
    assert '현재 관계' in system.content


def test_incomplete_model_response_is_502(monkeypatch):
    provider(monkeypatch, AnswerResponse(claims=[], gaps=[]), status='incomplete')
    with pytest.raises(StoryQaFailure) as error:
        agent.answer(DATA)
    assert error.value.status == 502


def test_answer_without_model_settings_is_503(monkeypatch):
    provider(monkeypatch)
    monkeypatch.delenv('OPENAI_API_KEY')
    with pytest.raises(StoryQaFailure) as error:
        agent.answer(DATA)
    assert error.value.status == 503


def test_previous_turns_are_sent_only_to_resolve_references(monkeypatch):
    data = DATA.model_copy(update={'history': [QaTurn(question='카이의 목표는?', answer='왕이 되는 것')]})
    seen = provider(monkeypatch, AnswerResponse(claims=[], gaps=['근거 없음']))

    assert agent.answer(data).gaps == ['근거 없음']
    system, human = seen['messages']
    assert '카이의 목표는?' in human.content and 'history' in system.content


def test_generation_trace_has_model_usage_and_failure(monkeypatch, spans):
    provider(monkeypatch, AnswerResponse(claims=[], gaps=['근거 없음']))
    agent.answer(DATA)
    provider(monkeypatch, status='incomplete')
    with pytest.raises(StoryQaFailure):
        agent.answer(DATA)
    ok, failed = [s for s in spans() if s.name == 'qa.generation']
    assert ok.attributes['langfuse.observation.type'] == 'generation'
    assert ok.attributes['langfuse.observation.model.name'] == 'resolved-model'
    assert ok.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 5}'
    assert failed.attributes['langfuse.observation.level'] == 'ERROR'
    assert json.loads(ok.attributes['langfuse.observation.input'])['question'] == '무슨 관계인가요?'
    assert json.loads(ok.attributes['langfuse.observation.output'])['gaps'] == ['근거 없음']
    assert '원문 한 줄' not in str(dict(ok.attributes))  # 현재 관계 발췌 본문은 결정 범위 밖
