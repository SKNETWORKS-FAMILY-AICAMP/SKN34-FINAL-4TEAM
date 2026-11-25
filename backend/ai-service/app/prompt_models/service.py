"""프롬프트별 기본 모델(#868): 호출 코드가 모델을 정하는 규칙(버전 모델 → 환경 변수·상수)에서 앞의 것을 뺀 나머지를 그 코드로 읽는다."""
import os

from app import prompts
from app.intent.prompt import MODEL as GUARD_MODEL
from app.prompt_models.models import DefaultModels
from app.simulation import agent as simulation
from app.simulation.director import DECISIONS_MODEL

SIMULATION_CALLS = ('plan', 'act', 'narrate', 'check')   # character_simulation.<호출>의 모델을 simulation.agent가 호출마다 정하는 프롬프트


def default_models() -> DefaultModels:
    """기동 때 등록하는 모든 프롬프트(app/prompts.py의 SEEDS)가 버전에 모델이 없을 때 쓰는 모델을 돌려준다. 키·모델·Langfuse를 부르지 않는다.

    대부분은 OPENAI_MODEL이다(없으면 None). 인물 시뮬레이션 호출은 simulation.agent가 정하는 값이다(act는 SIMULATION_ACT_MODEL, 없으면 ACT_MODEL).
    Decisions API를 부르는 두 프롬프트는 모델이 코드에 고정이라 버전이나 환경 변수와 무관하다.
    """
    models = dict.fromkeys(prompts.SEEDS, os.environ.get('OPENAI_MODEL') or None)
    for call in SIMULATION_CALLS:
        models[f'character_simulation.{call}'] = simulation.default_model(call)
    models['character_simulation.direct'] = DECISIONS_MODEL
    models['decision_guard.judge'] = GUARD_MODEL
    return DefaultModels(models=models)
