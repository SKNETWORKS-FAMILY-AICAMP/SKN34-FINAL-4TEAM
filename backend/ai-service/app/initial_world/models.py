"""#219 6c5ed7d8의 Input/Output DTO. 저장·검토 DTO는 가져오지 않는다."""
from hashlib import sha256
import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Revision = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
Text = Annotated[str, Field(min_length=1, max_length=3000)]
Hash = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]
Key = Annotated[str, Field(min_length=1, max_length=200, pattern=r'^[A-Za-z0-9:_-]+$')]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Basis(Model):
    draftRevision: Revision
    relationshipVersion: Revision
    currentRevisionId: UUID | None
    inputHash: Hash


class Source(Model):
    sourceId: Text
    ownerId: UUID
    field: Literal['description', 'title', 'body']
    text: Annotated[str, Field(max_length=20000)]
    textHash: Hash


class Entity(Model):
    cardId: UUID
    entityType: Literal['character', 'location', 'organization', 'ability', 'object']
    name: Annotated[str, Field(min_length=1, max_length=200)]
    aliases: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)


class Evidence(Model):
    sourceId: Text
    start: Revision
    end: Revision
    quote: Text
    quoteHash: Hash


class Input(Model):
    schemaVersion: Literal['initial-world.v1']
    analysisId: UUID
    worldId: UUID
    basis: Basis
    sources: list[Source] = Field(min_length=1)
    entities: list[Entity]

    @model_validator(mode='after')
    def source_identity(self):
        for source in self.sources:
            prefix = 'world' if source.field == 'description' else 'card'
            if (source.sourceId != f'{prefix}:{source.ownerId}:{source.field}'
                    or (prefix == 'world' and source.ownerId != self.worldId)):
                raise ValueError('SOURCE_IDENTITY')
        return self


    @model_validator(mode='after')
    def input_integrity(self):
        if len({s.sourceId for s in self.sources}) != len(self.sources) or len({e.cardId for e in self.entities}) != len(self.entities):
            raise ValueError('DUPLICATE_INPUT_ID')
        try:
            for source in self.sources:
                if sha256(source.text.encode('utf-8')).hexdigest() != source.textHash:
                    raise ValueError('SOURCE_HASH')
            if input_hash(self) != self.basis.inputHash:
                raise ValueError('INPUT_HASH')
        except UnicodeError:
            raise ValueError('INVALID_UNICODE') from None
        return self


class Relation(Model):
    sourceCardId: UUID
    targetCardId: UUID
    category: Literal['structural', 'emotional']
    label: Annotated[str, Field(min_length=1, max_length=200)]
    direction: Literal['directed', 'symmetric']
    polarity: Literal['asserted', 'denied']

    @model_validator(mode='after')
    def different_endpoints(self):
        if self.sourceCardId == self.targetCardId:
            raise ValueError('SELF_RELATION')
        return self


class Candidate(Model):
    localRef: Key
    type: Literal['fact', 'relation', 'rule', 'event', 'conjecture', 'goal', 'plan']
    title: Annotated[str, Field(min_length=1, max_length=200)]
    text: Text
    subjectId: UUID | None
    relatedEntityIds: list[UUID]
    provenance: Literal['ai_extraction', 'author_revision', 'author_addition']
    evidence: list[Evidence]
    relation: Relation | None
    condition: Annotated[str, Field(max_length=3000)]
    timeText: Annotated[str, Field(max_length=3000)]
    polarity: Literal['asserted', 'denied']

    @model_validator(mode='after')
    def shape(self):
        if (self.type == 'relation') != (self.relation is not None):
            raise ValueError('RELATION_TYPE')
        if self.type in ('goal', 'plan') and self.subjectId is None:
            raise ValueError('SUBJECT_REQUIRED')
        if self.provenance == 'ai_extraction' and not self.evidence:
            raise ValueError('EVIDENCE_REQUIRED')
        if self.provenance != 'ai_extraction' and self.evidence:
            raise ValueError('AUTHOR_EVIDENCE')
        return self


class Output(Model):
    schemaVersion: Literal['initial-world.v1']
    candidates: list[Candidate]
    diagnostics: list[Text]

    @model_validator(mode='after')
    def extracted_only(self):
        if any(c.provenance != 'ai_extraction' for c in self.candidates):
            raise ValueError('MODEL_CANNOT_AUTHOR')
        return self


def input_hash(value: Input) -> str:
    data = value.model_dump(mode='json')
    data.pop('analysisId')
    data['basis'].pop('inputHash')
    data['sources'].sort(key=lambda source: source['sourceId'])
    data['entities'].sort(key=lambda entity: entity['cardId'])
    return sha256(json.dumps(data, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':')).encode('utf-8')).hexdigest()


class Quotation(Model):
    sourceId: Text
    quote: Text


class ProposedCandidate(Candidate):
    provenance: Literal['ai_extraction']
    evidence: list[Quotation]


class ProposedOutput(Output):
    candidates: list[ProposedCandidate]
