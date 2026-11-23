"""Content MCP 창구(DEC-49) 클라이언트: 작가가 승인한 Writing 결과를 그 작가의 권한으로 회차 초안에, 설정 보강 제안을 세계관 초안에, 계획 수정안을 플롯·장면 계획에 반영한다.

Stateless Streamable HTTP `{CONTENT_SERVICE_BASE_URL}/mcp`에 AI를 호출한 사용자의 Bearer를 그대로 보내고,
인가·revision 충돌 판단은 Content Service가 한다. 토큰은 요청마다 `AUTHORIZATION` 컨텍스트로만 받고
그래프 상태·체크포인트·추적에 넣지 않는다. Review·Q&A·시뮬레이션은 같은 창구로 원고·세계관을 읽는다. 승인 반영의 쓰기는 회차 초안 수정(`episode_update_draft`)과 세계관 초안 수정(`world_studio_edit_draft`), 계획 수정(`story_plan_update`)뿐이며
버전 저장(확정)·발행·삭제 도구는 부르지 않는다. 메인 에이전트의 직접 도구 10개(#554)는 `app/orchestration/mcp_tools.py`가 이 창구로 부른다(쓰기 4개는 작가 승인 뒤).
"""

import asyncio
import json
import os
import uuid
from contextvars import ContextVar

from agents.mcp import MCPServerStreamableHttp
from typing import Literal

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError

from app.content_mcp.errors import ContentMcpFailure

AUTHORIZATION: ContextVar[str] = ContextVar('content_mcp_authorization', default='')
# Content가 사용자에게 보여 줄 detail로 거절하는 상태. 그 밖의 도구 오류는 502로 닫는다.
PASSED_STATUSES = {401, 403, 404, 409, 422}
SELECTION_CHANGED = '선택한 문장이 초안에서 바뀌었거나 여러 곳에 있어 반영하지 않았어요. 다시 요청해 주세요.'
WORLD_CHANGED = '제안한 뒤 세계관 초안이 바뀌어 반영하지 않았어요. 다시 요청해 주세요.'
PLAN_CHANGED = '제안한 뒤 계획이 바뀌어 저장하지 않았어요. 다시 요청해 주세요.'


class DraftRevision(BaseModel):
    model_config = ConfigDict(strict=True)
    revision: int


class Draft(DraftRevision):
    title: str
    body: str
    authorNote: str | None = None


class EpisodeReadResponse(BaseModel):
    draft: Draft


class EpisodeUpdateResponse(BaseModel):
    draft: DraftRevision


class PlanItem(BaseModel):
    """계획 목록(story_plan_list)의 한 항목에서 대상을 고르는 데 쓰는 칸."""
    model_config = ConfigDict(strict=True)
    id: str
    kind: Literal['plot', 'scene']
    title: str
    parentId: str | None = None
    episodeNumber: int | None = None


class StoryPlan(PlanItem):
    """계획 상세(story_plan_read). 수정 저장에 되돌려 보낼 칸을 모두 담는다(position·episodeMissing은 보내지 않는다)."""
    content: str
    characterIds: list[str]
    placeIds: list[str]
    revision: int


def place(body: str, quote: str) -> int | None:
    """구절이 원고에 한 곳만 있으면 그 위치. str.count는 겹치는 출현('하하하'의 '하하')을 한 번으로 세서 쓰지 않는다(Content 규칙과 같다)."""
    at = body.find(quote)
    return at if at >= 0 and body.find(quote, at + 1) < 0 else None


def read_draft(work_id: str, number: int) -> Draft:
    """작가 권한으로 최신 초안과 revision을 읽는다."""
    try:
        return EpisodeReadResponse.model_validate(call('episode_read', {'id': work_id, 'number': number})).draft
    except ValidationError:
        raise ContentMcpFailure(502, 'Content 초안 응답을 확인할 수 없습니다.') from None


def render_writing(body: str, result: dict) -> tuple[str, tuple[int, int] | None]:
    """Text를 뒤에 잇거나 유일한 Patch 선택 구간을 바꾼다. Patch 위치는 원래 본문 기준이다."""
    if 'text' in result:
        return (f"{body}\n\n{result['text']}" if body.strip() else result['text']), None
    before = result['before']
    if (start := place(body, before)) is None:
        raise ContentMcpFailure(409, SELECTION_CHANGED)
    end = start + len(before)
    return body[:start] + result['after'] + body[end:], (start, end)


