"""작품 장르·키워드 후보를 구조화 출력 1회로 제안받는다(create_agent + 공통 미들웨어, app/agent_runtime.py)."""

from app import agent_runtime
from app.work_tags.errors import SuggestionFailure
from app.work_tags.models import Input, Output
from app.work_tags.prompt import INSTRUCTIONS


def propose(data: Input) -> Output:
    """모델 출력의 형식만 검증해 반환한다. 승인 목록·개수 검증은 service가 한다."""
    # 원고 본문은 추적에 남기지 않고 작품 제목과 회차 번호만 남긴다.
    trace = {'title': data.title, 'episodes': [episode.number for episode in data.episodes]}
    # 장르 최대 5개와 키워드 20개가 한국어 토큰으로 늘어나도 잘리지 않게 여유를 둔다.
    _, result = agent_runtime.run('work_tags.generation', '장르·키워드 추천', SuggestionFailure, INSTRUCTIONS, data.model_dump(),
                                  max_tokens=2000, timeout=30, trace=trace, schema=Output)
    return result
