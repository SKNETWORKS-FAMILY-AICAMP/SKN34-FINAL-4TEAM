"""Writing & Editing(#62): 새 회차 원고(Text)와 선택 구간 수정(before/after Patch)을 별개 결과로 만든다.

Content가 권한·판본·선택 범위를 확정해 허용 자료만 보낸다. 결과는 제안일 뿐이며 저장은 Content가
최신 판본·원문 해시·작가 승인(#60)을 다시 확인한 뒤에만 한다. 부분 수정은 선택 구간의 교체 문장만 돌려주므로
선택 밖 문장은 구조적으로 바뀌지 않는다.
"""

import json
import os

from openai import OpenAI, OpenAIError
from pydantic import BaseModel

from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, DraftResponse, PatchRequest, PatchResponse, Usage
from app.writing.prompt import DRAFT_INSTRUCTIONS, PATCH_INSTRUCTIONS


def draft(data: DraftRequest) -> DraftResponse:
    """BeatPlan/콘티와 허용 문맥으로 새 회차 원고 제안을 만든다."""
    text, meta = _write(4000, DRAFT_INSTRUCTIONS, data)
    return DraftResponse(text=text, **meta)


def patch(data: PatchRequest) -> PatchResponse:
    """선택 구간 하나를 수정 지시대로 고친 before/after 제안을 만든다."""
    after, meta = _write(2000, PATCH_INSTRUCTIONS, data)
    return PatchResponse(before=data.selection, after=after, **meta)


def _write(max_tokens: int, instructions: str, data: BaseModel) -> tuple[str, dict]:
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise WritingFailure(503, '집필 모델 설정이 필요합니다.')
    with OpenAI(api_key=key, timeout=120, max_retries=0) as client:
        try:
            response = client.responses.create(
                model=model, store=False, max_output_tokens=max_tokens, instructions=instructions,
                input=json.dumps(data.model_dump(), ensure_ascii=False))
        except OpenAIError:
            raise WritingFailure(503, '집필 모델 호출에 실패했습니다.') from None
    text = response.output_text.strip()
    # 토큰 한도로 잘린 원고도 완성본처럼 보이지 않게 실패로 돌려준다.
    if response.status != 'completed' or not text:
        raise WritingFailure(502, '집필 모델 응답을 확인할 수 없습니다.')
    usage = Usage(inputTokens=response.usage.input_tokens, outputTokens=response.usage.output_tokens) if response.usage else None
    return text, {'model': response.model, 'providerResponseId': response.id, 'usage': usage}
