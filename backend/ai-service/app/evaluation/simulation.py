"""시뮬레이션 평가 세트(simulation.act·simulation.narrate)의 생성·채점. 운영 회귀 평가는 이 세트만 원문 평가(eval/simulation)와 같은 방식으로 돌린다.

생성은 업무 Agent 틀이 아니라 실제 서비스 호출이다: app/simulation/agent의 act·narrate에 평가 대상 프롬프트 버전 본문을 그대로 주고(production 버전을 읽지 않는다)
응답 확인·따옴표 통일도 서비스와 같다. act는 서비스 기본 모델(terra)·구조화 출력 그대로다.
채점은 G-Eval이 아니라 원문 평가 루브릭(rubric.py)이다: 정답(expectedOutput)을 보여 준 채점 모델이 대사는 voice·intent, 지문·독백은 style·info를 1~5로 매기고
시점 위반은 pov_ok(위반이 없으면 1, 있으면 0)로 낸다. 지표는 모두 높을수록 좋고 Run 점수는 지표별 평균이다. 채점 입력은 항목의 metadata.judge(character·scene·facts)다.
운영 Run·항목 점수는 Ragas·GEval처럼 0~1이라 1~5점은 (점수-1)/4로 바꿔 기록한다(pov_ok는 그대로). 원문 평가(eval/simulation)의 1~5 기록·보고서는 바뀌지 않는다.
"""

from langfuse import Evaluation

from app.evaluation import rubric, scoring
from app.evaluation.errors import EvaluationFailure
from app.simulation import agent, service

KINDS = {'simulation.act': 'act', 'simulation.narrate': 'narrate'}   # 평가 세트 이름 → 서비스 호출 이름(지시문 이름은 character_simulation.<호출>)
METRICS = {'act': ('voice', 'intent', 'pov_ok'), 'narrate': ('style', 'info', 'pov_ok')}
BAD_INPUT = '시뮬레이션 평가 항목의 input.data(객체)가 필요합니다.'
BAD_ITEM = '시뮬레이션 평가 항목에 정답(expectedOutput)과 metadata.judge(character·scene·facts)가 필요합니다.'


def generate(kind: str, instructions: str, item_input: dict, model: str | None = None) -> str:
    """항목 입력(input.data는 서비스가 그 호출에 보내는 값 그대로)을 서비스 호출로 실행해 응답 글을 돌려준다. model은 평가하는 버전의 모델이다."""
    data = item_input.get('data')
    if not isinstance(data, dict):
        raise EvaluationFailure(422, BAD_INPUT)
    if kind == 'act':
        return service.normalize_quotes(service.acted(agent.act(data, instructions, model)).prose.strip())
    return service.narrated(agent.narrate(data, instructions, model), monologue=item_input.get('set') == 'monologue').prose.strip()


async def evaluate(kind: str, item_input: dict, output: str, expected, metadata) -> list[Evaluation]:
    """응답 글(output)을 정답과 견줘 루브릭 한 번으로 채점한 지표들(METRICS[kind])."""
    character, scene, facts = _judge_inputs(expected, metadata)
    if kind == 'act':
        instructions, schema, payload = rubric.DIALOGUE_JUDGE, rubric.DialogueGrade, rubric.dialogue_payload(character, scene, expected, output, facts)
    else:
        if item_input.get('set') not in ('narration', 'monologue'):
            raise EvaluationFailure(422, BAD_INPUT)
        instructions, schema = rubric.NARRATION_JUDGE, rubric.NarrationGrade
        payload = rubric.narration_payload(item_input['set'], character, scene, expected, output, facts)
    grade = await scoring.rubric_grade(instructions, payload, schema)
    leaked = grade.pop('leaked')
    scores = [Evaluation(name=name, value=(grade[name] - 1) / 4) for name in METRICS[kind][:2]]   # 1~5점을 0~1에 기록한다(Ragas·GEval과 같은 눈금이라 허용 오차를 함께 쓴다)
    return scores + [Evaluation(name='pov_ok', value=float(not leaked), comment='시점 위반 사실 id: ' + ', '.join(leaked) if leaked else None)]   # 사실 본문은 남기지 않는다


def _judge_inputs(expected, metadata) -> tuple[str, list[dict], list[dict]]:
    """항목이 채점에 필요한 것을 갖췄는지 확인한다(정답과 metadata.judge). 어긋나면 모델을 부르지 않고 항목 실패다."""
    judge = (metadata or {}).get('judge')
    if not (isinstance(expected, str) and expected.strip() and isinstance(judge, dict)):
        raise EvaluationFailure(422, BAD_ITEM)
    character, scene, facts = judge.get('character'), judge.get('scene'), judge.get('facts')
    lines = isinstance(scene, list) and all(isinstance(line, dict) and isinstance(line.get('by'), str) and isinstance(line.get('text'), str) for line in scene)
    listed = isinstance(facts, list) and all(isinstance(fact, dict) and isinstance(fact.get('id'), str) and isinstance(fact.get('text'), str) for fact in facts)
    if not (isinstance(character, str) and lines and listed):   # 나레이션은 인물이 없어 character가 빈 문자열이다
        raise EvaluationFailure(422, BAD_ITEM)
    return character, scene, facts
