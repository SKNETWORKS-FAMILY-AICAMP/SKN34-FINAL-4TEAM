import pytest

from app.intent import agent


@pytest.fixture(autouse=True)
def fresh_client():
    """판정 클라이언트는 키마다 캐시된다. 테스트마다 비워 앞 테스트의 대역이 남지 않게 한다."""
    agent._client.cache_clear()
    yield
    agent._client.cache_clear()
