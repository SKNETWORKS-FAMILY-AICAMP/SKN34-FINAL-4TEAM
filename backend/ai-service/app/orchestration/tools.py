"""메인 에이전트의 서브 에이전트 도구 `ask_*` 7종(#473). 각 도구는 기존 업무 Agent 서비스를 그대로 감싼다.

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

from langchain.tools import ToolRuntime
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.types import Command, interrupt
from pydantic import Field

from app import tracing
from app.content_mcp import service as content_mcp
from app.content_mcp.errors import ContentMcpFailure
from app.intent.prompt import CAPABILITY_NAMES
from app.rating import service as rating
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest
from app.research import service as research
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest
from app.retrieval import service as retrieval
from app.retrieval.errors import RetrievalFailure
from app.retrieval.models import RetrievalScope
from app.review import service as review
from app.review.errors import ReviewFailure
from app.review.models import ReviewRequest
from app.simulation import service as simulation
from app.simulation.errors import SimulationFailure
from app.simulation.models import GAP_LABELS, SimulationPlan
from app.story_qa import service as story_qa
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import AnswerRequest
from app.orchestration.models import QaStepResult
from app.world_review import service as world_review
from app.world_review.errors import WorldReviewFailure
from app.writing import agent as writing
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest, PlanRequest

Request = Annotated[str, Field(max_length=2000, description='서브 에이전트에게 줄 작업 지시. 작가 요청과 이번 턴 앞선 결과의 요약을 담을 수 있다.')]
# shortcut: 최근 5턴만 넘기고 요약하지 않는다. 긴 대화의 앞부분 지칭이 필요해지면 요약을 검토한다.
HISTORY_TURNS = 5
FAILURES = (StoryQaFailure, WritingFailure, ResearchFailure, RetrievalFailure, SimulationFailure, ContentMcpFailure, ReviewFailure,
            WorldReviewFailure, RatingFailure)
NO_REVIEW_TARGET = '검수할 작품과 회차를 확인할 수 없어요.'
NO_RATING_TARGET = '심의 등급을 판별할 작품과 회차를 확인할 수 없어요.'
NO_WORLD_REVIEW_TARGET = '검토할 작품을 확인할 수 없어요.'
NO_WRITING_TARGET = '기획하거나 쓸 작품과 회차를 확인할 수 없어요.'
CONTEXT_TOO_LONG = '허용 문맥이 너무 길어요. 기준 회차나 원고 분량을 줄여 주세요.'
NO_ISSUES = '검수에서 고칠 문제를 찾지 못해 수정하지 않았어요.'
ONLY_SUSPECTED = '확정된 문제가 없어 자동으로 고치지 않았어요. 의심 지적은 고칠 구간을 골라 집필·수정을 따로 요청해 주세요.'
PICK_NEEDED = '확정된 문제가 여러 곳이라 자동으로 고치지 않았어요. 고칠 구간을 골라 집필·수정을 따로 요청해 주세요.'
BAD_FIX = '고칠 수 있는 확정 지적이 아니에요. 검수 결과에서 확정 지적을 골라 주세요.'
DRAFT_CHANGED = '검수한 뒤 초안이 바뀌어 고치지 않았어요. 다시 검수해 주세요.'
BAD_DRAFT = 'Content 초안 응답을 확인할 수 없습니다.'
# 판정 기능 → 메인에 노출할 도구 이름. world_plot은 미구현이라 도구가 없다(판정되면 unsupported).
TOOL_NAMES = {'story_context': 'ask_story_qa', 'review': 'ask_review', 'world_review': 'ask_world_review', 'writing_editing': 'ask_writing',
              'web_research': 'ask_web_research', 'rating': 'ask_rating', 'character_simulation': 'ask_character_simulation'}
UNSUPPORTED_MESSAGE = ('요청에 아직 실행할 수 없는 작업이 있어 아무 작업도 실행하지 않았어요. '
                       '작품 질문, 원고 검수, 설정집 검토, 기획·집필·수정, 고증 조사, 인물 시뮬레이션은 각각 요청할 수 있어요.')


def _check(inputs: dict, check: str | None) -> str | None:
    """Review 검사 종류. 작가가 보낸 검사 종류가 메인 에이전트의 check보다 우선한다."""
    return (inputs.get('review') or {}).get('check') or check


# 작가 입력을 기다리는 조건(turn, inputs, scope, 도구 인자). 도구 안 needs와 병렬 묶음 검사(waits)가 같은 조건을 쓴다.
# ask_writing·ask_character_simulation은 항상 단독이라 묶음 검사에 필요 없다.
WAITS = {
    'ask_story_qa': lambda turn, inputs, scope, args: 'story_context' not in inputs and not scope,
    'ask_review': lambda turn, inputs, scope, args: bool(turn.get('target')) and not _check(inputs, args.get('check')),
    'ask_web_research': lambda turn, inputs, scope, args: 'web_research' not in inputs,
}


def waits(call: dict, state: dict, turn: dict) -> bool:
    """병렬 묶음 검사(#474): 이 호출을 지금 실행하면 작가 입력을 기다리는가."""
    wait = WAITS.get(call['name'])
    return bool(wait and wait(turn, state.get('inputs') or {}, state.get('retrievalScope'), call['args']))


class Skipped(Exception):
    """조건부 수정이 고칠 확정 지적이 없어 실행하지 않는다. 메시지가 작가에게 보일 이유다."""


def previous(turn: dict) -> list[dict]:
    """이전 턴들. 메시지 수정으로 대화를 다시 시작하는 턴에는 없다."""
    return [] if turn.get('replaceHistory') else turn.get('turns', [])


def history(turn: dict) -> list[str]:
    """이전 턴의 요청. 지칭 해석용 자료로만 쓴다."""
    return [t['request'] for t in previous(turn)][-HISTORY_TURNS:]


def task(turn: dict) -> str:
    """이번 턴이 실행하는 요청. 되물음에 기능 이름으로 답한 턴은 되물음을 받은 직전 요청이고, 아니면 작가가 보낸 request다."""
    return turn.get('task') or turn['request']


def trace(turn: dict) -> dict | None:
    return tracing.context(turn.get('runId'), turn.get('traceParent'))


def _summary(step: dict) -> str:
    """메인 에이전트가 읽을 결과 요약. 원고 Text·Patch·BeatPlan 본문은 넣지 않는다(종합 답변에서 다시 쓰지 않게)."""
    if step['status'] == 'failed':
        return f"[실패] {CAPABILITY_NAMES[step['feature']]}: {step['error']}"
    brief = {'feature': step['feature'], 'status': step['status'], **({'reason': step['error']} if step.get('error') else {})}
    if step['status'] == 'completed':
        brief.update(SUMMARIES[step['feature']](step['result']))
    return json.dumps(brief, ensure_ascii=False)


def _writing_summary(r: dict) -> dict:
    if 'plans' in r:
        return {'kind': 'plan', 'plans': [p['title'] for p in r['plans']], 'notes': r['notes']}
    # 수정안은 고친 구절(before)만 알려 어느 지적을 고쳤는지 말하게 한다. 고친 문장(after)과 새 원고 본문은 넣지 않는다.
    return {'kind': 'patch', 'selection': r['before']} if 'after' in r else {'kind': 'draft', 'characters': len(r['text'])}


SUMMARIES: dict[str, Callable[[dict], dict]] = {
    'story_context': lambda r: {'claims': [{k: c[k] for k in ('text', 'kind', 'sourceIds')} for c in r['claims']], 'gaps': r['gaps']},
    'review': lambda r: {'revision': r['revision'], 'gaps': r['gaps'], 'findings': [
        {'fix': i, 'status': f['status'], 'category': f['category'], 'quote': f['quote'], 'reason': f['reason']}
        for i, f in enumerate(r['findings'])]},
    'world_review': lambda r: {'findings': [{'kind': f['kind'], 'message': f['message']} for f in r['findings']]},
    'writing_editing': _writing_summary,
    'web_research': lambda r: {'gaps': r['gaps'], 'findings': [{k: f[k] for k in ('text', 'verdict', 'sourceUrls')} for f in r['findings']]},
    'rating': lambda r: {'verdict': r['verdict'], 'prohibited': r['prohibited']},
}


def _reply(runtime: ToolRuntime, feature: str, content: str, update: dict, failed: bool = False, artifact=None) -> Command:
    message = ToolMessage(content=content, artifact=artifact, tool_call_id=runtime.tool_call_id, name=TOOL_NAMES[feature],
                          status='error' if failed else 'success')
    return Command(update={**update, 'messages': [message]})


def _ask(runtime: ToolRuntime, feature: str, call, needs=lambda inputs, scope: False, when: str = 'always',
         task_kind: str | None = None) -> Command:
    """서브 에이전트 하나를 실행해 단계로 남긴다.

    needs(inputs, scope)가 참이면 작가 입력을 기다린다(대화가 없으면 needs_input, 거절이면 cancelled). needs·call이 올리는 기능 실패는
    단계 failed, Skipped는 skipped다. interrupt는 추적 span 밖에서 걸어 대기를 실패로 남기지 않는다.
    단계는 자기 것 하나만 덧붙이고(steps reducer) inputs·retrievalScope는 입력을 받았을 때만 쓴다. 병렬 묶음의 도구는 입력을 기다리지
    않으므로(#474) 같은 키를 동시에 쓰지 않는다.
    """
    turn, steps = runtime.context, list(runtime.state.get('steps', []))
    step = {'feature': feature, 'when': when, 'status': 'not_started', **({'task': task_kind} if task_kind else {})}
    inputs, scope = dict(runtime.state.get('inputs', {})), runtime.state.get('retrievalScope')
    name, answered = CAPABILITY_NAMES[feature], {}
    try:
        while needs(inputs, scope):
            if not turn.get('scope'):  # 대화가 없으면 체크포인트가 없어 멈췄다 이어갈 수 없다.
                return _reply(runtime, feature, f'[입력 대기] {name}: 작가 입력이 없어 실행하지 않았어요.',
                              {'stopped': {'status': 'needs_input', 'missingInputs': [feature]}}, failed=True)
            answer = interrupt({'steps': [*steps, step], 'missingInputs': [feature]})
            if not answer['approved']:
                return _reply(runtime, feature, f'[취소] {name}: 작가가 취소해 실행하지 않았어요.', {'stopped': {'status': 'cancelled'}}, failed=True)
            inputs.update(answer['inputs'])
            # Content가 resume마다 새로 서명한 조회 토큰을 쓴다. 저장된 토큰은 만료·Content 재시작으로 무효일 수 있다.
            scope = answer.get('scope') or scope
            answered = {'inputs': inputs, 'retrievalScope': scope}
        runtime.stream_writer({'started': feature})
        with tracing.observe(f'step.{feature}', as_type='agent', trace_context=trace(turn)):
            step.update(status='completed', result=call(inputs, scope).model_dump(mode='json'))
    except Skipped as skip:
        step.update(status='skipped', error=str(skip))
    except FAILURES as error:
        step.update(status='failed', error=str(error))
    return _reply(runtime, feature, _summary(step), {'steps': [step], **answered}, failed=step['status'] == 'failed',
                  artifact=step.get('result'))


def _target(turn: dict, failure: type[Exception], message: str) -> dict:
    if not (target := turn.get('target')):
        raise failure(422, message)
    return target


@tool
def ask_story_qa(request: Request, runtime: ToolRuntime) -> Command:
    """작품 질문(Story Context / Q&A): 작품의 내용·설정·인물 관계를 Content가 허용한 근거로 답한다. request는 질문이다."""
    turn = runtime.context

    def answer(inputs, scope):
        data, gaps, coverage = inputs.get('story_context'), [], None
        if data is None:  # 발췌가 없으면 공통 Retrieval 도구로 Content가 확인한 근거를 받아 온다. 근거가 없으면 모델을 부르지 않는다.
            found = retrieval.retrieve(RetrievalScope.model_validate(scope), request)
            gaps, coverage = [g.detail for g in found.gaps], found.coverage
            if not found.excerpts:
                return QaStepResult(claims=[], gaps=gaps, coverage=coverage)
            data = {'question': request[:500], 'excerpts': [e.model_dump() for e in found.excerpts]}
        qa = [t['qa'] for t in previous(turn) if t['qa']][-HISTORY_TURNS:]
        answered = story_qa.answer(AnswerRequest.model_validate({**data, 'history': qa}))
        cited = {i for claim in answered.claims for i in claim.sourceIds}
        return QaStepResult(claims=answered.claims, gaps=gaps + answered.gaps, coverage=coverage,
                            sources=[e for e in data['excerpts'] if e['id'] in cited])

    return _ask(runtime, 'story_context', answer, needs=lambda inputs, scope: WAITS['ask_story_qa'](turn, inputs, scope, {}))


@tool
def ask_review(request: Request, runtime: ToolRuntime, check: Literal['mechanical', 'semantic', 'both'] | None = None) -> Command:
    """원고 검수(Review): Content가 확인한 반영 회차 초안을 검수해 위치·근거·확정/의심이 있는 지적을 돌려준다.

    check는 mechanical(맞춤법·표기), semantic(설정·개연성), both 중 요청에서 알 수 있는 것이며 모르면 비운다(작가가 고른다).
    """
    turn = runtime.context

    def run(inputs, scope):
        target = _target(turn, ReviewFailure, NO_REVIEW_TARGET)
        return review.review(ReviewRequest(workId=target['workId'], episode=target['episode'], check=_check(inputs, check)))

    return _ask(runtime, 'review', run, needs=lambda inputs, scope: WAITS['ask_review'](turn, inputs, scope, {'check': check}))


@tool
def ask_world_review(request: Request, runtime: ToolRuntime) -> Command:
    """설정집 검토: 작품에 연결된 세계관 카드 자체의 모순·역할 오류·누락을 검토한다(원고 검수는 ask_review)."""
    turn = runtime.context
    return _ask(runtime, 'world_review', lambda inputs, scope: world_review.review(world_review.linked_request(
        _target(turn, WorldReviewFailure, NO_WORLD_REVIEW_TARGET)['workId'])))


@tool
def ask_rating(request: Request, runtime: ToolRuntime) -> Command:
    """심의 등급(Rating): 반영 회차 초안이 19세 이용가로 분류될 내용인지 판별 제안만 한다(등급 적용은 하지 않는다)."""
    turn = runtime.context

    def run(inputs, scope):
        target = _target(turn, RatingFailure, NO_RATING_TARGET)
        return rating.rate(RatingRequest(workId=target['workId'], episodes=[target['episode']]))

    return _ask(runtime, 'rating', run)


@tool
def ask_web_research(runtime: ToolRuntime) -> Command:
    """고증 조사(웹): 작가가 동의한 질문·맥락만 웹에서 확인한다. 외부 전송이라 작업 지시를 받지 않는다."""
    return _ask(runtime, 'web_research', lambda inputs, scope: research.research(ResearchRequest.model_validate(inputs['web_research'])),
                needs=lambda inputs, scope: WAITS['ask_web_research'](runtime.context, inputs, scope, {}))


@tool
def ask_writing(request: Request, task: Literal['plan', 'draft', 'patch'], runtime: ToolRuntime, fix: int | None = None) -> Command:
    """기획·집필·수정(Writing & Editing): plan은 전개 기획만, draft는 계획을 세워 새 원고까지, patch는 기존 문장 수정안이다.

    이번 턴 ask_review 결과의 확정 지적을 고칠 때만 task=patch와 fix(그 지적의 fix 번호)를 쓴다. 확정 지적이 하나면 fix를 비워도 된다.
    """
    turn, steps = runtime.context, runtime.state.get('steps', [])
    reviewed = next((s for s in reversed(steps) if s['feature'] == 'review' and s['status'] == 'completed'), None)
    given = (runtime.state.get('inputs') or {}).get('writing_editing') or {}
    fixing = 'fix' in given or fix is not None or (task == 'patch' and 'patch' not in given and reviewed is not None)
    if fixing:
        return _fix(runtime, reviewed, fix)

    def run(inputs, scope):
        data = inputs.get('writing_editing') or {}
        if 'patch' in data:
            return writing.patch(PatchRequest.model_validate(data['patch']))
        target = turn.get('target')
        if 'draft' in data:
            draft = DraftRequest.model_validate(data['draft'])
            if target and not draft.context:
                draft.context = _allowed_context(target, draft.plan)
            return writing.draft(draft)
        if not target:
            raise WritingFailure(422, NO_WRITING_TARGET)
        planned = PlanRequest(episodeNumber=target['episode'], request=request, context=_allowed_context(target, request),
                              previousPlans=_previous_plans(turn))
        return writing.plan(planned) if task == 'plan' else writing.plan_and_draft(planned)

    # 부분 수정은 Content·작가가 주는 선택 구간이 있어야 한다. 기획·바로 집필은 요청과 반영 대상으로 실행한다(#387).
    needs = lambda inputs, scope: task == 'patch' and not {'patch', 'draft'} & set(inputs.get('writing_editing') or {})  # noqa: E731
    return _ask(runtime, 'writing_editing', run, needs=needs, task_kind=task)


def _fix(runtime: ToolRuntime, reviewed: dict | None, fix: int | None) -> Command:
    """조건부 수정(#370): 이번 턴 Review의 확정 지적 하나를 부분 수정한다. 메인 에이전트의 판단만으로 수정 입력을 만들지 않는다.

    확정 지적(위치가 하나로 정해진 지적)만 고친다. 작가가 고른 번호(inputs.writing_editing.fix) > 메인 에이전트의 fix > 유일한 확정 지적 순이며,
    여러 개인데 정해지지 않으면 대화에서 작가가 고른다. 앞뒤 문장은 검수한 판본 그대로인지 확인한 초안에서 자른다.
    """
    turn = runtime.context
    pick = lambda inputs: (inputs.get('writing_editing') or {}).get('fix', fix)  # noqa: E731

    def needs(inputs, scope):
        if reviewed is None:
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
        chosen_at = pick(inputs) if pick(inputs) is not None else confirmed[0]
        if chosen_at not in confirmed:
            raise WritingFailure(422, BAD_FIX)
        chosen, target = findings[chosen_at], turn['target']
        try:
            draft = content_mcp.call('episode_read', {'id': target['workId'], 'number': target['episode']})['draft']
            body, revision = draft['body'], draft['revision']
        except (LookupError, TypeError):
            raise ContentMcpFailure(502, BAD_DRAFT) from None
        at = content_mcp.place(body, chosen['quote']) if isinstance(body, str) else None
        if revision != reviewed['result']['revision'] or at is None:
            raise ContentMcpFailure(409, DRAFT_CHANGED)
        # shortcut: 허용 문맥(context) 없이 지적의 이유·제안만 지시로 보낸다. 설정을 고쳐 써야 하는 수정이 약하면 Semantic 근거 설정을 context로 넘긴다.
        return writing.patch(PatchRequest(selection=chosen['quote'], instruction=f"{chosen['reason']} 제안: {chosen['suggestion']}"[:2000],
                                          precedingText=body[:at][-2000:], followingText=body[at + len(chosen['quote']):][:2000]))

    return _ask(runtime, 'writing_editing', run, needs=needs, when='if_issues_found', task_kind='patch')


def _previous_plans(turn: dict) -> list[dict]:
    """최근 HISTORY_TURNS턴 중 가장 최근의 기획 결과(계획 대안). 없으면 빈 목록."""
    for past in reversed(previous(turn)[-HISTORY_TURNS:]):
        for step in (past.get('reply') or {}).get('steps', []):
            if step['feature'] == 'writing_editing' and step['status'] == 'completed' and 'plans' in (step.get('result') or {}):
                return step['result']['plans']
    return []


def _allowed_context(target: dict, query: str) -> str:
    """Content가 근거 회차까지 허용한 설정·원문 발췌(작가 권한). Retrieval이 아니라 Content가 고른 문맥이며 한도(60,000자)도 Content가 지킨다."""
    found = content_mcp.call('work_context_read', {'id': target['workId'], 'episode': target.get('baseEpisode') or target['episode'],
                                                   'query': query[:200]})
    context = json.dumps(found, ensure_ascii=False, separators=(',', ':'))
    if len(context) > 60000:  # Content는 Jackson 직렬화 길이로 잰다. 여기 직렬화가 더 길면 모델 입력 한도를 넘는다.
        raise WritingFailure(422, CONTEXT_TOO_LONG)
    return context


@tool
def ask_character_simulation(request: Request, runtime: ToolRuntime) -> Command:
    """인물 시뮬레이션: 작가가 명시적으로 요청한 가상 장면의 계획(모드·전제·비트·인물)을 세운다. 장면은 이 턴의 도구 호출이 끝난 뒤
    작가와 턴마다 진행되므로 이 도구 뒤에는 다른 도구를 부를 수 없다. request는 시뮬레이션할 상황이다.
    """
    turn = runtime.context
    step = {'feature': 'character_simulation', 'when': 'always', 'status': 'not_started'}
    try:
        with tracing.observe('step.character_simulation.plan', as_type='agent', trace_context=trace(turn)):
            if form := turn.get('simulationForm'):  # 버튼 진입: 모델에게 묻지 않고 작가가 양식에 적은 값을 세계관으로 확인해 쓴다
                drafted = simulation.plan_from_form(SimulationPlan.model_validate(form), turn.get('target'))
            else:
                drafted = simulation.plan(request, history(turn), turn.get('target'))
    except FAILURES as error:
        step.update(status='failed', error=str(error))
        return _reply(runtime, 'character_simulation', _summary(step), {'steps': [step]}, failed=True)
    if gaps := drafted.gaps():
        asked = ', '.join(GAP_LABELS[g] for g in gaps)
        message = f'시뮬레이션을 시작하려면 {asked}을(를) 알려 주세요.'
        return _reply(runtime, 'character_simulation', f'[확인 필요] 인물 시뮬레이션: {message}', {'stopped': {'status': 'clarify', 'message': message}}, failed=True)
    plan = drafted.model_dump(mode='json')
    content = json.dumps({'feature': 'character_simulation', 'status': 'planned', 'mode': plan['mode'],
                          'characters': len(plan['characterIds'])}, ensure_ascii=False)
    return _reply(runtime, 'character_simulation', content, {'steps': [step], 'simulationPlan': plan})
