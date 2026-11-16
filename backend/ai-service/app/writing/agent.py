"""Writing & Editing(#62): 새 회차 원고(Text)와 선택 구간 수정(before/after Patch)을 별개 결과로 만든다.

Content가 권한·판본·선택 범위를 확정해 허용 자료만 보낸다. 결과는 제안일 뿐이며 저장은 Content가
최신 판본·원문 해시·작가 승인(#60)을 다시 확인한 뒤에만 한다. 부분 수정은 선택 구간의 교체 문장만 돌려주므로
선택 밖 문장은 구조적으로 바뀌지 않는다. 모델 호출은 create_agent + 공통 미들웨어(app/agent_runtime.py)로 1회 실행한다.
"""

from app import agent_runtime
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, DraftResponse, PatchRequest, PatchResponse
from app.writing.prompt import DRAFT_INSTRUCTIONS, PATCH_INSTRUCTIONS


def draft(data: DraftRequest) -> DraftResponse:
    """BeatPlan/콘티와 허용 문맥으로 새 회차 원고 제안을 만든다."""
    text, meta = _write(4000, DRAFT_INSTRUCTIONS, data)
    return DraftResponse(text=text, **meta)


def patch(data: PatchRequest) -> PatchResponse:
    """선택 구간 하나를 수정 지시대로 고친 before/after 제안을 만든다."""
    after, meta = _write(2000, PATCH_INSTRUCTIONS, data)
    return PatchResponse(before=data.selection, after=after, **meta)


def _write(max_tokens: int, instructions: str, data: DraftRequest | PatchRequest) -> tuple[str, dict]:
    # 허용 문맥(context)은 설정 본문을 담아 추적 결정 범위 밖이라 남기지 않는다.
    message, _ = agent_runtime.run('writing.generation', '집필', WritingFailure, instructions, data.model_dump(),
                                   max_tokens=max_tokens, timeout=120, trace=data.model_dump(exclude={'context'}))
    text = message.text.strip()
    if not text:
        raise WritingFailure(502, '집필 모델 응답을 확인할 수 없습니다.')
    return text, agent_runtime.meta(message)
