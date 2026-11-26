"""메인 에이전트의 서브 에이전트 도구 `ask_*` 7종(#473)과 작가에게 선택지로 되묻는 `ask_author`(#794). 각 서브 에이전트 도구는 기존 업무 Agent 서비스를 그대로 감싼다.

모델이 정하는 인자는 작업 지시 `request`(2,000자 이하)와 열거형(`check`·`task`·`fix`)뿐이다. 작품·회차·revision·scope 토큰·선택 구간·
외부 전송 동의는 도구가 Content가 확인한 상태(바깥 그래프 상태 = 실행 context, 메인 에이전트 상태의 inputs·retrievalScope)에서 읽는다.
모델이 만든 ID·문구는 인가 근거가 아니다. 결과는 단계(steps[])에 기능·상태·원본 결과로 남기고, ToolMessage의 content는 메인 에이전트가
읽을 요약 JSON, artifact는 원본 결과다. 기능 실패는 `[실패] <기능>: <고정 문구>`와 단계 failed, 조건이 거짓이면 skipped다.

작가 입력이 빠지면 도구 안에서 interrupt({steps, missingInputs})로 멈춘다(기존 waiting·resume 계약). interrupt 앞에는 부수효과를 두지 않는다
(resume 때 그 도구 호출만 처음부터 다시 실행된다). 대화가 없으면 멈출 수 없어 needs_input, 작가가 거절하면 cancelled로 남은 호출을 막는다.
인물 시뮬레이션은 계획(모델 호출)만 이 도구가 하고 장면은 바깥 그래프의 scene 노드가 쓴다. 장면은 턴마다 멈추는데 도구 안에서 쓰면
resume마다 계획 모델 호출이 interrupt 앞에서 다시 일어나기 때문이다.
서브 에이전트는 다른 서브 에이전트를 부르지 않고 사용자에게 직접 묻지 않는다.
"""

import json
from collections.abc import Callable
from typing import Annotated, Literal
from uuid import uuid4

from langchain.tools import ToolRuntime
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.types import Command, interrupt
from pydantic import Field

from app import agent_runtime, tracing
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.intent.prompt import CAPABILITY_NAMES, FEATURES
from app.novelbrain.models import world_snapshot
from app.novelbrain.service import episode_settings
from app.rating import service as rating
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest
from app.research import service as research
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest
from app.retrieval import service as retrieval
from app.retrieval.errors import RetrievalFailure, RetrievalUnavailable
from app.retrieval.models import RetrievalScope
from app.manuscript_review import service as manuscript_review
from app.manuscript_review.errors import ReviewFailure
from app.manuscript_review.models import ReviewRequest
from app.simulation import service as simulation
from app.simulation.errors import SimulationFailure
from app.simulation.models import GAP_LABELS, SimulationPlan
from app.story_qa import service as story_qa
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import AnswerRequest
from app.orchestration.models import CHOICES_MAX, REQUEST_MAX, Choice, QaStepResult, current_feature, utf16_len
from app.world_review import service as world_review
from app.world_review.errors import WorldReviewFailure
from app.writing import agent as writing
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest, PlanBrief, PlanPickRequest, PlanRequest, PlanReviseRequest

Request = Annotated[str, Field(max_length=REQUEST_MAX, description='서브 에이전트에게 줄 작업 지시. 작가 요청과 이번 턴 앞선 결과의 요약을 담을 수 있다.')]
# shortcut: 최근 5턴만 넘기고 요약하지 않는다. 긴 대화의 앞부분 지칭이 필요해지면 요약을 검토한다.
HISTORY_TURNS = 5
GUARD_TURNS, GUARD_REPLY = 3, 300  # Decision Guard가 받는 이전 턴 수와 답변 앞부분 글자 수(#781). 판정 입력을 짧게 두어 끌려감·지연을 줄인다
FAILURES = (StoryQaFailure, WritingFailure, ResearchFailure, RetrievalFailure, SimulationFailure, ContentMcpFailure, ReviewFailure,
            WorldReviewFailure, RatingFailure)
NO_REVIEW_TARGET = '검수할 작품과 회차를 확인할 수 없어요.'
NO_QA_TARGET = '질문할 작품과 회차를 확인할 수 없어요.'
NO_PUBLISHED = '발행한 회차가 없어 원고는 근거로 쓰지 않았어요. 세계관 설정만 봤어요.'
NO_RATING_TARGET = '심의 등급을 판별할 작품과 회차를 확인할 수 없어요.'
NO_WORLD_TARGET = '세계관을 다룰 작품을 확인할 수 없어요.'
NO_WRITING_TARGET = '기획하거나 쓸 작품과 회차를 확인할 수 없어요.'
CONTEXT_TOO_LONG = '허용 문맥이 너무 길어요. 기준 회차나 원고 분량을 줄여 주세요.'
NO_WORLD_SETTINGS = '이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.'
BAD_WORLD = 'Content 세계관 응답을 확인할 수 없습니다.'
NO_ISSUES = '검수에서 고칠 문제를 찾지 못해 수정하지 않았어요.'
ONLY_SUSPECTED = '확정된 문제가 없어 자동으로 고치지 않았어요. 의심 지적은 고칠 구간을 골라 집필·수정을 따로 요청해 주세요.'
PICK_NEEDED = '확정된 문제가 여러 곳이라 자동으로 고치지 않았어요. 고칠 구간을 골라 집필·수정을 따로 요청해 주세요.'
BAD_FIX = '고칠 수 있는 확정 지적이 아니에요. 검수 결과에서 확정 지적을 골라 주세요.'
FIX_TOO_FAR = '고른 지적이 서로 멀어 한 번에 고칠 수 없어요. 가까운 지적끼리 나눠 골라 주세요.'
FIX_DETAILS_TOO_LONG = '고른 지적의 설명이 너무 길어요. 한 번에 고칠 지적을 나눠 골라 주세요.'
DRAFT_CHANGED = '검수한 뒤 초안이 바뀌어 고치지 않았어요. 다시 검수해 주세요.'
BAD_DRAFT = 'Content 초안 응답을 확인할 수 없습니다.'
PATCH_READY = '수정안을 만들었고 본문은 화면의 결과 카드에 있어요.'
NO_SAVED_PLANS = '저장된 플롯·장면 계획이 없어 고칠 수 없어요. 고칠 계획을 먼저 저장해 주세요.'
NO_PLAN_CHANGE = '요청대로 바꿀 내용이 없어요. 고칠 방향을 더 구체적으로 알려 주세요.'
PLAN_EPISODE_MISSING = '연결한 회차가 삭제됐어요. 계획 패널에서 회차 연결을 해제한 뒤 다시 요청해 주세요.'
PLAN_CANDIDATES = 5  # 되묻기에 보이는 후보 계획 제목 수
# 판정 기능 → 메인에 노출할 도구 이름. 판정 기능마다 도구가 있어 미구현으로 끝내는 기능이 없다.
TOOL_NAMES = {'story_context': 'ask_story_qa', 'manuscript_review': 'ask_manuscript_review', 'world': 'ask_world', 'writing_editing': 'ask_writing',
              'research': 'ask_research', 'rating': 'ask_rating', 'character_simulation': 'ask_character_simulation'}


