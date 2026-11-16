import asyncio
import json

from langchain_core.callbacks import dispatch_custom_event

from app import tracing
from app.simulation import director, scene_agent
from app.agent_runtime import MODEL_EVENT, UsageLedger
from app.simulation.errors import SimulationFailure
from app.simulation.models import Scene

from .stubs import KAEL, LINA, PLAN_IF, action, context, narration, seed, speech, staged, text, verdict
from .test_director import wired

real_decide = director.decide  # staged()가 대역으로 바꾸기 전의 실제 연출 결정


def reporting(inner, name, ms=5, tokens=(10, 4)):
    """응답 대역이 agent.py처럼 호출 하나의 사용량·지연을 LangChain 이벤트로 알리게 감싼다."""
    def call(payload):
        dispatch_custom_event(MODEL_EVENT, {'name': name, 'ms': ms, 'failed': False, 'inputTokens': tokens[0], 'outputTokens': tokens[1]})
        return inner(payload)
    return call


def run_with(handlers, plan=PLAN_IF):
    agent = scene_agent.build_scene_agent(False)
    out = asyncio.run(agent.ainvoke(seed(plan), {'callbacks': handlers}, context=context(plan)))
    return Scene.model_validate(out['scene'])


def test_scene_events_relay_every_finished_turn_as_a_cumulative_step_to_the_stream(monkeypatch):
    staged(monkeypatch, speech(KAEL), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=True))

    async def collect():
        agent = scene_agent.build_scene_agent(False)
        return [chunk async for chunk in agent.astream(seed(PLAN_IF), {}, context=context(PLAN_IF), stream_mode='custom')]

    chunks = asyncio.run(collect())
    assert [len(c['result']['turns']) for c in chunks] == [1, 2, 3]  # 시작 나레이션, 카엘, 마무리
    assert [c['status'] for c in chunks] == ['not_started', 'not_started', 'completed'] and chunks[0]['feature'] == 'character_simulation'
    assert [c['result']['status'] for c in chunks] == ['paused', 'paused', 'completed']
    assert chunks[1]['result']['turns'][1]['characterName'] == '카엘' and all('error' not in c for c in chunks)


def test_scene_events_carry_the_reason_of_a_stopped_turn_and_ignore_other_events(monkeypatch):
    staged(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, fail=('voice_mix',), detail='DETAIL'))

    async def collect():
        agent = scene_agent.build_scene_agent(False)
        return [chunk async for chunk in agent.astream(seed(PLAN_IF), {}, context=context(PLAN_IF), stream_mode='custom')]

    chunks = asyncio.run(collect())
    assert len(chunks) == 2 and (chunks[-1]['status'], chunks[-1]['result']['status'], chunks[-1]['result']['stopReason']) == ('failed', 'stopped', 'check_failed')
    assert '말투 섞임' in chunks[-1]['error'] and not any(c.get('name') == 'simulation.model' for c in chunks)


def test_usage_callback_collects_each_model_call_per_turn_and_never_keeps_text(monkeypatch):
    staged(monkeypatch, speech(KAEL), acts=reporting(lambda payload: action(), 'act'), narrations=reporting(lambda payload: narration(), 'narrate', tokens=(20, 8)),
           verdicts=reporting(lambda payload: verdict(payload, scene_complete=True), 'check', tokens=(30, 2)),
           reviews=reporting(lambda payload: verdict(payload), 'check', tokens=(30, 2)))
    usage = UsageLedger('simulation.turn', scene_agent.turn)
    run_with([usage])
    assert [(t['turn'], t['status'], t['modelCalls']) for t in usage.records] == [(1, 'paused', 2), (2, 'paused', 2), (3, 'completed', 2)]
    opening = usage.records[0]
    assert (opening['inputTokens'], opening['outputTokens'], opening['failures']) == (50, 10, 0) and opening['ms'] == 10
    assert [(c['name'], c['inputTokens']) for c in opening['calls']] == [('narrate', 20), ('check', 30)]
    assert 'KAEL' not in text(usage.records) and action().prose not in text(usage.records)


