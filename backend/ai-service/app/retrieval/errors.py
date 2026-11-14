"""Retrieval 도구 실패 경계."""


class RetrievalFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class RetrievalUnavailable(RetrievalFailure):
    """Content가 원고 검색을 쓸 수 없다고(503) 답했다. 원고 발췌가 보조 근거인 호출자는 발췌 없이 진행할지 정할 수 있다.

    우리 쪽 설정 누락·연결 실패는 같은 503이어도 이 오류가 아니다.
    """
