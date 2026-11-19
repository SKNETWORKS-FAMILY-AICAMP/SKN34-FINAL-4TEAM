"""회차 원고 전처리 실행 틀의 실패 경계."""


class ReportFailure(Exception):
    """Content에 진행·실패를 보고하지 못했다. 메시지는 고정 문구이며 입력·원고를 담지 않는다."""
