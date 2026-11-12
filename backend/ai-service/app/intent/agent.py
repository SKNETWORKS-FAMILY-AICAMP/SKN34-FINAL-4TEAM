"""OpenAI Decisions(`gpt-6-luna`)를 1회 호출하고 질문별 답이 보낸 선택지 안에 있는지 검증한다."""

import os

from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app.intent.errors import IntentFailure
from app.intent.models import Decision
from app.intent.prompt import INSTRUCTIONS, MODEL


def decide(request: str, materials: list[str], questions: list[dict]) -> dict[str, str]:
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        raise IntentFailure()
    client = OpenAI(api_key=key, timeout=30, max_retries=0)
    try:
        # 설치된 SDK에 decisions 리소스가 없어 공식 HTTP 계약(POST /v1/decisions)을 직접 쓴다.
        response = client.post('/decisions', cast_to=object, body={
            'model': MODEL, 'questions': questions,
            'input': [{'role': 'developer', 'content': INSTRUCTIONS},
                      {'role': 'user', 'content': [{'type': 'input_json', 'data': {'request': request, 'materials': materials}}]}]})
        given = Decision.model_validate(response).answers
        answers = {a.name: a.choice for a in given if a.type == 'choice'}
        # 질문마다 정확히 한 답이 있고 그 값이 보낸 선택지 안에 있어야 한다. 가드레일이 걸린 요청은
        # 나머지 질문을 모델이 거부(refusal)하므로, guard 답만 유효하면 거절 결과로 쓴다.
        valid = {q['name']: {c['value'] for c in q['choices']} for q in questions}
        if len(given) != len(questions) or {a.name for a in given} != set(valid):
            raise IntentFailure()
        # guard를 거부했거나, guard는 통과했지만 다른 질문을 거부했으면 실행하지 않는 쪽으로 닫는다.
        if any(a.type == 'refusal' for a in given) and answers.get('guard', 'none') == 'none':
            return {'guard': 'unsafe'}
        if answers.get('guard') not in valid['guard']:
            raise IntentFailure()
        if answers['guard'] == 'none' and any(answers.get(n) not in v for n, v in valid.items()):
            raise IntentFailure()
        return answers
    except (OpenAIError, ValidationError):
        raise IntentFailure() from None
    finally:
        client.close()
