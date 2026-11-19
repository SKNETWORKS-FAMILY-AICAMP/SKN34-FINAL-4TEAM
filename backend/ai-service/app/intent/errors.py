"""Intent Router 실행 실패 경계. 모델 실패·규격 밖 응답은 실행하지 않는 쪽으로 닫는다.

메시지는 작가 화면에 그대로 보이는 서버 고정 문구다. 제공사 오류 본문·입력·키는 넣지 않는다(#413).
"""

ROUTER_FAILED_MESSAGE = '요청 분류에 실패했습니다.'
QUOTA_MESSAGE = 'AI 제공사 크레딧이 부족해 요청을 처리하지 못했습니다.'
RATE_LIMIT_MESSAGE = 'AI 제공사 요청 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.'
AUTH_MESSAGE = 'AI 제공사 인증에 실패했습니다. API 키 설정을 확인해 주세요.'
TIMEOUT_MESSAGE = 'AI 제공사 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
CONNECTION_MESSAGE = 'AI 제공사에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'


class IntentFailure(Exception):
    def __init__(self, message: str = ROUTER_FAILED_MESSAGE):
        super().__init__(message)
