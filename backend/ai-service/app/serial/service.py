"""AI 자율 연재(#659): 다음 전개 선택지, 회차 요약, 시뮬레이션 장면 미리보기, 다음 회차 생성·검수.

요청 하나의 모든 모델 호출이 같은 CreditMiddleware를 지나 입력+출력 토큰이 누적되고, 응답의 credits는 그 확정 금액이다(상한에 닿으면 402).
회차 기획·원고는 app/writing의 기획(plan)과 집필(draft)을 그대로 쓰고(지시문·프롬프트 이름 writing_editing.* 그대로, 중심 전개·분량·되풀이 금지는
요청 자료에 실어 보낸다), 선택지·회차 요약·투표와 제안 종합·검수·장면 미리보기만 새 프롬프트(serial.*)다. 사용자 토큰·Content MCP를 쓰지 않고
입력·원고·모델 응답을 오류 문구에 넣지 않는다.
"""

from app import agent_runtime
from app.serial.errors import SerialFailure
from app.serial.models import (ChoiceList, ChoicesRequest, ChoicesResponse, EpisodeRequest, EpisodeResponse, Review, SimulationRequest,
                               SimulationResponse, Summary, SummaryRequest, SummaryResponse, TopChoice, Usage)
from app.serial.prompt import (CHOICES_INSTRUCTIONS, EPISODE_SUMMARY_INSTRUCTIONS, REVIEW_INSTRUCTIONS, SIMULATION_INSTRUCTIONS,
                               SUMMARY_INSTRUCTIONS)
from app.writing import agent as writing
from app.writing.models import BeatPlan, DraftRequest, PlanRequest

CHOICE_COUNT, CHOICE_MAX = 4, 300  # 선택지 수와 글자 수(계약)
SCENE_MAX, SUMMARY_MAX, EPISODE_SUMMARY_MAX, TITLE_MAX = 1500, 1000, 400, 120  # 장면 미리보기(계약)·투표 종합 문장·회차 요약(계약)·회차 제목(Content 한도 120자)
MIN_TEXT = 2500  # 회차 원고 최소 분량(글자). 직전 회차들과 비슷한 분량은 프롬프트가 맡고, 이 아래는 검수 실패다.
# Writing 기본(4,000토큰·120초)보다 넉넉히: 직전 회차 분량의 원고가 잘리지 않게. 회차 실행 최악 합계는 570초(종합 40+기획 50+집필 180+검수 60+재작성 180+검수 60).
DRAFT_TOKENS, DRAFT_TIMEOUT = 8000, 180
NO_INPUT = '투표와 제안 글이 없어 연재 방향대로 이어 갔습니다.'
# Writing 기획·집필 지시는 그대로라 문맥 JSON(Content serialContext)의 이전 회차 요약·관련 장면 쓰는 법을 요청 자료로 알린다.
CONTEXT_GUIDE = '문맥의 summaries로 전체 흐름을, related(있으면)로 이어 쓸 옛 장면을 참고하되 related의 문장을 그대로 베끼지 않는다.'


def choices(data: ChoicesRequest) -> ChoicesResponse:
    """문맥과 연재 방향으로 다음 전개 선택지를 정확히 4개(각 300자 이하, 서로 다름) 만든다. 규칙을 벗어난 결과는 고치지 않고 502다."""
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    brief = {'episodeNumber': data.episodeNumber, 'direction': data.direction}
    _, result = agent_runtime.run('serial.choices.generation', '선택지', SerialFailure, CHOICES_INSTRUCTIONS, {**brief, 'context': data.context},
                                  prompt_name='serial.choices_v2', max_tokens=2000, timeout=60, trace=brief, schema=ChoiceList, credit=credit)
    picked = [choice.strip() for choice in result.choices]
    if len(picked) != CHOICE_COUNT or len(set(picked)) != CHOICE_COUNT or any(not choice or len(choice) > CHOICE_MAX for choice in picked):
        raise SerialFailure(502, '선택지 모델 응답을 확인할 수 없습니다.')
    return ChoicesResponse(choices=picked, credits=credit.credits, usage=_usage(credit))


