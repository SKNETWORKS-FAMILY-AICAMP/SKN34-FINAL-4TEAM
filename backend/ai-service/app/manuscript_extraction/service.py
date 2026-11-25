"""검증된 원고 추출 → 근거 있는 정체 통합 → 기존 Content 적재 DTO 구성. 정본·저장소는 수정하지 않는다."""
import hashlib
import json
from collections import Counter
from uuid import NAMESPACE_URL, uuid5
from pydantic import ValidationError
from app.manuscript_extraction import agent
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import (DOC_LIMIT, Card, CharacterDocs, EpisodeExtraction, EpisodeText, Evidence, ExtractedRelation,
    IdentityCandidate, IdentityDecision, IdentityLink, IdentityResolution, LoadPayload, ProposedExtraction, ProposedRelation,
    ProposedResolution, Relation)

# 카드 본문·문서의 줄은 '<표지> <인용>'이다. 표지와 사건 카드 제목은 Content ManuscriptStructureVerifier와 글자까지 같아야 한다.
LABELS = {'event': '[사건]', 'description': '[묘사]', 'fact': '[사실]', 'rule': '[규칙]', 'plan': '[계획]', 'goal': '[목표]', 'conjecture': '[추측]'}


def _require(condition, code):
    if not condition:
        raise PreprocessingFailure(code, 422)


def _hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _source_hash(episode):
    return _hash(json.dumps(episode.model_dump(), sort_keys=True, ensure_ascii=False, separators=(',', ':')))


def _quote_start(source, quote):
    """인용이 원문에 연속한 글자로 정확히 한 번 나오면 그 위치, 아니면 -1."""
    start = source.find(quote)
    return start if start >= 0 and source.find(quote, start + 1) < 0 else -1


