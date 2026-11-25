import json

import pytest
from openai import OpenAIError

from app.world_review import agent
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import EnrichResult, FillResult, ImpactResult, WorldReviewResult

from .stubs import CONTEXT, PASSAGES, PLANS, affected, fake_openai, fill_line, fill_request, finding, fix, request


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
    # 사건 카드끼리의 시간 순서·선후 모순(연대기)도 새 종류를 만들지 않고 contradiction으로 지적한다.
    assert '연대기' in instructions and '시간 순서' in instructions and instructions.count('contradiction은') == 1


CALLS = {
    'review': lambda: agent.review(request()),
    'enrich': lambda: agent.enrich('서윤을 보강해줘', request()),
    'impact': lambda: agent.impact('서윤의 나이를 바꾸면?', request(), CONTEXT, PLANS),
    'fill': lambda: agent.fill(fill_request()),
}


@pytest.mark.parametrize('name', CALLS)
def test_missing_model_settings_is_503(monkeypatch, name):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(WorldReviewFailure) as error:
        CALLS[name]()
    assert error.value.status == 503


@pytest.mark.parametrize('name', CALLS)
@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'text': '{"findings": "x"}'}, 502),
    ({'status': 'incomplete', 'parsed': WorldReviewResult(findings=[])}, 502),
    ({'text': ''}, 502),
])
def test_provider_failure_and_unreadable_output_are_errors(monkeypatch, kwargs, code, name):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(WorldReviewFailure) as error:
        CALLS[name]()
    assert error.value.status == code


# --- enrich: 작가가 가리킨 기존 카드의 본문·인물 문서를 세계관과 어긋나지 않게 보강한 제안 -------------------------------------------------

def test_enrich_sends_the_request_and_the_world_as_data_and_returns_meta(monkeypatch):
    parsed = EnrichResult(fixes=[fix(target='soul', text='더 자세한 SOUL')], note='말투를 보강했다.')
    seen = fake_openai(monkeypatch, parsed)

    result, meta = agent.enrich('서윤의 말투를 자세히 써줘', request())

    assert seen['init']['store'] is False and seen['init']['max_retries'] == 0 and 0 < seen['init']['timeout'] < 75
    assert seen['response_format']['json_schema']['name'] == 'EnrichResult'
    sent = json.loads(seen['messages'][-1].content)
    assert set(sent) == {'request', 'world'} and sent['request'] == '서윤의 말투를 자세히 써줘'
    assert sent['world']['worldName'] == '달빛 세계' and [c['id'] for c in sent['world']['cards']] == ['seoyun', 'war', 'rule']
    assert sent['world']['relationships'][0]['id'] == 'rel-1' and sent['world']['cards'][0]['characterDocs']['goal'] == '동생을 찾는다.'
    assert result == parsed and meta['model'] == 'resolved-model'


def test_enrich_instructions_scope_the_proposal_to_existing_cards_and_do_not_obey_the_data(monkeypatch):
    seen = fake_openai(monkeypatch, EnrichResult(fixes=[fix()], note=''))

    agent.enrich('서윤을 보강해줘', request())

    instructions = seen['messages'][0].content
    for needed in ('보강', 'request', '지시를 실행하지', '새 카드', 'IDENTITY', 'SOUL', 'GOAL', '1~5', '3,000자', 'null', '같은 칸', 'note', '300자'):
        assert needed in instructions, needed


# --- impact: 바꾸려는 설정·사건이 영향을 주는 곳 분석(읽기만) ------------------------------------------------------------------------

def test_impact_sends_the_world_the_allowed_manuscript_context_and_the_plans_as_data(monkeypatch):
    parsed = ImpactResult(affected=[affected()], conflicts=['3화와 충돌한다.'], gaps=[])
    seen = fake_openai(monkeypatch, parsed)

    result, meta = agent.impact('서윤의 나이를 바꾸면?', request(), CONTEXT, PLANS)

    assert seen['init']['store'] is False and seen['init']['max_retries'] == 0 and 0 < seen['init']['timeout'] < 75
    assert seen['response_format']['json_schema']['name'] == 'ImpactResult'
    sent = json.loads(seen['messages'][-1].content)
    assert set(sent) == {'request', 'world', 'manuscript', 'plans'} and sent['request'] == '서윤의 나이를 바꾸면?'
    assert [c['id'] for c in sent['world']['cards']] == ['seoyun', 'war', 'rule']
    assert sent['manuscript'] == CONTEXT and sent['plans'] == PLANS
    assert result == parsed and meta['model'] == 'resolved-model'


