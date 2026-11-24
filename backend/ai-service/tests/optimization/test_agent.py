"""반성 모델 호출(로컬 OpenCodex 게이트웨이 경로). OpenAI 클라이언트는 대역이다."""

from types import SimpleNamespace

import pytest
from openai import OpenAIError

from app.optimization import agent
from app.optimization.errors import OptimizationFailure
from traced import attrs


class FakeOpenAI:
    """OpenAI 클라이언트 대역: 만들 때 받은 인자와 responses.create 인자를 남긴다."""
    made, sent, reply = [], [], None

    def __init__(self, **options):
        FakeOpenAI.made.append(options)
        self.responses = SimpleNamespace(create=self._create)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def _create(self, **options):
        FakeOpenAI.sent.append(options)
        if isinstance(FakeOpenAI.reply, Exception):
            raise FakeOpenAI.reply
        return FakeOpenAI.reply


def reply(text='새 지시문', status='completed'):
    return SimpleNamespace(output_text=text, status=status, usage=SimpleNamespace(input_tokens=11, output_tokens=7))


@pytest.fixture(autouse=True)
def openai(monkeypatch):
    FakeOpenAI.made, FakeOpenAI.sent, FakeOpenAI.reply = [], [], reply()
    monkeypatch.setattr(agent, 'OpenAI', FakeOpenAI)
    for name in ('PROMPT_OPTIMIZER_BASE_URL', 'PROMPT_OPTIMIZER_API_KEY', 'PROMPT_OPTIMIZER_MODEL', 'OPENAI_API_KEY'):
        monkeypatch.delenv(name, raising=False)


def test_the_gateway_settings_are_used_and_the_prompt_goes_as_a_message_list_without_storing(monkeypatch):
    monkeypatch.setenv('PROMPT_OPTIMIZER_BASE_URL', 'http://host.docker.internal:10100/v1')
    monkeypatch.setenv('PROMPT_OPTIMIZER_API_KEY', 'gateway-key')
    monkeypatch.setenv('PROMPT_OPTIMIZER_MODEL', 'gpt-6.2-sol')

    assert agent.reflect('개선해 줘') == '새 지시문'

    [made] = FakeOpenAI.made
    assert made['base_url'] == 'http://host.docker.internal:10100/v1' and made['api_key'] == 'gateway-key'
    assert made['max_retries'] == 2   # 구독 게이트웨이의 429·일시 오류는 SDK가 두 번까지 다시 시도한다
    assert FakeOpenAI.sent == [{'model': 'gpt-6.2-sol', 'store': False, 'input': [{'role': 'user', 'content': '개선해 줘'}]}]   # 게이트웨이는 메시지 목록·store=False만 받는다


def test_blank_settings_fall_back_to_openai_the_openai_key_and_gpt_6_sol(monkeypatch):
    monkeypatch.setenv('PROMPT_OPTIMIZER_BASE_URL', '  ')
    monkeypatch.setenv('PROMPT_OPTIMIZER_API_KEY', '')
    monkeypatch.setenv('OPENAI_API_KEY', 'openai-key')

    agent.reflect('개선해 줘')

    [made] = FakeOpenAI.made
    assert made['base_url'] is None and made['api_key'] == 'openai-key' and FakeOpenAI.sent[0]['model'] == 'gpt-6-sol'


@pytest.mark.parametrize('url, host', [
    ('http://host.docker.internal:10100/v1', 'localhost:10100'),
    ('http://host.docker.internal/v1', 'localhost'),
    ('http://127.0.0.1:10100/v1', None),
    ('', None),   # 주소가 없으면 기본 OpenAI다
])
def test_only_the_container_to_host_name_sends_a_loopback_host_header(monkeypatch, url, host):
    """로컬 OpenCodex 게이트웨이는 Host가 localhost·127.0.0.1·[::1]이 아니면 403(origin_rejected)이라 컨테이너가 host.docker.internal로 부를 때만 Host를 localhost로 보낸다(#841 첫 실행)."""
    monkeypatch.setenv('PROMPT_OPTIMIZER_BASE_URL', url)
    monkeypatch.setenv('OPENAI_API_KEY', 'openai-key')

    agent.reflect('개선해 줘')

    [made] = FakeOpenAI.made
    assert made['default_headers'] == ({'Host': host} if host else None)


def test_without_any_key_it_fails_before_calling_anything():
    with pytest.raises(OptimizationFailure) as error:
        agent.reflect('개선해 줘')

    assert error.value.status == 503 and FakeOpenAI.made == []


@pytest.mark.parametrize('case', ['provider-error', 'incomplete', 'empty'])
def test_a_provider_failure_or_an_unusable_answer_is_a_fixed_502(monkeypatch, case):
    monkeypatch.setenv('OPENAI_API_KEY', 'openai-key')
    FakeOpenAI.reply = {'provider-error': OpenAIError('키 sk-비밀이 든 원문'), 'incomplete': reply(status='incomplete'), 'empty': reply('  ')}[case]

    with pytest.raises(OptimizationFailure) as error:
        agent.reflect('개선해 줘')

    assert error.value.status == 502 and '비밀' not in str(error.value)


def test_the_call_is_traced_with_model_and_usage_but_without_the_prompt_text(monkeypatch, spans):
    monkeypatch.setenv('OPENAI_API_KEY', 'openai-key')

    agent.reflect('원문 한 줄이 들어 있는 반성 입력')

    [span] = [s for s in spans() if s.name == 'optimization.reflect']
    attributes = attrs(span)
    assert attributes['langfuse.observation.model.name'] == 'gpt-6-sol' and 'langfuse.observation.input' not in attributes   # 본문은 남기지 않는다
    assert '11' in attributes['langfuse.observation.usage_details'] and '7' in attributes['langfuse.observation.usage_details']


def test_a_check_sends_one_short_message_to_the_gateway_and_fails_like_the_real_call(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'openai-key')

    assert agent.check() is None

    [sent] = FakeOpenAI.sent
    assert sent['store'] is False and len(sent['input'][0]['content']) < 100   # 게이트웨이에 닿는지만 보는 짧은 호출(개선이 OpenAI 호출을 쓰기 전에)

    FakeOpenAI.reply = OpenAIError('키 sk-비밀이 든 원문')
    with pytest.raises(OptimizationFailure) as error:
        agent.check()
    assert error.value.status == 502 and '비밀' not in str(error.value)