def summarize(data: SummaryRequest) -> SummaryResponse:
    """발행된 회차 하나의 줄거리 요약(300자 안팎, 400자 이하)을 만든다. 이후 회차의 문맥(summaries)이 된다. 규칙을 벗어난 결과는 줄이지 않고 502다."""
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    brief = {'episodeNumber': data.episodeNumber, 'title': data.title, 'body': data.body}
    _, result = agent_runtime.run('serial.summaries.generation', '회차 요약', SerialFailure, EPISODE_SUMMARY_INSTRUCTIONS, brief,
                                  prompt_name='serial.episode_summary', max_tokens=1000, timeout=40, trace={'episodeNumber': data.episodeNumber, 'title': data.title},
                                  schema=Summary, credit=credit)
    summary = result.summary.strip()
    if not summary or len(summary) > EPISODE_SUMMARY_MAX:
        raise SerialFailure(502, '회차 요약 모델 응답을 확인할 수 없습니다.')
    return SummaryResponse(summary=summary, credits=credit.credits, usage=_usage(credit))


def simulate(data: SimulationRequest) -> SimulationResponse:
    """공개 문맥으로 전제·비트를 짧은 장면 미리보기로 쓴다. 범위를 벗어난 결과는 줄이지 않고 502다."""
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    message, _ = agent_runtime.run('serial.scene', '장면 미리보기', SerialFailure, SIMULATION_INSTRUCTIONS,
                                   data.model_dump(include={'episodeNumber', 'premise', 'beats', 'context'}), prompt_name='serial.simulation_v2',
                                   max_tokens=2000, timeout=60, trace=data.model_dump(include={'episodeNumber', 'premise', 'beats'}), credit=credit)
    scene = message.text.strip()
    if not scene or len(scene) > SCENE_MAX:
        raise SerialFailure(502, '장면 미리보기 모델 응답을 확인할 수 없습니다.')
    return SimulationResponse(scene=scene, credits=credit.credits, usage=_usage(credit))


def episode(data: EpisodeRequest) -> EpisodeResponse:
    """투표·제안 종합 → 기획·원고 → 검수. 1위 선택지가 중심 전개다. 검수에 실패하면 지적을 넣어 원고를 한 번 다시 쓰고 다시 검수하며, 또 실패하면 422다."""
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    summary = _summary(data, credit)
    plan = writing.plan(PlanRequest(episodeNumber=data.episodeNumber, request=_plan_request(data, summary), single=True,
                                    context=data.context), credit).plans[0]
    title = plan.title.strip()
    if not title or len(title) > TITLE_MAX:
        raise SerialFailure(502, writing.BAD_PLAN)
    text = _write(data, plan, [], credit)
    review = _review(data, title, text, credit)
    if not review.passed:
        text = _write(data, plan, review.issues, credit)
        review = _review(data, title, text, credit)
        if not review.passed:
            raise SerialFailure(422, '검수를 통과하지 못했습니다.')
    return EpisodeResponse(summary=summary, title=title, text=text, review=review, credits=credit.credits, usage=_usage(credit))


def _summary(data: EpisodeRequest, credit: agent_runtime.CreditMiddleware) -> str:
    """투표 1위와 추천 상위 제안의 종합 문장. 공개되는 글이라 연재 방향·작품 문맥은 모델에 보내지 않는다. 종합할 것이 없으면 모델을 부르지 않는다."""
    if data.choice is None and not data.proposals:
        return NO_INPUT
    brief = {'episodeNumber': data.episodeNumber, 'choice': data.choice and data.choice.model_dump(),
             'proposals': [proposal.model_dump() for proposal in data.proposals]}
    _, result = agent_runtime.run('serial.summary', '투표·제안 종합', SerialFailure, SUMMARY_INSTRUCTIONS, brief, prompt_name='serial.vote_summary',
                                  max_tokens=1500, timeout=40, trace=brief, schema=Summary, credit=credit)
    summary = result.summary.strip()
    if not summary or len(summary) > SUMMARY_MAX:
        raise SerialFailure(502, '투표·제안 종합 모델 응답을 확인할 수 없습니다.')
    return summary


