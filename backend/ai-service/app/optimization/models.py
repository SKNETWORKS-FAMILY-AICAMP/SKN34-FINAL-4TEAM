"""프롬프트 자동 개선 내부 API 계약(#823, docs/design/operations-llmops-contract.md '프롬프트 자동 개선')."""

from pydantic import BaseModel, ConfigDict, Field


class OptimizationRequest(BaseModel):
    """운영이 접수시키는 자동 개선 한 건. Celery 태스크(optimization.run)에 JSON으로 실린다."""
    model_config = ConfigDict(extra='forbid')

    prompt: str = Field(min_length=1, max_length=100)  # Langfuse 프롬프트 이름(service.OPTIMIZABLE에 있어야 한다)
    version: int = Field(ge=1)  # 개선의 기준(시드)이 되는 프롬프트 버전
    maxMetricCalls: int = Field(ge=1, le=500)  # GEPA의 평가 호출 상한(항목 하나를 한 후보로 생성·채점하면 1회). 운영이 기본 150을 채워 보낸다


class OptimizationAccepted(BaseModel):
    """접수했다. 결과는 trace prompt_optimization과 새 프롬프트 버전·평가 Run으로 남고 운영 화면이 Langfuse에서 읽는다."""
    accepted: bool = True
