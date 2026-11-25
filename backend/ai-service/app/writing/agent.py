"""Writing & Editing(#62·#387·#578): 전개 기획(BeatPlan), 새 회차 원고(Text), 선택 구간 수정(before/after Patch), 저장된 플롯·장면 계획의 수정안(PlanRevision)을 별개 결과로 만든다.

기획은 계획만 돌려주고 원고를 만들지 않는다. 계획 없이 바로 집필하면 계획 하나를 정한 뒤 그 계획으로 원고를 쓴다(plan_and_draft).

Content가 권한·판본·선택 범위를 확정해 허용 자료만 보낸다. 결과는 제안일 뿐이며 저장은 Content가
최신 판본·원문 해시·작가 승인(#60)을 다시 확인한 뒤에만 한다. 부분 수정은 선택 구간의 교체 문장만 돌려주므로
선택 밖 문장은 구조적으로 바뀌지 않는다. 모델 호출은 create_agent + 공통 미들웨어(app/agent_runtime.py)로 1회 실행한다.
"""

from app import agent_runtime
from app.writing.errors import WritingFailure
from app.writing.models import (PLAN_CONTENT_MAX, PLAN_TITLE_MAX, DraftRequest, DraftResponse, PatchRequest, PatchResponse, PlanOutput, PlanPick,
                                PlanPickRequest, PlanRequest, PlanResponse, PlanReviseRequest, PlanRevision, PlanText)
from app.writing.prompt import (DRAFT_INSTRUCTIONS, PATCH_INSTRUCTIONS, PICK_PLAN_INSTRUCTIONS, PLAN_INSTRUCTIONS,
                                REVISE_PLAN_INSTRUCTIONS)

BAD_PLAN = '기획 모델 응답을 확인할 수 없습니다.'
BAD_REVISION = '계획 수정 모델 응답을 확인할 수 없습니다.'


def draft(data: DraftRequest) -> DraftResponse:
    """BeatPlan/콘티와 허용 문맥으로 새 회차 원고 제안을 만든다."""
    text, meta = _write('draft', 4000, DRAFT_INSTRUCTIONS, data)
    return DraftResponse(text=text, **meta)


def plan(data: PlanRequest, credit: agent_runtime.CreditMiddleware | None = None) -> PlanResponse:
    """요청과 허용 문맥으로 전개 계획을 만든다. 원고 문장은 만들지 않는다. credit은 AI 자율 연재(요청의 모든 모델 호출을 같은 크레딧에 센다)만 준다."""
    # 바로 집필은 기획(50초)+원고(120초)를 한 단계에서 잇는다. Content 중계 읽기 한도 3분 안에 끝나야 한다.
    message, result = agent_runtime.run('writing.plan', '기획', WritingFailure, PLAN_INSTRUCTIONS, data.model_dump(),
                                        prompt_name='writing_editing.plan', max_tokens=4000, timeout=50,
                                        trace=data.model_dump(exclude={'context'}), schema=PlanOutput, credit=credit)
    if not 1 <= len(result.plans) <= (1 if data.single else 3) or any(not p.beats or len(p.beats) > 12 for p in result.plans):
        raise WritingFailure(502, BAD_PLAN)
    return PlanResponse(**result.model_dump(), **agent_runtime.meta(message))


def plan_and_draft(data: PlanRequest) -> DraftResponse:
    """바로 집필: 계획 하나를 정하고 그 계획으로 원고를 쓴다. 쓴 계획을 결과에 함께 둔다."""
    chosen = plan(data.model_copy(update={'single': True})).plans[0]
    text = '\n'.join([chosen.title, *(f'{i}. {b}' for i, b in enumerate(chosen.beats, 1))])[:4000]
    written = draft(DraftRequest(episodeNumber=data.episodeNumber, plan=text, context=data.context))
    return written.model_copy(update={'plan': chosen})


def patch(data: PatchRequest) -> PatchResponse:
    """선택 구간 하나를 수정 지시대로 고친 before/after 제안을 만든다."""
    after, meta = _write('patch', 2000, PATCH_INSTRUCTIONS, data)
    return PatchResponse(before=data.selection, after=after, **meta)


def pick_plan(data: PlanPickRequest) -> str | None:
    """계획 수정 모델 호출 1: 요청이 가리키는 계획 하나의 id. 하나로 정할 수 없으면 None이다. 목록에 있는지는 호출한 쪽이 확인한다."""
    _, result = agent_runtime.run('writing.plan_pick', '계획 선택', WritingFailure, PICK_PLAN_INSTRUCTIONS, data.model_dump(),
                                  prompt_name='writing_editing.plan_pick', max_tokens=1000, timeout=30, trace=data.model_dump(), schema=PlanPick)  # 추론 토큰도 한도에 포함된다(#867)
    return result.planId


def revise_plan(data: PlanReviseRequest) -> PlanRevision | None:
    """계획 수정 모델 호출 2: 고를 계획의 제목·내용만 지시대로 고친 변경 전·후 제안. 바뀐 것이 없으면(공백 차이만 포함) None이고, 한도를 넘으면 502이며 저장하지 않는다."""
    message, result = agent_runtime.run('writing.plan_revise', '계획 수정', WritingFailure, REVISE_PLAN_INSTRUCTIONS,
                                        data.model_dump(exclude={'revision'}), prompt_name='writing_editing.plan_revise', max_tokens=8000,
                                        timeout=90, trace=data.model_dump(exclude={'revision'}), schema=PlanText)
    # 공백만 다른 칸은 원문을 그대로 둔다. 제목만 고쳐도 내용 앞뒤 공백이 지워져 저장되지 않게 한다.
    keep = lambda new, old: old if new.strip() == old.strip() else new  # noqa: E731  바뀐 칸은 모델 원문 그대로(#717)
    before = PlanText(title=data.plan.title, content=data.content)
    # 제목만은 Content가 trim해 저장하므로 승인 카드도 저장될 제목을 보인다(#727)
    after = PlanText(title=keep(result.title.strip(), before.title), content=keep(result.content, before.content))
    if after == before:
        return None
    if not after.title.strip() or _utf16(after.title) > PLAN_TITLE_MAX or _utf16(after.content) > PLAN_CONTENT_MAX:
        raise WritingFailure(502, BAD_REVISION)
    return PlanRevision(planId=data.plan.id, kind=data.plan.kind, revision=data.revision, before=before, after=after, **agent_runtime.meta(message))


def _utf16(text: str) -> int:
    """Content(Kotlin String.length)와 같은 UTF-16 코드 단위 길이. 이모지 같은 보충 문자는 2단위다."""
    return len(text.encode('utf-16-le')) // 2


def _write(kind: str, max_tokens: int, instructions: str, data: DraftRequest | PatchRequest) -> tuple[str, dict]:
    # 허용 문맥(context)은 설정 본문을 담아 추적 결정 범위 밖이라 남기지 않는다.
    message, _ = agent_runtime.run('writing.generation', '집필', WritingFailure, instructions, data.model_dump(),
                                   prompt_name=f'writing_editing.{kind}', max_tokens=max_tokens, timeout=120,
                                   trace=data.model_dump(exclude={'context'}))
    text = message.text.strip()
    if not text:
        raise WritingFailure(502, '집필 모델 응답을 확인할 수 없습니다.')
    return text, agent_runtime.meta(message)
