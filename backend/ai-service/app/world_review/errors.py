"""설정집 AI 검토 실행 실패 경계."""


class WorldReviewFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
