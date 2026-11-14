"""인물 시뮬레이션 모델 호출: 계획·인물 턴·검사를 각각 Structured Outputs 1회로 요청한다.

호출마다 새 입력만 보낸다(store=False, 이전 응답 id 없음). 그래서 한 인물의 입력과 모델 대화 상태가 다음 인물에게 이어지지 않는다.
키·모델은 호출 시 읽고(OPENAI_API_KEY·OPENAI_MODEL), 제공사 실패·불완전 응답은 고정 문구의 SimulationFailure로 바꾼다.
추적에는 모델·사용량·실패만 남긴다. 설정 문서·생성 문단은 팀 결정 범위(질문·원고·답변) 밖이라 남기지 않는다.
"""

import json
import os

from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ValidationError

from app import tracing
from app.simulation.errors import SimulationFailure
from app.simulation.models import Action, CharacterRef, PlanDraft, Verdict
from app.simulation.prompt import ACT_INSTRUCTIONS, CHECK_INSTRUCTIONS, PLAN_INSTRUCTIONS


def plan(request: str, history: list[str], characters: list[CharacterRef]) -> PlanDraft:
    """요청 문장과 인물 목록(id·이름만)으로 모드·전제·비트·참여 인물을 정한다. 흐름 모드에 비트가 없으면 비트를 제안한다."""
    data = {'request': request, 'history': history, 'characters': [c.model_dump() for c in characters]}
    return _parse('plan', PLAN_INSTRUCTIONS, data, PlanDraft, 1200, 40)


def act(data: dict) -> Action:
    """한 인물의 입력(그 인물이 아는 것만)으로 소설 문단 하나와 다른 인물에게 보일 행동을 만든다."""
    return _parse('act', ACT_INSTRUCTIONS, data, Action, 1500, 60)


def check(data: dict) -> Verdict:
    """생성 문단을 오류 1~3과 IF 전제·비트 진행 기준으로 한 번에 판정한다."""
    return _parse('check', CHECK_INSTRUCTIONS, data, Verdict, 1500, 60)


def _parse(name: str, instructions: str, data: dict, text_format: type[BaseModel], max_tokens: int, timeout: int):
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise SimulationFailure(503, '시뮬레이션 모델 설정이 필요합니다.')
    with OpenAI(api_key=key, timeout=timeout, max_retries=0) as client, \
            tracing.observe(f'simulation.{name}', as_type='generation', model=model) as generation:
        try:
            result = client.responses.parse(
                model=model, store=False, max_output_tokens=max_tokens, text_format=text_format,
                instructions=instructions, input=json.dumps(data, ensure_ascii=False))
        except ValidationError:
            raise SimulationFailure(502, '시뮬레이션 모델 응답을 확인할 수 없습니다.') from None
        except OpenAIError:
            raise SimulationFailure(503, '시뮬레이션 모델 호출에 실패했습니다.') from None
        usage = getattr(result, 'usage', None)
        generation.update(model=getattr(result, 'model', model),
                          usage_details=usage and {'input': usage.input_tokens, 'output': usage.output_tokens})
        if result.status != 'completed' or result.output_parsed is None:
            raise SimulationFailure(502, '시뮬레이션 모델 응답을 확인할 수 없습니다.')
    return result.output_parsed