def _check(inputs: dict, check: str | None) -> str | None:
    """Review 검사 종류. 작가가 보낸 검사 종류가 메인 에이전트의 check보다 우선한다."""
    return (inputs.get('manuscript_review') or inputs.get('review') or {}).get('check') or check


# 작가 입력을 기다리는 조건(turn, inputs, scope, 도구 인자). 도구 안 needs와 병렬 묶음 검사(waits)가 같은 조건을 쓴다.
# ask_writing·ask_character_simulation은 항상 단독이라 묶음 검사에 필요 없다. ask_world는 작가 승인이 필요한 enrich만 ask_writing처럼
# 단독으로 부르게 같은 검사에 넣는다(check·impact는 조회형이라 묶음에서 함께 실행한다).
WAITS = {
    # 토큰이 없어도 반영 대상(target)이 있으면 세계관 근거로 답한다(발행 회차 없음, #729)
    'ask_story_qa': lambda turn, inputs, scope, args: 'story_context' not in inputs and not scope and not turn.get('target'),
    'ask_manuscript_review': lambda turn, inputs, scope, args: bool(turn.get('target')) and not _check(inputs, args.get('check')),
    'ask_research': lambda turn, inputs, scope, args: args.get('task') == 'web' and 'research' not in inputs,
    'ask_world': lambda turn, inputs, scope, args: args.get('task') == 'enrich',
}


def inputs(state: dict) -> dict:
    """상태의 단계 입력. 옛 체크포인트 호환: #581 전에는 고증 조사 입력을 web_research 키로 저장했다(둘 다 있으면 research)."""
    read = dict(state.get('inputs') or {})
    if 'web_research' in read:
        read.setdefault('research', read.pop('web_research'))
    return read


def waits(call: dict, state: dict, turn: dict) -> bool:
    """병렬 묶음 검사(#474): 이 호출을 지금 실행하면 작가 입력을 기다리는가."""
    wait = WAITS.get(call['name'])
    return bool(wait and wait(turn, inputs(state), state.get('retrievalScope'), call['args']))


class Skipped(Exception):
    """조건부 수정이 고칠 확정 지적이 없어 실행하지 않는다. 메시지가 작가에게 보일 이유다."""


class Clarify(Exception):
    """대상을 하나로 정할 수 없어 아무것도 만들지 않고 작가에게 되묻는다. 메시지가 작가에게 보일 한 문장이고 choices는 고를 수 있는 답이다(#794)."""

    def __init__(self, message: str, choices: list[dict] = ()):
        super().__init__(message)
        self.choices = list(choices)


def _clarify(message: str, choices: list[dict] = ()) -> dict:
    """남은 호출을 막고 되묻기로 끝내는 stopped. 요청 한도(2,000자, UTF-16 단위로 Content와 같다)를 넘는 선택지는 자르면 다른 요청이 되므로 빼고 작가가 입력창으로 답한다."""
    return {'stopped': {'status': 'clarify', 'message': message, 'choices': [c for c in choices if utf16_len(c['message']) <= REQUEST_MAX][:CHOICES_MAX]}}


def previous(turn: dict) -> list[dict]:
    """이전 턴들. 메시지 수정으로 대화를 다시 시작하는 턴에는 없다."""
    return [] if turn.get('replaceHistory') else turn.get('turns', [])


def last_review(turn: dict, steps: list[dict]) -> dict | None:
    """조건부 수정(#370·#873)이 고칠 검수: 이번 턴에 완료된 마지막 검수, 없으면 메인이 보는 최근 HISTORY_TURNS턴 중 가장 최근 검수. 이번 대상(작품·회차)과 다르면 없다."""
    reviews = lambda items: [s for s in items if s['feature'] in ('manuscript_review', 'review') and s['status'] == 'completed']  # noqa: E731
    found = reviews(steps)[-1:] or next((r[-1:] for t in reversed(previous(turn)[-HISTORY_TURNS:]) if (r := reviews((t.get('reply') or {}).get('steps', [])))), [])
    target = turn.get('target') or {}
    return found[0] if found and (found[0]['result']['workId'], found[0]['result']['episode']) == (target.get('workId'), target.get('episode')) else None


def history(turn: dict) -> list[str]:
    """이전 턴의 요청. 지칭 해석용 자료로만 쓴다. 가드가 거절한 턴(reply.status == 'rejected')은 뺀 뒤 최근 HISTORY_TURNS개를 센다(#887, guard_history와 같은 규칙)."""
    return [t['request'] for t in previous(turn) if (t.get('reply') or {}).get('status') != 'rejected'][-HISTORY_TURNS:]


def guard_history(turn: dict) -> list[dict]:
    """Decision Guard에 보낼 최근 턴의 {요청, 답변 앞부분, 그 턴에 실행된 기능}(#781). 지칭·대답을 풀 자료로만 쓴다.

    기능은 저장된 답변의 단계(reply.steps)에서 꺼내 옛 기능 키를 지금 키로 바꾸고 중복과 판정 기능이 아닌 단계(content_action)를 뺀다(새 상태 없음).
    가드가 거절한 턴(reply.status == 'rejected')은 뺀 뒤 최근 턴을 센다: 가드가 막은 원문(키·이메일 등)을 외부로 다시 보내지 않는다.
    """
    kept = [t for t in previous(turn) if (t.get('reply') or {}).get('status') != 'rejected']
    return [{'request': t['request'], 'reply': ((t.get('reply') or {}).get('message') or '')[:GUARD_REPLY],
             'features': [f for f in dict.fromkeys(current_feature(s['feature']) for s in (t.get('reply') or {}).get('steps') or []) if f in FEATURES]}
            for t in kept[-GUARD_TURNS:]]


