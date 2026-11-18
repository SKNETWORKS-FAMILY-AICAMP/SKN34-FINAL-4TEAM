"""Decision Guard 모델 호출(#55·#373·#473): LangChain `create_agent` 위에서 OpenAI Decisions(`gpt-6-luna`)를 1회 부르고 답을 검증한다.

질문(guard + 기능별 yes/no)은 service가 정하고 선택지·누락·중복·refusal 검증은 여기서 한다. 입력 가드레일 미들웨어(LangChain 기본 미들웨어 상속)가 Decisions보다 먼저 작가 요청만 거른다.
- `SensitiveDataGuard`(PIIMiddleware): 요청에 이메일·카드번호·API 키가 있으면 어떤 모델도 부르지 않고 sensitive_data로 거절한다(외부 전송 방지).
- `ModerationGuard`(OpenAIModerationMiddleware): OpenAI moderation이 BLOCKED 범주를 걸면 unsafe로 거절한다. 폭력·성 묘사 같은
  창작 범주는 소설에 흔해 막지 않고 Decisions의 guard 질문이 판단한다.
자료(materials)·이전 요청(history)은 원고·검색 본문이라 가드레일 검사 대상이 아니며 Decisions에만 자료로 보낸다.
"""

import os
import re
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware, PIIMiddleware, hook_config
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_openai.middleware import OpenAIModerationMiddleware
from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app.intent.errors import IntentFailure
from app.intent.models import Decision
from app.intent.prompt import INSTRUCTIONS, MODEL

GUARD = 'guard'  # 가드레일이 끝낸 실행의 마지막 메시지 이름. 내용이 거절 사유(Reason)다
BLOCKED = ('sexual_minors', 'self_harm_instructions', 'illicit_violent')  # 창작 맥락이어도 처리하지 않는 moderation 범주
API_KEY = r'(?<![A-Za-z0-9])[sp]k-[A-Za-z0-9_-]{16,}'  # OpenAI·Langfuse 형식(sk-…, pk-…)의 키. 밑줄 강조(_sk-…_)도 잡는다
HANGUL = re.compile(r'[ㄱ-ㅣ가-힣]')  # 탐지 전에 공백으로 바꿀 한글


def _reject(reason: str) -> dict:
    return {'jump_to': 'end', 'messages': [AIMessage(content=reason, name=GUARD)]}


class SensitiveDataGuard(PIIMiddleware):
    """작가 요청(첫 모델 호출 앞의 유일한 사용자 메시지)에서 라이브러리 탐지기로 개인정보·키를 찾으면 sensitive_data 거절로 끝낸다.

    이메일·카드 탐지기는 정규식 단어 경계(\\b)를 쓰는데 한글도 단어 문자라 "a@b.com로"처럼 조사가 붙으면 놓친다. 그래서 한글을 공백으로 바꾼 글에서 찾는다.
    차단만 하고 글을 고치지 않으므로 위치는 쓰지 않는다.
    """

    def __init__(self, pii_type: str, detector: str | None = None):
        super().__init__(pii_type, strategy='block', detector=detector)

    @hook_config(can_jump_to=['end'])
    def before_model(self, state, runtime):
        return _reject('sensitive_data') if self.detector(HANGUL.sub(' ', state['messages'][-1].text)) else None


class ModerationGuard(OpenAIModerationMiddleware):
    """작가 요청을 moderation에 보내고 BLOCKED 범주만 unsafe 거절로 끝낸다. 그 밖의 표시는 통과시킨다."""

    def _apply_violation(self, messages, *, index, stage, content, result):
        return _reject('unsafe') if any(getattr(result.categories, c) for c in BLOCKED) else None


class DecisionsModel(BaseChatModel):
    """create_agent의 모델 슬롯에서 OpenAI Decisions를 부른다. 시스템 메시지는 developer 지시, 사용자 메시지는 작가 요청이다.

    질문·자료·이전 요청은 호출마다 정해 필드로 받는다. 응답(dict)은 그대로 additional_kwargs['decision']에 담고 decide가 검증한다.
    """
    client: Any
    questions: list[dict]
    materials: list[str]
    history: list[str]

    @property
    def _llm_type(self) -> str:
        return 'openai-decisions'

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        system, request = messages
        # 설치된 SDK에 decisions 리소스가 없어 공식 HTTP 계약(POST /v1/decisions)을 직접 쓴다.
        response = self.client.post('/decisions', cast_to=object, body={
            'model': MODEL, 'questions': self.questions,
            'input': [{'role': 'developer', 'content': system.content},
                      {'role': 'user', 'content': [{'type': 'input_json', 'data': {
                          'request': request.content, 'materials': self.materials, 'history': self.history}}]}]})
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content='', additional_kwargs={'decision': response}))])


def decide(request: str, materials: list[str], questions: list[dict], history: list[str] = ()) -> dict[str, str]:
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        raise IntentFailure()
    client = OpenAI(api_key=key, timeout=30, max_retries=0)
    try:
        model = DecisionsModel(client=client, questions=questions, materials=list(materials), history=list(history))
        agent = create_agent(model, system_prompt=INSTRUCTIONS, checkpointer=False, middleware=[
            SensitiveDataGuard('email'), SensitiveDataGuard('credit_card'), SensitiveDataGuard('api_key', API_KEY),
            ModerationGuard(client=client, check_output=False, exit_behavior='end'),
            ModelCallLimitMiddleware(run_limit=1, exit_behavior='error')])
        last = agent.invoke({'messages': [HumanMessage(request)]})['messages'][-1]
        if last.name == GUARD:
            return {'guard': last.content}
        given = Decision.model_validate(last.additional_kwargs['decision']).answers
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
