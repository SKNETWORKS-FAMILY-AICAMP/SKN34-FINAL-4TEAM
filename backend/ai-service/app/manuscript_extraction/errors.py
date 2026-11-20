"""회차 원고 전처리 실패 경계. 코드는 고정 문자열이며 원고·모델 응답·원문 예외를 담지 않는다."""


class PreprocessingFailure(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.status = status
