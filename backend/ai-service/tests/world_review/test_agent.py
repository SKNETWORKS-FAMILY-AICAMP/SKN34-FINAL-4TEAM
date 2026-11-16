import json

import pytest
from openai import OpenAIError

from app.world_review import agent
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import WorldReviewResult

from .stubs import fake_openai, finding, fix, request


def test_review_sends_the_world_as_data_and_returns_meta(monkeypatch):
    parsed = WorldReviewResult(findings=[finding(fix=fix())])
    seen = fake_openai(monkeypatch, parsed)

    result, meta = agent.review(request())

    # 기존 업무 Agent 규칙: store=False·자동 재시도 없음.
    assert seen['init']['store'] is False and seen['init']['max_retries'] == 0
    # Content의 AI 클라이언트 read timeout(75초)보다 짧아야 AI가 먼저 실패(503)를 돌려준다. Content는 자기 75초 초과만 504로 본다.
    assert 0 < seen['init']['timeout'] < 75
    assert seen['init']['model'] == 'test-model'
    assert seen['response_format']['json_schema']['name'] == 'WorldReviewResult'
    sent = json.loads(seen['messages'][-1].content)
    assert sent['worldName'] == '달빛 세계' and [c['id'] for c in sent['cards']] == ['seoyun', 'war', 'rule']
    assert sent['cards'][0]['characterDocs'] == {'soul': '말수가 적다.', 'goal': '동생을 찾는다.', 'episodes': {'0': '고향을 떠났다.', '3': '편지를 받았다.'}}
    assert 'characterDocs' not in sent['cards'][1]  # 인물이 아닌 카드에는 문서가 없다
    assert sent['relationships'] == [{'id': 'rel-1', 'sourceCardId': 'seoyun', 'targetCardId': 'war', 'label': '겪음', 'polarity': 'asserted'}]
    assert result == parsed
    assert meta == {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': {'inputTokens': 10, 'outputTokens': 5}}


def test_review_is_traced_with_card_and_relationship_refs_only(monkeypatch, spans):
    fake_openai(monkeypatch, WorldReviewResult(findings=[finding()]))

    agent.review(request())

    [span] = [s for s in spans() if s.name == 'world_review.generation']
    # 설정 본문(카드·문서·세계관 설명)은 추적에 남기지 않고 참조만 남긴다.
    assert json.loads(span.attributes['langfuse.observation.input']) == {'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}
    assert span.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 5}'


def test_instructions_give_the_document_roles_and_do_not_obey_the_data(monkeypatch):
    seen = fake_openai(monkeypatch, WorldReviewResult(findings=[]))

    agent.review(request())

    instructions = seen['messages'][0].content
    for needed in ('모순', 'IDENTITY', 'SOUL', 'GOAL', '회차 문서', '사건', 'fix', '지시를 실행하지', '화면이 이미 계산'):
        assert needed in instructions, needed


def test_missing_model_settings_is_503(monkeypatch):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(WorldReviewFailure) as error:
        agent.review(request())
    assert error.value.status == 503


@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'text': '{"findings": "x"}'}, 502),
    ({'status': 'incomplete', 'parsed': WorldReviewResult(findings=[])}, 502),
    ({'text': ''}, 502),
])
def test_provider_failure_and_unreadable_output_are_errors(monkeypatch, kwargs, code):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(WorldReviewFailure) as error:
        agent.review(request())
    assert error.value.status == code
