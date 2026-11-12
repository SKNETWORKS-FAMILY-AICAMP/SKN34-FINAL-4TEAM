"""문서용 실행 계약. 서비스에서 import하지 않으며 외부 호출·저장을 하지 않는다."""
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


class AnalysisRequest(Model):
    key: Key
    expectedDraftRevision: Revision


class AnalysisResponse(Model):
    analysisId: UUID
    basis: Basis
    executionStatus: Literal['running', 'completed', 'failed', 'unknown']
    freshness: Literal['current', 'stale']
    output: Output | None
    candidateIds: dict[Key, UUID]
    decisions: list['DecisionRecord']

    @model_validator(mode='after')
    def completed_output(self):
        if (self.executionStatus == 'completed') != (self.output is not None):
            raise ValueError('OUTPUT_STATE')
        if self.output is None and (self.candidateIds or self.decisions):
            raise ValueError('OUTPUT_STATE')
        if self.output is not None:
            unique([c.localRef for c in self.output.candidates])
            if set(self.candidateIds) != {c.localRef for c in self.output.candidates}:
                raise ValueError('CANDIDATE_BINDING')
            unique(list(self.candidateIds.values()))
            unique([(d.candidateId, d.sequence) for d in self.decisions])
            for d in self.decisions:
                if (self.candidateIds.get(d.candidateRef) != d.candidateId
                        or d.content.localRef != d.candidateRef):
                    raise ValueError('CANDIDATE_BINDING')
        return self


class DecisionRequest(Model):
    key: Key
    expectedDecisionSequence: Revision
    action: Literal['approve', 'edit', 'hold', 'reject']
    editedCandidate: Candidate | None
    comment: Annotated[str, Field(max_length=3000)]

    @model_validator(mode='after')
    def edit_only(self):
        if (self.action == 'edit') != (self.editedCandidate is not None):
            raise ValueError('EDIT_REQUIRED')
        if self.editedCandidate and self.editedCandidate.provenance != 'author_revision':
            raise ValueError('AUTHOR_PROVENANCE')
        return self


class DecisionRecord(Model):
    candidateId: UUID
    candidateRef: Key
    sequence: Annotated[int, Field(strict=True, ge=1)]
    state: Literal['pending', 'approved', 'held', 'rejected']
    content: Candidate


AnalysisResponse.model_rebuild()


class Selection(Model):
    candidateId: UUID
    decisionSequence: Annotated[int, Field(strict=True, ge=1)]


class ApplicationRequest(Model):
    key: Key
    expectedDraftRevision: Revision
    candidates: list[Selection] = Field(min_length=1)


class ApplicationResponse(Model):
    applicationId: UUID
    status: Literal['applying', 'applied', 'failed', 'unknown']
    baseDraftRevision: Revision
    resultDraftRevision: Revision | None
    createdCardIds: list[UUID]
    createdRelationshipIds: list[UUID]

    @model_validator(mode='after')
    def completion(self):
        if self.status == 'applied':
            if self.resultDraftRevision != self.baseDraftRevision + 1:
                raise ValueError('RESULT_REVISION')
        elif self.resultDraftRevision is not None:
            raise ValueError('UNCONFIRMED_RESULT')
        return self


def quote_utf16(text, start, end):
    raw = text.encode('utf-16-le')
    if not 0 <= start < end <= len(raw) // 2:
        raise ValueError('SPAN_RANGE')
    try:
        return raw[start * 2:end * 2].decode('utf-16-le', errors='strict')
    except UnicodeError as exc:
        raise ValueError('SURROGATE_BOUNDARY') from exc


def unique(values):
    if len(values) != len(set(values)):
        raise ValueError('DUPLICATE')


def input_hash(value):
    data = value.model_dump(mode='json')
    data.pop('analysisId')
    data['basis'].pop('inputHash')
    data['sources'].sort(key=lambda s: s['sourceId'])
    data['entities'].sort(key=lambda e: e['cardId'])
    return sha256(json.dumps(data, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':')).encode('utf-8')).hexdigest()


