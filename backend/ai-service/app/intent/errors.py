"""Intent Router 실행 실패 경계. 모델 실패·규격 밖 응답은 실행하지 않는 쪽으로 닫는다.

`IntentFailure` 메시지는 작가 화면에 그대로 보이는 서버 고정 문구다. 제공사 오류 본문·입력·키는 넣지 않는다(#413).
"""

ROUTER_FAILED_MESSAGE = '요청 분류에 실패했습니다.'


class IntentFailure(Exception):
    def __init__(self, message: str = ROUTER_FAILED_MESSAGE):
        super().__init__(message)
