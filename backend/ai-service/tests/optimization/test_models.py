"""POST /internal/v1/optimizations 요청 DTO."""

import pytest
from pydantic import ValidationError

from app.optimization.models import OptimizationAccepted, OptimizationRequest


def test_a_request_has_the_prompt_version_and_the_call_budget():
    request = OptimizationRequest(prompt='character_simulation.act', version=2, maxMetricCalls=150)
    assert (request.prompt, request.version, request.maxMetricCalls) == ('character_simulation.act', 2, 150)
    assert request.model_dump() == {'prompt': 'character_simulation.act', 'version': 2, 'maxMetricCalls': 150}   # Celery 태스크에 JSON으로 실린다


@pytest.mark.parametrize('bad', [{'maxMetricCalls': 0}, {'maxMetricCalls': 501}, {'version': 0}, {'prompt': ''}, {'prompt': 'x' * 101}, {'extra': 1}])
def test_a_request_outside_the_contract_is_rejected(bad):
    with pytest.raises(ValidationError):
        OptimizationRequest(**{'prompt': 'character_simulation.act', 'version': 1, 'maxMetricCalls': 150, **bad})


@pytest.mark.parametrize('budget', [1, 500])
def test_the_budget_limits_are_inclusive(budget):
    assert OptimizationRequest(prompt='p', version=1, maxMetricCalls=budget).maxMetricCalls == budget


def test_the_accepted_answer_is_just_accepted_true():
    assert OptimizationAccepted().model_dump() == {'accepted': True}
