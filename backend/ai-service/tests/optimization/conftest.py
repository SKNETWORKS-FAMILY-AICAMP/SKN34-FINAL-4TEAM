import pytest


@pytest.fixture(autouse=True)
def offline_by_default(monkeypatch):
    """Orca 셸처럼 Langfuse 키가 주입된 환경에서도 풀 읽기는 키가 없는 경우(저장소 파일)가 기본이다. 키가 필요한 시험은 스스로 설정한다."""
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)
