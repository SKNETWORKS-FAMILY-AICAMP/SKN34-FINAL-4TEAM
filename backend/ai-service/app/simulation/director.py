"""연출 결정(Director): 인물이 말하기 전에 장면의 다음 턴을 정한다(#362).

이번 턴을 나레이션·독백·인물 대사·마무리 중 무엇으로 쓸지, 누가 말할지, 어느 시점(전지적·3인칭 제한·1인칭)으로 쓸지를
선택지 질문(Choice)으로 묻는다. `langchain_typesafe.TypeSafeClassifier`를 OpenAI Decisions(`POST /v1/decisions`, gpt-6-luna)에
연결한 최소 서브클래스가 묻는다. 패키지 기본 경로(`/v1/systemone`)는 OpenAI에서 404이고 경로만 바꾸면 요청 형식이 달라 400이라,
경로·요청 변환·응답 변환만 덮어쓴다. 요청·응답 형식의 정본은 app/intent/agent.py(OpenAI Decisions)와 app/intent/models.py다.
모델이 준 값은 Python이 다시 검증하고 어긋나면 고치지 않고 실패로 올린다. 인물 id는 모델에 보내지 않고 별칭(c1…)으로만 주고받는다.
"""

from collections.abc import Sequence
from functools import lru_cache

import httpx2
from langchain_core.utils import secret_from_env
from langchain_typesafe import Choice, TypeSafeClassifier
from langchain_typesafe.client import (TypeSafeAPIConnectionError, TypeSafeAPIResponseValidationError, TypeSafeAPITimeoutError,
                                       TypeSafeError, parse_response)
from langchain_typesafe.types import ClassifierRequest, ClassifierResponse
from pydantic import Field, JsonValue, SecretStr

from app.intent.models import Decision as DecisionsReply
from app.simulation.errors import SimulationFailure
from app.simulation.models import Decision
from app.simulation.prompt import DIRECTOR_INSTRUCTIONS, POV_QUESTION, SPEAKER_QUESTION, TURN_CHOICES, TURN_QUESTION

DECISIONS_MODEL = 'gpt-6-luna'  # Decisions API가 지원하는 유일한 모델(app/intent/prompt.py와 같다)
NEEDS_SETTINGS = '시뮬레이션 모델 설정이 필요합니다.'
FAILED = '연출 결정 모델 호출에 실패했습니다.'
UNUSABLE = '연출 결정 모델 응답을 확인할 수 없습니다.'


class OpenAIDecisionClassifier(TypeSafeClassifier):
    """TypeSafeClassifier를 OpenAI Decisions에 연결한다. 키는 OPENAI_API_KEY이고 비동기 호출(ainvoke)만 지원한다."""

    model: str = Field(default=DECISIONS_MODEL, min_length=1)
    base_url: str = 'https://api.openai.com'
    api_key: SecretStr | str = Field(default_factory=secret_from_env('OPENAI_API_KEY', default=''), exclude=True, repr=False)
    instructions: str = ''  # Decisions의 developer 지시. TypeSafe 요청에는 없는 값이다.

    @property
    def _endpoint(self) -> str:
        return f"{self.base_url.rstrip('/')}/v1/decisions"

    def _payload(self, request: ClassifierRequest) -> dict[str, JsonValue]:
        """TypeSafe 요청 {state, questions}를 Decisions 본문으로 바꾼다."""
        questions = [{'type': 'choice', 'name': name, 'instructions': question.instructions,
                      'choices': [{'value': value, 'description': str(description)} for value, description in question.criteria.items()]}
                     for name, question in request['questions'].items()]
        return {'model': self.model, 'questions': questions,
                'input': [{'role': 'developer', 'content': self.instructions},
                          {'role': 'user', 'content': [{'type': 'input_json', 'data': {'state': request['state']}}]}]}

    def _classify(self, request: ClassifierRequest) -> ClassifierResponse:
        raise NotImplementedError('OpenAIDecisionClassifier는 ainvoke만 지원합니다.')

    async def _aclassify(self, request: ClassifierRequest) -> ClassifierResponse:
        try:
            response = await self.async_client.post(self._endpoint, json=self._payload(request), headers=self._request_headers)
        except httpx2.TimeoutException as error:
            raise TypeSafeAPITimeoutError(self.async_client.timeout) from error
        except httpx2.HTTPError as error:
            raise TypeSafeAPIConnectionError('Unable to connect to the OpenAI Decisions API.') from error
        return self._record_usage(parse_response(self._converted(response, request['questions'])))

    def _converted(self, response: httpx2.Response, questions: dict[str, Choice]) -> httpx2.Response:
        """Decisions 응답을 패키지 응답 형식으로 바꾼다. 질문마다 보낸 선택지 안의 답이 정확히 하나여야 하고 거부(refusal)는 실패다.

        Decisions는 확률을 주지 않아 고른 값만 1.0으로 채운다(신뢰도도 1.0). 실패 상태 응답은 그대로 두어 패키지가 오류로 바꾼다.
        """
        if not response.is_success:
            return response
        try:
            answers = DecisionsReply.model_validate(response.json()).answers
            given = {a.name: a for a in answers}
            if len(answers) != len(questions) or set(given) != set(questions) or any(
                    a.type != 'choice' or a.choice not in questions[name].criteria for name, a in given.items()):
                raise ValueError
        except ValueError:  # JSON 오류·pydantic 검증 오류 모두 ValueError다
            raise TypeSafeAPIResponseValidationError(response.status_code, None, response.headers, 'answers') from None
        body = {'model': self.model, 'answers': {
            name: {'type': 'choice', 'choice': a.choice, 'confidence': 1.0,
                   'probabilities': {label: 1.0 if label == a.choice else 0.0 for label in questions[name].criteria}}
            for name, a in given.items()}}
        return httpx2.Response(200, json=body, headers=response.headers, request=response.request)


