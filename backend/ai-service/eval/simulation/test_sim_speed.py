"""속도 실행기 단위 테스트: 모델 대역(연출·생성·나레이션·검사)으로 진짜 장면 에이전트를 끝까지 돌려 사용량 장부 기록·설정별 호출 수·이어 받기를 확인한다."""

import asyncio
import time

import pytest
from langchain_core.callbacks import adispatch_custom_event

import sim_config as c
import sim_speed as s
import sim_worlds as w
from app.agent_runtime import MODEL_EVENT
from app.simulation import agent, director, scene_agent
from app.simulation.models import Action, CheckItem, Decision, Narration, Verdict
from cost import CostLog, usd
from llm import CallCapExceeded
from sim_stats import summarize_speed

FLOW = next(spec for spec in w.SCENES if spec['id'] == 'ko-5-flow')  # 비트 둘: 시작·비트 전환·마무리 나레이션과 인물 턴 둘
IF = next(spec for spec in w.SCENES if spec['id'] == 'ko-5-if')


@pytest.fixture
def models(monkeypatch):
    """연출·생성·나레이션·검사 대역. 호출마다 공통 MODEL_EVENT로 (시간·토큰)을 알려 사용량 장부가 모으게 하고, 호출한 이름의 순서를 돌려준다."""
    calls = []

    def report(name, tin=1000, tout=100):
        agent._report(name, time.monotonic() - 0.02, {'input_tokens': tin, 'output_tokens': tout}, failed=False)
        calls.append(name)

    async def decide(state, allowed, cast, last_pov=None):
        await adispatch_custom_event(MODEL_EVENT, {'name': 'director', 'ms': 10, 'failed': False, 'inputTokens': 300, 'outputTokens': 5})
        calls.append('director')
        turn = 'speech' if 'speech' in allowed else allowed[0]
        return Decision(turn=turn, speaker=cast[0]['id'] if turn == 'speech' else None, pov='omniscient')

    def act(data):
        report('act')
        return Action(prose='그는 말했다. "안녕."', observed='그가 인사했다.', refusesBeat=False, refusalReason=None)

    def narrate(data):
        report('narrate')
        return Narration(prose='바람이 불었다.', observed='바람이 분다.')

    def check(payload):
        report('check', 3000, 100)
        return Verdict(checks=[CheckItem(kind=k, passed=True, detail='', refs=[]) for k in payload['checks']], beatDone=True,
                       sceneComplete=calls.count('act') >= 2)

    monkeypatch.setattr(director, 'decide', decide)
    monkeypatch.setattr(agent, 'act', act)
    monkeypatch.setattr(agent, 'narrate', narrate)
    monkeypatch.setattr(agent, 'check', check)
    return calls


def test_act_calls_are_priced_by_the_service_act_model_in_the_ledger_and_the_step_cost(models, tmp_path, monkeypatch):
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-6-luna')
    for name in ('SIMULATION_ACT_MODEL', 'SIMULATION_ACT_BASE_URL'):
        monkeypatch.delenv(name, raising=False)
    cost = CostLog(tmp_path / 'cost.jsonl')
    plan, world = w.Worlds([], {}).scene(FLOW)
    record = asyncio.run(s.run_scene(FLOW, plan, world, cost))
    acts = [row for row in cost.rows() if row['kind'] == 'act']
    assert acts and all(row['model'] == 'gpt-6.1-terra' and row['usd'] == pytest.approx((1000 * 1.00 + 100 * 5.00) / 1_000_000) for row in acts)   # 서비스 기본 act 모델 terra의 단가
    assert all('model' not in row for row in cost.rows() if row['kind'] != 'act')
    assert sum(step['usd'] for step in record['steps']) == pytest.approx(cost.spent())   # 턴별 금액도 장부와 같은 단가다


def play(spec):
    plan, world = w.Worlds([], {}).scene(spec)
    return asyncio.run(s.run_scene(spec, plan, world))


def test_a_scene_runs_to_its_end_and_the_usage_ledger_gives_one_step_per_turn(models):
    record = play(FLOW)
    assert (record['id'], record['mode'], record['status'], record['stopReason']) == ('ko-5-flow', 'flow', 'completed', None)
    assert [t['kind'] for t in record['turns']] == ['narration', 'character', 'narration', 'character', 'narration']
    assert len(record['steps']) == len(record['turns']) and all(t['regenerated'] == 0 for t in record['turns'])
    first = record['steps'][0]
    assert first['calls'] == ['director', 'narrate', 'check'] and first['modelCalls'] == 3 and first['inputTokens'] == 300 + 1000 + 3000
    assert first['ms'] >= 10 and first['wallMs'] >= 0 and first['usd'] == pytest.approx(usd(300, 5) + usd(1000, 100) + usd(3000, 100))


def test_with_the_director_and_narration_check_switches_the_ledger_shows_exactly_the_skipped_calls(models):
    runs = {}
    for config in 'ACE':
        models.clear()
        with c.applied(config):
            runs[config] = play(FLOW)
    names = {config: [name for step in record['steps'] for name in step['calls']] for config, record in runs.items()}
    assert names['A'].count('director') == 5 and names['A'].count('check') == 5  # 턴마다 연출, 검사는 나레이션 셋과 인물 턴 둘
    assert names['C'].count('director') == 2 and names['C'].count('check') == 5  # 규칙이 정한 시작·전환·마무리는 묻지 않는다
    assert names['E'].count('director') == 2 and names['E'].count('check') == 2  # 전지적 나레이션 셋은 모델 검사를 건너뛴다
    assert all(record['status'] == 'completed' for record in runs.values())
    speed = {config: summarize_speed([record]) for config, record in runs.items()}
    assert speed['A']['callsPerTurn'] > speed['C']['callsPerTurn'] > speed['E']['callsPerTurn']


