"""AI 자율 연재(#659): 다음 전개 선택지, 회차 요약, 시뮬레이션 장면 미리보기, 다음 회차 생성·검수.

요청 하나의 모든 모델 호출이 같은 CreditMiddleware에 센다: create_agent로 부르는 호출은 미들웨어가, 인물 시뮬레이션 엔진의 호출은 호출마다 알리는
MODEL_EVENT를 CreditLedger가 더한다. 응답의 credits는 그 확정 금액이다(상한에 닿으면 402).
회차 실행은 투표·제안 종합 → 기획(app/writing의 plan) → 인물 시뮬레이션(app/simulation 엔진, 장면 1개를 대화 없이 끝까지) → 장면을 뼈대로 집필 → 검수다.
시뮬레이션을 건너뛰는 대체 경로는 없다. 사용자 토큰·Content MCP를 쓰지 않고(세계관은 요청의 world) 입력·원고·모델 응답을 오류 문구에 넣지 않는다.
"""

import asyncio

from langchain_core.runnables import RunnableLambda
from pydantic import ValidationError

from app import agent_runtime
from app.agent_runtime import CreditLedger
from app.serial.errors import SerialFailure
from app.serial.models import (ChoiceList, ChoicesRequest, ChoicesResponse, EpisodeRequest, EpisodeResponse, Review, SimulationRequest,
                               SimulationResponse, Summary, SummaryRequest, SummaryResponse, Usage)
from app.serial.prompt import (CHOICES_INSTRUCTIONS, DRAFT_INSTRUCTIONS, EPISODE_SUMMARY_INSTRUCTIONS, REVIEW_INSTRUCTIONS, SIMULATION_INSTRUCTIONS,
                               SUMMARY_INSTRUCTIONS)
from app.simulation import agent as simulation_agent, service as simulation
from app.simulation.errors import SimulationFailure
from app.simulation.models import Scene, SimulationPlan
from app.simulation.scene_agent import scene_agent
from app.simulation.service import SceneContext
from app.writing import agent as writing
from app.writing.models import BeatPlan, PlanRequest

CHOICE_COUNT, CHOICE_MAX = 4, 300  # 선택지 수와 글자 수(계약)
SCENE_MAX, SUMMARY_MAX, EPISODE_SUMMARY_MAX, TITLE_MAX = 1500, 1000, 400, 120  # 장면 미리보기(계약)·투표 종합 문장·회차 요약(계약)·회차 제목(Content 한도 120자)
MIN_TEXT = 5000  # 회차 원고 최소 분량(글자). 직전 회차들과 비슷한 분량은 프롬프트가 맡고, 이 아래는 검수 실패다.
# 집필은 Writing 기본(4,000토큰·120초)보다 넉넉히: 5,000자 이상은 약 3,500~4,500토큰이고 추론 토큰도 출력 한도에 들어 12,000토큰으로 잡았다.
DRAFT_TOKENS, DRAFT_TIMEOUT = 12000, 195
# 인물 시뮬레이션 장면 하나(대화 없이 끝까지, 엔진의 턴 한도 안에서 보통 16턴 안팎, 턴마다 연출·집필·검사 호출)를 기다리는 시간 상한(초).
# 회차 실행의 최악 시간 합계는 Content 읽기 한도(35분)에서 나온다: 종합 30+기획 50+시뮬레이션 계획 40+장면 1,200+집필 195+검수 50+재작성 195+재검수 50
# = 1,810초(여유 290초). 시간이 모자라면 집필·검수 timeout을 올리지 말고 장면 상한이나 호출 수를 줄인다.
SIMULATION_TIMEOUT = 1200
NO_INPUT = '투표와 제안 글이 없어 연재 방향대로 이어 갔습니다.'
SCENE_TIMEOUT = '인물 시뮬레이션이 제한 시간 안에 끝나지 않았습니다.'
SCENE_UNFINISHED = '인물 시뮬레이션 장면이 끝나지 않았습니다.'
STEP = {'feature': 'character_simulation'}  # 장면 에이전트가 장면의 현재 결과를 끼워 넣는 단계 항목(바깥 그래프가 없어도 필요하다)


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


