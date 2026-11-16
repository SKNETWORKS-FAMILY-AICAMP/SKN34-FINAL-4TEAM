"""작품 장르·키워드(해시태그) 추천 입출력 DTO(#372). 장르 승인 목록과 개수 상한은 Content가 입력으로 넘긴다."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Genre = Annotated[str, Field(min_length=1, max_length=50)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Episode(Model):
    number: Annotated[int, Field(strict=True, ge=1)]
    title: Annotated[str, Field(max_length=200)]
    text: Annotated[str, Field(min_length=1, max_length=8000)]


class Input(Model):
    schemaVersion: Literal['work-tags.v1']
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=3000)]
    episodes: list[Episode] = Field(min_length=1, max_length=3)
    allowedGenres: list[Genre] = Field(min_length=1, max_length=100)
    maxGenres: Annotated[int, Field(strict=True, ge=1, le=5)]
    maxHashtags: Annotated[int, Field(strict=True, ge=1, le=20)]

    @model_validator(mode='after')
    def distinct_genres(self):
        if len(set(self.allowedGenres)) != len(self.allowedGenres):
            raise ValueError('DUPLICATE_GENRE')
        return self


class Output(Model):
    """추천 후보. 저장된 값이 아니며 작가가 고른 것만 기존 작품 수정 API로 저장한다.

    OpenAI strict schema가 받아들이지 않을 수 있는 길이·패턴 제약은 두지 않고 service가 같은 규칙을 검증한다.
    """
    schemaVersion: Literal['work-tags.v1']
    genres: list[str]
    hashtags: list[str]
