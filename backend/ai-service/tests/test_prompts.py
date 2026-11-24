import re
from pathlib import Path

from app import prompts, tracing

APP = Path(__file__).resolve().parents[1] / 'app'
# 이름을 f-string으로 만드는 호출부(검수 종류·집필 종류·시뮬레이션 호출)가 실제로 쓰는 이름
DYNAMIC = {'manuscript_review.mechanical', 'manuscript_review.semantic', 'writing_editing.draft', 'writing_editing.patch',
           'character_simulation.plan', 'character_simulation.act', 'character_simulation.narrate', 'character_simulation.check'}


def test_every_prompt_name_the_code_reads_from_langfuse_has_its_seed_and_nothing_else():
    """#705: 운영 화면이 모든 LLM 호출의 프롬프트를 처음부터 보이려면 기동 때 전부 등록해야 한다. 호출부와 목록이 어긋나면 여기서 실패한다."""
    source = '\n'.join(path.read_text(encoding='utf-8') for path in APP.rglob('*.py'))
    static = set(re.findall(r"(?:tracing\.prompt\(|prompt_name=)'([a-z_]+\.[a-z0-9_]+)'", source))
    static |= set(re.findall(r"_run\('[^']+', '[^']+', '([a-z_]+\.[a-z_]+)'", source))   # world_review의 _run(이름, 표시, 프롬프트 이름, …)
    static |= set(re.findall(r"_call\('([a-z_]+\.[a-z_]+)'", source))                     # manuscript_extraction의 _call(프롬프트 이름, …)
    assert static | DYNAMIC == set(prompts.SEEDS)
    assert all(isinstance(text, str) and text.strip() for text in prompts.SEEDS.values())


def test_register_all_reads_every_prompt_and_one_unavailable_prompt_does_not_stop_the_rest(monkeypatch, caplog):
    asked = []

    def prompt(name, default):
        asked.append(name)
        if name == 'orchestration.main':
            raise tracing.PromptUnavailable
        return tracing.Prompt(default)

    monkeypatch.setattr(tracing, 'prompt', prompt)
    prompts.register_all(wait=lambda seconds: None)
    assert asked[:len(prompts.SEEDS)] == list(prompts.SEEDS) and set(asked[len(prompts.SEEDS):]) == {'orchestration.main'}
    assert 'orchestration.main' in caplog.text


def test_prompts_that_failed_at_boot_are_retried_until_langfuse_is_up(monkeypatch):
    """ai-service는 langfuse-web 기동을 기다리지 않는다: 처음 못 읽은 프롬프트만 간격을 두고 다시 등록한다."""
    attempts, waits = {}, []

    def prompt(name, default):
        attempts[name] = attempts.get(name, 0) + 1
        if name == 'orchestration.main' and attempts[name] < 3:
            raise tracing.PromptUnavailable
        return tracing.Prompt(default)

    monkeypatch.setattr(tracing, 'prompt', prompt)
    prompts.register_all(wait=waits.append)
    assert attempts['orchestration.main'] == 3 and attempts['decision_guard.judge'] == 1 and waits == [prompts.RETRY_WAIT] * 2


def test_registration_gives_up_after_the_retries(monkeypatch):
    monkeypatch.setattr(tracing, 'prompt', lambda name, default: (_ for _ in ()).throw(tracing.PromptUnavailable))
    waits = []
    prompts.register_all(wait=waits.append)
    assert len(waits) == prompts.RETRIES