def _evidence(source, quote):
    offset = len(source[:source.find(quote)].encode('utf-16-le')) // 2
    return Evidence(quote=quote, start=offset, end=offset + len(quote.encode('utf-16-le')) // 2, quoteHash=_hash(quote))


def _line(statement):
    return f'{LABELS[statement.kind]} {statement.quote}'


def _first(*checks):
    """(위반 여부, 코드)를 차례로 보고 처음 위반한 코드를 돌려준다."""
    return next((code for broken, code in checks if broken), None)


def _validate(episode, proposed):
    """항목마다 원문·참조·시점을 다시 확인한다. 어긋난 항목만 빼고 코드별 건수를 skipped에 남긴다.

    제안은 있었는데 하나도 검증되지 못한 회차(모델 출력을 믿을 수 없다)만 실패다. 아무것도 제안하지 않은 회차는 빈 추출이다.
    """
    proposed = ProposedExtraction.model_validate(proposed)
    n, skipped = episode.number, Counter()
    ids = Counter(row.id for row in [*proposed.mentions, *proposed.statements, *proposed.relationships])

    def sound(row):  # 모든 항목 공통: 지역 id가 유일하고 인용이 원문에 정확히 한 번 나온다
        return ('DUPLICATE_LOCAL_ID' if ids[row.id] > 1 else
                'INVALID_OR_AMBIGUOUS_QUOTE' if _quote_start(episode.body, row.quote) < 0 else None)

    mentions = {}
    for mention in proposed.mentions:
        code = sound(mention) or (None if mention.name.strip() and mention.name in mention.quote else 'INVALID_MENTION_NAME')
        if code:
            skipped[code] += 1
        else:
            mentions[mention.id] = mention

    def knower_problem(ref, quote):  # 기억에 넣을 인물은 검증된 인물이고 이름이 인용에 글자 그대로 있어야 한다(다른 인물의 비밀이 새지 않게)
        found = mentions.get(ref)
        return ('UNKNOWN_ENTITY' if found is None else 'INVALID_KNOWER' if found.kind != 'character' else
                None if found.name in quote else 'KNOWLEDGE_NOT_EXPLICIT')

    def shelves(statement):  # 이 진술의 줄이 실리는 (대상, 칸). 첫 등장 회차인지는 정체 정리 뒤에야 알 수 있어 모든 칸을 센다
        docs = [(ref, 'body' if statement.document == 'identity' or mentions[ref].kind != 'character' else statement.document)
                for ref in statement.subjects if statement.document in ('identity', 'soul', 'goal')]
        return docs + [(ref, 'memory') for ref in statement.knowers]

    statements, seen, used = [], set(), Counter()
    for statement in proposed.statements:
        code = sound(statement) or _first(
            (not all(ref in mentions for ref in statement.subjects), 'UNKNOWN_ENTITY'),
            (len(set(statement.subjects)) < len(statement.subjects) or len(set(statement.knowers)) < len(statement.knowers), 'DUPLICATE_ENTITY_REFERENCE'))
        if code:
            skipped[code] += 1
            continue
        problems = [knower_problem(ref, statement.quote) for ref in statement.knowers]
        statement = statement.model_copy(update={'knowers': [ref for ref, why in zip(statement.knowers, problems) if not why]})
        expected = 'intended' if statement.kind in ('plan', 'goal') else 'uncertain' if statement.kind == 'conjecture' else 'asserted'
        occurred, line = statement.occurredEpisode, _line(statement)
        fingerprint = (statement.kind, tuple(sorted(statement.subjects)), statement.quote)
        event_body = len(f'발생: {occurred}화 / 참여: ') + len(', '.join(mentions[ref].name for ref in statement.subjects)) + 1 + len(line)
        prestory = statement.kind == 'fact' and occurred == 0 and statement.document == 'memory'
        overflow = (statement.kind == 'event' and event_body > DOC_LIMIT) or any(used[shelf] + len(line) > DOC_LIMIT for shelf in shelves(statement))
        code = _first(
            (statement.certainty != expected, 'SEMANTIC_TYPE_CONFLICT'),
            (statement.kind in ('plan', 'goal', 'conjecture') and occurred is not None, 'INTENTION_IS_NOT_EVENT'),
            (statement.kind == 'event' and occurred is None, 'EVENT_TIME_REQUIRED'),
            (occurred is not None and occurred > n, 'FUTURE_EVENT'),
            (statement.knownFromEpisode not in (0, n), 'INVALID_KNOWLEDGE_TIME'),
            (statement.knownFromEpisode == 0 and not prestory, 'INVALID_PRESTORY_MEMORY'),
            (statement.kind in ('plan', 'goal') and statement.document not in ('goal', 'memory'), 'INTENTION_DOCUMENT_CONFLICT'),
            (statement.kind == 'conjecture' and statement.document != 'memory', 'CONJECTURE_DOCUMENT_CONFLICT'),
            (statement.document == 'memory' and statement.kind != 'event' and not statement.knowers, 'UNREPRESENTABLE_STATEMENT'),
            (fingerprint in seen, 'DUPLICATE_STATEMENT'),
            (overflow, 'DOCUMENT_TOO_LONG'))
        if code:
            skipped[code] += 1
            continue
        skipped.update(why for why in problems if why)
        seen.add(fingerprint)
        for shelf in shelves(statement):
            used[shelf] += len(line) + 1
        statements.append(statement)

    relations, linked = [], set()
    for relation in proposed.relationships:
        code = sound(relation) or _first(
            (not (relation.source in mentions and relation.target in mentions and relation.source != relation.target), 'INVALID_RELATION_ENDPOINT'),
            ((relation.source, relation.target, relation.label) in linked, 'DUPLICATE_RELATION'))
        if code:
            skipped[code] += 1
            continue
        linked.add((relation.source, relation.target, relation.label))
        relations.append(ExtractedRelation(**relation.model_dump(), fromEpisode=n, ended=relation.change == 'ended'))
    _require(mentions or not skipped, 'NO_VERIFIED_MENTION')
    quotes = sorted({row.quote for row in [*mentions.values(), *statements, *relations]})
    return EpisodeExtraction(mentions=list(mentions.values()), statements=statements, relationships=relations, number=n, title=episode.title,
                             source=episode.body, sourceHash=_source_hash(episode), evidence=[_evidence(episode.body, q) for q in quotes],
                             skipped=dict(skipped))


def extract(episode: EpisodeText, instructions: str | None = None, model: str | None = None) -> EpisodeExtraction:
    """한 회차를 실제 LLM으로 구조화하고 원문·ID·유형·시점을 다시 검증한다. instructions·model은 회귀 평가가 지정한 프롬프트 버전의 본문·모델이다."""
    try:
        return _validate(episode, agent.extract(episode) if instructions is None else agent.extract(episode, instructions, model))
    except (ValidationError, TypeError, ValueError, UnicodeError):
        raise PreprocessingFailure('INVALID_EXTRACTION') from None


def _inputs(extractions):
    _require(bool(extractions), 'EMPTY_EXTRACTIONS')
    result = {}
    for number, raw in sorted(extractions.items()):
        row = EpisodeExtraction.model_validate(raw)
        _require(number == row.number, 'EPISODE_MISMATCH')
        data = EpisodeText(number=row.number, title=row.title, body=row.source)
        # 저장된 결과를 모델 출력 모양으로 되돌려 다시 거른다. 더 빠지거나 값이 달라지는 항목이 있으면 바뀐 것이다(건수 skipped는 그대로 둔다).
        again = row.model_dump(include={'mentions': True, 'statements': True, 'relationships': {'__all__': set(ProposedRelation.model_fields)}})
        checked = _validate(data, again)
        _require(checked.model_copy(update={'skipped': row.skipped}) == row, 'EXTRACTION_EVIDENCE_MISMATCH')
        result[number] = row
    return result


# 호칭 변형(치삼·치삼이·치삼아·치삼은)을 한 이름으로 보는 접미사·조사(#839). 값은 앞 글자의 받침 조건(True 있음·False 없음·None 상관없음)이다.
# 받침 규칙에 어긋난 꼴(영희이·치삼야)은 다른 이름일 수 있어 변형으로 보지 않는다. Content ManuscriptStructureVerifier.nameKey와 글자까지 같아야 한다.
_SUFFIXES = {'이': True, '아': True, '야': False, '은': True, '을': True, '는': False, '를': False, '가': False, '의': None}


def _base(name):
    """호칭 변형의 기본형. 끝의 접미사·조사를 떼되(치삼이가 → 치삼이 → 치삼) 두 글자 이상이 남을 때만 뗀다(순이는 그대로)."""
    while len(name) > 2 and name[-1] in _SUFFIXES and '가' <= name[-2] <= '힣' and _SUFFIXES[name[-1]] in (None, (ord(name[-2]) - 0xAC00) % 28 > 0):
        name = name[:-1]
    return name


def _key(ref):
    return 'entity-' + str(uuid5(NAMESPACE_URL, 'storyfork:manuscript:' + ref))


def _resolution(rows, proposed):
    mentions = {f'{n}:{m.id}': m for n, row in rows.items() for m in row.mentions}
    parent = {ref: ref for ref in mentions}
    episode = lambda ref: int(ref.split(':')[0])  # noqa: E731
    def root(ref):
        while parent[ref] != ref:
            ref = parent[ref]
        return ref
    def sound(link):  # 근거가 어긋난 링크는 그 링크 하나만 버린다(Content가 받은 결정을 같은 조건으로 다시 검증한다)
        if not (link.left in mentions and link.right in mentions and link.left != link.right):
            return False
        left, right = mentions[link.left], mentions[link.right]
        return (link.evidenceEpisode in rows and link.confirmedAt == link.evidenceEpisode
                and link.confirmedAt >= max(episode(link.left), episode(link.right))
                and _quote_start(rows[link.evidenceEpisode].source, link.quote) >= 0
                and left.name in link.quote and right.name in link.quote and left.kind == right.kind
                and (link.basis != 'same_name' or left.name == right.name))
    links = sorted((link for link in proposed.links if sound(link)), key=lambda l: (l.confirmedAt, min(l.left, l.right), max(l.left, l.right)))
    distinct = [frozenset((l.left, l.right)) for l in links if l.basis == 'distinct']
    decisions = []
    pairs = set()
    for link in links:
        pair = frozenset((link.left, link.right))
        if pair in pairs:
            continue  # 같은 쌍의 링크는 먼저 온 것만 쓴다
        left, right = mentions[link.left], mentions[link.right]
        status, reason = 'deferred', link.basis
        if link.basis == 'distinct':
            status = 'distinct'
        elif link.basis in ('explicit_alias', 'explicit_coreference', 'same_name'):
            if _base(left.name) != _base(right.name):
                reason = 'AUTHOR_REVIEW_REQUIRED' if left.kind == 'character' else 'DIFFERENT_NAMES'
            else:
                a, b = sorted((root(link.left), root(link.right)))
                if any({root(r) for r in p} <= {a, b} for p in distinct):
                    continue  # 다른 대상이라고 가른 쌍을 합치게 되는 링크
                parent[b] = a
                status, reason = 'merged', link.basis
        pairs.add(pair)
        decisions.append(IdentityDecision(link=link, status=status, reason=reason))
    # 같은 종류·같은 이름은 기본으로 같은 대상이다. 모델이 이미 판단한 쌍, 앞선 후보가 둘 이상인 경우, 같은 회차에 같은 이름이 둘인 경우
    # (모델이 일부러 가른 것)는 묶지 않는다. 같은 이름이 앞 회차에 없을 때만 호칭 변형(치삼·치삼이)을 같은 이름으로 보아 같은 규칙으로 묶는다(#839).
    # 근거는 뒤 회차 대상의 검증된 인용이고, 결정 목록에 같은 링크로 남아 organize가 같은 결과를 다시 만든다.
    order = sorted(mentions, key=lambda ref: (episode(ref), ref))
    exact = lambda a, b: (mentions[a].kind, mentions[a].name) == (mentions[b].kind, mentions[b].name)  # noqa: E731
    alike = lambda a, b: (mentions[a].kind, _base(mentions[a].name)) == (mentions[b].kind, _base(mentions[b].name))  # noqa: E731
    for i, ref in enumerate(order):
        n = episode(ref)
        for same in (exact, alike):
            if any(episode(x) == n and x != ref and same(x, ref) for x in order):
                break
            earlier = {root(x): x for x in reversed(order[:i]) if episode(x) < n and same(x, ref)}  # 묶음마다 가장 앞 회차의 ref
            if len(earlier) > 1:
                break
            if not earlier:
                continue  # 같은 이름이 없으니 호칭 변형으로 다시 본다
            (top, left), = earlier.items()
            pair = frozenset((left, ref))
            if not (top == root(ref) or pair in pairs or any({root(r) for r in p} <= {top, root(ref)} for p in distinct)):
                pairs.add(pair)
                a, b = sorted((top, root(ref)))
                parent[b] = a
                decisions.append(IdentityDecision(link=IdentityLink(left=left, right=ref, basis='same_name', confirmedAt=n, evidenceEpisode=n,
                                                                    quote=mentions[ref].quote), status='merged', reason='same_name'))
            break
    decisions.sort(key=lambda d: (d.link.confirmedAt, min(d.link.left, d.link.right), max(d.link.left, d.link.right)))
    return IdentityResolution(inputHashes={n: _hash(json.dumps(row.model_dump(), sort_keys=True, ensure_ascii=False, separators=(',', ':'))) for n, row in rows.items()},
                              mapping={ref: _key(root(ref)) for ref in sorted(parent)}, decisions=decisions)


def resolve(extractions: dict[int, object]) -> IdentityResolution:
    """같은 종류·같은 이름은 기본으로 병합하고, 모델이 알린 동명이인·별칭 링크를 근거가 맞는 것만 적용한다. key는 정렬된 회차-local ID에서 결정한다."""
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


def _fit(lines):
    """같은 줄은 한 번만, 문서 한도(3,000자) 안에서 앞 회차부터 쌓는다. 줄은 자르지 않고 넘치는 줄부터 뺀다."""
    kept, size = [], -1
    for line in dict.fromkeys(lines):
        size += len(line) + 1
        if size > DOC_LIMIT:
            break
        kept.append(line)
    return kept


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
    _require(cards, 'NO_SETTINGS_FOUND')
    relations = []
    for n, row in rows.items():
        for statement in row.statements:
            subjects = sorted({identity.mapping[f'{n}:{ref}'] for ref in statement.subjects})
            text = _line(statement)
            if statement.kind == 'event':
                key = 'event-' + str(uuid5(NAMESPACE_URL, f'storyfork:manuscript:{n}:{statement.id}'))
                names = ', '.join(cards[k].title for k in subjects)
                cards[key] = Card(key=key, cardType='event', title=f'{n}화 · {statement.quote[:24]}', aliases=[],
                                  body=f'발생: {statement.occurredEpisode}화 / 참여: {names}\n{text}', firstEpisode=n)
            # 카드 본문(IDENTITY)·GOAL은 첫 등장 회차의 진술만 싣는다(회차 차원이 없어 뒤 회차 내용이 앞으로 새면 안 된다). 뒤 회차의 재서술은 싣지 않는다.
            # 인물의 SOUL만 뒤 회차의 soul 진술도 쌓는다(#839: 성격이 뒤 회차에 드러나는 조연이 SOUL 없이 남지 않게).
            # ponytail: 쌓인 SOUL은 회차 차원이 없어 시뮬레이션 기준 회차보다 뒤에 드러난 성격·말투가 섞인다. 회차별 SOUL은 episodes처럼 회차 키로 두는 별도 설계다.
            for key in subjects:
                if statement.document in ('identity', 'soul', 'goal') and (first[key] == n or (statement.document == 'soul' and key in docs)):
                    target = bodies[key] if statement.document == 'identity' or key not in docs else docs[key][statement.document]
                    target.append(text)
            # 인물의 명시적 인지 대상에만 기억을 넣는다. 시작 전 기억은 첫 등장 회차에서만 00이고, 뒤 회차에서 밝혀진 것은 그 회차 기억이다.
            for ref in statement.knowers:
                key = identity.mapping[f'{n}:{ref}']
                bucket = 0 if statement.knownFromEpisode == 0 and n == first[key] else n
                memory = docs[key]['episodes'].setdefault(f'{bucket:02}', [])
                if text not in memory: memory.append(text)
        for relation in row.relationships:
            source, target = (identity.mapping[f'{n}:{ref}'] for ref in (relation.source, relation.target))
            _require(source != target, 'MERGED_SELF_RELATION')
            relations.append(Relation(fromKey=source, toKey=target, label=relation.label, fromEpisode=relation.fromEpisode, ended=relation.ended))
    for key, lines in bodies.items():
        # 인물의 IDENTITY는 정체 진술이 없으면 비워 둔다(#839): 이름으로 채우면 시뮬레이션·화면의 필수 문서 검사가 빈 문서를 통과시킨다.
        # 다른 카드는 확정 버전에 본문이 필수라(Content) 이름을 그대로 둔다.
        cards[key].body = '\n'.join(dict.fromkeys(lines)) or ('' if key in docs else cards[key].title)
    for key, documents in docs.items():
        cards[key].characterDocs = CharacterDocs(soul='\n'.join(_fit(documents['soul'])),
            goal='\n'.join(dict.fromkeys(documents['goal'])), episodes={n: '\n'.join(lines) for n, lines in sorted(documents['episodes'].items())})
    # 문서 길이 한도는 추출 때(_validate) 대상별로 막았다. 그래도 넘치면 잘라내지 않고 재검증으로 실패시킨다.
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
