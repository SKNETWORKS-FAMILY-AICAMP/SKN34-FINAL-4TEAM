"""AI 자율 연재 실행 실패 경계. 상태 코드와 고정 문구만 가진다(입력·원고·모델 응답은 담지 않는다)."""

CODES = {402: 'CREDIT_LIMIT_EXCEEDED', 422: 'SERIAL_REVIEW_FAILED'}  # 계약: Content가 상태 코드와 함께 구분하는 코드


class SerialFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.code = status, CODES.get(status)