def test_a_scene_the_agent_could_not_finish_is_recorded_with_its_stop_reason(models, monkeypatch):
    monkeypatch.setattr(agent, 'check', lambda payload: Verdict(checks=[CheckItem(kind=k, passed=False, detail='d', refs=[]) for k in payload['checks']],
                                                                 beatDone=False, sceneComplete=False))
    record = play(IF)
    assert (record['status'], record['stopReason']) == ('stopped', 'check_failed') and record['turns'] == []


def test_calls_without_token_usage_are_counted_as_unpriced_instead_of_silently_costing_zero(models, monkeypatch):
    async def decide(state, allowed, cast, last_pov=None):
        await adispatch_custom_event(MODEL_EVENT, {'name': 'director', 'ms': 10, 'failed': False, 'inputTokens': None, 'outputTokens': None})
        speech = 'speech' in allowed
        return Decision(turn='speech' if speech else allowed[0], speaker=cast[0]['id'] if speech else None, pov='omniscient')

    monkeypatch.setattr(director, 'decide', decide)
    record = play(FLOW)
    assert record['unpriced'] == 5 and summarize_speed([record])['unpricedCalls'] == 5  # 턴마다 한 번인 연출 호출 다섯 번


def test_a_scene_cut_short_by_the_loop_guard_is_recorded_as_stopped_by_the_call_limit(models, monkeypatch):
    monkeypatch.setattr(scene_agent, 'LOOP_LIMIT', 2)
    scene_agent.scene_agent.cache_clear()  # 에이전트는 처음 만들 때의 한도를 쓴다
    try:
        record = play(FLOW)
    finally:
        scene_agent.scene_agent.cache_clear()
    assert (record['status'], record['stopReason']) == ('stopped', 'call_limit') and 0 < len(record['turns']) < 5


def test_a_run_appends_each_scene_resumes_and_puts_every_call_into_the_cost_ledger(models, tmp_path):
    cost, out = CostLog(tmp_path / 'cost.jsonl'), tmp_path / 'runs' / 'speed-A.jsonl'
    worlds = w.Worlds([], {})
    first = asyncio.run(s.run_speed([FLOW], worlds, cost, limit_usd=10, out=out))
    assert [r['id'] for r in first] == ['ko-5-flow'] and len(out.read_text().splitlines()) == 1 and len(models) > 0
    assert {row['kind'] for row in cost.rows()} == {'director', 'narrate', 'act', 'check'} and cost.spent() == pytest.approx(sum(sum(st['usd'] for st in r['steps']) for r in first))
    seen = len(models)
    again = asyncio.run(s.run_speed([FLOW, IF], worlds, cost, limit_usd=10, out=out))
    assert [r['id'] for r in again] == ['ko-5-flow', 'ko-5-if'] and len(models) > seen and len(out.read_text().splitlines()) == 2
    assert [r['id'] for r in again][0] == first[0]['id'] and again[0] == first[0]  # 끝낸 장면은 다시 돌리지 않고 기록을 그대로 읽는다


def test_a_run_stops_before_a_scene_when_the_cost_limit_could_be_crossed(models, tmp_path):
    cost = CostLog(tmp_path / 'cost.jsonl')
    cost.record('earlier', 10_000_000, 0)  # 이미 $2를 썼다
    with pytest.raises(CallCapExceeded):
        asyncio.run(s.run_speed([FLOW], w.Worlds([], {}), cost, limit_usd=2.4, out=tmp_path / 'speed.jsonl'))
    assert models == []  # 장면 하나가 쓸 수 있는 여유(SCENE_RESERVE_USD)가 남지 않으면 시작하지 않는다



def test_a_scene_run_with_transcript_keeps_who_said_what_and_which_beat_each_turn_moved(models):
    plan, world = w.Worlds([], {}).scene(FLOW)
    record = asyncio.run(s.run_scene(FLOW, plan, world, transcript=True))
    turns = record['transcript']['turns']
    assert [t['kind'] for t in turns] == ['narration', 'character', 'narration', 'character', 'narration']
    assert turns[0]['text'] == '바람이 불었다.' and turns[1]['text'] == '그는 말했다. "안녕."' and turns[1]['by'] == '길현' and turns[0]['by'] == '나레이션'
    assert [t['beat'] for t in turns] == [0, 0, 1, 1, None] and turns[1]['done'] is True and turns[0]['done'] is False   # 나레이션도 그 비트에 속한다(맨 끝 마무리만 없음)
    assert record['transcript']['beats'] == ['done', 'done']
    assert 'transcript' not in play(FLOW)   # 켜지 않으면 기록에 글을 남기지 않는다(기본 기록은 집계용)



def test_a_scene_record_has_the_uniform_fields_the_engine_comparison_reads(models):
    record = play(FLOW)
    names = sorted(name for step in record['steps'] for name in step['calls'])
    assert record['engine'] == 'turn' and record['elapsedMs'] >= record['firstTurnMs'] == record['steps'][0]['wallMs']
    assert sorted(c['name'] for c in record['calls']) == names and record['serialSteps'] == len(names)   # 턴 방식은 호출이 모두 차례로 이어진다
