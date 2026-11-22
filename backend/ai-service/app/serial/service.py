"""AI 자율 연재(#659): 시뮬레이션 장면 미리보기와 다음 회차 생성·검수.

요청 하나의 모든 모델 호출이 같은 CreditMiddleware를 지나 입력+출력 토큰이 누적되고, 응답의 credits는 그 확정 금액이다(상한에 닿으면 402).
회차 기획·원고는 app/writing의 기획(plan)과 집필(draft)을 그대로 쓰고(지시문·프롬프트 이름 writing_editing.* 그대로),
의견 종합·검수·장면 미리보기만 새 프롬프트(serial.*)다. 사용자 토큰·Content MCP를 쓰지 않고 입력·원고·모델 응답을 오류 문구에 넣지 않는다.
"""

from app import agent_runtime
from app.serial.errors import SerialFailure
from app.serial.models import (EpisodeRequest, EpisodeResponse, Review, SimulationRequest, SimulationResponse, Summary,
                               Usage)
from app.serial.prompt import REVIEW_INSTRUCTIONS, SIMULATION_INSTRUCTIONS, SUMMARY_INSTRUCTIONS
from app.writing import agent as writing
from app.writing.models import BeatPlan, DraftRequest, PlanRequest

SCENE_MAX, SUMMARY_MAX, TITLE_MAX = 1500, 1000, 120  # 장면 미리보기(계약)·종합 문장·회차 제목(Content 한도 120자)
NO_OPINIONS = '독자 의견이 없어 연재 방향대로 이어 갔습니다.'


def simulate(data: SimulationRequest) -> SimulationResponse:
    """공개 문맥으로 전제·비트를 짧은 장면 미리보기로 쓴다. 범위를 벗어난 결과는 줄이지 않고 502다."""
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    message, _ = agent_runtime.run('serial.scene', '장면 미리보기', SerialFailure, SIMULATION_INSTRUCTIONS,
                                   data.model_dump(include={'episodeNumber', 'premise', 'beats', 'context'}), prompt_name='serial.simulation',
                                   max_tokens=2000, timeout=60, trace=data.model_dump(include={'episodeNumber', 'premise', 'beats'}), credit=credit)
    scene = message.text.strip()
    if not scene or len(scene) > SCENE_MAX:
        raise SerialFailure(502, '장면 미리보기 모델 응답을 확인할 수 없습니다.')
    return SimulationResponse(scene=scene, credits=credit.credits, usage=_usage(credit))


def episode(data: EpisodeRequest) -> EpisodeResponse:
    """의견 종합 → 기획·원고 → 검수. 검수에 실패하면 지적을 넣어 원고를 한 번 다시 쓰고 다시 검수하며, 또 실패하면 422다."""
    credit = agent_runtime.CreditMiddleware(data.creditLimit, SerialFailure)
    summary = _summary(data, credit)
    plan = writing.plan(PlanRequest(episodeNumber=data.episodeNumber, request=_plan_request(summary, data.direction), single=True,
                                    context=data.context), credit).plans[0]
    title = plan.title.strip()
    if not title or len(title) > TITLE_MAX:
        raise SerialFailure(502, writing.BAD_PLAN)
    text = writing.draft(DraftRequest(episodeNumber=data.episodeNumber, plan=writing.plan_text(plan), context=data.context), credit).text
    review = _review(data, title, text, credit)
    if not review.passed:
        text = writing.draft(DraftRequest(episodeNumber=data.episodeNumber, plan=_rewrite_plan(plan, review.issues), context=data.context),
                             credit).text
        review = _review(data, title, text, credit)
        if not review.passed:
            raise SerialFailure(422, '검수를 통과하지 못했습니다.')
    return EpisodeResponse(summary=summary, title=title, text=text, review=review, credits=credit.credits, usage=_usage(credit))


def _summary(data: EpisodeRequest, credit: agent_runtime.CreditMiddleware) -> str:
    """독자 의견 종합. 공개되는 글이라 연재 방향·작품 문맥은 모델에 보내지 않는다. 의견이 없으면 모델을 부르지 않는다."""
    if not data.opinions:
        return NO_OPINIONS
    brief = {'episodeNumber': data.episodeNumber, 'opinions': [opinion.model_dump() for opinion in data.opinions]}
    _, result = agent_runtime.run('serial.summary', '의견 종합', SerialFailure, SUMMARY_INSTRUCTIONS, brief, prompt_name='serial.summary',
                                  max_tokens=1500, timeout=40, trace=brief, schema=Summary, credit=credit)
    summary = result.summary.strip()
    if not summary or len(summary) > SUMMARY_MAX:
        raise SerialFailure(502, '의견 종합 모델 응답을 확인할 수 없습니다.')
    return summary


def _review(data: EpisodeRequest, title: str, text: str, credit: agent_runtime.CreditMiddleware) -> Review:
    """새 원고를 문맥 기준 설정 충돌·개연성·19세 이용가로 검수한다. 추적에는 작품 문맥을 남기지 않는다."""
    brief = {'episodeNumber': data.episodeNumber, 'title': title, 'text': text}
    _, result = agent_runtime.run('serial.review', '검수', SerialFailure, REVIEW_INSTRUCTIONS, {**brief, 'context': data.context},
                                  prompt_name='serial.review', max_tokens=2000, timeout=60, trace=brief, schema=Review, credit=credit)
    return result


def _plan_request(summary: str, direction: str) -> str:
    """기획 요청 문장: 독자 의견 종합과 연재 방향. PlanRequest.request 한도(2,000자)에 맞춘다."""
    lines = ['다음 회차를 기획한다. 계획 제목은 회차 제목으로 쓰이므로 짧게 짓는다.', f'독자 의견 종합: {summary}']
    if direction.strip():
        lines.append(f'연재 방향: {direction.strip()}')
    # ponytail: 연재 방향이 길면 뒤를 자른다(종합이 앞). 문제 되면 기획 요청 한도를 올리거나 방향을 요약해 넘긴다.
    return '\n'.join(lines)[:2000]


def _rewrite_plan(plan: BeatPlan, issues: list[str]) -> str:
    """같은 계획에 검수 지적(앞 5개, 각 200자)을 붙여 다시 쓰게 한다. 집필 요청의 계획 한도(4,000자) 안에서 계획 쪽을 줄인다."""
    notes = '\n\n검수에서 지적된 문제를 고쳐 다시 쓴다:\n' + '\n'.join(f'- {issue[:200]}' for issue in issues[:5])
    return writing.plan_text(plan)[:4000 - len(notes)] + notes


def _usage(credit: agent_runtime.CreditMiddleware) -> Usage:
    return Usage(inputTokens=credit.input_tokens, outputTokens=credit.output_tokens)
