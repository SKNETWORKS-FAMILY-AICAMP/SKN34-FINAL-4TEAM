"""웹 조사 실행 실패 경계."""


class ResearchFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
