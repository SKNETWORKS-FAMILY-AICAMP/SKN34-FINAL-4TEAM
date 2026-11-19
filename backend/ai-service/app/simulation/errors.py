"""인물 시뮬레이션 실패 경계. 입력·원고·모델 응답은 메시지에 넣지 않는다."""


PROMPT_UNAVAILABLE = '시뮬레이션 프롬프트를 불러올 수 없습니다.'  # Langfuse 프롬프트(character_simulation.*)를 읽을 수 없고 캐시도 없다


class SimulationFailure(Exception):
    """장면을 시작하지 못했거나 모델·Content 호출이 실패했다. 상태 코드와 고정 메시지만 가진다."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