class Contract(Model):
    """API별 $defs와 한 반영 시도를 묶는 테스트 전용 봉투. HTTP DTO가 아니다."""
    input: Input
    output: Output
    analysisRequest: AnalysisRequest
    analysisResponse: AnalysisResponse
    decisionRequest: DecisionRequest
    decisions: list[DecisionRecord]
    applicationRequest: ApplicationRequest
    applicationResponse: ApplicationResponse
    currentDraftRevision: Revision
    currentRelationshipVersion: Revision
    appliedCandidateIds: list[UUID]

    @model_validator(mode='after')
    def invariants(self):
        sources = {s.sourceId: s for s in self.input.sources}
        entities = {e.cardId for e in self.input.entities}
        unique([s.sourceId for s in self.input.sources])
        unique([e.cardId for e in self.input.entities])
        unique([c.localRef for c in self.output.candidates])
        unique([(d.candidateId, d.sequence) for d in self.decisions])
        unique([s.candidateId for s in self.applicationRequest.candidates])
        if input_hash(self.input) != self.input.basis.inputHash:
            raise ValueError('INPUT_HASH')
        if (self.analysisRequest.expectedDraftRevision != self.input.basis.draftRevision
                or self.analysisResponse.analysisId != self.input.analysisId
                or self.analysisResponse.basis != self.input.basis
                or self.analysisResponse.output != self.output
                or self.analysisResponse.freshness != 'current'):
            raise ValueError('ANALYSIS_BINDING')
        for s in self.input.sources:
            if sha256(s.text.encode('utf-8')).hexdigest() != s.textHash:
                raise ValueError('SOURCE_HASH')
        for c in [*self.output.candidates, *(d.content for d in self.decisions)]:
            refs = set(c.relatedEntityIds)
            if c.subjectId:
                refs.add(c.subjectId)
            if c.relation:
                refs.update([c.relation.sourceCardId, c.relation.targetCardId])
            if not refs <= entities:
                raise ValueError('UNKNOWN_ENTITY')
            for e in c.evidence:
                if e.sourceId not in sources:
                    raise ValueError('UNKNOWN_SOURCE')
                if quote_utf16(sources[e.sourceId].text, e.start, e.end) != e.quote:
                    raise ValueError('QUOTE_MISMATCH')
                if sha256(e.quote.encode('utf-8')).hexdigest() != e.quoteHash:
                    raise ValueError('QUOTE_HASH')
        if (self.applicationRequest.expectedDraftRevision != self.input.basis.draftRevision
                or self.currentDraftRevision != self.input.basis.draftRevision
                or self.currentRelationshipVersion != self.input.basis.relationshipVersion):
            raise ValueError('ANALYSIS_STALE')
        decisions = {}
        for d in self.decisions:
            if d.candidateId not in decisions or d.sequence > decisions[d.candidateId].sequence:
                decisions[d.candidateId] = d
        originals = {c.localRef: c for c in self.output.candidates}
        for d in self.decisions:
            if (d.candidateRef not in originals or d.content.localRef != d.candidateRef
                    or self.analysisResponse.candidateIds.get(d.candidateRef) != d.candidateId):
                raise ValueError('CANDIDATE_BINDING')
            if d.content.provenance == 'ai_extraction' and d.content != originals[d.candidateRef]:
                raise ValueError('FALSE_EXTRACTION')
        for selected in self.applicationRequest.candidates:
            d = decisions.get(selected.candidateId)
            if not d or d.state != 'approved' or d.sequence != selected.decisionSequence:
                raise ValueError('NOT_APPROVED')
            if selected.candidateId in self.appliedCandidateIds:
                raise ValueError('ALREADY_APPLIED')
        created = self.applicationResponse.createdCardIds + self.applicationResponse.createdRelationshipIds
        unique(created)
        if set(created) & entities:
            raise ValueError('EXISTING_ENTITY_ID')
        if self.applicationResponse.baseDraftRevision != self.applicationRequest.expectedDraftRevision:
            raise ValueError('APPLICATION_BINDING')
        return self
