"""인물 시뮬레이션 실패 경계. 입력·원고·모델 응답은 메시지에 넣지 않는다."""


class SimulationFailure(Exception):
    """장면을 시작하지 못했거나 모델·Content 호출이 실패했다. 상태 코드와 고정 메시지만 가진다."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class SimulationStopped(Exception):
    """장면이 끝까지 가지 못했다(검사 반복 위반·비트 거부·턴 한도·중간 실패).

    그때까지의 결과(result)를 보존하되 단계는 failed로 보여 준다. 부분 장면을 완료로 꾸미지 않는다(UC-09 E2).
    """

    def __init__(self, message: str, result):
        super().__init__(message)
        self.result = result