def apply_writing(work_id: str, number: int, result: dict, *, expected_revision: int | None = None) -> dict:
    """승인된 후보를 반영한다. 저장 직전의 revision 경쟁은 Content가 확인한다."""
    draft = read_draft(work_id, number)
    if expected_revision is not None and draft.revision != expected_revision:
        raise ContentMcpFailure(409, '검수한 뒤 초안이 바뀌어 반영하지 않았어요. 다시 요청해 주세요.')
    body, _ = render_writing(draft.body, result)
    saved = call('episode_update_draft', {'id': work_id, 'number': number, 'data': {
        'title': draft.title, 'body': body, 'revision': draft.revision, 'authorNote': draft.authorNote or ''}})
    try:
        revision = EpisodeUpdateResponse.model_validate(saved).draft.revision
    except ValidationError:
        raise ContentMcpFailure(502, 'Content 초안 저장 응답을 확인할 수 없습니다.') from None
    return {'episode': number, 'revision': revision}


def list_plans(work_id: str) -> list[PlanItem]:
    """작가 권한으로 작품의 플롯·장면 계획 목록을 읽는다. 소유자 검사는 Content가 한다."""
    try:
        return TypeAdapter(list[PlanItem]).validate_python(call('story_plan_list', {'workId': work_id}))
    except ValidationError:
        raise ContentMcpFailure(502, 'Content 계획 목록 응답을 확인할 수 없습니다.') from None


def read_plan(work_id: str, plan_id: str) -> StoryPlan:
    """작가 권한으로 계획 하나의 최신 값과 revision을 읽는다. 삭제·다른 작품이면 Content가 404로 답한다."""
    try:
        return StoryPlan.model_validate(call('story_plan_read', {'workId': work_id, 'id': plan_id}))
    except ValidationError:
        raise ContentMcpFailure(502, 'Content 계획 응답을 확인할 수 없습니다.') from None


def apply_plan(work_id: str, plan_id: str, revision: int, title: str, content: str) -> dict:
    """승인된 계획 수정안을 저장한다. 제목·내용만 바꾸고 나머지 칸은 다시 읽은 값 그대로 보내며 position은 보내지 않아 순서가 바뀌지 않는다.

    revision은 제안을 만든 때의 값이다. 읽은 계획이 그 revision이 아니면 쓰지 않고 409다(저장 직전 경쟁은 Content가 같은 revision으로 다시 막는다).
    """
    current = read_plan(work_id, plan_id)
    if current.revision != revision:
        raise ContentMcpFailure(409, PLAN_CHANGED)
    saved = call('story_plan_update', {'workId': work_id, 'id': plan_id, 'data': {
        'kind': current.kind, 'parentId': current.parentId, 'title': title, 'content': content, 'episodeNumber': current.episodeNumber,
        'characterIds': current.characterIds, 'placeIds': current.placeIds, 'revision': revision}})
    new = saved.get('revision') if isinstance(saved, dict) else None
    if not isinstance(new, int) or isinstance(new, bool):
        raise ContentMcpFailure(502, 'Content 계획 저장 응답을 확인할 수 없습니다.')
    return {'planId': plan_id, 'revision': new}


