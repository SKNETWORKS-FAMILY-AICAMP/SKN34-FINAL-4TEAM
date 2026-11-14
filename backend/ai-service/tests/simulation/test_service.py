import pytest

from app.manuscript.models import Excerpt
from app.retrieval.models import RetrievalResult
from app.simulation import service
from app.simulation.errors import SimulationFailure, SimulationStopped
from app.simulation.models import CheckItem, PlanDraft, SimulationPlan, Verdict
from app.simulation.prompt import FEEDBACK

from .stubs import (EPISODE, GATE, KAEL, LINA, PLAN_FLOW, PLAN_IF, READ, REL, TARGET, WORLD, action, fake_content, fake_models,
                    fake_novelbrain, recalled, text, verdict)

IF_KINDS = ['knowledge_leak', 'voice_mix', 'relation', 'premise']
FLOW_KINDS = ['knowledge_leak', 'voice_mix', 'relation', 'beat']


def simulate(plan=PLAN_IF, **kwargs):
    return service.simulate(plan, READ, EPISODE, **kwargs)


def stopped(plan=PLAN_IF, **kwargs) -> SimulationStopped:
    with pytest.raises(SimulationStopped) as stop:
        simulate(plan, **kwargs)
    return stop.value


# --- 세계관 읽기 -----------------------------------------------------------------------------------------------------

def test_world_is_the_one_linked_to_the_work_and_is_read_at_the_base_episode(monkeypatch):
    calls = fake_content(monkeypatch, worlds=[{'worldId': 'other', 'linkedWorkId': 'x'},
                                              {'worldId': WORLD, 'linkedWorkId': 'work'}])
    assert service.read_world('work', EPISODE) == READ
    assert calls == [('world_studio_list', {}), ('world_studio_read', {'id': WORLD, 'episode': '3'})]


def test_work_without_a_linked_world_fails_explicitly_without_reading_any_world(monkeypatch):
    calls = fake_content(monkeypatch, worlds=[{'worldId': WORLD, 'linkedWorkId': None}, {'worldId': 'o', 'linkedWorkId': 'x'}])
    with pytest.raises(SimulationFailure) as error:
        service.read_world('work', EPISODE)
    assert error.value.status == 409
    assert [tool for tool, _ in calls] == ['world_studio_list']


# --- 계획 ------------------------------------------------------------------------------------------------------------

def test_plan_asks_the_model_with_character_names_only(monkeypatch):
    fake_content(monkeypatch)
    seen = []
    draft = PlanDraft(mode='flow', premise=None, beats=['성문 대면'], characterIds=[KAEL])
    monkeypatch.setattr(service.agent, 'plan', lambda *args: seen.append(args) or draft)
    plan = service.plan('카엘이 성문에서 리나를 막아서는 장면', ['이전 요청'], TARGET)
    assert plan == SimulationPlan(mode='flow', beats=['성문 대면'], characterIds=[KAEL])
    # 모델에는 인물 카드의 id·이름만 간다(장소·삭제 카드, 문서 본문은 없다).
    assert seen == [('카엘이 성문에서 리나를 막아서는 장면', ['이전 요청'],
                     [{'id': KAEL, 'name': '카엘'}, {'id': LINA, 'name': '리나'}])]


def test_plan_the_model_could_not_settle_is_returned_with_its_gaps_for_the_caller_to_ask(monkeypatch):
    fake_content(monkeypatch)
    monkeypatch.setattr(service.agent, 'plan', lambda *args: PlanDraft(mode=None, premise=None, beats=[], characterIds=[]))
    assert service.plan('뭔가 해 줘', [], TARGET).gaps() == ['mode', 'characterIds']


@pytest.mark.parametrize('draft', [
    PlanDraft(mode='if', premise='전제', beats=[], characterIds=['not-in-the-world']),
    PlanDraft(mode='flow', premise=None, beats=['비트'] * 9, characterIds=[KAEL]),
])
def test_plan_the_world_or_the_limits_do_not_allow_is_an_error_not_a_fix(monkeypatch, draft):
    fake_content(monkeypatch)
    monkeypatch.setattr(service.agent, 'plan', lambda *args: draft)
    with pytest.raises(SimulationFailure) as error:
        service.plan('요청', [], TARGET)
    assert error.value.status == 502


