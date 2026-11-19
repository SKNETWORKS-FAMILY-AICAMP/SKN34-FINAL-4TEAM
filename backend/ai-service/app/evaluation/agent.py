"""평가 대상 기능 실행: 지정한 프롬프트 버전(지시문)으로 평가 항목의 입력을 모델에 한 번 보내 응답 본문을 받는다(app/agent_runtime.py)."""

from app import agent_runtime
from app.evaluation.errors import EvaluationFailure


def generate(instructions: str, data: dict) -> str:
    """업무 Agent와 같은 실행 틀(구조화 출력 없음)로 항목 입력을 처리한 응답 텍스트. 추적에는 항목 입력을 남긴다(공공 저작물 평가 세트)."""
    message, _ = agent_runtime.run('evaluation.generate', '회귀 평가', EvaluationFailure, instructions, data,
                                   max_tokens=8000, timeout=120, trace=data)
    text = message.text
    if not text.strip():
        raise EvaluationFailure(502, '평가 대상 모델 응답이 비어 있습니다.')
    return text
