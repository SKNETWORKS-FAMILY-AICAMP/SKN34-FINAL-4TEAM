"""회차 자료 하나에 대한 구조화 출력 1회로 판별 항목별 수준과 근거를 받는다(create_agent + 공통 미들웨어, app/agent_runtime.py)."""

from app import agent_runtime
from app.rating.errors import RatingFailure
from app.rating.models import RatingResult
from app.rating.prompt import INSTRUCTIONS


def rate(episode: dict) -> tuple[RatingResult, dict]:
    """회차 자료(제목·작가 메모·초안·공개된 인물 설정·규칙 신호)를 심의 기준으로 평가하고 모델·응답 ID·사용량을 함께 돌려준다."""
    # 원고 본문은 팀 결정(2026-11-13)으로 추적에 남기고 인물 설정 본문은 참조만 남긴다. 심의 기준은 저장소 문서라 남기지 않는다.
    trace = {**episode, 'characters': [c['ref'] for c in episode['characters']]}
    # 출력 한도는 추론 토큰을 함께 센다. 일곱 항목의 근거·이유가 잘리지 않을 만큼 검수와 같게 둔다.
    message, result = agent_runtime.run('rating.generation', '심의 판별', RatingFailure, INSTRUCTIONS, episode,
                                        max_tokens=16000, timeout=120, trace=trace, schema=RatingResult)
    return result, agent_runtime.meta(message)
