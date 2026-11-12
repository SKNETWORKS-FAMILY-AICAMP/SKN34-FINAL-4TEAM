"""집필 AI Intent Router(#55): 작가 요청을 입력 가드레일로 거른 뒤 등록된 7개 기능의 실행 순서나 확인 질문으로 분류한다.

OpenAI Decisions(`gpt-6-luna`)에 고정 선택지 질문만 보내므로 모델은 등록된 값 중 하나만 고를 수 있고,
작가에게 보이는 거절·확인 문구는 서버 고정 문구다. 권한·작품/Fork/회차 범위는 Content(`QaScopeService` 등)가
확정한 값만 쓴다. 결과에는 범위·대상·도구 필드가 없어 입력 문장이 그 결과를 바꿀 수 없다.
"""

from pydantic import ValidationError

from app.intent import agent
from app.intent.errors import IntentFailure
from app.intent.models import IntentResult, IntentStep
from app.intent.prompt import CLARIFY_MESSAGE, FEATURES, FINDING_FEATURES, GUARD_QUESTION, REJECT_MESSAGES, ROUTE_QUESTIONS


def route(request: str, operation: str | None = None, materials: list[str] = ()) -> IntentResult:
    """UI에서 고른 operation이 있으면 가드레일만 묻고 그 기능으로 확정한다. 모델 실패·규격 밖 응답은 IntentFailure."""
    if operation is not None:
        IntentStep(feature=operation, when='always')  # 등록 밖 값은 모델 호출 전에 ValidationError(ValueError)
    answers = agent.decide(request, list(materials), [GUARD_QUESTION] if operation else ROUTE_QUESTIONS)
    try:
        if answers['guard'] != 'none':
            return IntentResult(status='rejected', reason=answers['guard'], message=REJECT_MESSAGES[answers['guard']])
        if operation:
            return IntentResult(status='route', steps=[IntentStep(feature=operation, when='always')])
        chosen = sorted((answers[f], f) for f in FEATURES if answers[f] != 'none')  # 순서 값은 한 자리(1~3)라 문자열 정렬이 곧 순서다.
        steps = [IntentStep(feature=f, when='if_issues_found' if p.endswith('_if_issues') else 'always') for p, f in chosen]
        # 기능별 답이 독립이라 상대 순서만 쓴다. 한 순서에 여러 기능이 오거나, 조건부 작업 앞에 문제를 찾는 작업이 없으면
        # 모호하다고 보고 확인을 묻는다.
        if (answers['clarity'] == 'ambiguous' or not steps or len({p[0] for p, _ in chosen}) != len(chosen)
                or any(s.when == 'if_issues_found' and (i == 0 or steps[i - 1].feature not in FINDING_FEATURES)
                       for i, s in enumerate(steps))):
            return IntentResult(status='clarify', message=CLARIFY_MESSAGE)
        return IntentResult(status='route', steps=steps)
    except (KeyError, ValidationError):
        raise IntentFailure() from None
