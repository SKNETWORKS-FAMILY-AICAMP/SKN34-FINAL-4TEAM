import json
from functools import partial
from types import SimpleNamespace

import httpx
import pytest
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.runnables import RunnableLambda
from langchain_openai import ChatOpenAI

from app import tracing
from app.agent_runtime import MODEL_EVENT
from app.simulation import agent, prompt
from app.simulation.errors import SimulationFailure
from app.simulation.models import Action, CheckItem, Narration, PlanDraft, Verdict

from traced import attrs

ACTION = Action(prose='카엘이 말했다. "멈춰."', observed='카엘이 성문 앞에서 리나를 막아섰다.', refusesBeat=False, refusalReason=None)
NARRATION = Narration(prose='성문 위로 밤비가 내렸다.', observed='밤비가 성문 앞에 내리고 있다.')
PLAN = PlanDraft(mode='flow', premise=None, beats=['성문 대면'], characterIds=['k'])
VERDICT = Verdict(checks=[CheckItem(kind='beat', passed=True, detail='비트를 따랐어요.', refs=[])], beatDone=True, sceneComplete=False)
SECRET_DOC = {'known': [{'ref': 'k#soul', 'text': 'KAEL-SOUL 말이 짧다'}]}

CALLS = {  # 모델 호출 네 가지: (호출, 응답 형식, 모델이 돌려줄 예)
    'plan': (lambda: agent.plan('카엘과 리나가 성문에서 만나면?', ['이전 요청'], [{'id': 'k', 'name': '카엘'}]), PlanDraft, PLAN),
    'act': (lambda: agent.act(SECRET_DOC), Action, ACTION),
    'narrate': (lambda: agent.narrate(SECRET_DOC), Narration, NARRATION),
    'check': (lambda: agent.check(SECRET_DOC), Verdict, VERDICT),
}
LIMITS = {'plan': (1200, 40), 'act': (1500, 60), 'narrate': (1500, 60), 'check': (1500, 60)}  # 호출별 (최대 출력 토큰, timeout 초)
BY_SCHEMA = {schema.__name__: parsed for _, schema, parsed in CALLS.values()}
FIXED_502 = '시뮬레이션 모델 응답을 확인할 수 없습니다.'
FIXED_503 = '시뮬레이션 모델 호출에 실패했습니다.'


