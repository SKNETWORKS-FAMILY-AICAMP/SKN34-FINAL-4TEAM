"""Content가 확인한 발췌만 근거로 구조화 답변을 1회 생성한다(create_agent + 공통 미들웨어, app/agent_runtime.py)."""

from app import agent_runtime, tracing
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import AnswerRequest, AnswerResponse
from app.story_qa.prompt import QA_INSTRUCTIONS


def answer(data: AnswerRequest) -> AnswerResponse:
    """전달받은 발췌만 근거로 주장과 답할 수 없는 부분을 구조화해 생성한다. 설정·관계 발췌는 추적에 참조만 남긴다."""
    trace = {'question': data.question, 'excerpts': tracing.excerpts(data.excerpts),
             'history': [turn.model_dump() for turn in data.history]}
    _, result = agent_runtime.run('qa.generation', 'Q&A', StoryQaFailure, QA_INSTRUCTIONS, data.model_dump(),
                                  max_tokens=1400, timeout=40, trace=trace, schema=AnswerResponse)
    return result
