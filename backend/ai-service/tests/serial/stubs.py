"""자율 연재 테스트 대역: 모델 호출마다 정해진 답을 차례로 돌려주는 ChatOpenAI 대역과 요청 자료."""

import json
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app import agent_runtime

from fake_chat import FakeChat

CONTEXT = json.dumps({'episodes': [{'number': 1, 'title': '1화', 'text': '서윤이 문을 열었다.'}], 'cards': []}, ensure_ascii=False)

# (모델이 돌려줄 본문 또는 JSON 값, 입력 토큰, 출력 토큰)
SUMMARY = ({'summary': '독자들은 서윤이 진실을 알게 되길 바랐다.'}, 100, 50)
PLAN = ({'plans': [{'title': '진실의 밤', 'beats': ['서윤이 망설인다', '진실을 털어놓는다']}], 'notes': []}, 300, 100)
DRAFT = ('서윤은 오랫동안 숨겨 온 이야기를 꺼냈다.', 400, 200)
REWRITE = ('서윤은 처음부터 모든 것을 차분히 털어놓았다.', 400, 200)
PASS = ({'passed': True, 'issues': []}, 500, 20)
FAIL = ({'passed': False, 'issues': ['1화의 설정과 어긋난다: 서윤의 나이']}, 500, 30)


def simulation(**overrides) -> dict:
    return {'workId': 'work-1', 'episodeNumber': 2, 'premise': '서윤이 비밀을 털어놓는다', 'beats': ['망설임', '고백'], 'context': CONTEXT,
            'creditLimit': 5} | overrides


def episode(**overrides) -> dict:
    return {'workId': 'work-1', 'episodeNumber': 2, 'direction': '서윤의 성장 이야기', 'context': CONTEXT, 'creditLimit': 50,
            'opinions': [{'kind': 'general', 'body': '서윤이 진실을 알게 되면 좋겠어요', 'votes': 3, 'scene': None},
                         {'kind': 'simulation', 'body': '고백 장면', 'votes': 1, 'scene': '서윤이 입을 열었다.'}]} | overrides


class Scripted(FakeChat):
    """호출(_generate)마다 queue의 다음 답을 돌려준다. 모델에 닿지 못한 호출(상한에서 막힌 호출)은 답도 기록도 소비하지 않는다."""
    queue: Any
    calls: Any

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.seen['messages'] = messages
        self.calls.append(self.seen)
        body, tokens_in, tokens_out = self.queue.pop(0)
        reply = AIMessage(content=[{'type': 'text', 'text': body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)}],
                          response_metadata={'status': 'completed', 'model_name': 'resolved-model', 'id': 'resp-1'},
                          usage_metadata={'input_tokens': tokens_in, 'output_tokens': tokens_out, 'total_tokens': tokens_in + tokens_out})
        return ChatResult(generations=[ChatGeneration(message=reply)])


def answers(monkeypatch, *replies) -> list[dict]:
    """모델 호출마다 replies를 차례로 답하는 ChatOpenAI 대역. 실제로 모델에 닿은 호출의 기록(보낸 messages 등)을 모은 목록을 돌려준다."""
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    queue, calls = list(replies), []
    monkeypatch.setattr(agent_runtime, 'ChatOpenAI', lambda **kwargs: Scripted(seen={}, reply=None, model_name=kwargs['model'], queue=queue, calls=calls))
    return calls


def sent(call: dict) -> tuple[str, dict]:
    """한 모델 호출이 받은 (지시문, 자료 JSON)."""
    system, human = call['messages']
    return system.content, json.loads(human.content)
