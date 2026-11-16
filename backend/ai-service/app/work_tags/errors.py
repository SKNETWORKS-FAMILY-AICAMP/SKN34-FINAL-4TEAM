"""작품 장르·키워드 추천 실패 경계."""


class SuggestionFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