def task(turn: dict) -> str:
    """이번 턴이 실행하는 요청. 되물음에 기능 이름으로 답한 턴은 되물음을 받은 직전 요청이고, 아니면 작가가 보낸 request다."""
    return turn.get('task') or turn['request']


def _name(step: dict) -> str:
    """작가·모델에게 보일 단계 이름. 고증 조사의 platform은 웹 고증이 아니라 다른 작가의 공개 세계관을 참고한다(#640)."""
    return '공개 세계관 참고' if step.get('task') == 'platform' else CAPABILITY_NAMES[step['feature']]


def _summary(step: dict) -> str:
    """메인 에이전트가 읽을 결과 요약. 원고 Text·Patch·BeatPlan 본문은 넣지 않는다(종합 답변에서 다시 쓰지 않게)."""
    if step['status'] == 'failed':
        return f"[실패] {_name(step)}: {step['error']}"
    brief = {'feature': step['feature'], 'status': step['status'], **({'reason': step['error']} if step.get('error') else {})}
    if step['status'] == 'completed':
        brief.update(SUMMARIES[step['feature']](step['result']))
    return json.dumps(brief, ensure_ascii=False)


def _writing_summary(r: dict) -> dict:
    # gaps(설정 없이 쓴 이유 등, #523)는 종합 답변이 작가에게 전하도록 기획·집필 요약에 넣는다.
    if 'plans' in r:
        return {'kind': 'plan', 'plans': [p['title'] for p in r['plans']], 'notes': r['notes'], 'gaps': r['gaps']}
    if 'planId' in r:  # 계획 수정안: 어느 계획인지만 알리고 변경 전·후 본문은 넣지 않는다(화면의 승인 카드가 보여 준다)
        return {'kind': 'revise_plan', 'plan': r['before']['title']}
    # 수정안은 고친 구절(before)과 만들어졌다는 사실만 알린다(사실이 없으면 본문 없음을 실패로 읽는다). 고친 문장(after)과 새 원고 본문은 넣지 않는다.
    return {'kind': 'patch', 'selection': r['before'], 'proposal': PATCH_READY} if 'after' in r else {'kind': 'draft', 'characters': len(r['text']), 'gaps': r['gaps']}


def _world_summary(r: dict) -> dict:
    """World는 작업마다 모양이 달라 결과로 가른다. 메인 에이전트가 읽을 최소 정보만 넣는다: 제안한 글 전체와 카드·관계 id는 넣지 않는다."""
    if 'fixes' in r:  # enrich: 어느 칸을 바꾸자는 제안인지만. 글은 승인 카드가 보여 준다
        return {'task': 'enrich', 'note': r['note'], 'fixes': [{'card': f['cardTitle'], 'target': f['target'], 'episode': f['episode']} for f in r['fixes']]}
    if 'affected' in r:
        return {'task': 'impact', 'conflicts': r['conflicts'], 'gaps': r['gaps'],
                'affected': [{k: a[k] for k in ('kind', 'title', 'reason', 'certainty')} for a in r['affected']]}
    return {'task': 'check', 'findings': [{'kind': f['kind'], 'message': f['message']} for f in r['findings']]}


SUMMARIES: dict[str, Callable[[dict], dict]] = {
    'story_context': lambda r: {'claims': [{k: c[k] for k in ('text', 'kind', 'sourceIds')} for c in r['claims']], 'gaps': r['gaps']},
    # range: 선택한 글이 실린 턴에도 그 문장만 검수했다고 답하지 않게 범위를 알린다(#636).
    'manuscript_review': lambda r: {'revision': r['revision'], 'basis': 'writing_candidate' if r.get('candidate') else 'saved_draft', 'range': '회차 본문 전체',
                                    'gaps': r['gaps'], 'findings': [
        {'fix': i, 'status': f['status'], 'category': f['category'], 'quote': f['quote'], 'reason': f['reason']}
        for i, f in enumerate(r['findings'])]},
    'world': _world_summary,
    'writing_editing': _writing_summary,
    'research': lambda r: {'gaps': r['gaps'], **(
        {'references': [{'world': f['worldName'], 'card': f['cardTitle'], 'author': f['authorNickname'], 'note': f['note']} for f in r['references']]}
        if 'references' in r else {'findings': [{k: f[k] for k in ('text', 'verdict', 'sourceUrls')} for f in r['findings']]})},
    'rating': lambda r: {'verdict': r['verdict'], 'prohibited': r['prohibited']},
}


# 다시 쓰기(#795)가 같은 입력으로 다시 부를 수 있는 Writing 호출과 그 입력 모델
REWRITABLE = {'draft': DraftRequest, 'patch': PatchRequest, 'plan_and_draft': PlanRequest}


def write(call: dict):
    """기록한 Writing 호출 {call, input, gaps?}을 실행한다. 첫 실행과 다시 쓰기(#795)가 같은 경로라 같은 입력이면 같은 방식으로 쓴다."""
    result = getattr(writing, call['call'])(REWRITABLE[call['call']].model_validate(call['input']))
    return result.model_copy(update={'gaps': call['gaps']}) if 'gaps' in call else result


def _recorded(recipe: dict, name: str, data, gaps: list[str] | None = None):
    """Writing 호출을 recipe에 기록하고 실행한다. 승인 대기의 다시 쓰기가 이 기록으로 같은 입력을 다시 보낸다."""
    recipe.update(call=name, input=data.model_dump(mode='json'), **({'gaps': gaps} if gaps is not None else {}))
    return write(recipe)


