"""이미지 목적별 고정 규격과 내부 접수 계약."""
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, StrictBool, model_validator

MODEL = "gpt-image-2.6-flare"
QUALITY = "high"
SIZES = {"character_profile": "1024x1024", "world_cover": "1152x1536", "work_cover": "1152x1536", "illustration": "1536x1024"}

class ImageInput(BaseModel):
    purpose: Literal["character_profile", "world_cover", "work_cover", "illustration"]
    prompt: str = Field(min_length=1, max_length=12000)
    model: Literal["gpt-image-2.6-flare"] = MODEL
    quality: Literal["high"] = QUALITY
    templateVersion: Literal["v1", "cover-v2", "cover-v3"] = "v1"
    visualSettings: str = Field(default="", max_length=6000)
    referenceRole: Literal["style", "subject"] | None = None

    @model_validator(mode="after")
    def cover_template(self):
        if self.templateVersion != "v1" and self.purpose not in ("work_cover", "world_cover"):
            raise ValueError("cover template requires cover purpose")
        if self.visualSettings and self.templateVersion == "v1":
            raise ValueError("visual settings require a cover template")
        if (self.templateVersion == "cover-v3") != (self.referenceRole is not None):
            raise ValueError("cover-v3 requires a reference role")
        return self

    @property
    def size(self) -> str:
        return SIZES[self.purpose]

class JobRequest(BaseModel):
    jobId: UUID

class JobResponse(BaseModel):
    jobId: UUID
    status: str = "queued"

class ClaimResponse(BaseModel):
    claimed: StrictBool
    input: ImageInput | None = None

    @model_validator(mode="after")
    def claimed_input(self):
        if self.claimed and self.input is None:
            raise ValueError("claimed input required")
        return self

class ProgressRequest(BaseModel):
    stage: Literal["generating", "uploading"]

class CompletionRequest(BaseModel):
    key: str
