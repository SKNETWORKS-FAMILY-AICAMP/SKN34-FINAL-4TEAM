"""초기 세계관 추출 실패 경계. 상태 코드와 고정 실패 코드만 가진다."""


class ExtractionFailure(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.status = status
