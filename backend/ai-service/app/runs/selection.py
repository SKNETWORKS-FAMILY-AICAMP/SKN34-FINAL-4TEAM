"""Content가 검증한 선택 원고 참조. 원문은 포함하지 않는다."""
from typing import Annotated
from pydantic import Field, model_validator
from app.retrieval.contracts import Contract

class RunSelection(Contract):
    start: Annotated[int, Field(strict=True, ge=0)]
    end: Annotated[int, Field(strict=True, ge=1)]
    revision: Annotated[int, Field(strict=True, ge=0)] = 0
    source_hash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$", alias="sourceHash")]

    @model_validator(mode="after")
    def nonempty(self):
        if self.end <= self.start:
            raise ValueError("invalid_selection")
        return self