def apply_world(world_id: str, revision: int, fixes: list[dict]) -> dict:
    """승인된 설정 보강 제안(fixes)을 세계관 초안의 그 칸에만 반영한다. 읽은 초안 revision이 제안 때와 다르면 409로 쓰지 않는다.

    Content의 세계관 편집은 replace=false면 보낸 카드만 갱신하고 관계는 보낸 것만 갱신하므로, 고친 카드만 보내고 관계는 보내지 않아 다른 카드와
    관계는 저장된 그대로 남는다. 고친 카드도 칸 하나만 바꾼 채 읽은 그대로(별칭·태그·공개 범위·메타데이터) 돌려보낸다. 확정 버전은 만들지 않는다.
    """
    read = call('world_studio_read', {'id': world_id})
    try:
        current, name, description = read['draftRevision'], read['name'], read.get('description') or ''
        cards = {c['id']: c for c in read['cards'] if c.get('lifecycle') != 'removed'}
    except (LookupError, TypeError, AttributeError):
        raise ContentMcpFailure(502, 'Content 세계관 응답을 확인할 수 없습니다.') from None
    if current != revision:
        raise ContentMcpFailure(409, WORLD_CHANGED)
    edited: dict[str, dict] = {}
    for fix in fixes:
        card = edited.get(fix['cardId']) or cards.get(fix['cardId'])
        if card is None or (fix['target'] != 'body' and card.get('cardType') != 'character'):
            raise ContentMcpFailure(409, WORLD_CHANGED)
        _replace_cell(card, fix)
        edited[card['id']] = card
    saved = call('world_studio_edit_draft', {'id': world_id, 'request': {
        'expectedDraftRevision': revision, 'name': name, 'description': description, 'key': uuid.uuid4().hex, 'replace': False,
        'cards': list(edited.values())}})
    new = saved.get('draftRevision') if isinstance(saved, dict) else None
    if not isinstance(new, int):
        raise ContentMcpFailure(502, 'Content 세계관 저장 응답을 확인할 수 없습니다.')
    return {'worldId': world_id, 'revision': new}


def edit_world(arguments: dict) -> dict:
    """메인 에이전트의 `world_studio_edit_draft` 호출을 실행한다(#554). 항상 replace=false라 보낸 카드만 바꾸고 다른 카드·관계는 저장된 그대로 남는다.

    Content는 replace=false여도 보낸 카드를 통째로 바꾸므로(빠진 선택 필드는 기본값으로 돌아간다) 모델이 일부 필드만 보내도 읽은 카드 위에 덮어서 보낸다.
    본문을 바꾸면 화면이 읽는 사본(studio.item.text)도 함께 맞춘다. expectedDraftRevision을 모델이 주면 그대로 쓰고 어긋나면 Content가 409로 거절한다.
    """
    world_id, given = arguments.get('id'), arguments.get('request')
    if given is None and 'cards' in arguments:  # 모델이 request로 감싸지 않고 평평하게 보낸 호출도 같은 입력으로 본다
        given = {k: v for k, v in arguments.items() if k != 'id'}
    if not isinstance(world_id, str) or not isinstance(given, dict) or not isinstance(given.get('cards', []), list):
        raise ContentMcpFailure(422, '세계관 수정 요청 형식이 올바르지 않아요.')
    read = call('world_studio_read', {'id': world_id})
    try:
        current, name, description = {c['id']: c for c in read['cards']}, read['name'], read.get('description') or ''
    except (LookupError, TypeError, AttributeError):
        raise ContentMcpFailure(502, 'Content 세계관 응답을 확인할 수 없습니다.') from None
    cards = []
    for card in given.get('cards', []):
        old = current.get(card.get('id') if isinstance(card, dict) else None)
        if not isinstance(card, dict) or (old is None and not {'title', 'body', 'cardType', 'areaCode'} <= card.keys()):
            raise ContentMcpFailure(422, '세계관 수정 요청 형식이 올바르지 않아요.')
        merged = {**(old or {}), **card, 'semanticMetadata': _merge_metadata((old or {}).get('semanticMetadata'), card.get('semanticMetadata'))}
        if old is not None and 'body' in card:
            _replace_cell(merged, {'target': 'body', 'text': card['body']})
        item = ((merged['semanticMetadata'].get('studio') or {}).get('item'))
        if old is not None and 'title' in card and isinstance(item, dict) and 'title' in item:
            item['title'] = card['title']  # 화면이 읽는 이름 사본(studio.item.title)도 함께 맞춘다
        cards.append(merged)
    if not isinstance(given.get('expectedDraftRevision'), int):  # 읽은 revision 없이 저장하면 그 사이 바뀐 초안을 덮어쓴다
        raise ContentMcpFailure(422, '세계관을 읽은 revision(expectedDraftRevision)이 필요해요.')
    request = {'name': name, 'description': description, 'key': uuid.uuid4().hex,
               **{k: v for k, v in given.items() if k != 'cards'}, 'replace': False, 'cards': cards}
    return call('world_studio_edit_draft', {'id': world_id, 'request': request})


