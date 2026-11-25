"""설정집 검토·보강·영향 분석 모델 호출 1회씩: 구조화 출력으로 결과를 받는다(create_agent + 공통 미들웨어, app/agent_runtime.py)."""

from pydantic import BaseModel

from app import agent_runtime
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import EnrichResult, FillRequest, FillResult, ImpactResult, WorldReviewRequest, WorldReviewResult
from app.world_review.prompt import ENRICH_INSTRUCTIONS, FILL_INSTRUCTIONS, IMPACT_INSTRUCTIONS, INSTRUCTIONS


def _run(name: str, label: str, prompt_name: str, instructions: str, data: dict, trace: dict, schema: type[BaseModel]) -> tuple[BaseModel, dict]:
    """모델 호출 1회로 구조화 결과와 모델·응답 ID·사용량을 돌려준다.

    출력 한도는 추론 토큰을 함께 센다. 카드 한 칸 분량(3,000자)의 수정안을 여러 개 담아도 잘리지 않을 만큼 둔다.
    timeout은 Content의 AI 클라이언트 read timeout(75초)보다 짧게 둔다. 그래야 AI가 먼저 실패(503)를 돌려주고 Content는 자기 75초 초과만 504로 본다.
    """
    message, result = agent_runtime.run(name, label, WorldReviewFailure, instructions, data, prompt_name=prompt_name, max_tokens=32000, timeout=60,
                                        trace=trace, schema=schema)
    return result, agent_runtime.meta(message)


def review(data: WorldReviewRequest) -> tuple[WorldReviewResult, dict]:
    """설정집 스냅샷으로 지적을 만든다. 설정 본문(카드·인물 문서·세계관 설명)은 추적 결정 범위 밖이라 카드·관계 id 참조만 남긴다."""
    return _run('world_review.generation', '설정집 검토', 'world_review.check', INSTRUCTIONS, data.model_dump(exclude_none=True), data.refs(), WorldReviewResult)


def enrich(request: str, data: WorldReviewRequest) -> tuple[EnrichResult, dict]:
    """작가 요청이 가리킨 기존 카드의 본문·인물 문서를 보강한 수정안(1~5칸)과 설명을 만든다. 추적에는 요청 문장과 카드·관계 id만 남긴다."""
    return _run('world_review.enrich.generation', '설정 보강', 'world_review.enrich', ENRICH_INSTRUCTIONS,
                {'request': request, 'world': data.model_dump(exclude_none=True)}, {'request': request, **data.refs()}, EnrichResult)


def impact(request: str, data: WorldReviewRequest, context: dict, plans: list[dict]) -> tuple[ImpactResult, dict]:
    """바꾸려는 설정·사건의 영향을 설정집 스냅샷·Content가 허용한 원고 문맥·계획(정본 아님)에서 분석한다."""
    return _run('world_review.impact.generation', '설정 영향 분석', 'world_review.impact', IMPACT_INSTRUCTIONS,
                {'request': request, 'world': data.model_dump(exclude_none=True), 'manuscript': context, 'plans': plans},
                {'request': request, **data.refs()}, ImpactResult)


def fill(data: FillRequest) -> tuple[FillResult, dict]:
    """한 인물의 비어 있는 IDENTITY·SOUL을 채울 근거 문장을 원고 발췌에서 고른다. 카드 id는 모델에 보내지 않고, 추적에는 카드 id·대상·회차 번호만 남긴다."""
    return _run('world_review.fill.generation', '인물 문서 채우기', 'world_review.fill', FILL_INSTRUCTIONS, data.model_dump(exclude={'cardId'}), data.refs(),
                FillResult)
