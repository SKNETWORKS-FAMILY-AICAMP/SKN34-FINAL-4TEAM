"""Intent Router 결과와 OpenAI Decisions 응답 계약."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.intent.prompt import FEATURES

Feature = Literal[tuple(FEATURES)]
# unsafe는 가드레일을 통과하지 않은 채 모델이 질문을 거부(refusal)한 경우다. 실행하지 않는 쪽으로 닫는다.
Reason = Literal['greeting', 'out_of_scope', 'inappropriate_edit', 'prompt_injection', 'sensitive_data', 'unsafe']


class IntentStep(BaseModel):
    model_config = ConfigDict(extra='forbid')
    feature: Feature
    when: Literal['always', 'if_issues_found']


class IntentResult(BaseModel):
    """route면 steps를 순서대로 실행, clarify·rejected면 아무 기능도 실행하지 않고 message를 그대로 보여 준다."""
    model_config = ConfigDict(extra='forbid')
    status: Literal['route', 'clarify', 'rejected']
    steps: list[IntentStep] = []
    reason: Reason | None = None
    message: str | None = None

    @model_validator(mode='after')
    def consistent(self):
        if self.status == 'route':
            valid = bool(self.steps) and self.reason is None and self.message is None
        else:
            valid = not self.steps and bool(self.message) and (self.reason is not None) == (self.status == 'rejected')
        if not valid:
            raise ValueError(f'{self.status} 결과 형식이 맞지 않습니다.')
        return self


class DecisionAnswer(BaseModel):
    type: Literal['choice', 'refusal']
    name: str
    choice: str | None = None


class Decision(BaseModel):
    answers: list[DecisionAnswer]
