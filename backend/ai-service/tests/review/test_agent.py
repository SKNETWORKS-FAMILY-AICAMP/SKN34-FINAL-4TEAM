import json

import pytest
from openai import OpenAIError
from pydantic import ValidationError

from app.review import agent
from app.review.errors import ReviewFailure
from app.review.models import ReviewResult, Usage

from .stubs import fake_openai, finding


def test_review_sends_draft_and_settings_as_data_and_returns_meta(monkeypatch):
    parsed = ReviewResult(findings=[finding()], gaps=[])
    seen = fake_openai(monkeypatch, parsed)

    result, meta = agent.review('semantic', '서윤은 웃엇다.', [{'ref': 'card:seoyun', 'title': '서윤', 'text': '29세'}])

    assert seen['store'] is False and seen['model'] == 'test-model' and seen['text_format'] is ReviewResult
    assert '서윤은 웃엇다' in seen['input'] and 'card:seoyun' in seen['input'] and '"semantic"' in seen['input']
    assert result == parsed
    assert meta == {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': Usage(inputTokens=10, outputTokens=5)}


def test_review_is_traced_with_setting_refs_only(monkeypatch, spans):
    fake_openai(monkeypatch, ReviewResult(findings=[finding()], gaps=[]))

    agent.review('semantic', '서윤은 웃엇다.', [{'ref': 'card:seoyun', 'title': '서윤', 'text': '비밀 설정 본문'}])

    [span] = [s for s in spans() if s.name == 'review.generation']
    recorded = json.loads(span.attributes['langfuse.observation.input'])
    # 원고 본문은 팀 결정으로 남기고, 설정 본문은 참조만 남긴다.
    assert recorded == {'check': 'semantic', 'draft': '서윤은 웃엇다.', 'settings': ['card:seoyun']}
    assert span.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 5}'


def test_check_selects_its_own_instructions(monkeypatch):
    seen = fake_openai(monkeypatch, ReviewResult(findings=[], gaps=[]))
    agent.review('mechanical', '문장', [])
    mechanical = seen['instructions']
    agent.review('semantic', '문장', [])
    assert mechanical != seen['instructions']


def test_missing_model_settings_is_503(monkeypatch):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(ReviewFailure) as error:
        agent.review('mechanical', '문장', [])
    assert error.value.status == 503


@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'error': ValidationError.from_exception_data('ReviewResult', [])}, 502),
    ({'status': 'incomplete', 'parsed': ReviewResult(findings=[], gaps=[])}, 502),
    ({'parsed': None}, 502),
])
def test_provider_failure_and_unreadable_output_are_errors(monkeypatch, kwargs, code):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(ReviewFailure) as error:
        agent.review('mechanical', '문장', [])
    assert error.value.status == code
