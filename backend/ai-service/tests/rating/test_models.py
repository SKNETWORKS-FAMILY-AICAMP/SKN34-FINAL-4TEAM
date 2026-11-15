import pytest
from pydantic import ValidationError

from app.rating.models import RatingRequest, RatingResult


@pytest.mark.parametrize('episodes', [[], [0], list(range(1, 12)), [1, 1]])
def test_request_needs_one_to_ten_distinct_positive_episodes(episodes):
    with pytest.raises(ValidationError):
        RatingRequest(workId='work-1', episodes=episodes)


@pytest.mark.parametrize('data', [
    {'adult': True, 'reasons': []},  # 근거 없는 19세 판정
    {'adult': False, 'reasons': [{'criterion': 'sexual', 'quote': '구절', 'explanation': '이유'}]},  # 근거 있는 전체 이용가
    {'adult': True, 'reasons': [{'criterion': 'horror', 'quote': '구절', 'explanation': '이유'}]},  # 기준에 없는 항목
])
def test_result_reasons_must_match_the_verdict(data):
    with pytest.raises(ValidationError):
        RatingResult.model_validate(data)