def _merge_metadata(old: dict | None, new: dict | None) -> dict:
    """읽은 카드의 semanticMetadata 위에 모델이 보낸 값을 덮는다. 화면이 읽는 `studio`와 그 `item`은 한 단계 더 합친다: 모델이 null인 칸을 빼 보내면 화면이 세계관 전체를 읽지 못하기 때문이다."""
    old, new = old or {}, new or {}
    merged = {**old, **new}
    if isinstance(old.get('studio'), dict) and isinstance(new.get('studio'), dict):
        merged['studio'] = {**old['studio'], **new['studio']}
        if isinstance(old['studio'].get('item'), dict) and isinstance(new['studio'].get('item'), dict):
            merged['studio']['item'] = {**old['studio']['item'], **new['studio']['item']}
    return merged


def _replace_cell(card: dict, fix: dict) -> None:
    """카드 하나의 칸 하나를 새 글로 바꾼다(제자리). body는 카드 본문(인물은 IDENTITY), soul·goal·episode는 semanticMetadata.characterDocs의 칸이다."""
    if fix['target'] == 'body':
        card['body'] = fix['text']
        # 화면이 만든 카드는 semanticMetadata.studio.item.text가 본문의 사본이다. 프런트는 둘이 다르면 세계관 전체를 읽지 못하므로(HttpWorldStudioRepository.world())
        # 사본이 있을 때 같이 맞춘다. 사본이 없는 카드(옛 Seeder·부분 studio)에는 새 키를 만들지 않는다. 인물 문서는 studio 안에 사본이 없다.
        studio = (card.get('semanticMetadata') or {}).get('studio')
        item = studio.get('item') if isinstance(studio, dict) else None
        if isinstance(item, dict) and 'text' in item:
            item['text'] = fix['text']
        return
    metadata = card['semanticMetadata'] = card.get('semanticMetadata') or {}
    docs = metadata['characterDocs'] = {'soul': '', 'goal': '', 'episodes': {}, **(metadata.get('characterDocs') or {})}
    if fix['target'] == 'episode':
        docs['episodes'] = {**(docs.get('episodes') or {}), str(fix['episode']): fix['text']}
    else:
        docs[fix['target']] = fix['text']


def inherited_world(work_id: str, episode: int) -> dict | None:
    """연결한 세계관이 없는 Fork가 이어받는 원작 세계관(읽기 전용, #365)을 `world_studio_read` 응답 모양으로 읽는다. 이어받는 것이 없으면 None이다.

    Content가 공개 카드와 그 카드끼리의 관계만, 지식 상한은 Fork 기준 회차(`episode`가 더 작으면 그 회차)로 걸러 준다. 인물 문서(SOUL·GOAL·회차 기억)는 작가용이라 없다.
    관계를 읽을 수 없으면(`unavailable`) 관계 없이 진행하지 않고 실패한다(`world_studio_read`가 관계 저장 미완료에 503으로 답하는 것과 같다).
    """
    read = call('work_inherited_world', {'id': work_id, 'upto': str(episode)})
    if not isinstance(read, dict):
        raise ContentMcpFailure(502, 'Content MCP 결과를 확인할 수 없습니다.')
    if read.get('worldId') is None:
        return None
    if read.get('relationshipStatus') != 'current':
        raise ContentMcpFailure(503, '원작 세계관의 관계를 읽을 수 없어요.')
    return read


def linked_world(work_id: str, episode: int) -> dict | None:
    """작품에 연결된 세계관을 그 회차 시점 관계로 읽는다(`world_studio_read(episode)`). 연결이 없으면 Fork가 이어받는 원작 세계관(#365)을 읽고,
    그것도 없으면 None이다(대체 세계관을 찾지 않는다). Review·Q&A가 같은 세계관을 기준으로 쓰게 하는 한 곳이다.
    """
    try:
        linked = next((w['worldId'] for w in call('world_studio_list', {}) if w.get('linkedWorkId') == work_id), None)
    except (LookupError, TypeError, AttributeError):
        raise ContentMcpFailure(502, 'Content MCP 결과를 확인할 수 없습니다.') from None
    if linked is None:
        return inherited_world(work_id, episode)
    # None 등 dict가 아닌 응답을 '세계관 없음'으로 오인하지 않게 여기서 막는다(inherited_world와 같은 규칙).
    if not isinstance(read := call('world_studio_read', {'id': linked, 'episode': str(episode)}), dict):
        raise ContentMcpFailure(502, 'Content MCP 결과를 확인할 수 없습니다.')
    return read


