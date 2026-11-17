"""심의 등급 판별 실패 경계."""


class RatingFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
