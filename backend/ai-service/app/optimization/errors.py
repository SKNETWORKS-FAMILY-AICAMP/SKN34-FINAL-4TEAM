"""프롬프트 자동 개선 실패 경계. 메시지는 고정 문구라 trace·로그에 그대로 남길 수 있다(입력·응답 본문을 넣지 않는다)."""


class OptimizationFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
