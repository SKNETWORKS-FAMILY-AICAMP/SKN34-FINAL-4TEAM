"""프롬프트별 기본 모델 조회 내부 API(#868)의 응답 계약."""
from pydantic import BaseModel


class DefaultModels(BaseModel):
    """프롬프트 이름 → 그 프롬프트의 버전이 모델을 고르지 않았을 때 AI 서비스가 실제로 쓰는 모델. 환경에 모델이 없으면 None이다(추측하지 않는다)."""
    models: dict[str, str | None]
