"""Decision Guard 라우팅 평가 세트(decision_guard.routing, #783)의 생성·채점.

생성은 업무 Agent 틀이 아니라 실제 판정(app/intent/service.judge)에 평가할 프롬프트 버전 본문을 지시문으로 준다(production을 읽지 않는다).
항목 input은 {request, history?}이고 history는 오케스트레이션이 보내는 이전 턴 모양({request, reply, features}) 그대로다.
채점은 모델 없이 정답(expectedOutput {guard, capabilities})과 견준다: guard는 일치 1·불일치 0, 기능은 precision(고른 기능 중 맞은 비율)과
recall(정답 기능 중 고른 비율)이며 분모가 비면 1이다(기능 없는 잡담에 기능을 고르면 precision 0).
"""

import json

from langfuse import Evaluation

from app.evaluation.errors import EvaluationFailure
from app.intent import service as intent

DATASET, PROMPT = 'decision_guard.routing', 'decision_guard.judge'
METRICS = ('guard', 'precision', 'recall')
BAD_INPUT = '라우팅 평가 항목의 input에는 request(문자열)와 선택 history(목록)가 필요합니다.'
BAD_ITEM = '라우팅 평가 항목에 정답(expectedOutput의 guard·capabilities)이 필요합니다.'


def generate(instructions: str, item_input: dict) -> str:
    request, history = item_input.get('request'), item_input.get('history', [])
    if not (isinstance(request, str) and request.strip() and isinstance(history, list)):
        raise EvaluationFailure(422, BAD_INPUT)
    result = intent.judge(request, history=history, instructions=instructions)
    return json.dumps({'guard': result.reason or 'none', 'capabilities': result.capabilities}, ensure_ascii=False)


async def evaluate(output: str, expected) -> list[Evaluation]:
    if not (isinstance(expected, dict) and isinstance(expected.get('guard'), str) and isinstance(expected.get('capabilities'), list)):
        raise EvaluationFailure(422, BAD_ITEM)
    got = json.loads(output)
    picked, wanted = set(got['capabilities']), set(expected['capabilities'])
    hit = len(picked & wanted)
    return [Evaluation(name='guard', value=float(got['guard'] == expected['guard'])),
            Evaluation(name='precision', value=hit / len(picked) if picked else 1.0),
            Evaluation(name='recall', value=hit / len(wanted) if wanted else 1.0)]
