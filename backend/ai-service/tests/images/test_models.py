import pytest
from pydantic import ValidationError
from app.images.models import ClaimResponse

@pytest.mark.parametrize("body", [{"claimed":True}, {"claimed":"false"}, {}])
def test_invalid_claim_never_authorizes_generation(body):
    with pytest.raises(ValidationError):
        ClaimResponse.model_validate(body)
