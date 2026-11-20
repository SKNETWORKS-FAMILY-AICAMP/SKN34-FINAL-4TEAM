"""회귀 평가·누설 판정 실패 경계."""


class EvaluationFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