def _reply(runtime: ToolRuntime, feature: str, content: str, update: dict, failed: bool = False, artifact=None) -> Command:
    message = ToolMessage(content=content, artifact=artifact, tool_call_id=runtime.tool_call_id, name=TOOL_NAMES[feature],
                          status='error' if failed else 'success')
    return Command(update={**update, 'messages': [message]})


def _ask(runtime: ToolRuntime, feature: str, call, needs=lambda inputs, scope: False, when: str = 'always',
         task_kind: str | None = None, shown: list[dict] = ()) -> Command:
    """서브 에이전트 하나를 실행해 단계로 남긴다.

    needs(inputs, scope)가 참이면 작가 입력을 기다린다(대화가 없으면 needs_input, 거절이면 cancelled). needs·call이 올리는 기능 실패는
    단계 failed, Skipped는 skipped다. interrupt는 추적 span 밖에서 걸어 대기를 실패로 남기지 않는다.
    단계는 자기 것 하나만 덧붙이고(steps reducer) inputs·retrievalScope는 입력을 받았을 때만 쓴다. 병렬 묶음의 도구는 입력을 기다리지
    않으므로(#474) 같은 키를 동시에 쓰지 않는다. shown은 자기 단계 앞에 함께 남길 다른 턴의 단계다(지난 턴 검수, #873).
    """
    turn, steps = runtime.context, [*runtime.state.get('steps', []), *shown]
    step = {'feature': feature, 'when': when, 'status': 'not_started', **({'task': task_kind} if task_kind else {})}
    read, scope = inputs(runtime.state), runtime.state.get('retrievalScope')
    name, answered, ran = _name(step), {}, False
    line = uuid4().hex  # 진행 목록 줄 id. 모델의 tool_call_id 같은 내부 id는 싣지 않는다
    try:
        while needs(read, scope):
            if not turn.get('scope'):  # 대화가 없으면 체크포인트가 없어 멈췄다 이어갈 수 없다.
                return _reply(runtime, feature, f'[입력 대기] {name}: 작가 입력이 없어 실행하지 않았어요.',
                              {'stopped': {'status': 'needs_input', 'missingInputs': [feature]}}, failed=True)
            answer = interrupt({'steps': [*steps, step], 'missingInputs': [feature]})
            if not answer['approved']:
                return _reply(runtime, feature, f'[취소] {name}: 작가가 취소해 실행하지 않았어요.', {'stopped': {'status': 'cancelled'}}, failed=True)
            read.update(answer['inputs'])
            # Content가 resume마다 새로 서명한 조회 토큰을 쓴다. 저장된 토큰은 만료·Content 재시작으로 무효일 수 있다.
            scope = answer.get('scope') or scope
            answered = {'inputs': read, 'retrievalScope': scope}
        runtime.stream_writer({'started': feature})
        ran = True
        agent_runtime.report(line, name, 'running', feature=feature)  # 진행 목록(#784). started는 호환을 위해 둔다
        with tracing.observe(f'step.{feature}', as_type='agent'):
            step.update(status='completed', result=call(read, scope).model_dump(mode='json'))
    except Skipped as skip:
        step.update(status='skipped', error=str(skip))
    except Clarify as ask:  # 단계를 남기지 않고 한 문장으로 되묻는다(시뮬레이션 계획의 되묻기와 같다)
        agent_runtime.report(line, name, 'done', feature=feature)
        return _reply(runtime, feature, f'[확인 필요] {name}: {ask}', _clarify(str(ask), ask.choices), failed=True)
    except FAILURES as error:
        step.update(status='failed', error=str(error))
    except Exception:  # 예상 밖 예외도 줄이 running으로 남아 멈춘 것처럼 보이지 않게 한다
        if ran:
            agent_runtime.report(line, name, 'failed', feature=feature)
        raise
    if ran:  # 실패는 failed로 보이고, 조건이 거짓이라 건너뛴 단계(skipped)는 끝난 작업이다
        agent_runtime.report(line, name, 'failed' if step['status'] == 'failed' else 'done', feature=feature)
    return _reply(runtime, feature, _summary(step), {'steps': [*shown, step], **answered}, failed=step['status'] == 'failed',
                  artifact=step.get('result'))


def _target(turn: dict, failure: type[Exception], message: str) -> dict:
    if not (target := turn.get('target')):
        raise failure(422, message)
    return target


@tool
def ask_story_qa(request: Request, runtime: ToolRuntime) -> Command:
    """작품 질문(Story Context / Q&A): 작품의 원고·세계관 설정·인물 관계를 Content가 허용한 근거로 답한다. request는 질문이다."""
    turn = runtime.context

    def answer(inputs, scope):
        data, gaps, coverage = inputs.get('story_context'), [], None
        if data is None:
            # 발췌가 없으면 원고는 공통 Retrieval(Content 내부 검색), 설정·관계는 Content MCP로 기준 회차 시점의 세계관을 읽는다(#490).
            # 둘 다 근거가 없으면 모델을 부르지 않는다.
            target = _target(turn, StoryQaFailure, NO_QA_TARGET)
            if not scope:  # 발행 회차가 없어 Content가 조회 토큰을 주지 않았다(#729): 세계관 근거로만 답한다
                manuscript, gaps = [], [NO_PUBLISHED]
            else:
                try:
                    found = retrieval.retrieve(RetrievalScope.model_validate(scope), request)
                    # 설정·관계 정본은 WorldStudio 하나라(#490 결정 1) Retrieval에서는 원고 발췌만 쓴다(옛 설정 문서·현재 관계 제외).
                    manuscript, gaps, coverage = [e for e in found.excerpts if e.kind == 'manuscript'], [g.detail for g in found.gaps], found.coverage
                except RetrievalUnavailable as error:  # Content가 원고 검색을 쓸 수 없다고 답하면 세계관 근거로만 답하고 이유를 gap으로 알린다
                    manuscript, gaps = [], [str(error)]
            world, world_gaps = story_qa.world_excerpts(target['workId'], target.get('baseEpisode') or target['episode'], request[:500])
            gaps += world_gaps
            if not (excerpts := [e.model_dump() for e in [*manuscript, *world]]):
                return QaStepResult(claims=[], gaps=gaps, coverage=coverage)
            data = {'question': request[:500], 'excerpts': excerpts}
        qa = [t['qa'] for t in previous(turn) if t['qa']][-HISTORY_TURNS:]
        answered = story_qa.answer(AnswerRequest.model_validate({**data, 'history': qa}))
        cited = {i for claim in answered.claims for i in claim.sourceIds}
        return QaStepResult(claims=answered.claims, gaps=gaps + answered.gaps, coverage=coverage,
                            sources=[e for e in data['excerpts'] if e['id'] in cited])

    return _ask(runtime, 'story_context', answer, needs=lambda inputs, scope: WAITS['ask_story_qa'](turn, inputs, scope, {}))


