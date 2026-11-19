"""회차 원고 전처리 입출력 DTO(#343, DEC-50). 접수 요청과 Content 진행 보고만 있다."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 작업 ID는 Content 진행 API 경로에 들어가므로 경로 문자를 허용하지 않는다.
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


class Progress(Model):
    """Content 진행 갱신 API 본문이다. failed가 있으면 Content가 작업을 그 고정 사유로 끝낸다."""
    stage: Literal['extracting', 'resolving', 'organizing', 'loading']
    done: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]
    failedEpisodes: list[Annotated[int, Field(ge=1)]]
    failed: str | None = None
