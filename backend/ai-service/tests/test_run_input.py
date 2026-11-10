from app.runs.schemas import RunSelection
from pydantic import ValidationError
import pytest
from test_mock_retrievers import story,content
from test_run_service import binding

def test_unselected_legacy_checkpoint_binding_keeps_its_bytes(content):
    from hashlib import sha256
    from app.runs.graph import checkpoint_binding
    from app.runs.runner import ExecutionLimits
    _,grant,_=binding(content)
    limits=ExecutionLimits()
    expected=sha256((grant.main.model_dump_json(exclude={'selection'})+limits.model_dump_json()).encode()).hexdigest()
    assert checkpoint_binding(grant.main,limits)==expected

def test_selection_is_reference_only_and_utf16_range_is_nonempty():
    value=dict(start=0,end=2,revision=0,sourceHash='a'*64)
    assert RunSelection.model_validate(value).end==2
    for change in (dict(end=0),dict(sourceHash='secret'),dict(text='private manuscript')):
        with pytest.raises(ValidationError):
            RunSelection.model_validate(value|change)
