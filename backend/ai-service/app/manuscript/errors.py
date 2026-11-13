"""원고 임베딩·Q&A 실행 실패 경계."""


class ManuscriptFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