def test_world_without_character_cards_cannot_be_simulated(monkeypatch):
    fake_content(monkeypatch, read={**READ, 'cards': [READ['cards'][2]]})
    with pytest.raises(SimulationFailure) as error:
        service.plan('요청', [], TARGET)
    assert error.value.status == 409


@pytest.mark.parametrize('call', [lambda: service.plan('요청', [], None), lambda: service.run(PLAN_IF, None, '요청', None)])
def test_plan_and_run_need_the_target_work_and_episode(call):
    with pytest.raises(SimulationFailure) as error:
        call()
    assert error.value.status == 422


# --- 인물 입력의 격리 ----------------------------------------------------------------------------------------------------

def test_character_input_holds_only_that_characters_documents_up_to_the_base_episode(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(
        monkeypatch, [action(prose='카엘이 말했다. KAEL-INNER 속으로 비밀을 떠올렸다.', observed='카엘이 북문 앞에서 막아섰다.'),
                      action(prose='리나가 웃었다.', observed='리나가 웃었다.')],
        lambda payload: verdict(payload, scene_complete=len(calls.act) == 2))
    simulate()
    kael, lina = text(calls.act[0]), text(calls.act[1])
    # 카엘: 자기 문서(기준 회차 이하)와 자기가 끝점인 활성 관계(부정 관계는 '아님'으로)만.
    assert all(mark in kael for mark in ('KAEL-IDENTITY', 'KAEL-SOUL', 'KAEL-MEMORY', 'KAEL-EP2', '경계', '친구 아님', 'REL-KAEL-GATE'))
    assert not any(mark in kael for mark in ('LINA-', 'KAEL-EP5-FUTURE', 'REMOVED', 'REL-LINA-GATE', 'REL-REMOVED'))
    # 기준 회차에 아직 공개되지 않은 카드와의 관계는 아는지 확인할 수 없어 관계 문장에도 상대 제목이 드러나지 않게 뺀다.
    assert not any(mark in kael for mark in ('REL-SHADOW', '그림자 길드', 'SHADOW'))
    # 리나: 카엘의 문서·비공개 생각(prose에만 있던 KAEL-INNER)은 없고 장면에는 카엘이 드러낸 행동(observed)만 있다.
    assert all(mark in lina for mark in ('LINA-IDENTITY', 'LINA-SOUL', 'LINA-MEMORY-SECRET', 'LINA-EP3', 'REL-LINA-GATE'))
    assert not any(mark in lina for mark in ('KAEL-IDENTITY', 'KAEL-SOUL', 'KAEL-MEMORY', 'KAEL-EP', 'KAEL-INNER'))
    assert '카엘이 북문 앞에서 막아섰다.' in lina
    # 입력은 호출마다 처음부터 조립되며 이전 인물의 입력이나 대화 상태를 담는 칸이 없다.
    assert set(calls.act[0]) == set(calls.act[1]) == {'self', 'known', 'present', 'scene', 'direction'}
    assert [p['self']['id'] for p in calls.act] == [KAEL, LINA]


def test_real_novelbrain_filter_keeps_other_characters_private_documents_out_of_the_input(monkeypatch):
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=True))
    turn = simulate().turns[0]  # 실제 recall(3단계 시점·인물 필터)
    kael = text(calls.act[0])
    assert not any(mark in kael for mark in ('LINA-SOUL', 'LINA-MEMORY-SECRET', 'LINA-EP3', 'KAEL-EP5-FUTURE'))
    assert turn.evidence and not any(e.ref.split('#')[-1] in ('soul', 'memory', 'ep03') and f'{LINA}' in e.ref for e in turn.evidence)


def test_input_uses_novelbrain_refs_and_lists_each_ref_once(monkeypatch):
    fake_novelbrain(monkeypatch, items=[recalled(ref=f'card:{KAEL}#soul', source='bm25', text='KAEL-SOUL 말이 짧고 퉁명스러운 반말')])
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=True))
    result = simulate()
    refs = [d['ref'] for d in calls.act[0]['known']]
    assert {f'card:{KAEL}#identity', f'card:{KAEL}#soul', f'card:{KAEL}#memory', f'card:{KAEL}#ep02', f'relation:{REL}'} <= set(refs)
    assert len(refs) == len(set(refs))  # 조회 결과가 이미 입력에 든 문서면 겹쳐 넣지 않는다
    assert [e.ref for e in result.turns[0].evidence] == [f'card:{KAEL}#soul']  # 근거 기록에는 조회한 그대로 남는다


