"""업무 Agent 테스트용 ChatOpenAI 대역. create_agent가 실제로 돌고 모델 호출만 정해진 답으로 바꾼다."""

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app import agent_runtime


class FakeChat(BaseChatModel):
    seen: Any
    reply: Any  # AIMessage 또는 올릴 예외
    model_name: str

    @property
    def _llm_type(self) -> str:
        return 'fake-openai'

    def bind_tools(self, tools, **kwargs):
        if 'response_format' in kwargs:
            _strict(kwargs['response_format']['json_schema']['schema'])
        self.seen.update(tools=tools, **kwargs)
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.seen['messages'] = messages
        if isinstance(self.reply, Exception):
            raise self.reply
        return ChatResult(generations=[ChatGeneration(message=self.reply)])


def fake_chat(monkeypatch, text='', status='completed', error=None, blocks=()):
    """OPENAI 설정을 채우고 ChatOpenAI를 대역으로 바꾼다. 생성자·bind 인자와 받은 메시지를 담은 dict를 돌려준다."""
    seen = {}
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    reply = error or AIMessage(
        content=[{'type': 'text', 'text': text}, *blocks],
        response_metadata={'status': status, 'model_name': 'resolved-model', 'id': 'resp-1'},
        usage_metadata={'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15})

    def chat(**kwargs):
        seen['init'] = kwargs
        return FakeChat(seen=seen, reply=reply, model_name=kwargs['model'])

    monkeypatch.setattr(agent_runtime, 'ChatOpenAI', chat)
    return seen


def _strict(node) -> None:
    """OpenAI strict 구조화 출력이 받아들이는 스키마인지 본다. 객체마다 additionalProperties=false이고 모든 속성이 required여야 한다."""
    if isinstance(node, dict):
        if node.get('type') == 'object':
            assert node.get('additionalProperties') is False, f"{node.get('title')}: additionalProperties=false 필요"
            assert set(node.get('required', [])) == set(node.get('properties', {})), f"{node.get('title')}: 모든 속성 required 필요"
        for child in node.values():
            _strict(child)
    elif isinstance(node, list):
        for child in node:
            _strict(child)