# shortcut: 도구 목록(이름·설명·inputSchema)을 프로세스 안에 한 번 받아 두고 Content가 바뀌어도 다시 받지 않는다. 도구 스키마를 배포 중에 바꾸게 되면 만료·재조회를 둔다.
_SPECS: dict[str, dict] = {}


async def tool_specs(names: tuple[str, ...]) -> list[dict]:
    """Content MCP `list_tools`에서 허용 목록(names)의 도구 {name, description, schema}만 돌려준다. 인증은 사용자 Bearer를 함께 보낸다(공개 도구 목록도 같은 길이다)."""
    if not _SPECS:
        base, authorization = os.environ.get('CONTENT_SERVICE_BASE_URL'), AUTHORIZATION.get()
        if not base:
            raise ContentMcpFailure(503, 'Content MCP 설정이 필요합니다.')
        try:
            listed = await _list(f'{base.rstrip("/")}/mcp', authorization)
        except Exception:  # 연결·프로토콜 오류. 메시지에 입력이 섞일 수 있어 고정 문구만 쓴다.
            raise ContentMcpFailure(503, 'Content MCP를 호출할 수 없습니다.') from None
        _SPECS.update({t.name: {'name': t.name, 'description': t.description or '', 'schema': t.input_schema} for t in listed})
    return [_SPECS[n] for n in names if n in _SPECS]


async def _list(url: str, authorization: str):
    headers = {'Authorization': authorization} if authorization else {}
    async with MCPServerStreamableHttp({'url': url, 'headers': headers, 'timeout': 20}, client_session_timeout_seconds=20) as server:
        return await server.list_tools()


def call(tool: str, arguments: dict) -> dict:
    """도구 하나를 호출하고 JSON 결과를 돌려준다. 도구 오류는 Content의 상태·detail을 유지한다."""
    base, authorization = os.environ.get('CONTENT_SERVICE_BASE_URL'), AUTHORIZATION.get()
    if not base:
        raise ContentMcpFailure(503, 'Content MCP 설정이 필요합니다.')
    if not authorization:
        raise ContentMcpFailure(401, '사용자 인증을 확인할 수 없어요. 다시 로그인한 뒤 승인해 주세요.')
    try:
        is_error, text = asyncio.run(_request(f'{base.rstrip("/")}/mcp', authorization, tool, arguments))
    except Exception:  # 연결·프로토콜 오류. 예외 메시지에 원고가 섞일 수 있어 고정 문구만 쓴다.
        raise ContentMcpFailure(503, 'Content MCP를 호출할 수 없습니다.') from None
    if is_error:
        raise _failure(text)
    try:
        return json.loads(text)
    except ValueError:
        raise ContentMcpFailure(502, 'Content MCP 결과를 확인할 수 없습니다.') from None


async def _request(url: str, authorization: str, tool: str, arguments: dict) -> tuple[bool, str]:
    async with MCPServerStreamableHttp({'url': url, 'headers': {'Authorization': authorization}, 'timeout': 20},
                                       client_session_timeout_seconds=20) as server:
        result = await server.call_tool(tool, arguments)
    return result.is_error, ''.join(getattr(block, 'text', '') for block in result.content)


def _failure(text: str) -> ContentMcpFailure:
    """도구 오류 텍스트는 첫 줄 `HTTP <상태>[ <코드>]`, 둘째 줄 detail이다(docs/design/content-mcp-contract.md 오류 형식)."""
    head, _, detail = text.partition('\n')
    parts = head.split()
    status = int(parts[1]) if len(parts) > 1 and parts[0] == 'HTTP' and parts[1].isdigit() else None
    if status not in PASSED_STATUSES:
        return ContentMcpFailure(502, 'Content 작업에 실패했습니다.')
    return ContentMcpFailure(status, detail.strip()[:200] or 'Content 작업을 완료할 수 없습니다.')