@tool
def ask_manuscript_review(request: Request, runtime: ToolRuntime, check: Literal['mechanical', 'semantic', 'both'] | None = None) -> Command:
    """원고 검수(Manuscript Review): Content가 확인한 반영 회차 초안을 검수해 위치·근거·확정/의심이 있는 지적을 돌려준다.

    check는 mechanical(맞춤법·표기), semantic(설정·개연성), both 중 요청에서 알 수 있는 것이며 모르면 비운다(작가가 고른다).
    """
    turn = runtime.context

    def run(inputs, scope):
        target = _target(turn, ReviewFailure, NO_REVIEW_TARGET)
        data = ReviewRequest(workId=target['workId'], episode=target['episode'], check=_check(inputs, check))
        if base := runtime.state.get('writingBase'):
            written = next(s['result'] for s in runtime.state['steps'] if s['feature'] == 'writing_editing' and s['status'] == 'completed')
            return manuscript_review.review_candidate(data, base, written)
        return manuscript_review.review(data)

    return _ask(runtime, 'manuscript_review', run, needs=lambda inputs, scope: WAITS['ask_manuscript_review'](turn, inputs, scope, {'check': check}))


@tool
def ask_world(request: Request, task: Literal['check', 'enrich', 'impact'], runtime: ToolRuntime) -> Command:
    """세계관(World): 작품에 연결된 설정집 카드를 다룬다(원고 검수는 ask_manuscript_review).

    check는 카드끼리의 모순·인물 문서의 역할 오류·사건 정보 누락·사건 카드끼리의 시간 순서 모순을 검사한다. enrich는 request가 가리킨 기존 카드의
    본문·인물 문서를 자세히 쓴 보강 제안이다(보강할 카드와 방향을 request에 적는다. 작가가 승인해야 초안에 반영하므로 다른 도구와 함께 부르지 않는다).
    impact는 request의 설정·사건을 바꿀 때 영향받는 카드·관계·회차·계획된 장면과 충돌을 분석한다(읽기만 한다).
    """
    turn = runtime.context

    def run(inputs, scope):
        target = _target(turn, WorldReviewFailure, NO_WORLD_TARGET)
        if task == 'check':
            return world_review.review(world_review.linked_request(target['workId']))
        if task == 'enrich':
            return world_review.enrich(request, *world_review.linked_world(target['workId']))
        # impact는 허용 문맥을 writing과 같은 방식으로 읽고(Retrieval이 아니다) 계획 목록(정본 아님)을 더해 분석한다.
        data = world_review.linked_request(target['workId'])
        return world_review.impact(request, data, _read_context(target, request), content_mcp.call('story_plan_list', {'workId': target['workId']}))

    return _ask(runtime, 'world', run, task_kind=task)


@tool
def ask_rating(request: Request, runtime: ToolRuntime) -> Command:
    """심의 등급(Rating): 반영 회차 초안이 19세 이용가로 분류될 내용인지 판별 제안만 한다(등급 적용은 하지 않는다)."""
    turn = runtime.context

    def run(inputs, scope):
        target = _target(turn, RatingFailure, NO_RATING_TARGET)
        return rating.rate(RatingRequest(workId=target['workId'], episodes=[target['episode']]))

    return _ask(runtime, 'rating', run)


@tool
def ask_research(task: Literal['web', 'platform'], runtime: ToolRuntime, request: Request = '') -> Command:
    """고증 조사(Research): web은 작가가 동의한 질문·맥락만 웹에서 확인한다(외부 전송이라 request를 쓰지 않는다).

    platform은 다른 작가가 공개한 세계관에서 참고할 설정을 찾아 출처(세계관·카드·작가)를 단 참고안을 돌려준다. request는 찾을 설정 주제다.
    내 작품 안의 질문은 ask_story_qa다.
    """
    def run(inputs, scope):
        if task == 'platform':  # 공개 데이터만 써서 동의 입력을 기다리지 않는다
            return research.platform(request.strip() or runtime.context.get('task') or runtime.context['request'])
        return research.research(ResearchRequest.model_validate(inputs['research']))

    return _ask(runtime, 'research', run, needs=lambda inputs, scope: WAITS['ask_research'](runtime.context, inputs, scope, {'task': task}), task_kind=task)