def _write(data: EpisodeRequest, plan: BeatPlan, issues: list[str], credit: agent_runtime.CreditMiddleware) -> str:
    """계획과 집필 조건(분량·중심 전개·되풀이 금지)으로 원고를 쓴다. issues가 있으면 검수 지적을 고쳐 다시 쓴다."""
    request = DraftRequest(episodeNumber=data.episodeNumber, plan=_draft_plan(plan, data.choice, issues), context=data.context)
    return writing.draft(request, credit, max_tokens=DRAFT_TOKENS, timeout=DRAFT_TIMEOUT).text


def _review(data: EpisodeRequest, title: str, text: str, credit: agent_runtime.CreditMiddleware) -> Review:
    """새 원고를 설정 충돌·개연성·19세 이용가·1위 선택지 반영으로 검수한다. 최소 분량에 못 미치면 모델 검수 없이 실패다(다시 쓸 원고에 모델 호출을 쓰지 않는다)."""
    if len(text) < MIN_TEXT:
        return Review(passed=False, issues=[f'분량이 {len(text)}자로 최소 {MIN_TEXT:,}자에 못 미친다. 비트마다 장면을 풀어 {MIN_TEXT:,}자 이상으로 쓴다.'])
    brief = {'episodeNumber': data.episodeNumber, 'title': title, 'text': text, 'choice': data.choice and data.choice.text}
    _, result = agent_runtime.run('serial.review', '검수', SerialFailure, REVIEW_INSTRUCTIONS, {**brief, 'context': data.context},
                                  prompt_name='serial.episode_review_v2', max_tokens=2000, timeout=60, trace=brief, schema=Review, credit=credit)
    return result


def _plan_request(data: EpisodeRequest, summary: str) -> str:
    """기획 요청 문장: 중심 전개(1위 선택지)·연재 방향·제안 종합 순. PlanRequest.request 한도(2,000자)에 맞춘다."""
    lines = ['다음 회차를 기획한다. 계획 제목은 회차 제목으로 쓰이므로 짧게 짓고 비트는 5~8개로 짠다. 직전 회차의 결말을 되풀이하지 않고 그 직후 장면에서 시작한다. ' + CONTEXT_GUIDE]
    if data.choice:
        lines.append(f'중심 전개(독자 투표 1위): {data.choice.text}\n이 전개를 이번 회차의 핵심 사건으로 삼아 비트 대부분을 여기에 쓴다.')
    if data.direction.strip():
        lines.append(f'연재 방향: {data.direction.strip()}')
    lines.append(f'독자 제안 종합(참고): {summary}')
    # ponytail: 한도를 넘으면 뒤(제안 종합)부터 자른다. 문제 되면 기획 요청 한도를 올리거나 연재 방향을 요약해 넘긴다.
    return '\n'.join(lines)[:2000]


def _draft_plan(plan: BeatPlan, choice: TopChoice | None, issues: list[str]) -> str:
    """계획 문장에 집필 조건을 붙인다(Writing 집필 지시는 plan의 분량 요청을 따른다). 검수 지적은 앞 5개·각 200자만 붙인다. 계획 한도(4,000자) 안에서 계획 쪽을 줄인다."""
    rules = [f'분량은 직전 회차들과 비슷하게, 최소 {MIN_TEXT:,}자로 쓴다. 비트마다 장면·대사·묘사로 풀어 쓰고 줄거리 요약으로 넘기지 않는다.',
             '직전 회차의 결말·사건을 되풀이하지 않고 그 직후 장면부터 새 사건을 전개한다.', CONTEXT_GUIDE]
    if choice:
        rules.append(f'중심 전개(독자 투표 1위): {choice.text} — 이 전개가 본문의 핵심 사건이다. 제목에만 쓰지 않고 본문에서 끝까지 전개한다.')
    notes = '\n\n집필 조건:\n' + '\n'.join(f'- {rule}' for rule in rules)
    if issues:
        notes += '\n\n검수에서 지적된 문제를 고쳐 다시 쓴다:\n' + '\n'.join(f'- {issue[:200]}' for issue in issues[:5])
    return writing.plan_text(plan)[:4000 - len(notes)] + notes


def _usage(credit: agent_runtime.CreditMiddleware) -> Usage:
    return Usage(inputTokens=credit.input_tokens, outputTokens=credit.output_tokens)
