"""심의 등급(19세 이용가 여부) 판별 내부 API 계약. 판별 항목·수준은 guidelines/youth-protection.md와 같다.

모델은 항목마다 표현 수준만 평가하고, 등급(verdict)은 이 파일의 문턱값 규칙으로 코드가 계산한다.
"""

from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Criterion = Literal['sexual', 'violence', 'crime', 'drug', 'gambling', 'language', 'other']
Level = Literal[0, 1, 2, 3]  # 0 없음 · 1 암시·생략 · 2 묘사 · 3 별표 2 개별 기준 해당
Verdict = Literal['adult', 'general', 'needsReview']


class RatingRequest(BaseModel):
    workId: str = Field(min_length=1, max_length=100)
    # 회차마다 모델을 한 번씩 부르므로 한 요청의 호출 수를 제한한다.
    episodes: list[Annotated[int, Field(ge=1)]] = Field(min_length=1, max_length=10)

    @field_validator('episodes')
    @classmethod
    def _distinct(cls, episodes: list[int]) -> list[int]:
        if len(set(episodes)) != len(episodes):
            raise ValueError('같은 회차를 두 번 판별하지 않습니다.')
        return episodes


class Assessment(BaseModel):
    """판별 항목 하나의 평가. quotes는 초안에서 그대로 옮긴 구절이며 수준 2 이상이면 하나 이상이다."""
    model_config = ConfigDict(extra='forbid')  # OpenAI strict 구조화 출력은 additionalProperties=false 스키마만 받는다
    criterion: Criterion
    level: Level
    quotes: list[str]
    rationale: str

    @model_validator(mode='after')
    def _quoted_from_level_two(self):
        if self.level >= 2 and not self.quotes:
            raise ValueError('묘사 수준 이상의 평가에는 근거 구절이 필요합니다.')
        return self


class RatingResult(BaseModel):
    """모델 structured output. 모든 판별 항목을 한 번씩 평가하고, 성인 이용가로도 허용되지 않는 표현이면 prohibited다."""
    model_config = ConfigDict(extra='forbid')
    prohibited: bool
    assessments: list[Assessment]

    @model_validator(mode='after')
    def _every_criterion_once(self):
        if sorted(a.criterion for a in self.assessments) != sorted(get_args(Criterion)):
            raise ValueError('판별 항목마다 한 번씩 평가해야 합니다.')
        if self.prohibited and not any(a.quotes for a in self.assessments if a.criterion == 'sexual'):
            raise ValueError('금지 표현에는 sexual 항목의 근거 구절이 필요합니다.')
        return self

    def evidence(self) -> list[str]:
        """판정을 좌우하는 근거 구절: 수준 2 이상 항목과, 금지 표현이면 sexual 항목의 구절."""
        return [q for a in self.assessments if a.level >= 2 or (self.prohibited and a.criterion == 'sexual') for q in a.quotes]

    def verdict(self) -> Verdict:
        """문턱값(2026-11-17 사용자 결정, F-ADULT-01 확정 전 초안): 금지 표현이나 수준 3은 19세, 최고 수준 2는 검토(AI가 다시 판정하지 않고 작가가 정한다, #439), 그 외 전체."""
        top = max(a.level for a in self.assessments)
        if self.prohibited or top == 3:
            return 'adult'
        return 'needsReview' if top == 2 else 'general'


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int


class EpisodeRating(BaseModel):
    """회차 판정. verdict가 None이면 그 회차는 판별하지 못했고 error에 이유가 있다."""
    episode: int
    revision: int
    verdict: Verdict | None
    signals: dict[str, int]  # 모델에 참고로 보낸 규칙 신호(profanityCount: 비속어 어근 출현 수)
    prohibited: bool = False
    assessments: list[Assessment] = []
    error: str | None = None
    model: str | None = None
    providerResponseId: str | None = None
    usage: Usage | None = None


class RatingResponse(BaseModel):
    """요청한 회차들의 묶음 판정. 하나라도 19세면 19세, 전부 전체 이용가일 때만 전체, 그 외(검토·판별 실패)는 검토다.

    요청하지 않은 회차는 보지 않았다. 등급 적용은 Content가 정한다.
    """
    workId: str
    verdict: Verdict
    prohibited: bool
    episodes: list[EpisodeRating]
