import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.orchestration import agent, service


@pytest.fixture(autouse=True)
def chat_graph(monkeypatch):
    """운영의 AsyncPostgresSaver 대신 메모리 체크포인터로 대화 그래프를 컴파일한다."""
    monkeypatch.setattr(service, 'CHAT', service.build().compile(checkpointer=InMemorySaver()))


@pytest.fixture(autouse=True)
def main_waits(monkeypatch):
    """메인 모델 일시 장애 재시도의 대기(sleep)를 건너뛰고 대기 초를 모은다."""
    seen = []

    async def sleep(seconds):
        seen.append(seconds)

    monkeypatch.setattr(agent, 'sleep', sleep)
    return seen
