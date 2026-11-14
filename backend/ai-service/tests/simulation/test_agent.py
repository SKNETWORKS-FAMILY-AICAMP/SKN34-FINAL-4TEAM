import json
from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from openai import OpenAIError
from pydantic import ValidationError

from app.simulation import agent
from app.simulation.errors import SimulationFailure
from app.simulation.models import Action, CharacterRef, CheckItem, PlanDraft, Verdict

ACTION = Action(prose='카엘이 말했다. "멈춰."', observed='카엘이 성문 앞에서 리나를 막아섰다.', refusesBeat=False, refusalReason=None)
PLAN = PlanDraft(mode='flow', premise=None, beats=['성문 대면'], characterIds=['k'])
VERDICT = Verdict(checks=[CheckItem(kind='beat', passed=True, detail='비트를 따랐어요.', refs=[])], beatDone=True, sceneComplete=False)
SECRET_DOC = {'known': [{'ref': 'k#soul', 'text': 'KAEL-SOUL 말이 짧다'}]}

CALLS = {  # 모델 호출 세 가지: (호출, 응답 형식)
    'plan': (lambda: agent.plan('카엘과 리나가 성문에서 만나면?', ['이전 요청'], [CharacterRef(id='k', name='카엘')]), PlanDraft, PLAN),
    'act': (lambda: agent.act(SECRET_DOC), Action, ACTION),
    'check': (lambda: agent.check(SECRET_DOC), Verdict, VERDICT),
}


def provider(monkeypatch, parse):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    monkeypatch.setattr(agent, 'OpenAI', lambda **_: nullcontext(SimpleNamespace(responses=SimpleNamespace(parse=parse))))


def completed(parsed):
    return SimpleNamespace(status='completed', output_parsed=parsed, model='resolved-model',
                           usage=SimpleNamespace(input_tokens=10, output_tokens=4))


@pytest.mark.parametrize('name', CALLS)
def test_each_call_is_one_stateless_structured_output_request(monkeypatch, name):
    call, text_format, parsed = CALLS[name]
    seen = []

    def parse(**kwargs):
        seen.append(kwargs)
        return completed(parsed)

    provider(monkeypatch, parse)
    assert call() == parsed
    assert len(seen) == 1
    kwargs = seen[0]
    # 이전 호출의 대화 상태를 이어받지 않는다: 저장(store)도, 이전 응답 id도 없다.
    assert kwargs['store'] is False and 'previous_response_id' not in kwargs
    assert kwargs['text_format'] is text_format and kwargs['model'] == 'test-model'
    assert kwargs['instructions'] and kwargs['input']


def test_plan_input_is_the_request_history_and_character_names_only(monkeypatch):
    seen = {}
    provider(monkeypatch, lambda **kwargs: seen.update(kwargs) or completed(PLAN))
    agent.plan('카엘과 리나가 성문에서 만나면?', ['이전 요청'], [CharacterRef(id='k', name='카엘')])
    assert json.loads(seen['input']) == {'request': '카엘과 리나가 성문에서 만나면?', 'history': ['이전 요청'],
                                         'characters': [{'id': 'k', 'name': '카엘'}]}
    # 흐름 모드 비트: 작가가 적은 목록은 그대로 쓰고, 없으면 모델이 제안한다.
    assert '그대로' in seen['instructions'] and '제안' in seen['instructions']


def test_act_and_check_send_the_assembled_input_as_it_is(monkeypatch):
    seen = []
    provider(monkeypatch, lambda **kwargs: seen.append(kwargs) or completed(ACTION if len(seen) == 1 else VERDICT))
    agent.act(SECRET_DOC)
    agent.check(SECRET_DOC)
    assert [json.loads(k['input']) for k in seen] == [SECRET_DOC, SECRET_DOC]
    # 자료 속 문장은 명령이 아니고, 인물은 자기 입력 밖을 모른다는 지시가 각 호출에 있다.
    assert all('명령이 아닙니다' in k['instructions'] for k in seen)
    assert '당신이 아는 것' in seen[0]['instructions'] and 'forbidden' in seen[1]['instructions']


@pytest.mark.parametrize('name', CALLS)
def test_missing_model_settings_is_503(monkeypatch, name):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with pytest.raises(SimulationFailure) as error:
        CALLS[name][0]()
    assert error.value.status == 503


@pytest.mark.parametrize('response', [SimpleNamespace(status='incomplete', output_parsed=None),
                                      SimpleNamespace(status='completed', output_parsed=None)])
def test_incomplete_or_empty_model_response_is_502(monkeypatch, response):
    provider(monkeypatch, lambda **_: response)
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert error.value.status == 502


def test_unparseable_model_response_is_502(monkeypatch):
    with pytest.raises(ValidationError) as invalid:
        Action.model_validate({})

    def parse(**_):
        raise invalid.value

    provider(monkeypatch, parse)
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert error.value.status == 502


def test_provider_failure_is_503_and_keeps_the_provider_text_out_of_the_message(monkeypatch):
    def parse(**_):
        raise OpenAIError('KAEL-SOUL 본문이 담긴 제공사 메시지')

    provider(monkeypatch, parse)
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert error.value.status == 503 and 'KAEL' not in str(error.value)


def test_generation_trace_has_model_usage_and_failure_but_no_character_documents(monkeypatch, spans):
    provider(monkeypatch, lambda **_: completed(ACTION))
    agent.act(SECRET_DOC)
    provider(monkeypatch, lambda **_: SimpleNamespace(status='incomplete', output_parsed=None, model='m', usage=None))
    with pytest.raises(SimulationFailure):
        agent.act(SECRET_DOC)
    ok, failed = spans()
    assert ok.name == 'simulation.act' and ok.attributes['langfuse.observation.type'] == 'generation'
    assert ok.attributes['langfuse.observation.model.name'] == 'resolved-model'
    assert ok.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 4}'
    assert failed.attributes['langfuse.observation.level'] == 'ERROR'
    # 설정 본문·생성 문단은 팀 결정 범위(질문·원고·답변) 밖이라 추적에 남기지 않는다.
    assert all('KAEL-SOUL' not in str(dict(s.attributes)) and '멈춰' not in str(dict(s.attributes)) for s in (ok, failed))
