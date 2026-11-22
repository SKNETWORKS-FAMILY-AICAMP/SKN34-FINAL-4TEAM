"""속도 성적표: 고정 장면을 장면 에이전트(`pausing=False`)로 끝까지 돌려 턴마다의 모델 호출 시간·호출 수·토큰·재생성과 멈춤을 잰다.

운영 오케스트레이션의 scene 노드와 같게 `SceneContext(loaded=World)`와 `UsageLedger` 콜백으로 에이전트를 부른다. 세계관은 `sim_worlds`가 만들어 넣어 Content를 부르지 않는다.
장면은 순서대로 돈다(병렬 호출이 지연 측정을 흔들지 않게). 모델 호출 사용량은 비용 장부에도 남긴다. 한 이벤트 루프 안에서 불러야 한다(연출 분류기의 HTTP 연결이 루프에 묶인다).
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from langchain_core.messages import HumanMessage  # noqa: E402

from cost import request_usd  # noqa: E402
from llm import CallCapExceeded  # noqa: E402

from app.agent_runtime import UsageLedger  # noqa: E402
from app.simulation import scene_agent, service  # noqa: E402
from app.simulation.models import Scene  # noqa: E402

STEP = {'feature': 'character_simulation', 'when': 'always', 'status': 'not_started'}  # 장면 결과를 감싸는 단계 항목(오케스트레이션이 만드는 단계의 최소형)
SCENE_RESERVE_USD = 0.50  # 장면 하나가 더 쓸 수 있는 금액의 여유: 이만큼이 남지 않으면 새 장면을 시작하지 않는다


class TimedLedger(UsageLedger):
    """사용량 장부에 턴이 끝난 시각 사이의 시간(wallMs)을 더한다. 턴 대기 시간은 모델 호출 시간의 합(ms)에 recall 같은 계산이 더해진 것이다."""

    def __init__(self):
        super().__init__('simulation.turn', scene_agent.turn)
        self.marks = [time.monotonic()]

    def _flush(self, step: dict) -> None:
        super()._flush(step)
        self.marks.append(time.monotonic())
        self.records[-1]['wallMs'] = round((self.marks[-1] - self.marks[-2]) * 1000)


def _priced(call: dict) -> dict:
    """장부에 더할 모델 단가 인자(orig_variants.priced): act는 서비스가 쓰는 모델(기본 terra)의 단가다. 평가 모듈은 이 도구보다 늦게 생겨 필요할 때 불러온다."""
    from orig_variants import priced
    return priced(call['name'])


def _usd(call: dict) -> float:
    tokens_in, tokens_out, rate = call['inputTokens'] or 0, call['outputTokens'] or 0, _priced(call).get('rate')   # 토큰을 알려 주지 않은 호출은 0으로 세고 unpriced로 센다
    return request_usd(tokens_in, tokens_out) if rate is None else (tokens_in * rate[0] + tokens_out * rate[2]) / 1_000_000


async def run_scene(spec: dict, plan, world, cost=None, transcript: bool = False) -> dict:
    """장면 하나를 끝까지 돌린 기록 {id, mode, status, stopReason, error, turns, steps, unpriced}. 단계(step) 하나가 한 턴이고 cost가 있으면 호출마다 비용 장부에 남긴다.
    transcript가 켜지면 진단용으로 턴마다 말한 이·글·진행한 비트를 transcript에 더한다(글이 들어가므로 기록은 .data에만 둔다)."""
    context = service.SceneContext(plan=plan, target={'workId': 'eval', 'episode': world.episode}, request=spec['id'], scope=None, steps=[dict(STEP)],
                                   pausing=False, loaded=world)
    seed = {'messages': [HumanMessage('장면을 진행해 주세요.')], 'scene': service.new_scene(plan).model_dump(mode='json'), 'pending': False,
            'decision': None, 'action': None}
    ledger, began = TimedLedger(), time.monotonic()
    out = await scene_agent.scene_agent(False).ainvoke(seed, {'callbacks': [ledger]}, context=context)
    elapsed = round((time.monotonic() - began) * 1000)
    final = Scene.model_validate(out['scene'])
    if final.result.status in ('running', 'paused'):  # 에이전트는 끝나거나 멈춰야 끝난다: 이어 갈 장면인데 끝났다면 호출 한도(안전망)가 끊은 것이다(오케스트레이션과 같은 판정)
        final = service.stop_scene(final, '호출 한도에서 멈췄어요.', 'stopped', 'call_limit')
    calls = [c for r in ledger.records for c in r['calls']] + ledger.calls  # 끝까지 알림이 가지 못한 호출도 센다
    if cost is not None:
        for call in calls:
            cost.record(call['name'], call['inputTokens'] or 0, call['outputTokens'] or 0, failed=call['failed'], **_priced(call))
    record = {'id': spec['id'], 'engine': 'turn', 'mode': plan.mode, 'status': final.result.status, 'stopReason': final.result.stopReason, 'error': final.error,
            'turns': [{'kind': t.kind, 'pov': t.pov, 'regenerated': t.regenerated} for t in final.result.turns],
            'steps': [{'turn': r['turn'], 'ms': r['ms'], 'wallMs': r['wallMs'], 'modelCalls': r['modelCalls'], 'failures': r['failures'],
                       'inputTokens': r['inputTokens'], 'outputTokens': r['outputTokens'], 'usd': sum(_usd(c) for c in r['calls']),
                       'calls': [c['name'] for c in r['calls']]} for r in ledger.records],
            'unpriced': sum(c['inputTokens'] is None for c in calls),
            # 엔진 비교용 공통 항목: 턴 방식은 모든 호출이 차례로 이어져(직렬 단계 = 호출 수) 첫 턴이 보일 때까지는 첫 단계의 경과 시간이다
            'elapsedMs': elapsed, 'firstTurnMs': ledger.records[0]['wallMs'] if ledger.records else None, 'serialSteps': len(calls), 'calls': calls}
    if transcript:  # 정지한 장면은 턴과 trail 길이가 어긋날 수 있어 짧은 쪽까지만 짝짓는다
        record['transcript'] = {'beats': [b.status for b in final.result.beats], 'turns': [{'kind': t.kind, 'by': t.characterName, 'text': t.prose, 'beat': e.beat, 'done': e.done, 'ended': e.ended}
                                                                                       for t, e in zip(final.result.turns, final.trail, strict=False)]}
    return record


async def run_speed(specs: list[dict], worlds, cost, limit_usd: float, out: Path, transcript: bool = False) -> list[dict]:
    """고정 장면을 순서대로 끝까지 돌려 끝난 것부터 out(JSONL)에 덧붙인다(이미 있는 장면은 다시 하지 않는다). 여유가 남지 않으면 새 장면을 시작하지 않고 CallCapExceeded다."""
    out.parent.mkdir(parents=True, exist_ok=True)
    done = {r['id']: r for r in map(json.loads, out.read_text().splitlines())} if out.exists() else {}
    for spec in specs:
        if spec['id'] in done:
            continue
        if cost.spent() + SCENE_RESERVE_USD > limit_usd:
            raise CallCapExceeded(f'비용 상한 ${limit_usd:.2f}에 가까워졌다(끝낸 장면 {len(done)}/{len(specs)}). 같은 명령으로 이어 받는다.')
        plan, world = worlds.scene(spec)
        done[spec['id']] = await run_scene(spec, plan, world, cost, transcript)
        with out.open('a') as file:
            file.write(json.dumps(done[spec['id']], ensure_ascii=False) + '\n')
    return [done[spec['id']] for spec in specs]