async def episode(data: EpisodeRequest) -> EpisodeResponse:
    """투표·제안 종합 → 기획 → 인물 시뮬레이션(장면 1개) → 장면을 뼈대로 집필 → 검수. 1위 선택지가 중심 전개다.

    검수에 실패하면 지적을 넣어 원고를 한 번 다시 쓰고(장면은 다시 돌리지 않는다) 다시 검수하며, 또 실패하면 422다. 비동기인 이유: 장면 에이전트는 연출 분류기의
    HTTP 클라이언트가 묶인 앱의 이벤트 루프에서 돌아야 하고(요청마다 새 루프를 만들면 두 번째부터 깨진다), 블로킹 모델 호출은 스레드로 보낸다.
    """
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    world = simulation.world_from(data.world, data.episodeNumber - 1)  # 세계관 오류·인물 카드 없음은 모델을 부르기 전에 실패한다
    if not world.characters:
        raise SimulationFailure(409, simulation.NO_CHARACTERS)
    summary = await asyncio.to_thread(_summary, data, credit)
    plan = (await asyncio.to_thread(writing.plan, PlanRequest(episodeNumber=data.episodeNumber, request=_plan_request(data, summary), single=True,
                                                              context=data.context), credit)).plans[0]
    title = plan.title.strip()
    if not title or len(title) > TITLE_MAX:
        raise SerialFailure(502, writing.BAD_PLAN)
    scene = await _simulate(data, plan, world, credit)
    text = await asyncio.to_thread(_write, data, plan, scene, [], credit)
    review = await asyncio.to_thread(_review, data, title, scene, text, credit)
    if not review.passed:
        text = await asyncio.to_thread(_write, data, plan, scene, review.issues, credit)
        review = await asyncio.to_thread(_review, data, title, scene, text, credit)
        if not review.passed:
            raise SerialFailure(422, '검수를 통과하지 못했습니다.')
    return EpisodeResponse(summary=summary, title=title, text=text, review=review, credits=credit.credits, usage=_usage(credit))


async def _simulate(data: EpisodeRequest, plan: BeatPlan, world: simulation.World, credit: agent_runtime.CreditMiddleware) -> str:
    """인물 시뮬레이션: 장면 1개를 대화 없이 끝까지 한 번에 쓰고(pausing=False, 승인 질문 없음) 장면의 문단을 순서대로 이은 뼈대 글을 돌려준다.

    계획은 엔진의 계획 모델(SimulationPlan)이 1위 선택지·추천 상위 제안 글로 만들고, 세계관은 요청의 것을 엔진에 넣는다(read_world 대신). 엔진의 모델 호출은 모두
    호출마다 알리는 MODEL_EVENT로 같은 크레딧에 세고(CreditLedger) 상한에 닿으면 다음 호출 없이 402다. 장면이 끝나지 않으면 대체 없이 엔진의 이유 그대로 실패한다.
    """
    credit.gate()
    request = _simulation_request(data, plan)
    cast = [{'id': card.id, 'name': card.title} for card in world.characters.values()]
    ledger = {'callbacks': [CreditLedger(credit)]}
    # 계획 호출은 LangChain 실행 안에서 불러야 사용량 이벤트를 알릴 곳(원장)이 있다.
    drafted = await RunnableLambda(lambda _: simulation_agent.plan(request, [], cast)).ainvoke(None, ledger)
    try:
        chosen = SimulationPlan.model_validate(drafted.model_dump())
    except ValidationError:
        raise SimulationFailure(502, simulation.BAD_PLAN) from None
    simulation.check_plan(chosen, world)
    context = SceneContext(plan=chosen, target=None, request=request, scope=None, steps=[STEP], pausing=False, loaded=world)
    seed = {'scene': simulation.new_scene(chosen).model_dump(mode='json')}
    try:
        out = await asyncio.wait_for(scene_agent(False).ainvoke(seed, ledger, context=context), SIMULATION_TIMEOUT)
    except TimeoutError:
        raise SerialFailure(504, SCENE_TIMEOUT) from None
    final = Scene.model_validate(out['scene'])
    if final.result.status != 'completed':
        raise SerialFailure(502, final.error or SCENE_UNFINISHED)
    return '\n\n'.join(turn.prose for turn in final.result.turns)


def _simulation_request(data: EpisodeRequest, plan: BeatPlan) -> str:
    """시뮬레이션 계획 모델에 줄 요청 문장: 1위 선택지와 추천 상위 제안 글(제목과 본문 앞부분). 독자 입력이 없으면 기획의 제목·비트로 한다."""
    lines = [f'중심 전개(독자 투표 1위): {data.choice.text}'] if data.choice else []
    lines += [f'독자 제안 「{p.title}」: {(p.body or p.scene or "")[:300]}' for p in data.proposals]  # 시뮬레이션 글은 본문이 없으면 장면의 앞부분을 준다
    return '\n'.join(lines or [plan.title, *plan.beats])[:2000]