@lru_cache(maxsize=1)
def classifier() -> OpenAIDecisionClassifier:
    """연출 결정용 분류기. 연결(httpx2 클라이언트)을 재사용하려고 한 번만 만든다."""
    return OpenAIDecisionClassifier(instructions=DIRECTOR_INSTRUCTIONS)


async def decide(state: dict, allowed: Sequence[str], cast: Sequence[dict], last_pov: str | None = None) -> Decision:
    """다음 턴의 연출 결정. allowed는 지금 쓸 수 있는 턴(하나뿐이면 묻지 않고 알려 준다), cast는 [{id, name}]이다.

    state에는 인물 id가 없어야 한다. 모델에는 인물 별칭(c1…)만 보내고 답을 id로 되돌린다. 어긋난 답은 502, 호출 실패는 503이다.
    """
    ids = {f'c{n}': c['id'] for n, c in enumerate(cast, 1)}
    names = {f'c{n}': c['name'] for n, c in enumerate(cast, 1)}
    alias = {real: a for a, real in ids.items()}
    povs = {'omniscient': '전지적 시점: 모든 인물과 사건을 아는 서술자',
            **{f'limited:{a}': f'{name}의 3인칭 제한 시점' for a, name in names.items()},
            **{f'first:{a}': f'{name}의 1인칭 시점' for a, name in names.items()}}
    questions = {}
    if len(allowed) > 1:
        questions['turn'] = Choice(instructions=TURN_QUESTION, criteria={t: TURN_CHOICES[t] for t in allowed})
    questions['speaker'] = Choice(instructions=SPEAKER_QUESTION, criteria=names)
    questions['pov'] = Choice(instructions=POV_QUESTION, criteria=povs)
    seen = {**state, 'cast': [{'alias': a, 'name': name} for a, name in names.items()],
            'lastPov': _swap(last_pov, alias), **({'turn': allowed[0]} if len(allowed) == 1 else {})}
    try:
        chosen = classifier()
    except ValueError:  # 키가 없다
        raise SimulationFailure(503, NEEDS_SETTINGS) from None
    try:
        answers = (await chosen.ainvoke({'state': seen, 'questions': questions})).choices
    except TypeSafeAPIResponseValidationError:
        raise SimulationFailure(502, UNUSABLE) from None
    except TypeSafeError:
        raise SimulationFailure(503, FAILED) from None
    turn, pov = (answers['turn'].choice if 'turn' in answers else allowed[0]), answers['pov'].choice
    if turn not in allowed or (turn == 'monologue' and pov == 'omniscient'):  # 독백은 시점 인물이 있어야 한다
        raise SimulationFailure(502, UNUSABLE)
    return Decision(turn=turn, speaker=ids[answers['speaker'].choice] if turn == 'speech' else None, pov=_swap(pov, ids))


def _swap(pov: str | None, table: dict[str, str]) -> str | None:
    """`limited:<인물>`·`first:<인물>`의 인물 부분을 표(별칭↔id)로 바꾼다."""
    kind, _, who = (pov or '').partition(':')
    return f'{kind}:{table[who]}' if who and who in table else pov