def reply(text=None, status='completed', usage=True, output=None, **extra):
    """Responses API 응답 본문. text가 있으면 output_text 하나이고, usage가 참이면 입력 10·출력 4토큰을 담는다."""
    content = [{'type': 'output_text', 'text': text, 'annotations': []}] if text is not None else []
    message = {'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'status': 'completed', 'content': content}
    counts = {'input_tokens': 10, 'output_tokens': 4, 'total_tokens': 14, 'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0}}
    return {'id': 'resp_1', 'object': 'response', 'created_at': 0, 'status': status, 'model': 'resolved-model', 'output': output or ([message] if content else []),
            **({'usage': counts} if usage else {}), **extra}


def completion(text=None, finish='stop', usage=True, refusal=None) -> dict:
    """Chat Completions 응답 본문. text가 assistant 메시지 내용이고, usage가 참이면 입력 10·출력 4토큰을 담는다."""
    message = {'role': 'assistant', 'content': text, **({'refusal': refusal} if refusal else {})}
    return {'id': 'chatcmpl-1', 'object': 'chat.completion', 'created': 0, 'model': 'resolved-model', 'choices': [{'index': 0, 'message': message, 'finish_reason': finish}],
            **({'usage': {'prompt_tokens': 10, 'completion_tokens': 4, 'total_tokens': 14}} if usage else {})}


def ok(parsed, chat=False) -> httpx.Response:
    return httpx.Response(200, json=(completion if chat else reply)(parsed.model_dump_json()))


def provider(monkeypatch, respond=None):
    """ChatOpenAI는 실제 클래스를 쓰고 HTTP만 대역으로 막는다(네트워크 없음). respond(요청 본문) -> httpx.Response, 없으면 요청한 응답 형식의 예를 돌려준다.
    받은 요청마다 호스트·경로·본문·timeout·인증 머리글을 담은 목록을 돌려준다. 요청이 Chat Completions면 그 형식의 응답을 준다."""
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    sent = []

    def handler(request):
        body = json.loads(request.content)
        chat = request.url.path.endswith('/chat/completions')
        sent.append(SimpleNamespace(host=request.url.host, path=request.url.path, body=body, timeout=request.extensions['timeout']['read'], auth=request.headers.get('authorization')))
        return respond(body) if respond else ok(BY_SCHEMA[(body['response_format']['json_schema'] if chat else body['text']['format'])['name']], chat)

    monkeypatch.setattr(agent, 'ChatOpenAI', partial(ChatOpenAI, http_client=httpx.Client(transport=httpx.MockTransport(handler))))
    return sent


def texts(request) -> tuple[str, str]:
    """요청 입력(Responses의 input, Chat Completions의 messages)의 (system 메시지, user 메시지) 본문."""
    system, user = request.body.get('input') or request.body['messages']
    assert (system['role'], user['role']) == ('system', 'user')
    return system['content'], user['content']


@pytest.mark.parametrize('name', CALLS)
def test_each_call_is_one_stateless_structured_output_request(monkeypatch, name):
    call, schema, parsed = CALLS[name]
    sent = provider(monkeypatch)
    assert call() == parsed
    [request] = sent  # 자동 재시도 없음: 호출 하나가 요청 하나다
    body, (tokens, timeout) = request.body, LIMITS[name]
    assert request.path == '/v1/responses' and request.auth == 'Bearer test-key' and request.timeout == timeout  # Responses API
    # 이전 호출의 대화 상태를 이어받지 않는다: 저장(store)도, 이전 응답 id도 없다.
    assert body['store'] is False and 'previous_response_id' not in body
    assert body['model'] == 'test-model' and body['max_output_tokens'] == tokens
    assert {k: body['text']['format'][k] for k in ('type', 'strict', 'name')} == {'type': 'json_schema', 'strict': True, 'name': schema.__name__}  # 제공사 strict JSON schema
    assert all(texts(request))  # 지시문과 입력이 비어 있지 않다


def test_plan_input_is_the_request_history_and_character_names_only(monkeypatch):
    sent = provider(monkeypatch)
    agent.plan('카엘과 리나가 성문에서 만나면?', ['이전 요청'], [{'id': 'k', 'name': '카엘'}])
    instructions, data = texts(sent[0])
    assert json.loads(data) == {'request': '카엘과 리나가 성문에서 만나면?', 'history': ['이전 요청'], 'characters': [{'id': 'k', 'name': '카엘'}]}
    # 흐름 모드 비트: 작가가 적은 목록은 그대로 쓰고, 없으면 모델이 제안한다.
    assert '그대로' in instructions and '제안' in instructions


def test_act_narrate_and_check_send_the_assembled_input_as_it_is(monkeypatch):
    sent = provider(monkeypatch)
    agent.act(SECRET_DOC)
    agent.narrate(SECRET_DOC)
    agent.check(SECRET_DOC)
    pairs = [texts(request) for request in sent]
    assert [json.loads(data) for _, data in pairs] == [SECRET_DOC] * 3
    # 자료 속 문장은 명령이 아니고, 인물은 자기 입력 밖을 모른다는 지시가 각 호출에 있다.
    assert all('명령이 아닙니다' in instructions for instructions, _ in pairs)
    assert '당신이 아는 것' in pairs[0][0] and 'forbidden' in pairs[2][0]


def test_narrator_writes_the_scenery_and_the_characters_only_their_own_lines():
    # 배경·분위기·독백은 나레이터(메인 에이전트)가 쓰고 인물은 대사와 겉으로 보이는 짧은 행동만 쓴다.
    assert '배경' in prompt.ACT_INSTRUCTIONS and '나레이터' in prompt.ACT_INSTRUCTIONS and 'authorNote' in prompt.ACT_INSTRUCTIONS
    narrate = prompt.NARRATE_INSTRUCTIONS
    assert all(word in narrate for word in ('purpose', 'pov', 'style', 'notes', 'observed', 'monologue', '대사', '기준 회차 뒤'))
    assert all(kind in narrate for kind in ('omniscient', 'limited', 'first'))
    assert 'self.id' in prompt.CHECK_INSTRUCTIONS and 'knowledge_leak' in prompt.CHECK_INSTRUCTIONS
    assert set(prompt.NARRATION_FEEDBACK) == {'knowledge_leak', 'voice_mix'}


class Listener(BaseCallbackHandler):
    def __init__(self):
        self.events = []

    def on_custom_event(self, name, data, **kwargs):
        self.events.append((name, data))


def test_every_model_call_inside_a_langchain_run_reports_usage_latency_and_failure_without_any_text(monkeypatch):
    listener = Listener()
    provider(monkeypatch)
    RunnableLambda(lambda _: agent.act(SECRET_DOC)).invoke(None, {'callbacks': [listener]})
    provider(monkeypatch, lambda _: httpx.Response(200, json=reply(status='incomplete', usage=False)))
    with pytest.raises(SimulationFailure):
        RunnableLambda(lambda _: agent.narrate(SECRET_DOC)).invoke(None, {'callbacks': [listener]})
    (name, ok_event), (_, failed) = listener.events
    assert name == MODEL_EVENT
    assert (ok_event['name'], ok_event['failed'], ok_event['inputTokens'], ok_event['outputTokens']) == ('act', False, 10, 4) and ok_event['ms'] >= 0
    assert (failed['name'], failed['failed'], failed['inputTokens']) == ('narrate', True, None)
    assert 'KAEL-SOUL' not in str(listener.events) and '멈춰' not in str(listener.events)  # 본문·키는 없다


@pytest.mark.parametrize('name', CALLS)
def test_missing_model_settings_is_503(monkeypatch, name):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with pytest.raises(SimulationFailure) as error:
        CALLS[name][0]()
    assert error.value.status == 503


def refusal() -> dict:
    return reply(output=[{'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'refusal', 'refusal': 'KAEL-SOUL 거절 문구'}]}])


UNUSABLE = {  # 응답을 받았지만 쓸 수 없는 경우
    'incomplete-without-output': reply(status='incomplete', incomplete_details={'reason': 'max_output_tokens'}),
    'truncated-by-the-token-limit': reply('{"prose": "카엘이 말', status='incomplete', incomplete_details={'reason': 'max_output_tokens'}),
    'incomplete-even-if-the-json-parses': reply(ACTION.model_dump_json(), status='incomplete', incomplete_details={'reason': 'max_output_tokens'}),
    'not-json': reply('JSON이 아니다'),
    'provider-reports-an-error': reply(status='failed', error={'code': 'server_error', 'message': 'KAEL-SOUL 제공사 메시지'}),
    'refusal': refusal(),
}


@pytest.mark.parametrize('body', UNUSABLE.values(), ids=UNUSABLE)
def test_an_incomplete_unparseable_or_refused_model_response_is_502_with_the_fixed_message(monkeypatch, body):
    provider(monkeypatch, lambda _: httpx.Response(200, json=body))
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert (error.value.status, str(error.value)) == (502, FIXED_502) and 'KAEL' not in str(error.value)


@pytest.mark.parametrize('status', [500, 429, 401, 400])
def test_provider_failure_is_503_and_keeps_the_provider_text_out_of_the_message(monkeypatch, status):
    sent = provider(monkeypatch, lambda _: httpx.Response(status, json={'error': {'message': 'KAEL-SOUL 본문이 담긴 제공사 메시지', 'type': 'x'}}))
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert (error.value.status, str(error.value)) == (503, FIXED_503) and 'KAEL' not in str(error.value)
    assert len(sent) == 1  # 429·500도 자동으로 다시 보내지 않는다


def test_generation_trace_has_model_usage_and_failure_but_no_character_documents(monkeypatch, spans):
    provider(monkeypatch)
    agent.act(SECRET_DOC)
    provider(monkeypatch, lambda _: httpx.Response(200, json=reply(status='incomplete', usage=False)))
    with pytest.raises(SimulationFailure):
        agent.act(SECRET_DOC)
    ok_span, failed = spans()
    assert ok_span.name == 'simulation.act' and ok_span.attributes['langfuse.observation.type'] == 'generation'
    assert ok_span.attributes['langfuse.observation.model.name'] == 'resolved-model'
    assert ok_span.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 4}'
    assert failed.attributes['langfuse.observation.level'] == 'ERROR'
    # 설정 본문·생성 문단은 팀 결정 범위(질문·원고·답변) 밖이라 추적에 남기지 않는다.
    assert all('KAEL-SOUL' not in str(dict(s.attributes)) and '멈춰' not in str(dict(s.attributes)) for s in (ok_span, failed))


DEFAULTS = {'plan': prompt.PLAN_INSTRUCTIONS, 'act': prompt.ACT_INSTRUCTIONS, 'narrate': prompt.NARRATE_INSTRUCTIONS,
            'check': prompt.CHECK_INSTRUCTIONS}


@pytest.mark.parametrize('name', CALLS)
def test_each_call_uses_its_managed_prompt_and_the_generation_links_that_version(monkeypatch, spans, name):
    call, _, parsed = CALLS[name]
    asked = []
    sent = provider(monkeypatch)
    version = SimpleNamespace(name=f'character_simulation.{name}', version=2, is_fallback=False)
    monkeypatch.setattr(tracing, 'prompt', lambda n, default: asked.append((n, default)) or tracing.Prompt('관리된 지시', version))

    call()

    assert asked == [(f'character_simulation.{name}', DEFAULTS[name])] and texts(sent[0])[0] == '관리된 지시'
    [span] = spans()
    found = attrs(span)
    assert span.name == f'simulation.{name}'
    assert (found['langfuse.observation.prompt.name'], found['langfuse.observation.prompt.version']) == (f'character_simulation.{name}', 2)


@pytest.mark.parametrize('name', CALLS)
def test_an_unavailable_prompt_is_a_503_before_the_model_call(monkeypatch, name):
    sent = provider(monkeypatch)

    def unavailable(n, default):
        raise tracing.PromptUnavailable

    monkeypatch.setattr(tracing, 'prompt', unavailable)
    with pytest.raises(SimulationFailure) as error:
        CALLS[name][0]()
    assert (error.value.status, str(error.value)) == (503, '시뮬레이션 프롬프트를 불러올 수 없습니다.') and sent == []


# --- 추론 강도 스위치(#642) -------------------------------------------------------------------------------------------------

EFFORTS = ('none', 'minimal', 'low', 'medium', 'high')


@pytest.mark.parametrize('name', CALLS)
@pytest.mark.parametrize('value', [None, '', '  '])
def test_without_the_effort_switch_every_call_sends_low_effort(monkeypatch, name, value):
    sent = provider(monkeypatch)
    if value is not None:
        monkeypatch.setenv('SIMULATION_REASONING_EFFORT', value)
    CALLS[name][0]()
    assert len(sent) == 1 and sent[0].body['reasoning'] == {'effort': 'low'}  # 시뮬레이션 v2 기본값(빈 값 포함)


@pytest.mark.parametrize('name', CALLS)
@pytest.mark.parametrize('effort', EFFORTS)
def test_the_effort_switch_is_sent_as_reasoning_effort_on_every_call(monkeypatch, name, effort):
    sent = provider(monkeypatch)
    monkeypatch.setenv('SIMULATION_REASONING_EFFORT', effort)
    CALLS[name][0]()
    assert sent[0].body['reasoning'] == {'effort': effort}


@pytest.mark.parametrize('name', CALLS)
@pytest.mark.parametrize('effort', ['LOW', 'turbo', 'xhigh'])
def test_an_effort_outside_the_five_openai_values_is_a_503_before_any_model_call(monkeypatch, name, effort):
    built = []
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    monkeypatch.setenv('SIMULATION_REASONING_EFFORT', effort)
    monkeypatch.setattr(agent, 'ChatOpenAI', lambda **_: built.append(1))
    with pytest.raises(SimulationFailure) as error:
        CALLS[name][0]()
    assert (error.value.status, str(error.value)) == (503, '시뮬레이션 추론 강도 설정을 확인해 주세요.') and built == []


# --- act 전용 제공사(SIMULATION_ACT_*): OpenAI 호환 제공사(Hemmingway·OpenRouter)는 Chat Completions로 간다 ------------------------------------------

ACT_ENV = {'SIMULATION_ACT_BASE_URL': 'https://hemmingway.io/v1', 'SIMULATION_ACT_API_KEY': 'hem-key', 'SIMULATION_ACT_MODEL': 'hemmingway-27b'}


def act_provider(monkeypatch, respond=None, **env):
    """provider에 act 전용 제공사 설정을 더한다. env로 값을 바꾸고 None이면 그 변수를 지운다."""
    sent = provider(monkeypatch, respond)
    for name, value in {**ACT_ENV, **env}.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    return sent


def test_with_an_act_base_url_only_act_goes_to_that_provider_as_chat_completions(monkeypatch):
    sent = act_provider(monkeypatch)
    assert agent.act(SECRET_DOC) == ACTION
    [request] = sent
    body, (tokens, timeout) = request.body, LIMITS['act']
    assert (request.host, request.path, request.auth, request.timeout) == ('hemmingway.io', '/v1/chat/completions', 'Bearer hem-key', timeout)  # OpenAI 키가 아니라 act 전용 키다
    assert body['model'] == 'hemmingway-27b' and body['max_completion_tokens'] == tokens
    assert body['reasoning_effort'] == 'low' and 'store' not in body and 'reasoning' not in body  # 추론 강도는 reasoning_effort로 보내고 store는 보내지 않는다
    assert body['response_format']['type'] == 'json_schema' and body['response_format']['json_schema']['strict'] is True and body['response_format']['json_schema']['name'] == 'Action'
    assert all(texts(request))  # system·user 메시지


@pytest.mark.parametrize('name', ['plan', 'narrate', 'check'])
def test_the_other_calls_stay_on_openai_when_the_act_provider_is_set(monkeypatch, name):
    sent = act_provider(monkeypatch)
    CALLS[name][0]()
    [request] = sent
    assert (request.host, request.path, request.auth) == ('api.openai.com', '/v1/responses', 'Bearer test-key')
    assert request.body['model'] == 'test-model' and request.body['store'] is False and request.body['reasoning'] == {'effort': 'low'}


@pytest.mark.parametrize('effort', EFFORTS)
def test_the_effort_switch_is_sent_as_reasoning_effort_to_the_act_provider(monkeypatch, effort):
    sent = act_provider(monkeypatch)
    monkeypatch.setenv('SIMULATION_REASONING_EFFORT', effort)
    agent.act(SECRET_DOC)
    assert sent[0].body['reasoning_effort'] == effort


@pytest.mark.parametrize('key', [None, '', '  '])
def test_an_act_base_url_needs_its_own_key_and_never_borrows_the_openai_key(monkeypatch, key):
    sent = act_provider(monkeypatch, SIMULATION_ACT_API_KEY=key)
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert (error.value.status, str(error.value)) == (503, '시뮬레이션 모델 설정이 필요합니다.') and sent == []  # OPENAI_API_KEY는 어디로도 나가지 않는다
    agent.narrate(SECRET_DOC)  # 다른 호출은 OpenAI 설정 그대로 돈다
    assert [request.host for request in sent] == ['api.openai.com']


def test_the_act_provider_model_falls_back_to_the_openai_model(monkeypatch):
    sent = act_provider(monkeypatch, SIMULATION_ACT_MODEL=None)
    agent.act(SECRET_DOC)
    assert sent[0].host == 'hemmingway.io' and sent[0].body['model'] == 'test-model'


def test_an_act_model_alone_swaps_only_the_act_model_on_the_openai_path(monkeypatch):
    sent = act_provider(monkeypatch, SIMULATION_ACT_BASE_URL=None, SIMULATION_ACT_API_KEY=None, SIMULATION_ACT_MODEL='gpt-6.1-terra')
    agent.act(SECRET_DOC)
    agent.narrate(SECRET_DOC)
    assert [(r.host, r.path, r.auth, r.body['model']) for r in sent] == [('api.openai.com', '/v1/responses', 'Bearer test-key', 'gpt-6.1-terra'),
                                                                         ('api.openai.com', '/v1/responses', 'Bearer test-key', 'test-model')]


@pytest.mark.parametrize('value', ['', '  '])
def test_blank_act_settings_mean_the_default_openai_path(monkeypatch, value):
    sent = act_provider(monkeypatch, **dict.fromkeys(ACT_ENV, value))
    agent.act(SECRET_DOC)
    assert (sent[0].host, sent[0].path, sent[0].auth, sent[0].body['model']) == ('api.openai.com', '/v1/responses', 'Bearer test-key', 'test-model')


CHAT_UNUSABLE = {  # act 제공사가 응답했지만 쓸 수 없는 경우
    'length-even-if-the-json-parses': completion(ACTION.model_dump_json(), finish='length'),
    'content-filter': completion(finish='content_filter'),
    'not-json': completion('JSON이 아니다'),
    'json-in-a-code-fence': completion('```json\n' + ACTION.model_dump_json() + '\n```'),  # 고쳐 읽지 않는다
    'empty-content': completion(''),
}


@pytest.mark.parametrize('body', CHAT_UNUSABLE.values(), ids=CHAT_UNUSABLE)
def test_a_truncated_filtered_unparseable_or_refused_act_provider_response_is_502_with_the_fixed_message(monkeypatch, body):
    act_provider(monkeypatch, lambda _: httpx.Response(200, json=body))
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert (error.value.status, str(error.value)) == (502, FIXED_502) and 'KAEL' not in str(error.value)


@pytest.mark.parametrize('status', [500, 429, 401, 404])
def test_an_act_provider_failure_is_503_without_retry_and_without_the_provider_text(monkeypatch, status):
    sent = act_provider(monkeypatch, lambda _: httpx.Response(status, json={'error': {'message': 'KAEL-SOUL 본문이 담긴 제공사 메시지', 'type': 'x'}}))
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert (error.value.status, str(error.value)) == (503, FIXED_503) and 'KAEL' not in str(error.value)
    assert [request.host for request in sent] == ['hemmingway.io']  # 한 번만 보내고 다시 보내지 않는다


def test_an_act_provider_call_reports_usage_latency_and_the_resolved_model_like_any_other(monkeypatch, spans):
    listener = Listener()
    act_provider(monkeypatch)
    RunnableLambda(lambda _: agent.act(SECRET_DOC)).invoke(None, {'callbacks': [listener]})
    act_provider(monkeypatch, lambda _: httpx.Response(200, json=completion(finish='length')))
    with pytest.raises(SimulationFailure):
        RunnableLambda(lambda _: agent.act(SECRET_DOC)).invoke(None, {'callbacks': [listener]})
    (name, ok_event), (_, failed) = listener.events
    assert name == MODEL_EVENT and (ok_event['name'], ok_event['failed'], ok_event['inputTokens'], ok_event['outputTokens']) == ('act', False, 10, 4)
    assert (failed['name'], failed['failed'], failed['inputTokens']) == ('act', True, None)
    ok_span, failed_span = spans()
    assert ok_span.attributes['langfuse.observation.model.name'] == 'resolved-model'
    assert ok_span.attributes['langfuse.observation.usage_details'] == '{"input": 10, "output": 4}'
    assert failed_span.attributes['langfuse.observation.level'] == 'ERROR'


@pytest.mark.parametrize('effort', ['LOW', 'xhigh'])
def test_an_effort_outside_the_five_openai_values_is_a_503_before_the_call_to_the_act_provider_too(monkeypatch, effort):
    sent = act_provider(monkeypatch)
    monkeypatch.setenv('SIMULATION_REASONING_EFFORT', effort)
    with pytest.raises(SimulationFailure) as error:
        agent.act(SECRET_DOC)
    assert (error.value.status, str(error.value)) == (503, '시뮬레이션 추론 강도 설정을 확인해 주세요.') and sent == []
