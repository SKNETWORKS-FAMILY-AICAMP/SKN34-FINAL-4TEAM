"""초기 세계관 후보 추출. 원문 저장소·정본·Neo4j에 접근하지 않는다."""
import re
from hashlib import sha256

from pydantic import ValidationError
from app.initial_world import agent
from app.initial_world.errors import ExtractionFailure
from app.initial_world.models import Input, Output, ProposedOutput


def checked_output(data: Input, proposed: ProposedOutput) -> Output:
    """원문 근거·기존 ID를 검증하며 한 후보라도 실패하면 전체 결과를 거부한다."""
    sources = {source.sourceId: source for source in data.sources}
    entities = {entity.cardId: entity for entity in data.entities}
    if len({c.localRef for c in proposed.candidates}) != len(proposed.candidates):
        raise ExtractionFailure('DUPLICATE_LOCAL_REF')
    candidates = []
    for candidate in proposed.candidates:
        refs = set(candidate.relatedEntityIds)
        if candidate.subjectId is not None:
            refs.add(candidate.subjectId)
        if candidate.relation is not None:
            refs.update([candidate.relation.sourceCardId, candidate.relation.targetCardId])
        if not refs <= entities.keys():
            raise ExtractionFailure('UNKNOWN_ENTITY')
        evidence = []
        for quote in candidate.evidence:
            source = sources.get(quote.sourceId)
            if source is None:
                raise ExtractionFailure('UNKNOWN_SOURCE')
            start = source.text.find(quote.quote)
            if start < 0 or source.text.find(quote.quote, start + 1) >= 0:
                raise ExtractionFailure('UNRESOLVED_QUOTATION')
            end = start + len(quote.quote)
            # 명시적 한국어 계획/추측의 확정 승격만 막는 보수적 보조 검사다. 의미 판정기가 아니다.
            left = re.split(r'[.!?。！？\r\n]', source.text[:start])[-1]
            right = re.split(r'[.!?。！？\r\n]', source.text[end:])[0]
            sentence = left + quote.quote + right
            if candidate.type in ('fact', 'event') and re.search(r'계획|예정|추측|추정|가능성|것 같|원한다|바란다', sentence):
                raise ExtractionFailure('UNCERTAIN_AS_ASSERTED')
            evidence.append(dict(sourceId=quote.sourceId,
                start=len(source.text[:start].encode('utf-16-le')) // 2,
                end=len(source.text[:end].encode('utf-16-le')) // 2,
                quote=quote.quote, quoteHash=sha256(quote.quote.encode('utf-8')).hexdigest()))
        quotes = '\n'.join(e['quote'] for e in evidence)
        for ref in refs:
            entity = entities[ref]
            names = [entity.name, *entity.aliases]
            mentioned = [name for name in names if name and name in quotes]
            if mentioned and all(any(name in [other.name, *other.aliases]
                                     for other in data.entities if other.cardId != ref) for name in mentioned):
                raise ExtractionFailure('AMBIGUOUS_ENTITY_REFERENCE')
        candidates.append(candidate.model_dump(mode='json') | {'evidence': evidence})
    return Output.model_validate(dict(schemaVersion=proposed.schemaVersion,
                                     candidates=candidates, diagnostics=proposed.diagnostics))


def extract(data: Input) -> Output:
    """모델 제안을 받아 원문 근거·기존 ID를 검증한 후보만 반환한다."""
    proposed = agent.propose(data)
    try:
        return checked_output(data, proposed)
    except (ValidationError, UnicodeError):
        raise ExtractionFailure('INVALID_MODEL_OUTPUT') from None
