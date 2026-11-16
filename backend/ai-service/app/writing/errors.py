"""새 원고·부분 수정 실행 실패 경계."""


class WritingFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
