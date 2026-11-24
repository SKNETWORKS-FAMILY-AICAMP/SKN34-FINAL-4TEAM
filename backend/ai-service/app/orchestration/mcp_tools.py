"""메인 에이전트가 직접 쓰는 Content MCP 도구 10개(#554, DEC-59). 서브 에이전트(`ask_*`)에 해당하지 않는 간단한 작업용이다.

읽기 6개는 자동으로 실행하고 쓰기 4개는 `HumanInTheLoopMiddleware`가 작가 승인을 받은 뒤에만 실행한다. 원고(`episode_update_draft`)는 넣지 않는다:
원고는 기존 `ask_writing` + `apply` 경로로만 고친다. 허용 목록 밖의 도구는 Content가 알려 줘도 감싸지 않는다.

도구 이름·설명·inputSchema는 Content MCP `list_tools`가 알려 주고(`content_mcp.tool_specs`) 여기서는 LangChain 도구 모양만 입힌다. 실제 실행은 이 도구 함수가 아니라
`DynamicToolMiddleware.awrap_tool_call`이 `execute`로 한다(승인 뒤 단계 기록·한도·실패 처리를 한 곳에서 하려고). 호출은 작가 Bearer를 쓰는 `content_mcp.call`이고
모델이 준 id는 인가 근거가 아니다(권한은 Content가 확인한다). 작품 id만 대상 작품(target)과 같아야 한다.
"""

import asyncio
import json

from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.types import Command, interrupt

from app import tracing
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.orchestration.models import CONTENT_ACTION

MCP_CALLS = 10  # 턴당 MCP 도구 호출 상한. 서브 에이전트 한도(TOOL_CALLS)와 따로 센다.
READ_LIMIT = 20000  # 읽기 결과를 모델에 주는 최대 글자 수(Content 응답이 길면 잘라서 알린다)
# 읽기(자동 실행) 6개와 쓰기(승인 뒤 실행) 4개의 한국어 고정 문구. 쓰기 문구는 승인 카드의 제목이다.
READ = {'world_studio_read': '세계관 읽기', 'episode_read': '회차 읽기', 'episode_list': '회차 목록 읽기', 'work_read': '작품 읽기',
        'story_plan_list': '계획 목록 읽기', 'story_plan_read': '계획 읽기'}
WRITE = {'world_studio_edit_draft': '세계관 설정 카드 수정', 'work_update': '작품 정보 수정', 'story_plan_create': '플롯·장면 계획 추가',
         'story_plan_update': '플롯·장면 계획 수정'}
LABELS = {**READ, **WRITE}
# Content의 도구 설명만으로는 모델이 request를 풀어 평평하게 보내는 일이 있어 모양을 덧붙인다.
HINTS = {'world_studio_edit_draft': ' 인자는 {id, request: {expectedDraftRevision(world_studio_read의 draftRevision), name, description, key, replace: false, cards: [바꿀 카드]}} 모양이다. 바꿀 카드만 cards에 넣는다.'}
NAMES = tuple(LABELS)
WORK_ID = {'episode_read': 'id', 'episode_list': 'id', 'work_read': 'id', 'work_update': 'id', 'story_plan_list': 'workId',
           'story_plan_read': 'workId', 'story_plan_create': 'workId', 'story_plan_update': 'workId'}
NOT_THIS_WORK = '지금 보는 작품이 아닌 작품은 다룰 수 없어요.'
NOT_THIS_WORLD = '지금 보는 작품에 연결된 세계관이 아닌 세계관은 다룰 수 없어요.'
WORLD_TOOLS = ('world_studio_read', 'world_studio_edit_draft')
LIMIT_REACHED = '이번 요청에서 부를 수 있는 Content 도구 횟수를 넘었어요.'


# 도구 목록을 못 읽은 턴의 답 끝에 붙이는 안내(#639, 2026-11-23 사용자 결정: 진행하되 작가가 알아듣는 말로 알린다).
UNAVAILABLE = '지금은 작품 정보·세계관·플롯 계획을 불러올 수 없어서, 이번 답에서는 이것들을 직접 확인하거나 고치지 못했어요. 잠시 후 다시 시도해 주세요.'


async def specs() -> list[dict] | None:
    """허용 목록의 도구 정의. Content MCP를 읽을 수 없으면 None: 이번 턴은 MCP 도구 없이 서브 에이전트만 쓰고 답 끝에 UNAVAILABLE을 붙인다."""
    try:
        return await content_mcp.tool_specs(NAMES)
    except ContentMcpFailure:
        return None


def tools(found: list[dict]) -> list[StructuredTool]:
    """모델에 보일 도구 모양. func는 쓰지 않는다(미들웨어가 가로채 실행한다)."""
    def never(**_):
        raise RuntimeError('Content MCP 도구는 DynamicToolMiddleware가 실행한다.')
    return [StructuredTool(name=s['name'], description=s['description'] + HINTS.get(s['name'], ''), args_schema=s['schema'], func=never) for s in found if s['name'] in LABELS]


def _result(step: dict | None, call: dict, content: str, failed: bool = False, **update) -> Command:
    message = ToolMessage(content=content, tool_call_id=call['id'], name=call['name'], status='error' if failed else 'success')
    return Command(update={'mcpCalls': 1, 'messages': [message], **({'steps': [step]} if step else {}), **update})


def _failed(call: dict, label: str, error: ContentMcpFailure) -> Command:
    """쓰기 실패: 단계 failed로 남겨 남은 호출을 막는다(다시 시도하거나 덮어쓰지 않는다)."""
    step = {'feature': CONTENT_ACTION, 'when': 'always', 'status': 'failed', 'error': str(error)}
    return _result(step, call, f'[실패] {label}: {error}', failed=True)


