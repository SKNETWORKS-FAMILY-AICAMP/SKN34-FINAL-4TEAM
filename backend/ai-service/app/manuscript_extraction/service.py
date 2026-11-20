"""검증된 원고 추출 → 근거 있는 정체 통합 → 기존 Content 적재 DTO 구성. 정본·저장소는 수정하지 않는다."""
import hashlib
import json
from uuid import NAMESPACE_URL, uuid5
from pydantic import ValidationError
from app.manuscript_extraction import agent
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import (Card, CharacterDocs, EpisodeExtraction, EpisodeText, Evidence,
    IdentityCandidate, IdentityDecision, IdentityResolution, LoadPayload, ProposedExtraction, ProposedResolution, Relation)


def require_available() -> None:
    """#345 및 성공 결과 보존·멱등 적재 검증 전에는 실제 작업을 접수하지 않는다."""
    raise PreprocessingFailure('PREPROCESSING_NOT_IMPLEMENTED', 503)


def _require(condition, code):
    if not condition:
        raise PreprocessingFailure(code, 422)


def _hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _source_hash(episode):
    return _hash(json.dumps(episode.model_dump(), sort_keys=True, ensure_ascii=False, separators=(',', ':')))


def _evidence(source, quote):
    start = source.find(quote)
    _require(start >= 0 and source.find(quote, start + 1) < 0, 'INVALID_OR_AMBIGUOUS_QUOTE')
    offset = len(source[:start].encode('utf-16-le')) // 2
    return Evidence(quote=quote, start=offset, end=offset + len(quote.encode('utf-16-le')) // 2, quoteHash=_hash(quote))


def _validate(episode, proposed):
    proposed = ProposedExtraction.model_validate(proposed)
    mentions = {m.id: m for m in proposed.mentions}
    all_rows = [*proposed.mentions, *proposed.statements, *proposed.relationships]
    _require(len({r.id for r in all_rows}) == len(all_rows), 'DUPLICATE_LOCAL_ID')
    quotes = sorted({r.quote for r in all_rows})
    evidence = [_evidence(episode.body, q) for q in quotes]
    for mention in proposed.mentions:
        _require(mention.name.strip() and mention.name in mention.quote, 'INVALID_MENTION_NAME')
    seen = set()
    for statement in proposed.statements:
        refs = statement.subjects + statement.knowers
        _require(all(ref in mentions for ref in refs), 'UNKNOWN_ENTITY')
        _require(len(set(statement.subjects)) == len(statement.subjects) and len(set(statement.knowers)) == len(statement.knowers), 'DUPLICATE_ENTITY_REFERENCE')
        _require(all(mentions[ref].kind == 'character' for ref in statement.knowers), 'INVALID_KNOWER')
        _require(all(mentions[ref].name in statement.quote for ref in statement.knowers), 'KNOWLEDGE_NOT_EXPLICIT')
        expected = 'intended' if statement.kind in ('plan', 'goal') else 'uncertain' if statement.kind == 'conjecture' else 'asserted'
        _require(statement.certainty == expected, 'SEMANTIC_TYPE_CONFLICT')
        # 명시적 표지의 보수적 거절일 뿐 한국어 의미 판별의 완전한 대체가 아니다.
        if statement.certainty == 'asserted':
            _require(not any(cue in statement.quote for cue in ('계획', '추측', '것 같', '싶어', '예정', '지도 모', '소문')), 'UNCERTAIN_SOURCE_AS_FACT')
        if statement.kind in ('plan', 'goal', 'conjecture'):
            _require(statement.occurredEpisode is None, 'INTENTION_IS_NOT_EVENT')
        if statement.kind == 'event':
            _require(statement.occurredEpisode is not None, 'EVENT_TIME_REQUIRED')
        _require(statement.occurredEpisode is None or statement.occurredEpisode <= episode.number, 'FUTURE_EVENT')
        _require(statement.knownFromEpisode in (0, episode.number), 'INVALID_KNOWLEDGE_TIME')
        if statement.knownFromEpisode == 0:
            _require(statement.kind == 'fact' and statement.occurredEpisode == 0 and statement.document == 'memory', 'INVALID_PRESTORY_MEMORY')
            _require('이야기 시작 전부터' in statement.quote, 'PRESTORY_EVIDENCE_REQUIRED')
        if statement.kind in ('plan', 'goal'):
            _require(statement.document in ('goal', 'memory'), 'INTENTION_DOCUMENT_CONFLICT')
        if statement.kind == 'conjecture':
            _require(statement.document == 'memory', 'CONJECTURE_DOCUMENT_CONFLICT')
        fingerprint = (statement.kind, tuple(sorted(statement.subjects)), statement.quote)
        _require(fingerprint not in seen, 'DUPLICATE_STATEMENT')
        seen.add(fingerprint)
    seen = set()
    for relation in proposed.relationships:
        _require(relation.change != 'learned', 'RELATION_DISCOVERY_NOT_REPRESENTABLE')
        _require(relation.change != 'changed', 'RELATION_CHANGE_NOT_REPRESENTABLE')
        _require(relation.ended == (relation.change == 'ended'), 'RELATION_CHANGE_CONFLICT')
        _require(relation.source in mentions and relation.target in mentions and relation.source != relation.target, 'INVALID_RELATION_ENDPOINT')
        # LoadPayload에는 관계 공개 회차가 따로 없다. 소급 공개나 미래 관계를 과거로 넣지 않는다.
        _require(relation.fromEpisode == episode.number, 'UNSUPPORTED_RELATION_TIME')
        fingerprint = (relation.source, relation.target, relation.label, relation.fromEpisode)
        _require(fingerprint not in seen, 'DUPLICATE_RELATION')
        seen.add(fingerprint)
    return EpisodeExtraction(**proposed.model_dump(), number=episode.number, title=episode.title,
                             source=episode.body, sourceHash=_source_hash(episode), evidence=evidence)


def extract(episode: EpisodeText) -> EpisodeExtraction:
    """한 회차를 실제 LLM으로 구조화하고 원문·ID·유형·시점을 다시 검증한다."""
    try:
        return _validate(episode, agent.extract(episode))
    except (ValidationError, TypeError, ValueError, UnicodeError):
        raise PreprocessingFailure('INVALID_EXTRACTION') from None


def _inputs(extractions):
    _require(bool(extractions), 'EMPTY_EXTRACTIONS')
    result = {}
    for number, raw in sorted(extractions.items()):
        row = EpisodeExtraction.model_validate(raw)
        _require(number == row.number, 'EPISODE_MISMATCH')
        data = EpisodeText(number=row.number, title=row.title, body=row.source)
        checked = _validate(data, row.model_dump(include=set(ProposedExtraction.model_fields)))
        _require(checked == row, 'EXTRACTION_EVIDENCE_MISMATCH')
        result[number] = row
    return result


def _key(ref):
    return 'entity-' + str(uuid5(NAMESPACE_URL, 'storyfork:manuscript:' + ref))


def _resolution(rows, proposed):
    mentions = {f'{n}:{m.id}': m for n, row in rows.items() for m in row.mentions}
    parent = {ref: ref for ref in mentions}
    def root(ref):
        while parent[ref] != ref:
            ref = parent[ref]
        return ref
    decisions = []
    pairs = set()
    distinct = [frozenset((l.left, l.right)) for l in proposed.links if l.basis == 'distinct']
    for link in sorted(proposed.links, key=lambda l: (l.confirmedAt, min(l.left, l.right), max(l.left, l.right))):
        _require(link.left in mentions and link.right in mentions and link.left != link.right, 'INVALID_IDENTITY_REFERENCE')
        pair = frozenset((link.left, link.right))
        _require(pair not in pairs, 'DUPLICATE_IDENTITY_LINK'); pairs.add(pair)
        _require(link.evidenceEpisode in rows and link.confirmedAt == link.evidenceEpisode, 'INVALID_IDENTITY_TIME')
        _require(link.confirmedAt >= max(int(r.split(':')[0]) for r in pair), 'IDENTITY_BEFORE_MENTION')
        _evidence(rows[link.evidenceEpisode].source, link.quote)
        left, right = mentions[link.left], mentions[link.right]
        _require(left.name in link.quote and right.name in link.quote, 'IDENTITY_NAMES_NOT_IN_EVIDENCE')
        _require(left.kind == right.kind, 'IDENTITY_KIND_CONFLICT')
        status, reason = 'deferred', link.basis
        if link.basis == 'distinct':
            status = 'distinct'
        elif link.basis in ('explicit_alias', 'explicit_coreference'):
            if left.name != right.name:
                reason = 'AUTHOR_REVIEW_REQUIRED' if left.kind == 'character' else 'DIFFERENT_NAMES'
            else:
                a, b = sorted((root(link.left), root(link.right)))
                _require(not any({root(r) for r in pair} <= {a, b} for pair in distinct), 'CONTRADICTORY_IDENTITY')
                parent[b] = a
                status, reason = 'merged', link.basis
        decisions.append(IdentityDecision(link=link, status=status, reason=reason))
    return IdentityResolution(inputHashes={n: _hash(json.dumps(row.model_dump(), sort_keys=True, ensure_ascii=False, separators=(',', ':'))) for n, row in rows.items()},
                              mapping={ref: _key(root(ref)) for ref in sorted(parent)}, decisions=decisions)


def resolve(extractions: dict[int, object]) -> IdentityResolution:
    """이름 자동 병합 없이 명시적 근거만 적용한다. key는 정렬된 회차-local ID에서 결정한다."""
    try:
        rows = _inputs(extractions)
        return _resolution(rows, ProposedResolution.model_validate(agent.resolve(list(rows.values()))))
    except (ValidationError, ValueError, TypeError, KeyError):
        raise PreprocessingFailure('INVALID_IDENTITY_OUTPUT') from None


def organize(identities: object, extractions: dict[int, object]) -> LoadPayload:
    """검증 결과만 결정적으로 구성한다. 추가 LLM·원문 재조회·정본 UUID 발급은 없다."""
    try:
        rows = _inputs(extractions)
        identity = IdentityResolution.model_validate(identities)
        checked = _resolution(rows, ProposedResolution(links=[d.link for d in identity.decisions]))
        _require(identity == checked, 'IDENTITY_INPUT_MISMATCH')
        return _organize(identity, rows)
    except (ValidationError, ValueError, TypeError, KeyError):
        raise PreprocessingFailure('INVALID_LOAD_PAYLOAD') from None


def _organize(identity, rows):
    cards, first, docs, bodies = {}, {}, {}, {}
    for n, row in rows.items():
        for mention in sorted(row.mentions, key=lambda m: m.id):
            key = identity.mapping[f'{n}:{mention.id}']
            if key not in cards:
                cards[key] = Card(key=key, cardType=mention.kind, title=mention.name, aliases=[], body=mention.name, firstEpisode=n)
                first[key], bodies[key] = n, []
                if mention.kind == 'character': docs[key] = {'soul': [], 'goal': [], 'episodes': {}}
            elif mention.name != cards[key].title and mention.name not in cards[key].aliases:
                cards[key].aliases.append(mention.name)
    relations = []
    for n, row in rows.items():
        for statement in row.statements:
            subjects = sorted({identity.mapping[f'{n}:{ref}'] for ref in statement.subjects})
            text = f'[{statement.kind}] {statement.quote}'
            represented = bool(statement.knowers) or statement.kind == 'event'
            if statement.kind == 'event':
                key = 'event-' + str(uuid5(NAMESPACE_URL, f'storyfork:manuscript:{n}:{statement.id}'))
                names = ', '.join(cards[k].title for k in subjects)
                cards[key] = Card(key=key, cardType='event', title=f'{n}화 사건 {statement.id}', aliases=[],
                                  body=f'발생: {statement.occurredEpisode}화 / 참여: {names}\n{text}', firstEpisode=n)
            for key in subjects:
                if first[key] == n and statement.document in ('identity', 'soul', 'goal'):
                    target = bodies[key] if statement.document == 'identity' or key not in docs else docs[key][statement.document]
                    target.append(text)
                    represented = True
                elif key not in docs and statement.kind != 'event':
                    raise PreprocessingFailure('UNSUPPORTED_LATER_SETTING_STATE', 422)
            _require(represented, 'UNREPRESENTABLE_STATEMENT')
            # 인물의 명시적 인지 대상에만 기억을 넣는다. 미래 회차는 이전 bucket으로 합치지 않는다.
            for ref in statement.knowers:
                key = identity.mapping[f'{n}:{ref}']
                _require(statement.knownFromEpisode != 0 or n == first[key], 'RETROACTIVE_MEMORY_NOT_REPRESENTABLE')
                memory = docs[key]['episodes'].setdefault(f'{statement.knownFromEpisode:02}', [])
                if text not in memory: memory.append(text)
        for relation in row.relationships:
            source, target = (identity.mapping[f'{n}:{ref}'] for ref in (relation.source, relation.target))
            _require(source != target, 'MERGED_SELF_RELATION')
            relations.append(Relation(fromKey=source, toKey=target, label=relation.label, fromEpisode=relation.fromEpisode, ended=relation.ended))
    for key, lines in bodies.items():
        cards[key].body = '\n'.join(dict.fromkeys(lines)) or cards[key].title
    for key, documents in docs.items():
        cards[key].characterDocs = CharacterDocs(soul='\n'.join(dict.fromkeys(documents['soul'])),
            goal='\n'.join(dict.fromkeys(documents['goal'])), episodes={n: '\n'.join(lines) for n, lines in sorted(documents['episodes'].items())})
    # 모델/문서 길이 한도 초과도 잘라내지 않는다. 재검증으로 모두 실패시킨다.
    candidates = {}
    for decision in identity.decisions:
        if decision.reason == 'AUTHOR_REVIEW_REQUIRED':
            link = decision.link
            pair = (identity.mapping[link.right], identity.mapping[link.left])
            candidates.setdefault(pair, IdentityCandidate(fromKey=pair[0], toKey=pair[1], episode=link.confirmedAt, quote=link.quote))
    payload = LoadPayload(identityCandidates=list(candidates.values()), cards=sorted(cards.values(), key=lambda c: c.key),
                          relations=sorted(relations, key=lambda r: (r.fromEpisode, r.fromKey, r.toKey, r.label)))
    fingerprints = [(r.fromKey, r.toKey, r.label, r.fromEpisode) for r in relations]
    _require(len(fingerprints) == len(set(fingerprints)), 'DUPLICATE_RESOLVED_RELATION')
    return LoadPayload.model_validate(payload.model_dump())