def _summary(data: EpisodeRequest, credit: agent_runtime.CreditMiddleware) -> str:
    """투표 1위와 추천 상위 제안의 종합 문장. 공개되는 글이라 연재 방향·작품 문맥은 모델에 보내지 않는다. 종합할 것이 없으면 모델을 부르지 않는다."""
    if data.choice is None and not data.proposals:
        return NO_INPUT
    brief = {'episodeNumber': data.episodeNumber, 'choice': data.choice and data.choice.model_dump(),
             'proposals': [proposal.model_dump() for proposal in data.proposals]}
    _, result = agent_runtime.run('serial.summary', '투표·제안 종합', SerialFailure, SUMMARY_INSTRUCTIONS, brief, prompt_name='serial.vote_summary',
                                  max_tokens=1500, timeout=30, trace=brief, schema=Summary, credit=credit)
    summary = result.summary.strip()
    if not summary or len(summary) > SUMMARY_MAX:
        raise SerialFailure(502, '투표·제안 종합 모델 응답을 확인할 수 없습니다.')
    return summary


def _write(data: EpisodeRequest, plan: BeatPlan, scene: str, issues: list[str], credit: agent_runtime.CreditMiddleware) -> str:
    """시뮬레이션 장면을 뼈대로 회차 원고를 쓴다(계획·중심 전개·최소 분량과 함께). issues가 있으면 검수 지적(앞 5개·각 200자)을 고쳐 다시 쓴다.

    장면이 Writing 집필 요청의 계획 한도(4,000자)보다 길 수 있어 Writing 집필 대신 장면을 입력으로 받는 새 프롬프트(serial.episode_draft)로 쓴다.
    """
    brief = {'episodeNumber': data.episodeNumber, 'title': plan.title, 'beats': plan.beats, 'scene': scene, 'minChars': MIN_TEXT,
             'centralDevelopment': data.choice and data.choice.text, **({'issues': [issue[:200] for issue in issues[:5]]} if issues else {})}
    message, _ = agent_runtime.run('serial.draft', '집필', SerialFailure, DRAFT_INSTRUCTIONS, {**brief, 'context': data.context},
                                   prompt_name='serial.episode_draft', max_tokens=DRAFT_TOKENS, timeout=DRAFT_TIMEOUT, trace=brief, credit=credit)
    text = message.text.strip()
    if not text:
        raise SerialFailure(502, '집필 모델 응답을 확인할 수 없습니다.')
    return text


def _review(data: EpisodeRequest, title: str, scene: str, text: str, credit: agent_runtime.CreditMiddleware) -> Review:
    """새 원고를 설정 충돌·개연성·19세 이용가·1위 선택지·시뮬레이션 장면 반영으로 검수한다. 최소 분량에 못 미치면 모델 검수 없이 실패다(다시 쓸 원고에 모델 호출을 쓰지 않는다)."""
    if len(text) < MIN_TEXT:
        return Review(passed=False, issues=[f'분량이 {len(text)}자로 최소 {MIN_TEXT:,}자에 못 미친다. 비트마다 장면을 풀어 {MIN_TEXT:,}자 이상으로 쓴다.'])
    brief = {'episodeNumber': data.episodeNumber, 'title': title, 'scene': scene, 'text': text, 'choice': data.choice and data.choice.text}
    _, result = agent_runtime.run('serial.review', '검수', SerialFailure, REVIEW_INSTRUCTIONS, {**brief, 'context': data.context},
                                  prompt_name='serial.episode_review_v3', max_tokens=2000, timeout=50, trace=brief, schema=Review, credit=credit)
    return result


def _plan_request(data: EpisodeRequest, summary: str) -> str:
    """기획 요청 문장: 중심 전개(1위 선택지)·연재 방향·제안 종합 순. PlanRequest.request 한도(2,000자)에 맞춘다."""
    # Writing 기획 지시는 그대로라 문맥 JSON(Content serialContext)의 이전 회차 요약·관련 장면 쓰는 법을 요청 문장으로 알린다.
    lines = ['다음 회차를 기획한다. 계획 제목은 회차 제목으로 쓰이므로 짧게 짓고 비트는 6~10개로 짠다. 직전 회차의 결말을 되풀이하지 않고 그 직후 장면에서 시작한다. '
             '문맥의 summaries로 전체 흐름을, related(있으면)로 이어 쓸 옛 장면을 참고하되 related의 문장을 그대로 베끼지 않는다.']
    if data.choice:
        lines.append(f'중심 전개(독자 투표 1위): {data.choice.text}\n이 전개를 이번 회차의 핵심 사건으로 삼아 비트 대부분을 여기에 쓴다.')
    if data.direction.strip():
        lines.append(f'연재 방향: {data.direction.strip()}')
    lines.append(f'독자 제안 종합(참고): {summary}')
    # ponytail: 한도를 넘으면 뒤(제안 종합)부터 자른다. 문제 되면 기획 요청 한도를 올리거나 연재 방향을 요약해 넘긴다.
    return '\n'.join(lines)[:2000]


def _usage(credit: agent_runtime.CreditMiddleware) -> Usage:
    return Usage(inputTokens=credit.input_tokens, outputTokens=credit.output_tokens)
