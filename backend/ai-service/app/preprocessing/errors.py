"""회차 원고 전처리 실패 경계. 코드는 고정 문자열이며 원고·모델 응답·원문 예외를 담지 않는다."""


class PreprocessingFailure(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.status = status


def error_code(error: Exception) -> str:
    """로그·표식에 남기는 값: 우리 오류는 고정 코드, 그 밖의 예외는 종류 이름만이다(메시지에는 원고가 섞일 수 있다)."""
    return str(error) if isinstance(error, PreprocessingFailure) else type(error).__name__


class StageFailure(Exception):
    """그래프 단계 하나가 실패했다. Content progress의 stage·고정 사유 문구와 내부 코드(예외 종류)만 가진다."""

    def __init__(self, stage: str, reason: str, code: str):
        super().__init__(code)
        self.stage = stage
        self.reason = reason


# Content `preprocessing_progress`의 `failed`에 보내는 고정 사유 문구(단계별). 원고나 예외 내용은 넣지 않는다.
REASONS = {
    'extracting': '일부 회차의 추출에 실패했습니다.',
    'resolving': '등장 대상 정리에 실패했습니다.',
    'organizing': '인물·설정 정리에 실패했습니다.',
    'loading': '세계관 초안 적재에 실패했습니다.',
}
START_FAILED = '전처리를 시작하지 못했습니다.'
UNEXPECTED = '전처리 중 예기치 못한 오류가 발생했습니다.'