def mismatch(call: dict, turn: dict) -> str | None:
    """작품 id를 받는 도구가 대상 작품이 아닌 작품을, 화면에 세계관이 열려 있으면 세계관 도구가 그 세계관이 아닌 세계관을 가리키면 이유 글. 대상 작품이 없으면 작품 도구는 쓸 수 없다.

    화면에 세계관이 없을 때(집필실)는 그 세계관이 작품에 연결된 것인지 실행 직전에 `_run`이 Content에서 확인한다.
    """
    args = call['args'] if isinstance(call['args'], dict) else {}
    if key := WORK_ID.get(call['name']):
        return None if args.get(key) == (turn.get('target') or {}).get('workId') else NOT_THIS_WORK
    seen = (turn.get('page') or {}).get('worldId')
    return NOT_THIS_WORLD if seen and args.get('id') != seen else None


def _run(name: str, args: dict, turn: dict):
    if name in WORLD_TOOLS and not (turn.get('page') or {}).get('worldId'):
        work = (turn.get('target') or {}).get('workId')
        linked = content_mcp.call('work_read', {'id': work}).get('worldStudioId') if work else None
        if not linked or args.get('id') != linked:
            raise ContentMcpFailure(422, NOT_THIS_WORLD)
    return content_mcp.edit_world(args) if name == 'world_studio_edit_draft' else content_mcp.call(name, args)


async def execute(request) -> Command:
    """허용된 MCP 도구 호출 하나를 실행한다. 승인(쓰기)은 이 호출 전에 끝나 있다.

    읽기는 결과 JSON을 모델에 그대로(길면 잘라) 주고 단계를 남기지 않는다(읽기 실패도 오류 메시지만 준다). 쓰기는 성공하면 단계(content_action, applied=새 revision)를 남겨 화면이 다시 읽게 하고,
    실패(Content의 409 revision 충돌 포함)는 단계 failed로 남겨 남은 호출을 막는다(다시 시도하거나 덮어쓰지 않는다). 단 work_update의 409는 실패로 끝내지 않고
    작품을 다시 읽어 최신 revision의 카드로 다시 승인받으며, 쓰는 것은 작가가 승인한 카드의 인자 그대로다(그 사이 또 낡아 409면 다시 묻는다, #687).
    """
    call, turn = request.tool_call, request.runtime.context
    # 모델이 고르지 않은 선택 인자를 빈 글("")·null로 채우면 Content가 값 오류(422)로 거절하므로 뺀다.
    name, args = call['name'], {k: v for k, v in (call['args'] if isinstance(call['args'], dict) else {}).items() if v not in ('', None)}
    label = LABELS[name]
    if reason := mismatch(call, turn):
        return _result(None, call, f'[차단] {label}: {reason}', failed=True)
    write = name in WRITE
    if write:
        request.runtime.stream_writer({'started': CONTENT_ACTION})
    while True:
        try:
            with tracing.observe(f'mcp.{name}', as_type='tool'):
                done = await asyncio.to_thread(_run, name, args, turn)
            break
        except ContentMcpFailure as error:
            if not write:  # 읽기 실패(예: 잘못된 인자 422)는 단계로 남기지 않고 모델이 사유를 보고 다시 부르게 한다(횟수는 MCP 한도가 막는다)
                return _result(None, call, f'[실패] {label}: {error}', failed=True)
            if not (name == 'work_update' and error.status == 409):  # work_update의 409는 revision 충돌뿐이다(WorkService.update)
                return _failed(call, label, error)
            # 원고(회차 초안) 저장도 작품 revision을 올려 제안이 낡는다(#687). revision만 새로 읽어 같은 수정을 다시 승인받는다.
            # 모델에 다시 제안시키면 '같은 턴에 같은 도구를 다시 부르지 않는다'(지시 규칙 5)와 부딪쳐 실모델이 포기한다(E2E 확인).
            try:
                fresh = await asyncio.to_thread(content_mcp.call, 'work_read', {'id': args['id']})
            except ContentMcpFailure as unread:
                return _failed(call, label, unread)
            card = {**args, 'data': {**args['data'], 'revision': fresh.get('revision')}}
            # 이어 갈 때 이 함수가 처음부터 다시 돌아(낡은 호출은 409로 끝나 쓰지 않는다) 다시 읽은 revision이 그 사이 달라졌을 수 있다. 그래서 쓰는 것은
            # 다시 읽은 값이 아니라 작가가 답한 카드의 인자(service._target이 결정에 싣는다)다. 그 사이 또 낡아 409면 이 자리로 돌아와 최신 revision으로 다시 묻는다.
            decision = interrupt({'action_requests': [{'name': name, 'args': card, 'description': label}], 'steps': request.state.get('steps', [])})['decisions'][0]
            if decision['type'] != 'approve':
                return _result(None, call, decision.get('message', ''), failed=True)
            args = decision['args']
    if not write:
        text = json.dumps(done, ensure_ascii=False, separators=(',', ':'))
        return _result(None, call, text if len(text) <= READ_LIMIT else f'{text[:READ_LIMIT]}…(길어서 여기까지만 읽었어요)')
    revision = next((done[k] for k in ('draftRevision', 'revision') if isinstance(done, dict) and isinstance(done.get(k), int)), 0)
    step = {'feature': CONTENT_ACTION, 'when': 'always', 'status': 'completed', 'result': {'tool': name, 'label': label}, 'approval': 'approved',
            'applied': {'episode': (turn.get('target') or {}).get('episode', 0), 'revision': revision}}
    return _result(step, call, json.dumps({'tool': name, 'status': 'applied', 'revision': revision}))
