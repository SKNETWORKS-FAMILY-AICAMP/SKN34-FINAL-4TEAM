import pytest
from pydantic import ValidationError

from app.evaluation.models import EvaluationRequest, LeakCheckRequest


@pytest.mark.parametrize('bad', [{'dataset': '', 'prompt': 'p', 'version': 1}, {'dataset': 'd', 'prompt': '', 'version': 1}, {'dataset': 'd', 'prompt': 'p', 'version': 0}])
def test_evaluation_request_needs_dataset_prompt_and_a_positive_version(bad):
    with pytest.raises(ValidationError):
        EvaluationRequest(**bad)


@pytest.mark.parametrize('bad', [{'response': '', 'references': ['카드']}, {'response': '응답', 'references': []}, {'response': '응답', 'references': ['']}])
def test_leak_check_needs_a_response_and_non_blank_references(bad):
    with pytest.raises(ValidationError):
        LeakCheckRequest(**bad)


def test_leak_check_question_is_optional_and_bounded():
    request = {'response': '응답', 'references': ['카드']}

    assert LeakCheckRequest(**request).question is None
    assert LeakCheckRequest(**request, question='사용자 질문').question == '사용자 질문'
    with pytest.raises(ValidationError):
        LeakCheckRequest(**request, question='가' * 100_001)
