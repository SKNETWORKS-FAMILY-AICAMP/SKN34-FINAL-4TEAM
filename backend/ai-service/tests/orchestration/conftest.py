import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.orchestration import service


@pytest.fixture(autouse=True)
def chat_graph(monkeypatch):
    """운영의 AsyncPostgresSaver 대신 메모리 체크포인터로 대화 그래프를 컴파일한다."""
    monkeypatch.setattr(service, 'CHAT', service.build().compile(checkpointer=InMemorySaver()))
