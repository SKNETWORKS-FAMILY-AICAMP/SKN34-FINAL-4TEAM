from typing import get_args

import pytest
from pydantic import ValidationError

from app.rating.models import Criterion, RatingRequest, RatingResult

from .stubs import result


@pytest.mark.parametrize('episodes', [[], [0], list(range(1, 12)), [1, 1]])
def test_request_needs_one_to_ten_distinct_positive_episodes(episodes):
    with pytest.raises(ValidationError):
        RatingRequest(workId='work-1', episodes=episodes)


def rows(**overrides):
    """항목마다 수준 0인 평가 목록. overrides는 criterion → 바꿀 필드이며 없는 criterion이면 덧붙인다."""
    table = {c: {'criterion': c, 'level': 0, 'quotes': [], 'rationale': '근거'} for c in get_args(Criterion)}
    for criterion, fields in overrides.items():
        table[criterion] = {**table.get(criterion, {'criterion': criterion, 'quotes': [], 'rationale': '근거'}), **fields}
    return list(table.values())


@pytest.mark.parametrize('assessments', [
    rows()[:-1],  # 빠진 항목
    rows() + rows()[:1],  # 같은 항목 두 번
    rows(horror={'level': 3, 'quotes': ['구절']}),  # 기준에 없는 항목
    rows(violence={'level': 4, 'quotes': ['구절']}),  # 없는 수준
    rows(violence={'level': 2}),  # 근거 구절 없는 묘사 수준
])
def test_result_must_assess_every_criterion_once_with_quotes_from_level_two(assessments):
    with pytest.raises(ValidationError):
        RatingResult.model_validate({'prohibited': False, 'assessments': assessments})


@pytest.mark.parametrize('assessments', [
    rows(),
    rows(violence={'level': 2, 'quotes': ['구절']}),  # 다른 항목의 구절은 sexual 근거가 아니다(#456)
])
def test_prohibited_needs_a_sexual_quote(assessments):
    with pytest.raises(ValidationError):
        RatingResult.model_validate({'prohibited': True, 'assessments': assessments})


@pytest.mark.parametrize('level, prohibited, verdict', [
    (3, False, 'adult'), (2, False, 'needsReview'), (1, False, 'general'), (0, False, 'general'), (1, True, 'adult')])
def test_verdict_is_computed_from_the_highest_level(level, prohibited, verdict):
    assert result(level, criterion='sexual', prohibited=prohibited).verdict() == verdict