@tool
def ask_writing(request: Request, task: Literal['plan', 'draft', 'patch', 'revise_plan'], runtime: ToolRuntime, fix: int | None = None,
                from_review: bool = False) -> Command:
    """기획·집필·수정(Writing & Editing): plan은 전개 기획만(저장하지 않는다), draft는 계획을 세워 새 원고까지, patch는 기존 문장 수정안이다.

    revise_plan은 작가가 이미 저장한 플롯·장면 계획의 제목·내용을 고치는 수정안이다(request에 고칠 계획과 방향을 적는다). 원고 문장은 고치지 않는다.

    선택한 글이나 원고 구간을 고칠 때는 검수가 없어도 fix 없이 task=patch를 쓴다(선택한 글은 검수를 함께 요청했어도, 확정 지적이 없어도 그렇다. 선택한 글이 없으면 작가가 구간을 고른다).
    이번 턴 ask_manuscript_review 결과의 확정 지적을 고칠 때는 task=patch에 fix(그 지적의 fix 번호)를 더한다. 선택한 글이 없고 확정 지적이 하나면 fix를 비워도 된다.
    이전 턴 검수의 확정 지적을 고칠 때는 task=patch에 from_review=true를 더하고 fix는 비운다(확정 지적이 여럿이면 작가가 고른다).
    선택한 글이 남아 있어도 요청이 검수에서 나온 문제를 고치라는 것이면 확정 지적이 있을 때만 부르고 fix를 꼭 넣는다(fix를 비우면 선택한 글을 고친다).
    """
    if task == 'revise_plan':
        return _revise_plan(runtime, request)
    turn, steps = runtime.context, runtime.state.get('steps', [])
    selected = (turn.get('page') or {}).get('selection')  # 작가가 편집기에서 고른 글(#554, Content가 확인한 화면 정보)
    reviewed = last_review(turn, steps)
    reviewed_now = any(s['feature'] in ('manuscript_review', 'review') and s['status'] == 'completed' for s in steps)  # 초안 읽기(writingBase)는 이번 턴 검수만 본다
    given = (runtime.state.get('inputs') or {}).get('writing_editing') or {}
    # 지난 턴 검수는 고치라고 밝힌 호출(fix·from_review)에만 쓴다. 아니면 검수한 회차의 '3문단 고쳐줘'까지 지적 고치기로 바뀐다(#873).
    fixing = 'fix' in given or fix is not None or (task == 'patch' and (from_review or ('patch' not in given and reviewed_now and not selected)))
    if fixing:
        earlier = reviewed is not None and not reviewed_now
        # 다음 턴 모델은 지난 검수의 fix 번호를 받지 못해 추측하므로 작가가 고른 번호만 쓴다. 화면이 체크박스를 그리도록 그 검수 단계를 이번 턴 앞에 싣는다.
        return _fix(runtime, reviewed, None if earlier else fix, shown=[reviewed] if earlier else [])

    base, recipe = None, {}

    def run(inputs, scope):
        nonlocal base
        data = inputs.get('writing_editing') or {}
        target = turn.get('target')
        changes_draft = task != 'plan' or 'patch' in data or 'draft' in data
        if target and changes_draft and not reviewed_now and 'manuscript_review' in map(current_feature, runtime.state['decision']['capabilities']):
            draft = content_mcp.read_draft(target['workId'], target['episode'])
            base = {'body': draft.body, 'revision': draft.revision}
        if 'patch' in data:
            patch = PatchRequest.model_validate(data['patch'])
            if target and not patch.context:  # 채팅 구간 입력(#497): Content는 구간만 검증하므로 허용 문맥은 여기서 채운다. gaps는 PatchResponse에 없어 버린다
                patch.context, _ = _allowed_context(target, patch.instruction)
            return _recorded(recipe, 'patch', patch)
        if task == 'patch' and selected and 'draft' not in data:  # 선택한 글이 있으면 입력 대기 없이 그 글을 수정한다. 반영 때 초안에 한 번만 있어야 한다
            return _recorded(recipe, 'patch', PatchRequest(selection=selected, instruction=request or '선택한 문장을 다듬어 주세요.'))
        if 'draft' in data:
            draft, gaps = DraftRequest.model_validate(data['draft']), []
            if target and not draft.context:
                draft.context, gaps = _allowed_context(target, draft.plan, fork_draft=bool(target.get("fork")))
            return _recorded(recipe, 'draft', draft, gaps)
        if not target:
            raise WritingFailure(422, NO_WRITING_TARGET)
        context, gaps = _allowed_context(target, request, fork_draft=task != "plan" and bool(target.get("fork")))
        planned = PlanRequest(episodeNumber=target['episode'], request=request, context=context, previousPlans=_previous_plans(turn))
        if task == 'plan':  # 기획은 원고가 아니라 반영·다시 쓰기가 없다
            return writing.plan(planned).model_copy(update={'gaps': gaps})
        return _recorded(recipe, 'plan_and_draft', planned, gaps)

    # 부분 수정은 Content·작가가 주는 선택 구간이 있어야 한다. 기획·바로 집필은 요청과 반영 대상으로 실행한다(#387).
    needs = lambda inputs, scope: task == 'patch' and not selected and not {'patch', 'draft'} & set(inputs.get('writing_editing') or {})  # noqa: E731
    return _written(_ask(runtime, 'writing_editing', run, needs=needs, task_kind=task), recipe, base)


def _written(command: Command, recipe: dict, base: dict | None) -> Command:
    """완료한 Writing 단계면 다시 쓰기용 호출 기록(writingCall, 후보 검수를 다시 돌릴 집필 직전 초안 base 포함)과 검수 기준 초안을 남긴다."""
    if command.update.get('steps', [{}])[-1].get('status') == 'completed':  # 자기 단계는 마지막이다(앞에 지난 턴 검수가 올 수 있다)
        if recipe:
            command.update['writingCall'] = {**recipe, **({'base': base} if base is not None else {})}
        if base is not None:
            command.update['writingBase'] = base
    return command


def _revise_plan(runtime: ToolRuntime, request: str) -> Command:
    """기존 플롯·장면 계획 수정 제안(#578): 저장된 계획 목록에서 대상 하나를 고르고(모델 호출 1), 최신 계획을 읽어 제목·내용만 고친다(모델 호출 2).

    작품은 Content가 확인한 target에서만 읽는다. 대상이 하나로 정해지지 않거나 목록에 없는 ID를 골랐으면 수정안을 만들지 않고 후보 제목으로 되묻는다.
    여기서는 저장하지 않는다. 저장은 작가 승인 뒤 apply 노드가 Content MCP로 한다.

    shortcut: 모델에는 계획 전체의 요약을 한 번에 보낸다(목록 길이 제한 없음). 계획이 아주 많은 작품에서 한도에 닿으면 회차·종류로 거른다.
    """
    turn = runtime.context

    def run(inputs, scope):
        work = _target(turn, WritingFailure, NO_WRITING_TARGET)['workId']
        listed = content_mcp.list_plans(work)
        titles = {p.id: p.title for p in listed}
        briefs = [PlanBrief(id=p.id, kind=p.kind, title=p.title, episodeNumber=p.episodeNumber, plot=titles.get(p.parentId)) for p in listed]
        if not briefs:
            raise Clarify(NO_SAVED_PLANS)
        if (picked := writing.pick_plan(PlanPickRequest(request=request, plans=briefs))) not in titles:
            shown = ', '.join(f"'{b.title}'" for b in briefs[:PLAN_CANDIDATES])
            more = f' 외 {len(briefs) - PLAN_CANDIDATES}개' if len(briefs) > PLAN_CANDIDATES else ''
            raise Clarify(f'어느 계획을 고칠지 정할 수 없어요. 고칠 계획의 제목을 알려 주세요. 저장된 계획: {shown}{more}',
                          [{'label': f"'{b.title[:13]}{'…' if len(b.title) > 13 else ''}' 고치기", 'message': f"'{b.title}' 계획을 고쳐줘: {task(turn)}"}
                           for b in briefs[:CHOICES_MAX]])
        current = content_mcp.read_plan(work, picked)
        if current.episodeMissing:  # 그대로 저장하면 Content가 승인 순간 거절하므로 제안 전에 알린다(#641)
            raise WritingFailure(422, PLAN_EPISODE_MISSING)
        brief = next(b for b in briefs if b.id == picked).model_copy(update={'title': current.title, 'episodeNumber': current.episodeNumber})
        if (revised := writing.revise_plan(PlanReviseRequest(request=request, plan=brief, content=current.content, revision=current.revision))) is None:
            raise Clarify(NO_PLAN_CHANGE)
        return revised

    return _ask(runtime, 'writing_editing', run, task_kind='revise_plan')


