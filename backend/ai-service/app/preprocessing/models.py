"""회차 원고 전처리 입력 DTO(#343, DEC-50). 접수 요청만 있다. 진행·결과는 worker가 Content 콜백으로 보고한다."""
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 작업 ID는 Content 콜백 경로에 들어가므로 경로 문자를 허용하지 않는다.
JobId = Annotated[str, Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class JobRequest(Model):
    """Content가 접수시키는 전처리 작업이다. 같은 jobId를 다시 접수하면 episodes에는 실패 회차만 담는다."""
    jobId: JobId
    workId: Annotated[str, Field(min_length=1, max_length=64)]
    episodes: list[Annotated[int, Field(strict=True, ge=1)]] = Field(min_length=1, max_length=5000)

    @field_validator('episodes')
    @classmethod
    def distinct_episodes(cls, episodes):
        if len(set(episodes)) != len(episodes):
            raise ValueError('DUPLICATE_EPISODE')
        return episodes
