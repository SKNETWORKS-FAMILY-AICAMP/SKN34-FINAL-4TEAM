"""설정집 검토 모델 호출 1회: 구조화 출력으로 지적 목록을 받는다(create_agent + 공통 미들웨어, app/agent_runtime.py)."""

from app import agent_runtime
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import WorldReviewRequest, WorldReviewResult
from app.world_review.prompt import INSTRUCTIONS


def review(data: WorldReviewRequest) -> tuple[WorldReviewResult, dict]:
    """설정집 스냅샷으로 지적을 만들고 모델·응답 ID·사용량을 함께 돌려준다."""
    # 설정 본문(카드·인물 문서·세계관 설명)은 추적 결정 범위 밖이라 카드·관계 id 참조만 남긴다.
    trace = {'cards': [c.id for c in data.cards], 'relationships': [r.id for r in data.relationships]}
    # 출력 한도는 추론 토큰을 함께 센다. 카드 한 칸 분량(3,000자)의 수정안을 여러 개 담아도 잘리지 않을 만큼 둔다.
    # timeout은 Content의 AI 클라이언트 read timeout(75초)보다 짧게 둔다. 그래야 AI가 먼저 실패(503)를 돌려주고 Content는 자기 75초 초과만 504로 본다.
    message, result = agent_runtime.run('world_review.generation', '설정집 검토', WorldReviewFailure, INSTRUCTIONS,
                                        data.model_dump(exclude_none=True), max_tokens=32000, timeout=60, trace=trace,
                                        schema=WorldReviewResult)
    return result, agent_runtime.meta(message)
