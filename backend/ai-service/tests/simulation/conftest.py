import pytest

SWITCHES = ('SIMULATION_REASONING_EFFORT', 'SIMULATION_SKIP_FORCED_DIRECTOR', 'SIMULATION_WORLD_CACHE', 'SIMULATION_SKIP_NARRATION_CHECK',
            'SIMULATION_ACT_BASE_URL', 'SIMULATION_ACT_API_KEY', 'SIMULATION_ACT_MODEL')


@pytest.fixture(autouse=True)
def default_switches(monkeypatch):
    """속도 스위치(#642)의 기본값은 지금 동작이다. 개발자 셸·.env에 스위치가 남아 있어도 단위 테스트는 기본값으로 돈다."""
    for name in SWITCHES:
        monkeypatch.delenv(name, raising=False)
