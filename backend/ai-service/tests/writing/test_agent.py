import json

import pytest
from openai import OpenAIError

from app.writing import agent
from app.writing.errors import WritingFailure
from app.writing.models import (BeatPlan, DraftRequest, DraftResponse, PatchRequest, PlanBrief, PlanPickRequest, PlanRequest, PlanResponse,
                                PlanReviseRequest, Usage)

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


# 기존 계획 수정(#578): 모델 호출 1은 요청이 가리키는 계획 하나를 고르고, 호출 2는 그 계획의 제목·내용만 고친다.
BRIEFS = [PlanBrief(id='plot-1', kind='plot', title='복수극'), PlanBrief(id='scene-1', kind='scene', title='재회', episodeNumber=5, plot='복수극')]


def test_pick_plan_returns_the_listed_id_the_request_points_at_and_sends_no_plan_text(monkeypatch):
    seen = fake_openai(monkeypatch, text=json.dumps({'planId': 'scene-1'}))
    assert agent.pick_plan(PlanPickRequest(request='재회 장면 고쳐줘', plans=BRIEFS)) == 'scene-1'
    sent = seen['messages'][-1].content
    assert seen['response_format']['json_schema']['strict'] is True
    assert '재회 장면 고쳐줘' in sent and 'scene-1' in sent and '복수극' in sent and 'content' not in sent


def test_pick_plan_is_none_when_the_model_cannot_settle_on_one(monkeypatch):
    fake_openai(monkeypatch, text=json.dumps({'planId': None}))
    assert agent.pick_plan(PlanPickRequest(request='그거 고쳐줘', plans=BRIEFS)) is None


def revise(monkeypatch, title='재회', content='카엘이 리나를 만나지만 이름을 부르지 못한다.', original='카엘이 리나를 만난다.'):
    seen = fake_openai(monkeypatch, text=json.dumps({'title': title, 'content': content}, ensure_ascii=False))
    data = PlanReviseRequest(request='더 긴장감 있게', plan=BRIEFS[1], content=original, revision=3)
    return seen, agent.revise_plan(data)


def test_revise_plan_returns_the_before_and_after_with_the_revision_it_was_given(monkeypatch):
    seen, result = revise(monkeypatch)
    sent = seen['messages'][-1].content
    assert seen['response_format']['json_schema']['strict'] is True and '더 긴장감 있게' in sent and '카엘이 리나를 만난다.' in sent and 'revision' not in sent
    assert (result.planId, result.kind, result.revision) == ('scene-1', 'scene', 3)
    assert (result.before.title, result.before.content) == ('재회', '카엘이 리나를 만난다.')
    assert (result.after.title, result.after.content) == ('재회', '카엘이 리나를 만나지만 이름을 부르지 못한다.')
    assert result.model == 'resolved-model' and result.providerResponseId == 'resp-1' and result.usage == Usage(inputTokens=10, outputTokens=5)


@pytest.mark.parametrize('title, content', [
    ('', '새 내용'),                      # 제목이 비었다
    ('가' * 121, '새 내용'),              # 제목 120자 초과
    ('가' * 119 + '😀', '새 내용'),       # Python 120자지만 Content(UTF-16)로 121단위
    ('재회', '가' * 8001),                # 내용 8,000자 초과
    ('재회', '가' * 7999 + '😀'),         # Python 8,000자지만 UTF-16으로 8,001단위
], ids=['empty-title', 'long-title', 'utf16-title', 'long-content', 'utf16-content'])
def test_revise_plan_outside_the_limits_is_failure_not_a_proposal(monkeypatch, title, content):
    with pytest.raises(WritingFailure) as error:
        revise(monkeypatch, title, content)
    assert error.value.status == 502


@pytest.mark.parametrize('title, content', [('가' * 120, '새 내용'), ('재회', '가' * 8000)], ids=['title-at-limit', 'content-at-limit'])
def test_revise_plan_at_the_limits_is_a_proposal(monkeypatch, title, content):
    _, result = revise(monkeypatch, title, content)
    assert (result.after.title, result.after.content) == (title, content)


@pytest.mark.parametrize('title, content', [('재회', '카엘이 리나를 만난다.'), ('재회', ' 카엘이 리나를 만난다. ')], ids=['unchanged', 'whitespace-only'])
def test_revise_plan_without_a_change_is_none_not_a_failure(monkeypatch, title, content):
    assert revise(monkeypatch, title, content)[1] is None


def test_revise_plan_keeps_the_original_content_when_only_the_title_changes(monkeypatch):
    # 모델이 내용 앞뒤 공백을 지워 돌려줘도 저장할 내용은 원문 그대로다.
    _, result = revise(monkeypatch, '새 제목', '카엘이 리나를 만난다.', original=' 카엘이 리나를 만난다.\n')
    assert (result.after.title, result.after.content) == ('새 제목', ' 카엘이 리나를 만난다.\n')
