import asyncio
import gzip
import json

import httpx2
import pytest
from langchain_core.runnables import RunnableLambda
from langchain_typesafe import Choice
from langchain_typesafe.client import (TypeSafeAPIResponseValidationError, TypeSafeBadRequestError, TypeSafeNotFoundError)

from app.simulation import director
from app.simulation.callbacks import UsageCallback
from app.simulation.errors import SimulationFailure
from app.simulation.models import Decision

KAEL, LINA = 'card-kael-0001', 'card-lina-0002'
CAST = [{'id': KAEL, 'name': '카엘'}, {'id': LINA, 'name': '리나'}]
STATE = {'mode': 'if', 'scene': [{'by': '나레이션', 'text': '밤비가 내린다.'}]}
ASKED = {'turn': Choice(instructions='이번 턴에 무엇을 쓸까요?', criteria={'speech': '대사', 'narration': '지문'})}


def reply(**choices):
    """OpenAI Decisions 응답 대역: {질문: 선택값}. None이면 거부(refusal)다."""
    return {'answers': [{'type': 'refusal', 'name': n} if c is None else {'type': 'choice', 'name': n, 'choice': c}
                        for n, c in choices.items()]}


def wired(monkeypatch, body, status=200, gzipped=False):
    """분류기를 목 HTTP 전송에 연결한다. 보낸 요청 [(URL, 헤더, 본문)] 목록을 돌려준다.

    gzipped면 실제 OpenAI 응답처럼 gzip으로 압축한 본문과 그에 맞는 Content-Encoding·Content-Length 헤더로 답한다.
    """
    sent = []

    def handler(request):
        sent.append((str(request.url), dict(request.headers), json.loads(request.content)))
        data = body(sent[-1][2]) if callable(body) else body
        if gzipped:
            packed = gzip.compress(json.dumps(data).encode())
            return httpx2.Response(status, content=packed, headers={'content-type': 'application/json', 'content-encoding': 'gzip',
                                                                    'content-length': str(len(packed)), 'x-request-id': 'req_abc'})
        return httpx2.Response(status, json=data)

    classifier = director.OpenAIDecisionClassifier(
        api_key='sk-test-secret', instructions='연출 지시', async_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    monkeypatch.setattr(director, 'classifier', lambda: classifier)
    return sent


def classify(request=None, **kwargs):
    return asyncio.run(director.classifier().ainvoke(request or {'state': STATE, 'questions': ASKED}))


# --- OpenAI Decisions 연결 -------------------------------------------------------------------------------------------

def test_classifier_posts_the_questions_to_openai_decisions_in_its_own_format(monkeypatch):
    sent = wired(monkeypatch, reply(turn='speech'))
    classify()
    (url, headers, body), = sent
    assert url == 'https://api.openai.com/v1/decisions'  # 패키지 기본 경로(/v1/systemone)가 아니다
    assert headers['authorization'] == 'Bearer sk-test-secret'
    assert body == {
        'model': 'gpt-6-luna',
        'questions': [{'type': 'choice', 'name': 'turn', 'instructions': '이번 턴에 무엇을 쓸까요?',
                       'choices': [{'value': 'speech', 'description': '대사'}, {'value': 'narration', 'description': '지문'}]}],
        'input': [{'role': 'developer', 'content': '연출 지시'},
                  {'role': 'user', 'content': [{'type': 'input_json', 'data': {'state': STATE}}]}]}


def test_answers_become_the_packages_choice_answers(monkeypatch):
    wired(monkeypatch, reply(turn='speech'))
    answer = classify().choices['turn']
    assert (answer.choice, answer.probabilities, answer.confidence) == ('speech', {'speech': 1.0, 'narration': 0.0}, 1.0)


def test_a_gzip_compressed_reply_is_not_decoded_a_second_time_when_it_is_rewrapped(monkeypatch):
    """OpenAI는 응답을 gzip으로 보낸다. 클라이언트가 이미 푼 본문으로 새 응답을 만들 때 원 응답의 압축·길이 헤더를 옮기면
    새 응답이 풀린 JSON을 다시 풀려다 DecodingError(incorrect header check)가 난다."""
    wired(monkeypatch, reply(turn='speech'), gzipped=True)
    assert classify().choices['turn'].choice == 'speech'


def test_the_usage_of_the_original_reply_is_carried_into_the_answer(monkeypatch):
    wired(monkeypatch, {**reply(turn='speech'), 'usage': {'input_tokens': 120, 'output_tokens': 7, 'total_tokens': 127}})
    usage = classify().usage
    assert (usage.input_tokens, usage.output_tokens) == (120, 7)
    wired(monkeypatch, reply(turn='speech'))
    assert classify().usage.input_tokens is None  # 응답에 없으면 지어내지 않는다


@pytest.mark.parametrize('body', [
    reply(turn=None),                                                  # 거부
    reply(turn='jump'),                                                # 보낸 선택지 밖
    reply(other='speech'),                                             # 질문과 다른 이름
    {'answers': []},                                                   # 답 누락
    {'answers': reply(turn='speech')['answers'] * 2},                  # 같은 질문에 두 답
    {'unexpected': True},
])
def test_reply_that_does_not_fit_the_questions_is_an_error_not_an_answer(monkeypatch, body):
    wired(monkeypatch, body)
    with pytest.raises(TypeSafeAPIResponseValidationError):
        classify()


@pytest.mark.parametrize('status, error', [(400, TypeSafeBadRequestError), (404, TypeSafeNotFoundError)])
def test_http_failures_keep_the_packages_errors_and_never_show_the_key(monkeypatch, status, error):
    wired(monkeypatch, {'error': 'x'}, status=status)
    with pytest.raises(error) as failure:
        classify()
    assert 'sk-test-secret' not in str(failure.value) and '연출 지시' not in repr(failure.value)


def test_the_blocking_call_is_not_supported(monkeypatch):
    wired(monkeypatch, reply(turn='speech'))
    with pytest.raises(NotImplementedError):
        director.classifier().invoke({'state': STATE, 'questions': ASKED})


def test_key_comes_from_openai_api_key_and_a_missing_key_is_refused(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-from-env')
    assert director.OpenAIDecisionClassifier().api_key.get_secret_value() == 'sk-from-env'
    monkeypatch.delenv('OPENAI_API_KEY')
    monkeypatch.setenv('TYPESAFE_API_KEY', 'typesafe-key')
    with pytest.raises(ValueError):
        director.OpenAIDecisionClassifier()  # TypeSafe 키를 OpenAI로 보내지 않는다


# --- 연출 결정 ----------------------------------------------------------------------------------------------------------

def decide(monkeypatch, answers, allowed=('narration', 'monologue', 'speech'), last_pov=None, state=STATE):
    sent = wired(monkeypatch, reply(**answers) if isinstance(answers, dict) else answers)
    result = asyncio.run(director.decide(state, allowed, CAST, last_pov))
    return result, sent[0][2]


def test_decision_maps_the_answers_back_to_character_ids(monkeypatch):
    result, _ = decide(monkeypatch, {'turn': 'speech', 'speaker': 'c2', 'pov': 'limited:c1'})
    assert result == Decision(turn='speech', speaker=LINA, pov=f'limited:{KAEL}')
    result, _ = decide(monkeypatch, {'turn': 'narration', 'speaker': 'c1', 'pov': 'omniscient'})
    assert result == Decision(turn='narration', speaker=None, pov='omniscient')   # 대사가 아니면 화자는 쓰지 않는다
    result, _ = decide(monkeypatch, {'turn': 'monologue', 'speaker': 'c2', 'pov': 'first:c2'})
    assert result == Decision(turn='monologue', speaker=None, pov=f'first:{LINA}')


def test_questions_use_aliases_and_the_allowed_turns_only_so_no_character_id_leaves(monkeypatch):
    _, body = decide(monkeypatch, {'turn': 'speech', 'speaker': 'c1', 'pov': 'omniscient'}, allowed=('narration', 'speech'),
                     last_pov=f'limited:{KAEL}')
    questions = {q['name']: q for q in body['questions']}
    assert list(questions) == ['turn', 'speaker', 'pov']
    assert [c['value'] for c in questions['turn']['choices']] == ['narration', 'speech']
    assert [(c['value'], c['description']) for c in questions['speaker']['choices']] == [('c1', '카엘'), ('c2', '리나')]
    assert [c['value'] for c in questions['pov']['choices']] == ['omniscient', 'limited:c1', 'limited:c2', 'first:c1', 'first:c2']
    sent_state = body['input'][1]['content'][0]['data']['state']
    assert sent_state['cast'] == [{'alias': 'c1', 'name': '카엘'}, {'alias': 'c2', 'name': '리나'}] and sent_state['lastPov'] == 'limited:c1'
    assert sent_state['scene'] == STATE['scene']
    assert KAEL not in json.dumps(body) and LINA not in json.dumps(body)


def test_a_turn_that_is_already_fixed_is_not_asked_but_told(monkeypatch):
    result, body = decide(monkeypatch, {'speaker': 'c1', 'pov': 'omniscient'}, allowed=('end',))
    assert result.turn == 'end' and [q['name'] for q in body['questions']] == ['speaker', 'pov']
    assert body['input'][1]['content'][0]['data']['state']['turn'] == 'end'


@pytest.mark.parametrize('answers', [
    {'turn': 'monologue', 'speaker': 'c1', 'pov': 'omniscient'},        # 독백은 시점 인물이 있어야 한다
    {'turn': 'speech', 'speaker': 'c9', 'pov': 'omniscient'},           # 인물 목록 밖
    {'turn': 'speech', 'speaker': 'c1', 'pov': 'limited:c9'},
    {'turn': 'end', 'speaker': 'c1', 'pov': 'omniscient'},              # 허용하지 않은 턴
])
def test_decision_that_breaks_the_rules_is_an_error_not_a_fix(monkeypatch, answers):
    wired(monkeypatch, reply(**answers))
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(director.decide(STATE, ('narration', 'monologue', 'speech'), CAST))
    assert failure.value.status == 502 and 'c9' not in str(failure.value)


@pytest.mark.parametrize('status, expected', [(400, 503), (404, 503), (500, 503)])
def test_model_failure_is_a_fixed_message_without_the_input_or_the_key(monkeypatch, status, expected):
    wired(monkeypatch, {'error': 'x'}, status=status)
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(director.decide(STATE, ('speech',), CAST))
    assert failure.value.status == expected and failure.value.args == ('연출 결정 모델 호출에 실패했습니다.',)


def test_unusable_reply_is_a_502_and_missing_settings_a_503(monkeypatch):
    wired(monkeypatch, {'answers': []})
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(director.decide(STATE, ('speech',), CAST))
    assert failure.value.status == 502
    monkeypatch.undo()
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    director.classifier.cache_clear()
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(director.decide(STATE, ('speech',), CAST))
    assert failure.value.status == 503


# --- 사용량 장부 -------------------------------------------------------------------------------------------------------

def in_a_run(ledger, allowed=('narration', 'speech')):
    """LangChain 실행 안에서 연출 결정을 한 번 부르고 콜백(장부)에 쌓인 호출을 돌려준다. 실패는 그대로 올린다."""
    async def run(_):
        return await director.decide(STATE, allowed, CAST)
    asyncio.run(RunnableLambda(run).ainvoke(None, {'callbacks': [ledger]}))
    return ledger.calls


def test_each_decisions_call_reaches_the_usage_ledger_with_its_tokens(monkeypatch):
    wired(monkeypatch, {**reply(turn='speech', speaker='c1', pov='omniscient'), 'usage': {'input_tokens': 120, 'output_tokens': 7}})
    (call,) = in_a_run(UsageCallback())
    assert (call['name'], call['failed'], call['inputTokens'], call['outputTokens']) == ('director', False, 120, 7) and call['ms'] >= 0


def test_a_failed_decisions_call_is_in_the_ledger_as_a_failure_without_tokens(monkeypatch):
    wired(monkeypatch, {'error': 'x'}, status=500)
    ledger = UsageCallback()
    with pytest.raises(SimulationFailure):
        in_a_run(ledger)
    assert [(c['name'], c['failed'], c['inputTokens'], c['outputTokens']) for c in ledger.calls] == [('director', True, None, None)]


# --- 독백의 시점 -------------------------------------------------------------------------------------------------------

INNER_POVS = ['limited:c1', 'limited:c2', 'first:c1', 'first:c2']  # 시점 인물이 있는 선택지


def test_when_only_a_monologue_is_allowed_the_point_of_view_choices_have_a_character(monkeypatch):
    result, body = decide(monkeypatch, {'speaker': 'c1', 'pov': 'first:c2'}, allowed=('monologue',))
    questions = {q['name']: q for q in body['questions']}
    assert [c['value'] for c in questions['pov']['choices']] == INNER_POVS
    assert result == Decision(turn='monologue', speaker=None, pov=f'first:{LINA}')


def reasked(first, second):
    """질문이 셋이면 첫 질문의 답을, 시점 하나만 물으면 두 번째 답을 준다. 보낸 요청 [(질문 이름들, 시점 선택지, 상태)]도 돌려준다."""
    asked = []

    def body(sent):
        asked.append(([q['name'] for q in sent['questions']], [c['value'] for q in sent['questions'] if q['name'] == 'pov' for c in q['choices']],
                      sent['input'][1]['content'][0]['data']['state']))
        return reply(**(first if len(sent['questions']) == 3 else second))

    return body, asked


def test_a_monologue_answered_with_the_omniscient_view_asks_the_point_of_view_again_without_it(monkeypatch):
    body, asked = reasked({'turn': 'monologue', 'speaker': 'c1', 'pov': 'omniscient'}, {'pov': 'first:c2'})
    wired(monkeypatch, body)
    result = asyncio.run(director.decide(STATE, ('narration', 'monologue', 'speech'), CAST))
    assert result == Decision(turn='monologue', speaker=None, pov=f'first:{LINA}')
    assert [names for names, _, _ in asked] == [['turn', 'speaker', 'pov'], ['pov']]  # 한 번 더, 시점만 묻는다
    assert asked[0][1][0] == 'omniscient' and asked[1][1] == INNER_POVS
    assert asked[1][2]['turn'] == 'monologue' and asked[1][2]['scene'] == STATE['scene']  # 독백인 줄 알려 준다


def test_a_second_omniscient_answer_for_a_monologue_is_still_an_error(monkeypatch):
    body, asked = reasked({'turn': 'monologue', 'speaker': 'c1', 'pov': 'omniscient'}, {'pov': 'omniscient'})
    wired(monkeypatch, body)
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(director.decide(STATE, ('narration', 'monologue', 'speech'), CAST))
    assert failure.value.status == 502 and len(asked) == 2  # 세 번째 시도는 없다
