"""품질 성적표: TimeChara 질문을 시뮬레이션 인물 턴 경로로 답하게 하고 공개 채점 기준으로 채점한다.

질문 하나는 '그 시점의 인물에게 인터뷰어가 묻는 장면 한 줄'(`sim_worlds.Worlds.interview`)이고 답은 운영의 인물 턴 경로가 만든다:
`service.character_view` → `agent.act` → 서버 규칙(`scene_agent._problem`) → `agent.check`(`service.verify`) → 위반이면 고정 안내로 다시 쓴다(최대 `REGENERATIONS`번).
장면 에이전트의 도구·검사 미들웨어를 한 턴만 돌릴 수 없어, 같은 함수를 같은 순서로 부르는 얇은 루프다(규칙을 다시 구현하지 않는다).
채점은 `eval/novelbrain/run_timechara.py`의 공개 기준(시공간 0/1·성격 1~7)을 그대로 쓴다. 질문·응답 본문은 `.data`에만 남는다.
"""

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from langchain_core.runnables import RunnableLambda  # noqa: E402

from llm import CallCapExceeded, LlmFailure  # noqa: E402
from run_timechara import judge_personality, judge_spatiotemporal  # noqa: E402
from timechara import judge_name  # noqa: E402

import sim_worlds  # noqa: E402
from app.agent_runtime import UsageLedger  # noqa: E402
from app.simulation import agent, scene_agent, service  # noqa: E402
from app.simulation.errors import SimulationFailure  # noqa: E402
from app.simulation.prompt import FEEDBACK  # noqa: E402


def generate(plan, world, actor, scene) -> list[dict]:
    """인물 한 명의 답을 운영 경로로 만든다. 시도마다 {prose, failed(검사가 본 위반 종류)}이고, 마지막 시도가 최종 응답이다(모두 위반이면 멈춘 턴)."""
    pov = f'limited:{actor.id}'
    asked, extra, _ = service.character_view(plan, world, scene, actor)
    style = service.action_style(pov, actor)
    kinds = service.check_kinds(plan, 'character', pov)
    payload = {**asked, **extra, 'actionStyle': style}
    attempts, feedback = [], []
    for _ in range(service.REGENERATIONS + 1):
        action = service.acted(agent.act({**asked, 'actionStyle': style, **({'feedback': feedback} if feedback else {})}))
        prose = service.normalize_quotes(action.prose.strip())
        made = {'kind': 'character', 'characterId': actor.id, 'prose': prose, 'check': {'payload': payload}}
        if problem := scene_agent._problem(made, scene):
            failed = [problem]
        else:
            body = {**payload, 'checks': kinds, 'paragraph': prose}
            verdict = agent.check(body)
            service.verify(verdict, kinds, body)
            failed = [c for c in verdict.checks if not c.passed]
        attempts.append({'prose': prose, 'failed': [c.kind for c in failed]})
        if not failed:
            break
        feedback = [FEEDBACK[c.kind] for c in failed]
    return attempts


def grade(llm, row: dict, response: str, templates: dict, personality: str | None) -> dict:
    """공개 기준 채점: 시공간(absence·presence는 공간 먼저) 0/1과 성격 1~7. 채점 호출이 실패하면 점수를 꾸미지 않고 None이다."""
    name = judge_name(row['series'], row['character'], row['character_period'])
    try:
        verdict = judge_spatiotemporal(llm, row, response, name, templates['spatiotemporal'])
        mood = judge_personality(llm, row['question'], response, name, personality, templates['personality']) if personality else None
    except LlmFailure:
        return {'score': None, 'personality': None}
    return {'score': verdict['score'], 'personality': mood}