def test_character_sees_only_the_current_beat_never_the_later_ones(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(refuses=True, reason='이유'), lambda payload: verdict(payload))
    stopped(PLAN_FLOW)
    assert 'B0-NOW' in text(calls.act[0]) and 'B1-FUTURE' not in text(calls.act[0])


def test_each_turn_recalls_for_that_character_at_stage_3_for_the_base_episode(monkeypatch):
    recall = fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=len(calls.act) >= 2))
    excerpt = Excerpt(id='m1', episode=2, quote='원고 발췌')
    simulate(manuscript=[excerpt])
    assert [(c['character_id'], c['stage'], c['episode']) for c in recall] == [(KAEL, 3, EPISODE), (LINA, 3, EPISODE)]
    assert recall[0]['manuscript'] == [excerpt] and (recall[0]['world'].worldId, recall[0]['world'].episode) == (WORLD, EPISODE)
    assert 'IF-PREMISE' in recall[0]['query']
    assert 'GATE-LORE 북문은 밤에 닫힌다' in text(calls.act[0]['known'])  # 조회 결과가 그 인물의 입력에 들어간다


def test_regeneration_does_not_recall_again(monkeypatch):
    recall = fake_novelbrain(monkeypatch)
    fails = iter([('voice_mix',), ()])
    fake_models(monkeypatch, action(), lambda payload: verdict(payload, fail=next(fails), scene_complete=True))
    simulate()
    assert len(recall) == 1


def test_checker_gets_other_characters_secrets_and_the_characters_future_as_forbidden(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=len(calls.act) >= 2))
    simulate()
    kael, lina = calls.check
    assert all(mark in text(kael['forbidden']) for mark in ('LINA-MEMORY-SECRET', 'LINA-EP3', 'KAEL-EP5-FUTURE'))
    assert 'KAEL-SOUL' not in text(kael['forbidden'])  # SOUL은 말투 자료라 금지 목록이 아니다
    assert 'LINA-SOUL' in text(kael['voices']) and 'KAEL-SOUL' in text(lina['voices'])
    assert all(mark in text(lina['forbidden']) for mark in ('KAEL-MEMORY', 'KAEL-EP2', 'KAEL-EP5-FUTURE'))
    assert kael['paragraph'] == action().prose and kael['checks'] == IF_KINDS and 'KAEL-SOUL' in text(kael['known'])
    assert 'forbidden' not in calls.act[0] and 'voices' not in calls.act[0]  # 인물에게는 금지 목록이 가지 않는다


# --- 검사·재생성·중단 ------------------------------------------------------------------------------------------------------

def test_violation_regenerates_only_that_turn_then_stops_after_two_retries(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(
        payload, fail=('knowledge_leak',), refs=[f'card:{LINA}#memory'], detail='LEAK-DETAIL 리나의 정체를 말했다'))
    stop = stopped()
    assert len(calls.act) == len(calls.check) == 3  # 처음 + 재생성 2회
    assert (stop.result.status, stop.result.stopReason, stop.result.turns) == ('stopped', 'check_failed', [])
    # 재생성 안내는 고정 문구뿐이다. 검사 모델의 설명에는 인물이 알면 안 되는 사실이 섞일 수 있다.
    assert 'feedback' not in calls.act[0]
    assert calls.act[1]['feedback'] == calls.act[2]['feedback'] == [FEEDBACK['knowledge_leak']]
    assert all('LEAK-DETAIL' not in text(payload) for payload in calls.act)
    assert '알 수 없는 정보 언급' in str(stop) and 'LEAK-DETAIL' in str(stop) and '카엘' in str(stop)


def test_a_turn_that_passes_after_a_retry_counts_the_regeneration(monkeypatch):
    fake_novelbrain(monkeypatch)
    attempts = iter([('voice_mix',), (), ()])
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, fail=next(attempts),
                                                                        scene_complete=len(calls.act) >= 3))
    result = simulate()
    assert [(t.index, t.regenerated) for t in result.turns] == [(0, 1), (1, 0)]
    assert all(check.passed for turn in result.turns for check in turn.checks)
    assert len(calls.act) == 3


