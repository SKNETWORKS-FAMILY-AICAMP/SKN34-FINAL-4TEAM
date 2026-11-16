"""검사 종류 하나에 대한 구조화 출력 1회로 지적 목록을 받는다(create_agent + 공통 미들웨어, app/agent_runtime.py)."""

from app import agent_runtime
from app.review.errors import ReviewFailure
from app.review.models import ReviewResult
from app.review.prompt import INSTRUCTIONS


def review(check: str, draft: str, settings: list[dict]) -> tuple[ReviewResult, dict]:
    """초안과 허용 설정으로 지적을 만들고 모델·응답 ID·사용량을 함께 돌려준다."""
    # 원고 본문은 팀 결정(2026-11-13)으로 추적에 남기고 설정 본문은 참조만 남긴다.
    trace = {'check': check, 'draft': draft, 'settings': [s['ref'] for s in settings]}
    # 출력 한도는 추론 토큰을 함께 센다. 40,000자 초안의 많은 지적이 잘리지 않을 만큼 둔다.
    message, result = agent_runtime.run('review.generation', '검수', ReviewFailure, INSTRUCTIONS[check],
                                        {'check': check, 'draft': draft, 'settings': settings},
                                        max_tokens=16000, timeout=120, trace=trace, schema=ReviewResult)
    return result, agent_runtime.meta(message)