def test_usage_callback_counts_a_failed_tool_and_starts_the_next_turn_clean(monkeypatch):
    attempts = []

    def act(payload):
        attempts.append(1)
        if len(attempts) == 1:
            raise SimulationFailure(503, '시뮬레이션 모델 호출에 실패했습니다.')
        return action()

    staged(monkeypatch, speech(KAEL), acts=act, verdicts=lambda payload: verdict(payload, scene_complete=True))
    usage = UsageLedger('simulation.turn', scene_agent.turn)
    scene = run_with([usage])
    assert scene.error == '시뮬레이션 모델 호출에 실패했습니다.' and scene.result.status == 'failed'
    failed = usage.records[-1]
    assert (failed['status'], failed['failures'], failed['modelCalls']) == ('failed', 1, 1) and failed['calls'][0]['failed'] is True
    assert usage.records[0]['failures'] == 0 and usage.calls == []


def test_usage_callback_leaves_one_span_per_turn_in_the_trace_without_any_text(monkeypatch, spans):
    staged(monkeypatch, speech(KAEL), acts=reporting(lambda payload: action(), 'act'), verdicts=lambda payload: verdict(payload, scene_complete=True))
    usage = UsageLedger('simulation.turn', scene_agent.turn, trace=tracing.context(*tracing.start_run('writing_ai.orchestration', as_type='chain')))
    run_with([usage])
    turns = [s for s in spans() if s.name == 'simulation.turn']
    assert len(turns) == 3
    metadata = {k.removeprefix('langfuse.observation.metadata.'): v for k, v in dict(turns[1].attributes).items() if 'metadata' in k}
    assert json.loads(metadata['calls']) == usage.records[1]['calls'] and metadata['turn'] == 2 and metadata['modelCalls'] == 1
    assert 'KAEL' not in str(dict(turns[1].attributes)) and action().prose not in str(dict(turns[1].attributes))


def test_a_failed_directors_decision_call_is_finalized_in_the_ledger_and_announced_as_a_failed_step(monkeypatch):
    staged(monkeypatch)
    monkeypatch.setattr(director, 'decide', real_decide)
    wired(monkeypatch, {'error': 'x'}, status=500)  # 연출 결정(Decisions) 호출이 서버 오류로 실패한다
    usage = UsageLedger('simulation.turn', scene_agent.turn)

    async def collect():
        agent = scene_agent.build_scene_agent(False)
        return [chunk async for chunk in agent.astream(seed(PLAN_IF), {'callbacks': [usage]}, context=context(PLAN_IF), stream_mode='custom')]

    chunks = asyncio.run(collect())
    assert [(c['status'], c['result']['status'], c['result']['turns']) for c in chunks] == [('failed', 'failed', [])]
    assert chunks[0]['error'] == '연출 결정 모델 호출에 실패했습니다.'
    (turn,) = usage.records  # 턴 이벤트가 없어도 실패한 연출 호출의 지연·실패가 장부에서 사라지지 않는다
    assert (turn['status'], turn['failures'], turn['modelCalls']) == ('failed', 1, 1)
    assert [(c['name'], c['failed'], c['inputTokens']) for c in turn['calls']] == [('director', True, None)]


def test_the_directors_decisions_call_lands_in_the_ledger_of_the_turn_it_decided(monkeypatch):
    staged(monkeypatch, verdicts=lambda payload: verdict(payload, scene_complete=True))
    monkeypatch.setattr(director, 'decide', real_decide)  # 연출 결정만 실제 함수로 두고 Decisions 응답은 목 전송으로 준다

    def decisions(sent):
        picks = [{'type': 'choice', 'name': q['name'], 'choice': 'speech' if q['name'] == 'turn' and 'speech' in [c['value'] for c in q['choices']]
                  else q['choices'][0]['value']} for q in sent['questions']]
        return {'answers': picks, 'usage': {'input_tokens': 100, 'output_tokens': 5}}

    wired(monkeypatch, decisions)
    usage = UsageLedger('simulation.turn', scene_agent.turn)
    run_with([usage])
    assert [t['status'] for t in usage.records] == ['paused', 'paused', 'completed']  # 시작 나레이션, 카엘, 마무리
    for turn in usage.records:  # 턴마다 그 턴을 정한 연출 결정 호출이 한 번 있고 토큰이 장부에 남는다
        (decided,) = [c for c in turn['calls'] if c['name'] == 'director']
        assert (decided['failed'], decided['inputTokens'], decided['outputTokens']) == (False, 100, 5)
        assert turn['inputTokens'] >= 100