def test_beat_refusal_stops_as_a_planning_problem_without_regenerating(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(refuses=True, reason='REASON 자존심 때문에 막아서지 않는다'), lambda p: verdict(p))
    stop = stopped(PLAN_FLOW)
    assert (stop.result.status, stop.result.stopReason) == ('stopped', 'beat_rejected')
    assert [b.status for b in stop.result.beats] == ['rejected', 'pending'] and stop.result.turns == []
    assert len(calls.act) == 1 and calls.check == []
    assert '카엘' in str(stop) and 'REASON' in str(stop) and 'B0-NOW' in str(stop)


def test_unfinished_scene_stops_at_the_turn_limit_and_never_looks_complete(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload))
    stop = stopped()
    assert len(calls.act) == len(stop.result.turns) == 12
    assert [t.characterId for t in stop.result.turns[:4]] == [KAEL, LINA, KAEL, LINA]  # 비트가 없으면 돌아가며
    assert (stop.result.status, stop.result.stopReason) == ('stopped', 'turn_limit')


def test_flow_completes_when_every_beat_is_done(monkeypatch):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, [action(), action(prose='리나가 고개를 숙였다.', observed='리나가 고개를 숙였다.')],
                        lambda payload: verdict(payload, beat_done=True))
    result = simulate(PLAN_FLOW)
    assert [t.characterName for t in result.turns] == ['카엘', '리나']
    assert [b.status for b in result.beats] == ['done', 'done']
    assert (result.mode, result.premise, result.status, result.stopReason) == ('flow', None, 'completed', None)
    assert all(payload['checks'] == FLOW_KINDS for payload in calls.check)


def test_characters_in_the_current_beat_act_before_the_others(monkeypatch):
    fake_novelbrain(monkeypatch)
    plan = SimulationPlan(mode='flow', beats=['카엘이 칼을 뽑는다'], characterIds=[KAEL, LINA])
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, beat_done=len(calls.act) == 2))
    assert [t.characterId for t in simulate(plan).turns] == [KAEL, KAEL]


def test_if_mode_checks_the_premise_and_ends_when_the_scene_is_complete(monkeypatch):
    fake_novelbrain(monkeypatch)
    fails = iter([('premise',), (), ()])
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload, fail=next(fails),
                                                                        scene_complete=len(calls.act) >= 3))
    result = simulate(PLAN_IF)
    assert all(payload['checks'] == IF_KINDS for payload in calls.check)
    assert 'IF-PREMISE' in text(calls.act[0]['direction']) and 'currentBeat' not in calls.act[0]['direction']
    assert (result.mode, result.premise, result.beats) == ('if', PLAN_IF.premise, [])
    assert (result.status, [t.regenerated for t in result.turns]) == ('completed', [1, 0])


def test_result_shape_follows_the_contract_json(monkeypatch):
    fake_novelbrain(monkeypatch, items=[recalled(), recalled(ref='ep2#c1', source='manuscript', text='원고 문장')])
    fake_models(monkeypatch, action(), lambda payload: verdict(payload, beat_done=True))
    result = simulate(PLAN_FLOW).model_dump(mode='json')
    assert set(result) == {'mode', 'premise', 'beats', 'turns', 'status', 'stopReason'}
    assert result['beats'][0] == {'index': 0, 'text': PLAN_FLOW.beats[0], 'status': 'done'}
    turn = result['turns'][0]
    assert set(turn) == {'index', 'characterId', 'characterName', 'prose', 'checks', 'regenerated', 'evidence'}
    assert [c['kind'] for c in turn['checks']] == FLOW_KINDS and set(turn['checks'][0]) == {'kind', 'passed', 'detail'}
    assert turn['evidence'] == [{'ref': f'card:{GATE}', 'source': 'graph'}, {'ref': 'ep2#c1', 'source': 'manuscript'}]


def test_progress_gets_a_running_result_after_each_accepted_turn(monkeypatch):
    fake_novelbrain(monkeypatch)
    fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=len(seen) == 1))
    seen = []
    result = simulate(progress=lambda partial: seen.append((partial.status, len(partial.turns))))
    assert seen == [('running', 1)] and (result.status, len(result.turns)) == ('completed', 2)


# --- 실패 -------------------------------------------------------------------------------------------------------------

