"""Decision Guard 판정과 OpenAI Decisions 응답 계약."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.intent.prompt import FEATURES

Feature = Literal[tuple(FEATURES)]
# unsafe는 가드레일을 통과하지 않은 채 모델이 질문을 거부(refusal)한 경우다. 실행하지 않는 쪽으로 닫는다.
Reason = Literal['greeting', 'out_of_scope', 'inappropriate_edit', 'prompt_injection', 'sensitive_data', 'unsafe']


class DecisionResult(BaseModel):
    """턴당 한 번의 판정(#473). 거절이면 reason만, 통과면 이번 요청에 필요한 기능(고정 순서)만 있다. 순서·조건은 메인 에이전트가 정한다."""
    model_config = ConfigDict(extra='forbid')
    allowed: bool
    reason: Reason | None = None
    capabilities: list[Feature] = []

    @model_validator(mode='after')
    def consistent(self):
        if self.allowed == (self.reason is not None) or (not self.allowed and self.capabilities):
            raise ValueError('판정 결과 형식이 맞지 않습니다.')
        return self


class DecisionAnswer(BaseModel):
    type: Literal['choice', 'refusal']
    name: str
    choice: str | None = None


class Decision(BaseModel):
    answers: list[DecisionAnswer]
