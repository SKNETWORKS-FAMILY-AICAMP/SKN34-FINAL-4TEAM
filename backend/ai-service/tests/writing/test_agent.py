import json

import pytest
from openai import OpenAIError

from app.writing import agent
from app.writing.errors import WritingFailure
from app.writing.models import BeatPlan, DraftRequest, DraftResponse, PatchRequest, PlanRequest, PlanResponse, Usage

from .stubs import fake_openai


def test_draft_writes_new_text_from_plan_and_allowed_context(monkeypatch):
    seen = fake_openai(monkeypatch, text='  비가 그친 새벽, 서윤은 문을 열었다.  ')
    data = DraftRequest(episodeNumber=11, plan='1. 서윤이 편지를 발견한다.', context='10화: 서윤은 도시를 떠났다.')

    result = agent.draft(data)

    assert seen['init']['store'] is False and seen['init']['max_tokens'] == 4000
    assert seen['init']['model'] == 'test-model' and 'response_format' not in seen
    sent = seen['messages'][-1].content
    assert '서윤이 편지를 발견한다' in sent and '도시를 떠났다' in sent
    assert result.text == '비가 그친 새벽, 서윤은 문을 열었다.'
    assert result.model == 'resolved-model'
    assert result.providerResponseId == 'resp-1'
    assert result.usage == Usage(inputTokens=10, outputTokens=5)


def test_writing_is_traced_without_allowed_context(monkeypatch, spans):
    fake_openai(monkeypatch, text='새 원고')
    agent.draft(DraftRequest(episodeNumber=2, plan='계획', context='비공개 설정 본문'))
    [span] = [s for s in spans() if s.name == 'writing.generation']
    # 허용 문맥(설정 본문)은 추적 결정 범위 밖이라 남기지 않고, 계획·원고는 남긴다.
    assert json.loads(span.attributes['langfuse.observation.input']) == {'episodeNumber': 2, 'plan': '계획'}
    assert span.attributes['langfuse.observation.output'] == '새 원고'


def test_patch_returns_before_and_after_for_the_selection_only(monkeypatch):
    seen = fake_openai(monkeypatch, text='그는 조용히 웃었다.')
    data = PatchRequest(selection='그는 웃었다.', instruction='더 차분하게', precedingText='문이 닫혔다.',
                        followingText='창밖은 어두웠다.')

    result = agent.patch(data)

    # 앞뒤 문장은 읽기 전용 문맥으로만 보내고, 결과는 선택 구간의 교체 문장뿐이다.
    sent = seen['messages'][-1].content
    assert '문이 닫혔다' in sent and '그는 웃었다' in sent and '더 차분하게' in sent
    assert result.before == '그는 웃었다.'
    assert result.after == '그는 조용히 웃었다.'
    assert result.providerResponseId == 'resp-1'


def test_missing_model_settings_is_503(monkeypatch):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(WritingFailure) as error:
        agent.patch(PatchRequest(selection='문장', instruction='고쳐줘'))
    assert error.value.status == 503


@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'status': 'incomplete'}, 502),
    ({'text': '   '}, 502),
])
def test_provider_failure_and_empty_output_are_errors_not_results(monkeypatch, kwargs, code):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(WritingFailure) as error:
        agent.draft(DraftRequest(episodeNumber=1, plan='계획'))
    assert error.value.status == code


def plan_json(*plans, notes=()):
    return json.dumps({'plans': [{'title': t, 'beats': list(b)} for t, b in plans], 'notes': list(notes)}, ensure_ascii=False)


def test_plan_returns_beat_plans_without_writing_prose(monkeypatch):
    seen = fake_openai(monkeypatch, text=plan_json(('편지의 비밀', ['서윤이 편지를 발견한다.', '카이가 편지를 숨긴다.']),
                                                  ('추격', ['서윤이 카이를 쫓는다.']), notes=['10화의 약속은 확정 사건']))
    result = agent.plan(PlanRequest(episodeNumber=11, request='11화 전개를 두 가지 짜줘', context='10화: 서윤은 도시를 떠났다.'))

    assert seen['response_format']['json_schema']['strict'] is True
    sent = seen['messages'][-1].content
    assert '두 가지 짜줘' in sent and '도시를 떠났다' in sent
    assert [p.title for p in result.plans] == ['편지의 비밀', '추격']
    assert result.plans[0].beats == ['서윤이 편지를 발견한다.', '카이가 편지를 숨긴다.']
    assert result.notes == ['10화의 약속은 확정 사건'] and result.providerResponseId == 'resp-1'


@pytest.mark.parametrize('text, single', [
    (plan_json(), False),                                                   # 계획 없음
    (plan_json(('a', ['1']), ('b', ['1']), ('c', ['1']), ('d', ['1'])), False),  # 대안 3개 초과
    (plan_json(('a', ['1']), ('b', ['1'])), True),                          # 바로 집필은 계획 하나
    (plan_json(('a', [])), False),                                          # 비트 없음
])
def test_plan_outside_limits_is_failure_not_result(monkeypatch, text, single):
    fake_openai(monkeypatch, text=text)
    with pytest.raises(WritingFailure) as error:
        agent.plan(PlanRequest(episodeNumber=1, request='전개 짜줘', single=single))
    assert error.value.status == 502


def test_plan_and_draft_plans_once_then_writes_from_that_plan(monkeypatch):
    calls = []
    monkeypatch.setattr(agent, 'plan', lambda data: calls.append(('plan', data)) or PlanResponse(
        plans=[BeatPlan(title='편지의 비밀', beats=['서윤이 편지를 발견한다.', '카이가 편지를 숨긴다.'])], notes=[],
        model='m', providerResponseId='p', usage=None))
    monkeypatch.setattr(agent, 'draft', lambda data: calls.append(('draft', data)) or DraftResponse(
        text='새 원고', model='m', providerResponseId='d', usage=None))

    result = agent.plan_and_draft(PlanRequest(episodeNumber=11, request='11화를 기획하고 써줘', context='문맥'))

    (_, asked), (_, written) = calls
    assert asked.single is True
    assert (written.episodeNumber, written.context) == (11, '문맥')
    assert written.plan == '편지의 비밀\n1. 서윤이 편지를 발견한다.\n2. 카이가 편지를 숨긴다.'
    assert result.text == '새 원고' and result.plan.title == '편지의 비밀'


def test_plan_and_draft_fit_in_the_content_relay_read_timeout(monkeypatch):
    # 바로 집필은 한 단계 안에서 두 번 부르므로 두 timeout 합이 Content 중계 읽기 한도(3분)보다 짧아야 한다.
    seen = fake_openai(monkeypatch, text=plan_json(('a', ['1'])))
    agent.plan(PlanRequest(episodeNumber=1, request='전개 짜줘'))
    planning = seen['init']['timeout']
    agent.draft(DraftRequest(episodeNumber=1, plan='계획'))
    assert planning + seen['init']['timeout'] < 180


def test_plan_sees_the_previous_plan_alternatives_so_the_author_can_pick_one(monkeypatch):
    seen = fake_openai(monkeypatch, text=plan_json(('추격', ['서윤이 쫓는다.'])))
    agent.plan(PlanRequest(episodeNumber=11, request='두 번째 안으로 써줘', single=True,
                           previousPlans=[BeatPlan(title='편지의 비밀', beats=['편지를 찾는다.']), BeatPlan(title='추격', beats=['서윤이 쫓는다.'])]))
    sent = seen['messages'][-1].content
    assert '편지의 비밀' in sent and '추격' in sent
    assert 'previousPlans' in seen['messages'][0].content  # 지시가 이전 계획의 쓰임을 설명한다
