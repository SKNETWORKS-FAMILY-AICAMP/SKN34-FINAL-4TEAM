"""회귀 평가·누설 판정 내부 API 계약(DEC-55, docs/design/operations-llmops-contract.md)."""

from typing import Annotated

from pydantic import BaseModel, Field


class EvaluationRequest(BaseModel):
    dataset: str = Field(min_length=1, max_length=100)  # Langfuse 평가 세트 이름. qa.로 시작하면 Ragas, 그 밖은 DeepEval GEval로 채점한다
    prompt: str = Field(min_length=1, max_length=100)  # Langfuse 프롬프트 이름
    version: int = Field(ge=1)  # 평가할 프롬프트 버전


class EvaluationAccepted(BaseModel):
    """평가를 받아들였다. 결과는 Langfuse의 이 이름의 Run(experiment)에 쌓이고 운영 서비스가 Langfuse에서 읽는다."""
    runName: str


class LeakCheckRequest(BaseModel):
    response: str = Field(min_length=1, max_length=100_000)
    # 독자에게 공개되지 않은 설정 카드 제목·미발행 회차 제목 등(운영이 글자 대조로 걸러 온 참조)
    references: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(min_length=1, max_length=200)


class LeakCheckResponse(BaseModel):
    suspected: bool
    reason: str
