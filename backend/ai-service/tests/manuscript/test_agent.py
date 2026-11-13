import json
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from app.manuscript import agent
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest, AnswerResponse, Claim, Excerpt

DATA = AnswerRequest(question='무슨 관계인가요?', excerpts=[
    Excerpt(id='source', episode=1, quote='원문 한 줄', kind='relationship', title='리안 → 카엘'),
])


def provider(monkeypatch, parse):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    monkeypatch.setattr(agent, 'OpenAI', lambda **_: nullcontext(SimpleNamespace(responses=SimpleNamespace(parse=parse))))


def test_answer_uses_structured_outputs_and_only_provided_passages(monkeypatch):
    expected = AnswerResponse(claims=[Claim(text='용이 왔어요.', kind='confirmed', sourceIds=['source'])], gaps=[])

    def parse(**kwargs):
        assert kwargs['store'] is False
        assert kwargs['text_format'] is AnswerResponse
        assert '원문 한 줄' in kwargs['input']
        assert '"kind":"relationship"' in kwargs['input']
        assert '현재 관계' in kwargs['instructions']
        return SimpleNamespace(status='completed', output_parsed=expected)

    provider(monkeypatch, parse)
    assert agent.answer(DATA) == expected


def test_incomplete_model_response_is_502(monkeypatch):
    provider(monkeypatch, lambda **_: SimpleNamespace(status='incomplete', output_parsed=None))
    with pytest.raises(ManuscriptFailure) as error:
        agent.answer(DATA)
    assert error.value.status == 502


def test_answer_without_model_settings_is_503(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with pytest.raises(ManuscriptFailure) as error:
        agent.answer(DATA)
    assert error.value.status == 503


def test_previous_turns_are_sent_only_to_resolve_references(monkeypatch):
    from app.manuscript.models import QaTurn
    data = DATA.model_copy(update={'history': [QaTurn(question='카이의 목표는?', answer='왕이 되는 것')]})

    def parse(**kwargs):
        assert '카이의 목표는?' in kwargs['input'] and 'history' in kwargs['instructions']
        return SimpleNamespace(status='completed', output_parsed=AnswerResponse(claims=[], gaps=['근거 없음']))

    provider(monkeypatch, parse)
    assert agent.answer(data).gaps == ['근거 없음']


def test_generation_trace_has_model_usage_and_failure(monkeypatch, spans):
    expected = AnswerResponse(claims=[], gaps=['근거 없음'])
    provider(monkeypatch, lambda **_: SimpleNamespace(status='completed', output_parsed=expected, model='resolved-model',
                                                      usage=SimpleNamespace(input_tokens=10, output_tokens=4)))
    agent.answer(DATA)
    provider(monkeypatch, lambda **_: SimpleNamespace(status='incomplete', output_parsed=None, model='m', usage=None))
    with pytest.raises(ManuscriptFailure):
        agent.answer(DATA)
    ok, failed = spans()
    assert ok.attributes['langfuse.observation.type'] == 'generation'
    assert ok.attributes['langfuse.observation.model.name'] == 'resolved-model'
    assert ok.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 4}'
    assert failed.attributes['langfuse.observation.level'] == 'ERROR'
    assert json.loads(ok.attributes['langfuse.observation.input'])['question'] == '무슨 관계인가요?'
    assert json.loads(ok.attributes['langfuse.observation.output'])['gaps'] == ['근거 없음']
    assert '원문 한 줄' not in str(dict(ok.attributes))  # 현재 관계 발췌 본문은 결정 범위 밖
