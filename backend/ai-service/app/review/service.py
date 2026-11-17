"""원고 검수(#59): 작가의 회차 초안을 Mechanical·Semantic 중 하나 또는 둘 다(both, 병렬)로 검수해 위치·이유·근거가 있는 지적을 돌려준다.

초안과 세계관은 Content MCP(DEC-49)로 요청한 작가의 권한으로 읽는다. Mechanical은 초안만, Semantic은 초안과 그 회차 시점에
공개된 세계관 설정(카드·관계)만 모델에 보낸다. Simulation은 부르지 않는다. 결과는 제안이며 원고를 고치지 않는다.
모델이 원고에 없는 구절·보내지 않은 근거·다른 검사 종류의 분류를 쓰면 고치지 않고 실패한다.
"""

import contextvars
from concurrent.futures import ThreadPoolExecutor

from app.content_mcp import service as content_mcp
from app.novelbrain.models import WorldSnapshot, world_snapshot
from app.review import agent
from app.review.errors import ReviewFailure
from app.review.models import CATEGORIES, Finding, ReviewRequest, ReviewResponse

EMPTY_DRAFT = '검수할 초안 본문이 없어요.'
NO_LINKED_WORLD = '이 작품에 연결된 세계관이 없어 설정 검수를 할 수 없어요.'
BAD_CONTENT = 'Content 응답을 확인할 수 없습니다.'
BAD_FINDING = '검수 모델 응답의 위치·근거를 확인할 수 없습니다.'


def review(data: ReviewRequest) -> ReviewResponse:
    try:
        draft = content_mcp.call('episode_read', {'id': data.workId, 'number': data.episode})['draft']
        body, revision = draft['body'], draft['revision']
    except (LookupError, TypeError):
        raise ReviewFailure(502, BAD_CONTENT) from None
    if not isinstance(body, str) or not isinstance(revision, int):
        raise ReviewFailure(502, BAD_CONTENT)
    if not body.strip():
        raise ReviewFailure(422, EMPTY_DRAFT)
    checks = ('semantic', 'mechanical') if data.check == 'both' else (data.check,)
    settings = _settings(_world(data.workId, data.episode), data.episode) if 'semantic' in checks else []
    inputs = [(c, body, settings if c == 'semantic' else []) for c in checks]
    if len(inputs) == 1:
        results = [agent.review(*inputs[0])]
    else:  # 두 검수는 서로의 결과를 쓰지 않아 동시에 부른다. 추적 문맥(contextvars)은 스레드마다 복사해 넘긴다.
        with ThreadPoolExecutor(len(inputs)) as pool:
            results = [run.result() for run in [pool.submit(contextvars.copy_context().run, agent.review, *i) for i in inputs]]
    refs = {s['ref'] for s in settings}
    findings, gaps, metas = [], [], []
    for check, (result, meta) in zip(checks, results):
        findings += [_locate(body, found) for found in result.findings if _valid(check, body, found, refs)]
        gaps += result.gaps
        metas.append(meta)
    usages = [m['usage'] for m in metas]
    usage = None if None in usages else {k: sum(u[k] for u in usages) for k in ('inputTokens', 'outputTokens')}
    return ReviewResponse(workId=data.workId, episode=data.episode, revision=revision, check=data.check, findings=findings,
                          gaps=gaps, model=metas[0]['model'], providerResponseId=','.join(m['providerResponseId'] for m in metas),
                          usage=usage)


def _valid(check: str, body: str, found, refs: set[str]) -> bool:
    """원고에 있는 구절·그 검수의 분류·보낸 근거만 받는다. Mechanical은 설정을 받지 않았으므로 근거가 없어야 한다."""
    allowed = refs if check == 'semantic' else set()
    if (not found.quote or found.quote not in body or found.category not in CATEGORIES[check]
            or not set(found.evidenceRefs) <= allowed
            or (check == 'semantic' and found.status == 'confirmed' and not found.evidenceRefs)):
        raise ReviewFailure(502, BAD_FINDING)
    return True


def _locate(body: str, found) -> Finding:
    if (at := content_mcp.place(body, found.quote)) is not None:
        start = _utf16(body[:at])
        return Finding(**found.model_dump(), start=start, end=start + _utf16(found.quote))
    # 같은 구절이 여러 곳이면 위치를 추측하지 않고, 위치를 모르는 지적은 확정하지 않는다
    status = 'suspected' if found.status == 'confirmed' else found.status
    return Finding(**found.model_dump(exclude={'status'}), status=status, start=None, end=None)


def _world(work_id: str, episode: int) -> WorldSnapshot:
    """작품에 연결된 세계관을 그 회차 시점 관계로 읽는다. 연결이 없으면 Fork가 이어받는 원작 세계관(읽기 전용, #365)을 읽고, 그것도 없으면 대체 세계관을 찾지 않고 실패한다."""
    try:
        linked = next((w['worldId'] for w in content_mcp.call('world_studio_list', {}) if w.get('linkedWorkId') == work_id), None)
    except (LookupError, TypeError, AttributeError):
        raise ReviewFailure(502, BAD_CONTENT) from None
    if linked is not None:
        read = content_mcp.call('world_studio_read', {'id': linked, 'episode': str(episode)})
    elif (read := content_mcp.inherited_world(work_id, episode)) is None:
        raise ReviewFailure(409, NO_LINKED_WORLD)
    try:
        return world_snapshot(read, episode)
    except ValueError:
        raise ReviewFailure(502, BAD_CONTENT) from None


def _settings(world: WorldSnapshot, episode: int) -> list[dict]:
    """그 회차까지 공개된 카드(인물은 그 회차까지의 기억)와 두 끝이 모두 공개된 관계. 이후 회차 정보는 검수 근거가 아니다."""
    cards = {c.id: c for c in world.cards if c.revealFromEpisode is None or c.revealFromEpisode <= episode}
    settings = []
    for c in cards.values():
        memories = [f'{n}화: {t}' for n, t in sorted(c.episodes.items()) if n <= episode]
        text = '\n\n'.join(t for t in (c.text, c.soul, c.goal, *memories) if t.strip())
        settings.append({'ref': f'card:{c.id}', 'type': c.cardType, 'title': c.title, 'text': text})
    for r in world.relations:
        if r.source in cards and r.target in cards:
            label = f'{r.label}(아님)' if r.polarity == 'denied' else r.label
            settings.append({'ref': f'relation:{r.id}', 'type': 'relation',
                             'title': f'{cards[r.source].title} → {cards[r.target].title}', 'text': f'{label}\n{r.body}'.strip()})
    return settings


def _utf16(text: str) -> int:
    """Content 선택 구간과 같은 UTF-16 코드 단위 길이."""
    return len(text.encode('utf-16-le')) // 2