def _fix(runtime: ToolRuntime, reviewed: dict | None, fix: int | None, shown: list[dict]) -> Command:
    """조건부 수정(#370): 이번 턴 또는 가장 최근 턴 Review의 확정 지적을 부분 수정한다. 메인 에이전트의 판단만으로 수정 입력을 만들지 않는다.

    확정 지적(위치가 하나로 정해진 지적)만 고친다. 작가가 고른 번호(inputs.writing_editing.fix, 하나 또는 여럿 #795) > 메인 에이전트의 fix > 유일한 확정 지적 순이며,
    여러 개인데 정해지지 않으면 대화에서 작가가 고른다. 여럿이면 첫 지적부터 끝 지적까지를 한 구간(5,000자 이하)으로 한 번에 고친다.
    앞뒤 문장은 검수한 판본 그대로인지 확인한 초안에서 자른다.
    """
    turn, recipe, base = runtime.context, {}, {}  # base: 검수 판본과 같음을 확인한 초안. 같은 턴 뒤 검수가 수정 후보를 보게 한다(#915 리뷰)
    pick = lambda inputs: (inputs.get('writing_editing') or {}).get('fix', fix)  # noqa: E731

    def needs(inputs, scope):
        if reviewed is None or reviewed['result'].get('candidate') is not None:
            raise WritingFailure(422, BAD_FIX)
        findings = reviewed['result']['findings']
        confirmed = [i for i, f in enumerate(findings) if f['status'] == 'confirmed']
        if not confirmed:
            raise Skipped(ONLY_SUSPECTED if findings else NO_ISSUES)
        if pick(inputs) is not None or len(confirmed) == 1:
            return False
        if not turn.get('scope'):  # 대화가 없으면 멈춰 고르게 할 수 없다
            raise Skipped(PICK_NEEDED)
        return True

    def run(inputs, scope):
        findings = reviewed['result']['findings']
        confirmed = [i for i, f in enumerate(findings) if f['status'] == 'confirmed']
        picks = pick(inputs) if pick(inputs) is not None else confirmed[0]
        picks = picks if isinstance(picks, list) else [picks]
        if not set(picks) <= set(confirmed):
            raise WritingFailure(422, BAD_FIX)
        target = turn['target']
        try:
            draft = content_mcp.call('episode_read', {'id': target['workId'], 'number': target['episode']})['draft']
            body, revision = draft['body'], draft['revision']
        except (LookupError, TypeError):
            raise ContentMcpFailure(502, BAD_DRAFT) from None
        chosen = [(content_mcp.place(body, findings[i]['quote']) if isinstance(body, str) else None, findings[i]) for i in picks]
        if revision != reviewed['result']['revision'] or any(at is None for at, _ in chosen):
            raise ContentMcpFailure(409, DRAFT_CHANGED)
        base.update(body=body, revision=revision)
        chosen.sort(key=lambda placed: placed[0])  # 지시는 원고 순서로 적는다
        start, end = chosen[0][0], max(at + len(f['quote']) for at, f in chosen)
        if end - start > 5000:  # PatchRequest.selection 상한
            raise WritingFailure(422, FIX_TOO_FAR)
        if content_mcp.place(body, body[start:end]) != start:  # 반영은 고칠 구간이 초안에 한 곳만 있어야 한다
            raise ContentMcpFailure(409, DRAFT_CHANGED)
        lines = [f"{f['reason']} 제안: {f['suggestion']}" for _, f in chosen]
        instruction = lines[0] if len(lines) == 1 else '\n'.join(f'{n}. "{f["quote"]}": {line}' for n, ((_, f), line) in enumerate(zip(chosen, lines), 1))
        if len(lines) > 1 and len(instruction) > 2000:
            raise WritingFailure(422, FIX_DETAILS_TOO_LONG)
        # shortcut: 허용 문맥(context) 없이 지적의 이유·제안만 지시로 보낸다. 설정을 고쳐 써야 하는 수정이 약하면 Semantic 근거 설정을 context로 넘긴다.
        return _recorded(recipe, 'patch', PatchRequest(selection=body[start:end], instruction=instruction[:2000],
                                                        precedingText=body[:start][-2000:], followingText=body[end:][:2000]))

    return _written(_ask(runtime, 'writing_editing', run, needs=needs, when='if_issues_found', task_kind='patch', shown=shown), recipe, base or None)


def _previous_plans(turn: dict) -> list[dict]:
    """최근 HISTORY_TURNS턴 중 가장 최근의 기획 결과(계획 대안). 없으면 빈 목록."""
    for past in reversed(previous(turn)[-HISTORY_TURNS:]):
        for step in (past.get('reply') or {}).get('steps', []):
            if step['feature'] == 'writing_editing' and step['status'] == 'completed' and 'plans' in (step.get('result') or {}):
                return step['result']['plans']
    return []


