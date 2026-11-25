"""프롬프트별 기본 모델(#868). 호출 코드가 모델을 정하는 규칙 그대로 환경 변수와 상수에서 읽는다(키·모델·Langfuse 호출 없이)."""
import pytest

from app import prompts
from app.intent.prompt import MODEL as GUARD_MODEL
from app.prompt_models import service
from app.simulation import agent
from app.simulation.director import DECISIONS_MODEL

OWN_RULE = {'character_simulation.act', 'character_simulation.direct', 'decision_guard.judge'}  # OPENAI_MODEL을 따르지 않는 프롬프트
FOLLOWERS = set(prompts.SEEDS) - OWN_RULE


@pytest.fixture(autouse=True)
def blank_environment(monkeypatch):
    """Orca 셸에 .env가 주입돼 있어도 모델 설정은 테스트가 정한 값만 본다."""
    for name in ('OPENAI_MODEL', 'SIMULATION_ACT_MODEL', 'SIMULATION_ACT_BASE_URL'):
        monkeypatch.delenv(name, raising=False)


def models() -> dict:
    return service.default_models().models


def test_every_registered_prompt_has_an_entry_and_nothing_else():
    assert set(models()) == set(prompts.SEEDS)


def test_a_prompt_runs_on_OPENAI_MODEL_unless_it_has_its_own_rule(monkeypatch):
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-env')

    found = models()

    assert {name: found[name] for name in FOLLOWERS} == dict.fromkeys(FOLLOWERS, 'gpt-env')


def test_the_character_act_runs_on_the_act_model_and_the_other_simulation_calls_on_OPENAI_MODEL(monkeypatch):
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-env')
    assert models()['character_simulation.act'] == agent.ACT_MODEL != 'gpt-env'

    monkeypatch.setenv('SIMULATION_ACT_MODEL', ' gpt-act ')   # 공백은 호출 코드도 걷어 낸다
    found = models()

    assert found['character_simulation.act'] == 'gpt-act'
    assert [found[f'character_simulation.{call}'] for call in ('plan', 'narrate', 'check')] == ['gpt-env'] * 3


def test_an_act_provider_without_an_act_model_falls_back_to_OPENAI_MODEL(monkeypatch):
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-env')
    monkeypatch.setenv('SIMULATION_ACT_BASE_URL', 'https://provider.example/v1')
    assert models()['character_simulation.act'] == 'gpt-env'   # 외부 제공사에는 기본 act 모델(terra)을 쓰지 않는다

    monkeypatch.setenv('SIMULATION_ACT_MODEL', 'provider-model')
    assert models()['character_simulation.act'] == 'provider-model'


def test_the_two_decisions_prompts_keep_their_fixed_model_whatever_the_environment_says(monkeypatch):
    assert (models()['character_simulation.direct'], models()['decision_guard.judge']) == (DECISIONS_MODEL, GUARD_MODEL)

    monkeypatch.setenv('OPENAI_MODEL', 'gpt-env')
    monkeypatch.setenv('SIMULATION_ACT_MODEL', 'gpt-act')
    found = models()

    assert (found['character_simulation.direct'], found['decision_guard.judge']) == (DECISIONS_MODEL, GUARD_MODEL)


@pytest.mark.parametrize('value', [None, ''], ids=['unset', 'blank'])
def test_without_OPENAI_MODEL_a_prompt_that_needs_it_has_no_model_and_nothing_is_guessed(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv('OPENAI_MODEL', value)

    found = models()

    assert {name: model for name, model in found.items() if model is None} == dict.fromkeys(FOLLOWERS, None)
    assert found['character_simulation.act'] == agent.ACT_MODEL   # act has a default of its own, so it runs without OPENAI_MODEL
