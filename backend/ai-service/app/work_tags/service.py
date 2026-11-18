"""작품 장르·키워드 추천. 작품 정본에 접근하지 않고 모델 제안을 Content가 준 규칙으로만 검증한다."""
import re

from app.work_tags import agent
from app.work_tags.errors import SuggestionFailure
from app.work_tags.models import Input, Output


HASHTAG = re.compile(r'^[^#\s]{1,30}$')  # '#'와 공백 없이 30자 이하


def checked_output(data: Input, proposed: Output) -> Output:
    """승인 목록 밖 장르, 상한을 넘거나 겹치거나 장르 이름을 그대로 반복한 키워드가 하나라도 있으면 보정하지 않고 전체 결과를 거부한다."""
    genres, hashtags = proposed.genres, proposed.hashtags
    if not genres or len(genres) > data.maxGenres or len(set(genres)) != len(genres):
        raise SuggestionFailure(502, '장르 후보의 개수나 중복이 규칙을 벗어났습니다.')
    if not set(genres) <= set(data.allowedGenres):
        raise SuggestionFailure(502, '승인 목록에 없는 장르 후보가 있습니다.')
    if not all(HASHTAG.fullmatch(tag) for tag in hashtags):
        raise SuggestionFailure(502, '키워드 후보의 형식이 규칙을 벗어났습니다.')
    if len(hashtags) > data.maxHashtags or len(set(hashtags)) != len(hashtags) or set(hashtags) & set(data.allowedGenres):
        raise SuggestionFailure(502, '키워드 후보의 개수·중복·장르 반복이 규칙을 벗어났습니다.')
    return proposed


def suggest(data: Input) -> Output:
    """모델 제안을 받아 Content 규칙을 지키는 후보만 반환한다."""
    return checked_output(data, agent.propose(data))