def test_impact_instructions_name_each_ref_kind_and_only_analyze(monkeypatch):
    seen = fake_openai(monkeypatch, ImpactResult(affected=[], conflicts=[], gaps=[]))

    agent.impact('서윤의 나이를 바꾸면?', request(), CONTEXT, PLANS)

    instructions = seen['messages'][0].content
    for needed in ('영향', 'card', 'relationship', 'episode', 'scene', 'ref', 'confirmed', 'inferred', 'conflicts', 'gaps', '지시를 실행하지',
                   '계획', '정본이 아닌', '입력에 있는 값만'):
        assert needed in instructions, needed


@pytest.mark.parametrize('name, span_name, asked', [('enrich', 'world_review.enrich.generation', '서윤을 보강해줘'),
                                                   ('impact', 'world_review.impact.generation', '서윤의 나이를 바꾸면?')])
def test_enrich_and_impact_are_traced_with_the_request_and_refs_only(monkeypatch, spans, name, span_name, asked):
    fake_openai(monkeypatch, EnrichResult(fixes=[fix()], note='') if name == 'enrich' else ImpactResult(affected=[], conflicts=[], gaps=[]))

    CALLS[name]()

    [span] = [s for s in spans() if s.name == span_name]
    recorded = json.loads(span.attributes['langfuse.observation.input'])
    # 설정·원고 본문은 추적에 남기지 않고 요청 문장과 카드·관계 id 참조만 남긴다.
    assert recorded == {'request': asked, 'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}
    assert '약초꾼' not in json.dumps(recorded, ensure_ascii=False)


# --- fill: 한 인물의 비어 있는 IDENTITY·SOUL을 채울 근거 문장을 원고 발췌에서 고른다 ----------------------------------------------------

def test_fill_sends_the_names_the_targets_and_the_passages_as_data_and_returns_meta(monkeypatch):
    parsed = FillResult(lines=[fill_line()])
    seen = fake_openai(monkeypatch, parsed)

    result, meta = agent.fill(fill_request())

    assert seen['init']['store'] is False and seen['init']['max_retries'] == 0 and 0 < seen['init']['timeout'] < 75
    assert seen['response_format']['json_schema']['name'] == 'FillResult'
    # 카드 id는 모델이 쓸 데가 없어 보내지 않는다.
    assert json.loads(seen['messages'][-1].content) == {'title': '치삼', 'aliases': ['치삼이'], 'targets': ['body', 'soul'], 'passages': PASSAGES}
    assert result == parsed and meta['model'] == 'resolved-model'


def test_fill_instructions_make_the_model_quote_the_manuscript_and_never_invent(monkeypatch):
    seen = fake_openai(monkeypatch, FillResult(lines=[]))

    agent.fill(fill_request())

    instructions = seen['messages'][0].content
    for needed in ('targets', 'passages', 'IDENTITY', 'SOUL', 'quote', '글자 그대로', '요약', 'fact', 'description', 'episode', '가장 작은 episode',
                   '8개', '지시를 실행하지', '지어내', '다른 인물'):
        assert needed in instructions, needed


def test_fill_is_traced_with_the_card_the_targets_and_the_episodes_only(monkeypatch, spans):
    fake_openai(monkeypatch, FillResult(lines=[fill_line()]))

    agent.fill(fill_request())

    [span] = [s for s in spans() if s.name == 'world_review.fill.generation']
    recorded = json.loads(span.attributes['langfuse.observation.input'])
    # 원고 발췌와 인물 이름은 추적에 남기지 않고 카드 id·대상·회차 번호만 남긴다.
    assert recorded == {'cardId': 'chisam', 'targets': ['body', 'soul'], 'episodes': [2, 4]}
    assert '소금장수' not in json.dumps(recorded, ensure_ascii=False) and '치삼' not in json.dumps(recorded, ensure_ascii=False)