def evaluate(row: dict, worlds, llm, templates: dict, personalities: dict) -> dict:
    """질문 하나: 인물 턴을 만들고(모델 호출은 비용 장부에 남긴다) 첫 응답과 최종 응답을 채점한다. 생성이 실패하면 error에 상태만 남긴다."""
    ledger = UsageLedger('simulation.quality', lambda step: {})  # 모델 호출마다 {name, ms, tokens}를 모은다(STEP이 없어 span은 남기지 않는다)
    record = {'idx': row['idx'], 'data_type': row['data_type'], 'error': None}
    try:
        attempts = RunnableLambda(lambda _: generate(*worlds.interview(row))).invoke(None, {'callbacks': [ledger]})
    except SimulationFailure as failure:
        attempts = None
        record['error'] = failure.status
    for call in ledger.calls:
        llm.cost.record(call['name'], call['inputTokens'] or 0, call['outputTokens'] or 0, failed=call['failed'])
    if attempts is None:
        return {**record, 'usage': ledger.calls}
    first, final = attempts[0], attempts[-1]
    personality = personalities.get(row['character'])
    first_grade = grade(llm, row, first['prose'], templates, personality)
    final_grade = first_grade if final['prose'] == first['prose'] else grade(llm, row, final['prose'], templates, personality)
    return {**record, 'attempts': len(attempts), 'blocked': bool(final['failed']), 'flagged': bool(first['failed']),
            'leakFlagged': 'knowledge_leak' in first['failed'], 'first': first_grade, 'final': final_grade,
            'responses': {'first': first['prose'], 'final': final['prose']}, 'usage': ledger.calls}


def run_quality(rows: list[dict], worlds, llm, templates: dict, personalities: dict, limit_usd: float, workers: int, out: Path, question_usd: float) -> list[dict]:
    """질문마다 evaluate를 스레드로 돌려 끝난 것부터 out(JSONL)에 덧붙인다. out에 이미 있는 질문은 다시 하지 않아 중단 뒤에 이어 받는다.
    진행 중인 질문의 비용은 끝나야 장부에 남으므로 새 질문은 '장부 + 동시 수 × 질문당 최대 금액(question_usd)'이 상한 안일 때만 시작한다(그러면 동시에 진행하던 질문이
    끝나도 지출이 상한을 넘지 않는다). 그렇지 않으면 새 질문을 시작하지 않고 끝낸 것을 남긴 채 CallCapExceeded다."""
    out.parent.mkdir(parents=True, exist_ok=True)
    done = {r['idx']: r for r in map(json.loads, out.read_text().splitlines())} if out.exists() else {}
    for series in {r['series'] for r in rows}:
        worlds.series(series)  # 스레드가 같은 세계관을 동시에 만들지 않게 먼저 만든다
    lock, stop, reserve = threading.Lock(), threading.Event(), workers * question_usd

    def one(row):
        if stop.is_set() or llm.cost.spent() + reserve > limit_usd:
            stop.set()
            return
        record = evaluate(row, worlds, llm, templates, personalities)
        with lock, out.open('a') as file:
            file.write(json.dumps(record, ensure_ascii=False) + '\n')
            done[row['idx']] = record

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, [r for r in rows if r['idx'] not in done]))
    if stop.is_set():
        raise CallCapExceeded(f'비용 상한 ${limit_usd:.2f}에 도달했다(끝낸 질문 {len(done)}/{len(rows)}). 같은 명령으로 이어 받는다.')
    return [done[r['idx']] for r in rows]


def load_inputs(rows: list[dict]) -> tuple[dict, dict]:
    """공개 채점 프롬프트 둘과 인물별 성격 설명(`prepare`가 받은 .data/timechara/data). 성격 설명이 없는 인물은 성격을 채점하지 않는다."""
    data = sim_worlds.TC / 'data'
    templates = {'spatiotemporal': (data / 'spatiotemporal_consistency_evaluation_prompt.txt').read_text(),
                 'personality': (data / 'personality_consistency_evaluation_prompt.txt').read_text()}
    paths = {name: data / 'personality' / f"{name.lower().replace(' ', '_')}_personality.txt" for name in {r['character'] for r in rows}}
    return templates, {name: path.read_text() for name, path in paths.items() if path.exists()}
