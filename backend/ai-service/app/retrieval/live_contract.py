"""Content 실조회 응답에서 실제 실행에 사용하는 필드를 검증한다."""
from pydantic import BaseModel, Field, StrictInt, StrictStr


class Excerpt(BaseModel):
    start: StrictInt = Field(ge=0)
    end: StrictInt = Field(gt=0)
    text: StrictStr


class Episode(BaseModel):
    number: StrictInt = Field(ge=1)
    versionId: StrictStr
    excerpts: tuple[Excerpt, ...]


class Setting(BaseModel):
    id: StrictStr
    versionId: StrictStr
    name: StrictStr
    content: StrictStr
    category: StrictStr
    tags: tuple[StrictStr, ...]
    visibility: StrictStr
    fromEpisode: StrictInt
    toEpisode: StrictInt | None = None
    knownBy: tuple[StrictStr, ...]
    evidence: StrictStr


class StoryContext(BaseModel):
    title: StrictStr
    summary: StrictStr
    basisEpisode: StrictInt = Field(ge=1)
    character: StrictStr
    settings: tuple[Setting, ...]
    draft: StrictStr
    episodes: tuple[Episode, ...]


class Relation(BaseModel):
    source: StrictStr
    target: StrictStr
    label: StrictStr
    body: StrictStr


class CurrentGraph(BaseModel):
    worldId: StrictStr
    basisRevision: StrictInt = Field(ge=0)
    graphVersion: StrictInt = Field(ge=0)
    relations: tuple[Relation, ...]


class RetrievalSnapshot(BaseModel):
    scopeRef: StrictStr
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    context: StoryContext
    currentGraph: CurrentGraph | None
    episodeDocuments: dict[str, StrictStr]
