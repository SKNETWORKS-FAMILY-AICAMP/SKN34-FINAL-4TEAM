"""Intent Router 실행 실패 경계. 모델 실패·규격 밖 응답은 실행하지 않는 쪽으로 닫는다."""


class IntentFailure(Exception):
    pass
