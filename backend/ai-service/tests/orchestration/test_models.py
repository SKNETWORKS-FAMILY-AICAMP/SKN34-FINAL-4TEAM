import pytest
from pydantic import ValidationError

from app.orchestration.models import WritingInput

from .stubs import DRAFT, PATCH


@pytest.mark.parametrize('body', [{}, {**DRAFT, **PATCH}])
def test_writing_input_needs_exactly_one_of_draft_or_patch(body):
    with pytest.raises(ValidationError):
        WritingInput.model_validate(body)
