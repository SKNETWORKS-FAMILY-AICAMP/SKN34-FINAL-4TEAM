from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """GET /internal/v1/health 응답 계약."""

    status: Literal["up"] = "up"
    service: Literal["storyfork-ai-service"] = "storyfork-ai-service"