def _read_context(target: dict, query: str, include_settings: bool = True, fork_draft: bool = False) -> dict:
    """Content가 근거 회차까지 허용한 설정·원문 발췌(작가 권한, work_context_read). Retrieval이 아니라 Content가 고른 문맥이다.
    include_settings=False면 Content가 옛 설정 문서를 빼고 그 길이를 예산에서도 뺀다(#602)."""
    args = {'id': target['workId'], 'episode': target.get('baseEpisode') or target['episode'], 'query': query[:200]}
    if fork_draft:
        args['draftEpisode'] = target['episode']
        if target.get('episodeVersionId'):
            args['basisVersionId'] = target['episodeVersionId']
    return content_mcp.call('work_context_read', args if include_settings else {**args, 'includeSettings': False})


def _allowed_context(target: dict, query: str, *, fork_draft: bool = False) -> tuple[str, list[str]]:
    """writing에 보내는 허용 문맥 글과 작가에게 알릴 gaps. 원고 문맥은 Content가 근거 회차까지 허용한 것을 그대로 쓰고,
    설정(settings)만 Q&A·Review와 같은 WorldStudio(연결 → Fork 상속 세계관)로 바꾼다(#523). 세계관이 없으면 빈 설정과 알림이다.

    옛 설정 문서는 Content에서 빼고 읽어 예산을 깎지 않는다(#602). 공개된 카드가 0건이면 알림 없이 빈 설정으로 쓴다.
    """
    if not isinstance(context := _read_context(target, query, include_settings=False, fork_draft=fork_draft), dict):  # settings만 바꿔 끼우므로 객체가 아니면 단계 실패다(linked_world와 같은 규칙)
        raise ContentMcpFailure(502, 'Content MCP 결과를 확인할 수 없습니다.')
    episode = target.get('baseEpisode') or target['episode']
    gaps = []
    if (world := content_mcp.linked_world(target['workId'], episode)) is None:
        settings, gaps = [], [NO_WORLD_SETTINGS]
    else:
        try:
            settings = episode_settings(world_snapshot(world, episode), episode)
        except ValueError:
            raise WritingFailure(502, BAD_WORLD) from None
    text = json.dumps({**context, 'settings': settings}, ensure_ascii=False, separators=(',', ':'))
    if len(text) > 60000:  # 한도(60,000자)는 모델 입력 한도다. Content는 Jackson 직렬화 길이로 재서 여기 직렬화가 더 길 수 있다.
        raise WritingFailure(422, CONTEXT_TOO_LONG)
    return text, gaps


@tool
def ask_character_simulation(request: Request, runtime: ToolRuntime) -> Command:
    """인물 시뮬레이션: 작가가 명시적으로 요청한 가상 장면의 계획(모드·전제·비트·인물)을 세운다. 장면은 이 턴의 도구 호출이 끝난 뒤
    작가와 턴마다 진행되므로 이 도구 뒤에는 다른 도구를 부를 수 없다. request는 시뮬레이션할 상황이다.
    """
    turn = runtime.context
    step = {'feature': 'character_simulation', 'when': 'always', 'status': 'not_started'}
    line, name = uuid4().hex, CAPABILITY_NAMES['character_simulation']
    agent_runtime.report(line, name, 'running', feature='character_simulation')
    try:
        with tracing.observe('step.character_simulation.plan', as_type='agent'):
            if form := turn.get('simulationForm'):  # 버튼 진입: 모델에게 묻지 않고 작가가 양식에 적은 값을 세계관으로 확인해 쓴다
                drafted = simulation.plan_from_form(SimulationPlan.model_validate(form), turn.get('target'))
            else:
                drafted = simulation.plan(request, history(turn), turn.get('target'))
    except FAILURES as error:
        step.update(status='failed', error=str(error))
        agent_runtime.report(line, name, 'failed', feature='character_simulation')
        return _reply(runtime, 'character_simulation', _summary(step), {'steps': [step]}, failed=True)
    except Exception:
        agent_runtime.report(line, name, 'failed', feature='character_simulation')
        raise
    agent_runtime.report(line, name, 'done', feature='character_simulation')  # 되묻기도 끝난 작업이다
    if gaps := drafted.gaps():
        asked = ', '.join(GAP_LABELS[g] for g in gaps)
        message = f'시뮬레이션을 시작하려면 {asked}을(를) 알려 주세요.'
        # 모드는 바로 고르는 버튼, 여러 명을 고르는 인물은 집필실 시작 양식을 여는 버튼이다(#794). 전제·비트는 글로 답한다.
        choices = [{'label': label, 'message': f'{mode} 시뮬레이션으로 해줘: {task(turn)}'}
                   for label, mode in (('IF로 시작', 'IF'), ('흐름대로 시작', '흐름'))] if 'mode' in gaps else []
        if 'characterIds' in gaps:
            choices.append({'label': '양식에서 고르기', 'message': task(turn), 'form': 'simulation'})
        return _reply(runtime, 'character_simulation', f'[확인 필요] 인물 시뮬레이션: {message}', _clarify(message, choices), failed=True)
    plan = drafted.model_dump(mode='json')
    content = json.dumps({'feature': 'character_simulation', 'status': 'planned', 'mode': plan['mode'],
                          'characters': len(plan['characterIds'])}, ensure_ascii=False)
    return _reply(runtime, 'character_simulation', content, {'steps': [step], 'simulationPlan': plan})


@tool
def ask_author(question: Annotated[str, Field(min_length=1, max_length=500, description='작가에게 보일 확인 질문 한 문장')],
               options: Annotated[list[Choice], Field(min_length=2, max_length=CHOICES_MAX, description='고를 수 있는 답 2~4개. label은 버튼 글(20자 이하), '
                                                      'message는 누르면 작가 이름으로 보낼 요청 문장(그것만 읽어도 할 일이 분명하게)')],
               runtime: ToolRuntime) -> Command:
    """작가에게 선택지로 되묻는다(#794): 대상·작업을 정할 수 없고 고를 후보(회차·인물·계획·작업 등)가 있을 때만 부른다. 부르면 이번 턴은 이 질문으로 끝난다.
    후보가 없으면 이 도구 없이 확인 질문 한 문장으로 답한다."""
    return Command(update={**_clarify(question, [o.model_dump() for o in options]),
                           'messages': [ToolMessage(content='[확인 필요] 작가에게 물었어요.', tool_call_id=runtime.tool_call_id, name='ask_author')]})
