"""#372 입출력 계약. 입력 한도와 모델 출력 형식(strict schema)을 확인한다."""
import json

import pytest

from app.work_tags.models import Input, Output

from .stubs import data


@pytest.mark.parametrize('overrides', [{'episodes': []}, {'allowedGenres': ['고전', '고전']}, {'title': ''}, {'extra': 1}])
def test_input_contract(overrides):
    with pytest.raises(ValueError):
        Input.model_validate(data(**overrides))


def test_output_schema_has_no_string_length_or_pattern_limits():
    """길이·패턴 제약은 OpenAI strict schema에서 거절될 수 있어 두지 않고 service가 검증한다."""
    schema = json.dumps(Output.model_json_schema())
    assert not any(key in schema for key in ('minLength', 'maxLength', 'pattern', 'minItems', 'maxItems'))


def test_output_schema_has_no_saved_state():
    assert set(Output.model_json_schema()['properties']) == {'schemaVersion', 'genres', 'hashtags'}
