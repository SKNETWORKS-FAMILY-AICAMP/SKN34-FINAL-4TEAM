"""집필 AI Decision Guard(#473, #55 Intent Router 대체): 작가 요청을 입력 가드레일로 거른 뒤 서비스 범위와 이번 요청에 필요한 기능을 판정한다.

OpenAI Decisions(`gpt-6-luna`)에 고정 선택지 질문(guard + 기능별 yes/no)만 보내므로 모델은 등록된 값 중 하나만 고를 수 있고,
작가에게 보이는 거절·확인 문구는 서버 고정 문구다. 순서·조건·검사 종류·작업 종류는 묻지 않는다(메인 에이전트가 정한다).
권한·작품/Fork/회차 범위는 Content가 확정한 값만 쓴다. 판정에는 범위·대상·도구 인자가 없어 입력 문장이 범위를 넓힐 수 없다.
"""

import re

from app.intent import agent
from app.intent.errors import IntentFailure
from app.intent.models import DecisionResult
from app.intent.prompt import CAPABILITY_ALIASES, CAPABILITY_NAMES, DECISION_QUESTIONS, FEATURES, GUARD_QUESTION

_PLAIN = re.compile(r'[\s·ㆍ・]')  # 보기 이름을 알아볼 때 공백·가운뎃점(· ㆍ ・) 차이는 무시한다
_BY_NAME = {_PLAIN.sub('', name): feature for feature, name in CAPABILITY_NAMES.items()}
_BY_NAME.update({_PLAIN.sub('', name): feature for name, feature in CAPABILITY_ALIASES.items()})


def clarified(request: str) -> str | None:
    """작가가 되묻기(CLARIFY_MESSAGE)의 기능 보기 이름으로 답했으면 그 기능, 아니면 None. 호출자가 직전 턴이 되묻기였는지 확인한다."""
    return _BY_NAME.get(_PLAIN.sub('', request))


def judge(request: str, operation: str | None = None, materials: list[str] = (), history: list[str] = ()) -> DecisionResult:
    """UI에서 고른 operation이 있으면 가드레일만 묻고 그 기능 하나로 확정한다. 모델 실패·규격 밖 응답은 IntentFailure.

    자유 입력은 이번 요청만으로 먼저 판정한다. 이전 요청을 같이 보내면 이미 끝난 요청에 판정이 끌려가기 때문이다. 고른 기능이 없을 때만
    history(같은 대화의 이전 요청)를 붙여 한 번 더 묻는다. "그거 고쳐줘" 같은 지칭은 이전 요청이 있어야 풀린다.
    """
    if operation is not None and operation not in FEATURES:
        raise ValueError('등록되지 않은 기능입니다.')  # 모델 호출 전에 거절한다
    if operation:
        return _decide(request, materials, operation, history)
    first = _decide(request, materials, None, ())
    return _decide(request, materials, None, history) if first.allowed and not first.capabilities and history else first


def _decide(request: str, materials: list[str], operation: str | None, history: list[str]) -> DecisionResult:
    answers = agent.decide(request, list(materials), [GUARD_QUESTION] if operation else DECISION_QUESTIONS, list(history))
    if answers['guard'] != 'none':
        return DecisionResult(allowed=False, reason=answers['guard'])
    try:
        return DecisionResult(allowed=True, capabilities=[operation] if operation else [f for f in FEATURES if answers[f] == 'yes'])
    except KeyError:
        raise IntentFailure() from None
