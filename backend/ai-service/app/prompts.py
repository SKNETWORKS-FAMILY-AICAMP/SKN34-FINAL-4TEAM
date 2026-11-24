"""Langfuse에서 관리하는 모델 지시문 전체와 기동 때 등록(#705).

운영 화면에서 모든 LLM 호출의 프롬프트·모델을 처음부터 고를 수 있게, AI 서비스가 기동할 때 여기 있는 프롬프트를 모두 읽어
없으면 등록하고 코드 시드를 맞춘다(tracing.prompt). 이름과 본문은 호출부(tracing.prompt·agent_runtime.run의 prompt_name)와 같아야 하며
tests/test_prompts.py가 소스의 이름과 대조한다. 평가 채점기 루브릭은 서비스 호출이 아니라 넣지 않는다(코드 고정, DEC-55).
"""

import logging
import time

from app import tracing
from app.generation import prompt as generation
from app.initial_world import prompt as initial_world
from app.intent import prompt as intent
from app.manuscript_extraction import prompt as manuscript_extraction
from app.manuscript_review import prompt as manuscript_review
from app.orchestration import prompt as orchestration
from app.rating import prompt as rating
from app.research import prompt as research
from app.serial import prompt as serial
from app.simulation import prompt as simulation
from app.story_qa import prompt as story_qa
from app.work_tags import prompt as work_tags
from app.world_review import prompt as world_review
from app.writing import prompt as writing

logger = logging.getLogger(__name__)

SEEDS: dict[str, str] = {
    'orchestration.main': orchestration.INSTRUCTIONS,
    'decision_guard.judge': intent.INSTRUCTIONS,
    'story_context.answer': story_qa.QA_INSTRUCTIONS,
    'writing_editing.plan': writing.PLAN_INSTRUCTIONS,
    'writing_editing.plan_pick': writing.PICK_PLAN_INSTRUCTIONS,
    'writing_editing.plan_revise': writing.REVISE_PLAN_INSTRUCTIONS,
    'writing_editing.draft': writing.DRAFT_INSTRUCTIONS,
    'writing_editing.patch': writing.PATCH_INSTRUCTIONS,
    'manuscript_review.mechanical': manuscript_review.INSTRUCTIONS['mechanical'],
    'manuscript_review.semantic': manuscript_review.INSTRUCTIONS['semantic'],
    'world_review.check': world_review.INSTRUCTIONS,
    'world_review.enrich': world_review.ENRICH_INSTRUCTIONS,
    'world_review.impact': world_review.IMPACT_INSTRUCTIONS,
    'web_research.search': research.RESEARCH_INSTRUCTIONS,
    'research.pick': research.PICK_INSTRUCTIONS,
    'research.refer': research.REFER_INSTRUCTIONS,
    'rating.assess': rating.INSTRUCTIONS,
    'character_simulation.plan': simulation.PLAN_INSTRUCTIONS,
    'character_simulation.act': simulation.ACT_INSTRUCTIONS,
    'character_simulation.narrate': simulation.NARRATE_INSTRUCTIONS,
    'character_simulation.check': simulation.CHECK_INSTRUCTIONS,
    'character_simulation.direct': simulation.DIRECTOR_INSTRUCTIONS,
    'proposals.continue': generation.INSTRUCTIONS,
    'initial_world.extract': initial_world.INSTRUCTIONS,
    'manuscript_extraction.extract': manuscript_extraction.EXTRACT,
    'manuscript_extraction.resolve': manuscript_extraction.RESOLVE,
    'work_tags.suggest': work_tags.INSTRUCTIONS,
    'serial.choices_v2': serial.CHOICES_INSTRUCTIONS,
    'serial.episode_summary': serial.EPISODE_SUMMARY_INSTRUCTIONS,
    'serial.simulation_v2': serial.SIMULATION_INSTRUCTIONS,
    'serial.vote_summary': serial.SUMMARY_INSTRUCTIONS,
    'serial.episode_draft': serial.DRAFT_INSTRUCTIONS,
    'serial.episode_review_v3': serial.REVIEW_INSTRUCTIONS,
}


RETRIES, RETRY_WAIT = 10, 15  # ai-service는 langfuse-web 기동을 기다리지 않아 처음엔 실패할 수 있다: 15초 간격으로 10번(약 2.5분)까지 다시 한다


def register_all(wait=time.sleep) -> None:
    """모든 프롬프트를 읽어 없으면 등록하고 시드를 맞춘다. 못 읽은 프롬프트만 RETRY_WAIT 뒤 다시 하고, RETRIES번 뒤에도 못 읽으면
    경고만 남긴다(그 프롬프트는 처음 호출될 때 다시 읽는다)."""
    pending = list(SEEDS)
    for attempt in range(RETRIES + 1):
        if attempt:
            wait(RETRY_WAIT)
        failed = []
        for name in pending:
            try:
                tracing.prompt(name, SEEDS[name])
            except tracing.PromptUnavailable:
                failed.append(name)
        if not failed:
            return
        pending = failed
    logger.warning('기동 때 등록하지 못한 프롬프트: %s', ', '.join(pending))
