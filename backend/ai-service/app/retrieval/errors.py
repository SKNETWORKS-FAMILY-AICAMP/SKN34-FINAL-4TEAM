"""Retrieval 도구 실패 경계."""


class RetrievalFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
