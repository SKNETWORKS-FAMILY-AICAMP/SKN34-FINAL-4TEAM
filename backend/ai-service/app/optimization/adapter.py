"""GEPA 어댑터(자동 개선 #823): 지시문 후보를 최적화 풀 항목마다 서비스 호출로 만들고 원문 평가 루브릭으로 채점한다.

안쪽 평가는 Langfuse Dataset Run을 만들지 않고 함수를 직접 부른다(app/evaluation/simulation의 generate·grade): minibatch마다 Run이 생기면 평가 목록과
기준 Run 탐색 창(최근 100개)을 밀어낸다. 항목 점수는 그 세트 지표(0~1)의 평균이다. 생성·채점이 실패한 항목은 0점으로 두되 실패 호출이 전체의 20%를
넘으면 중단한다(실패를 점수로 숨기지 않는다). 항목은 5개까지 동시에 돌고 스레드는 호출한 쪽의 추적 문맥을 이어받아 안쪽 호출이 같은 trace 아래에 남는다.
gepa는 --extra eval이라 여기서 import하지 않고 evaluate가 부를 때 읽는다.
"""

import asyncio
import contextvars
import json
from concurrent.futures import ThreadPoolExecutor
from statistics import fmean

from app.evaluation import simulation
from app.evaluation.errors import EvaluationFailure
from app.optimization.errors import OptimizationFailure
from app.simulation.errors import SimulationFailure

WORKERS = 5
MAX_FAILURE_RATE = 0.2
MAX_INPUT_CHARS = 6000  # 반성 입력 한 예시에 싣는 모델 입력 길이


class SimulationAdapter:
    """GEPA 후보는 {'instructions': 지시문 본문} 하나다. kind는 서비스 호출 이름(act·narrate), model은 기준 버전이 고른 모델이다."""

    propose_new_texts = None   # GEPA 0.1.4의 반성기가 이 속성을 바로 읽는다(Protocol에는 선택이지만 없으면 AttributeError). None = 기본 반성 흐름을 쓴다

    def __init__(self, kind: str, model: str | None):
        self.kind, self.model, self.calls, self.failures = kind, model, 0, 0

    def evaluate(self, batch: list[dict], candidate: dict[str, str], capture_traces: bool = False):
        from gepa import EvaluationBatch
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(contextvars.copy_context().run, self._one, row, candidate['instructions']) for row in batch]
            results = [future.result() for future in futures]
        self.calls += len(batch)
        self.failures += sum(result['error'] is not None for result in results)
        if self.failures > MAX_FAILURE_RATE * self.calls:
            raise OptimizationFailure(502, '생성·채점 실패가 20%를 넘어 중단했어요.')
        return EvaluationBatch(outputs=[r['output'] for r in results], scores=[r['score'] for r in results], trajectories=results if capture_traces else None)

    def make_reflective_dataset(self, candidate: dict[str, str], eval_batch, components_to_update: list[str]) -> dict[str, list[dict]]:
        """반성 입력: 모델 입력·생성 글·피드백(정답·지표 점수·위반 사실 본문). 루브릭 문구는 바꾸지 않는다(기준 Run과 어긋난다)."""
        records = [_record(trajectory) for trajectory in eval_batch.trajectories]
        return {name: records for name in components_to_update}

    def _one(self, row: dict, instructions: str) -> dict:
        try:
            output = simulation.generate(self.kind, instructions, row['input'], self.model)
            scores, leaked = asyncio.run(simulation.grade(self.kind, row['input'], output, row['expectedOutput'], row['metadata']))
        except (EvaluationFailure, SimulationFailure) as error:   # 고정 문구 실패만 항목 실패다. 그 밖의 예외(코드 버그)는 그대로 올린다
            return {'row': row, 'output': '', 'score': 0.0, 'scores': {}, 'leaked': [], 'error': str(error)}
        return {'row': row, 'output': output, 'score': fmean(scores.values()), 'scores': scores, 'leaked': leaked, 'error': None}


def _record(trajectory: dict) -> dict:
    data = json.dumps(trajectory['row']['input']['data'], ensure_ascii=False)
    inputs = data if len(data) <= MAX_INPUT_CHARS else data[:MAX_INPUT_CHARS] + ' …(이하 생략)'
    return {'Inputs': inputs, 'Generated Outputs': trajectory['output'] or '(생성하지 못했어요)', 'Feedback': _feedback(trajectory)}


def _feedback(trajectory: dict) -> str:
    if trajectory['error']:
        return '이 입력은 생성 또는 채점에 실패해 점수가 없어요.'
    row, scores = trajectory['row'], ', '.join(f'{name} {value:.2f}' for name, value in trajectory['scores'].items())
    lines = [f"정답(원작의 다음 글): {row['expectedOutput']}", f'점수(0~1, 높을수록 좋음): {scores}']
    if trajectory['leaked']:
        facts = {fact['id']: fact['text'] for fact in row['metadata']['judge']['facts']}
        lines.append('시점 위반: 생성 글이 아직 알 수 없는 사실을 말했거나 아는 듯 썼어요 — ' + '; '.join(facts[i] for i in trajectory['leaked']))
    return '\n'.join(lines)