def test_model_failure_in_the_middle_keeps_the_earlier_turns_in_a_failed_result(monkeypatch):
    fake_novelbrain(monkeypatch)

    def act(payload):
        if len(calls.act) == 2:
            raise SimulationFailure(503, '시뮬레이션 모델 호출에 실패했습니다.')
        return action()

    calls = fake_models(monkeypatch, act, lambda payload: verdict(payload))
    stop = stopped()
    assert str(stop) == '시뮬레이션 모델 호출에 실패했습니다.'
    assert (stop.result.status, stop.result.stopReason, len(stop.result.turns)) == ('failed', None, 1)


@pytest.mark.parametrize('bad', [
    lambda payload: verdict(payload, fail=('knowledge_leak',), refs=['made-up-ref']),      # 입력에 없는 근거
    lambda payload: Verdict(checks=[CheckItem(kind='voice_mix', passed=True, detail='', refs=[])],
                            beatDone=False, sceneComplete=False),                             # 요청한 검사가 빠짐
    lambda payload: Verdict(checks=[CheckItem(kind=k, passed=True, detail='', refs=[]) for k in IF_KINDS + ['voice_mix']],
                            beatDone=False, sceneComplete=False),                             # 같은 검사가 두 번
])
def test_check_verdict_that_does_not_fit_the_request_is_an_error_not_a_pass(monkeypatch, bad):
    fake_novelbrain(monkeypatch)
    fake_models(monkeypatch, action(), bad)
    stop = stopped()
    assert (str(stop), stop.result.status, stop.result.turns) == ('시뮬레이션 검사 모델 응답을 확인할 수 없습니다.', 'failed', [])


@pytest.mark.parametrize('empty', [action(prose='  '), action(observed='')])
def test_empty_paragraph_or_action_from_the_model_is_an_error(monkeypatch, empty):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, empty, lambda payload: verdict(payload))
    stop = stopped()
    assert str(stop) == '시뮬레이션 모델 응답을 확인할 수 없습니다.' and calls.check == []


@pytest.mark.parametrize('plan', [
    SimulationPlan(mode='if', premise='전제', characterIds=['not-in-the-world']),
    SimulationPlan(mode='if', characterIds=[KAEL]),  # 전제가 빠진 계획
])
def test_plan_the_world_does_not_support_fails_before_any_model_call(monkeypatch, plan):
    fake_novelbrain(monkeypatch)
    calls = fake_models(monkeypatch, action(), lambda payload: verdict(payload))
    with pytest.raises(SimulationFailure) as error:
        simulate(plan)
    assert error.value.status == 422 and calls.act == []


# --- 실행(세계관 읽기 + 원고 발췌) ----------------------------------------------------------------------------------------

COVERAGE = {'expected': [], 'withVerifiedExcerpt': [], 'withoutVerifiedExcerpt': []}


def test_run_reads_the_linked_world_and_hands_the_retrieved_excerpts_to_recall(monkeypatch):
    calls = fake_content(monkeypatch)
    recall = fake_novelbrain(monkeypatch)
    fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=True))
    excerpts = [Excerpt(id='m', episode=2, quote='원고', kind='manuscript'), Excerpt(id='s', episode=2, quote='설정', kind='setting')]
    asked = []
    monkeypatch.setattr(service.retrieval, 'retrieve', lambda scope, question: asked.append((scope.scopeToken, question)) or
                        RetrievalResult(status='found', excerpts=excerpts, gaps=[], coverage=COVERAGE, steps=[]))
    result = service.run(PLAN_IF, TARGET, '카엘과 리나가 만나면', {'scopeToken': 'signed.token'})
    assert result.status == 'completed' and asked == [('signed.token', '카엘과 리나가 만나면')]
    assert [tool for tool, _ in calls] == ['world_studio_list', 'world_studio_read']
    # 받은 발췌를 그대로 넘긴다. 원고가 아닌 발췌(설정·현재 관계)는 recall의 인물 필터가 gaps로 돌린다.
    assert [e.id for e in recall[0]['manuscript']] == ['m', 's']


def test_run_without_scope_does_not_retrieve(monkeypatch):
    fake_content(monkeypatch)
    recall = fake_novelbrain(monkeypatch)
    fake_models(monkeypatch, action(), lambda payload: verdict(payload, scene_complete=True))
    monkeypatch.setattr(service.retrieval, 'retrieve', lambda *args: pytest.fail('scope가 없으면 검색하지 않는다'))
    assert service.run(PLAN_IF, TARGET, '요청', None).status == 'completed'
    assert recall[0]['manuscript'] == []
