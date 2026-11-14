import pytest

from app.retrieval.models import RetrievalResult
from app.simulation import scene_agent, service
from app.simulation.errors import SimulationFailure
from app.simulation.models import Note, SceneAction, SimulationPlan
from app.simulation.prompt import FEEDBACK, NARRATION_FEEDBACK

from .stubs import (KAEL, LINA, PLAN_FLOW, PLAN_IF, READ, Run, action, fake_content, monologue, narration, narrating, run_auto, speech,
                    staged as setup, text, verdict)

IF_KINDS = ['knowledge_leak', 'voice_mix', 'relation', 'premise']
FLOW_KINDS = ['knowledge_leak', 'voice_mix', 'relation', 'beat']
ANY = ['narration', 'monologue', 'speech']


def characters(scene):
    return [t for t in scene.result.turns if t.kind == 'character']


# --- 연출·도구·검사의 한 바퀴 -------------------------------------------------------------------------------------------------

def test_the_director_decides_before_every_turn_and_the_decision_is_recorded_on_the_turn(monkeypatch):
    h = setup(monkeypatch, speech(KAEL, f'limited:{KAEL}'), speech(LINA, f'limited:{LINA}'),
              verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    scene = run_auto()
    # 모든 턴 앞에 연출 결정이 있고 도구(모델 호출)와 검사가 그 뒤를 따른다. 전지적 나레이션의 검사는 따로 기록된다.
    assert h.order == ['director', 'narrate', 'review', 'director', 'act', 'check', 'director', 'act', 'check', 'director', 'narrate', 'review']
    assert [c['allowed'] for c in h.director] == [['narration'], ANY, ANY, ['end']]
    assert [(t.kind, t.characterName, t.pov) for t in scene.result.turns] == [
        ('narration', '나레이션', 'omniscient'), ('character', '카엘', f'limited:{KAEL}'), ('character', '리나', f'limited:{LINA}'),
        ('narration', '나레이션', 'omniscient')]
    assert [e.decision.turn for e in scene.trail] == ['narration', 'speech', 'speech', 'end']
    assert (scene.trail[1].decision.speaker, scene.trail[3].closing, scene.trail[2].ended) == (KAEL, True, True)
    assert (scene.result.status, scene.result.stopReason, scene.error, scene.memo, scene.redo) == ('completed', None, None, None, None)
    assert [t.index for t in scene.result.turns] == [0, 1, 2, 3]


def test_the_director_is_told_the_state_of_the_scene_and_the_cast_it_may_choose_from(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    run_auto()
    opening, second, third = h.director[:3]
    assert opening['state']['scene'] == [] and opening['state']['required'] == 'opening' and opening['last_pov'] is None
    assert [c['name'] for c in opening['cast']] == ['카엘', '리나'] and 'required' not in second['state']
    assert [line['by'] for line in third['state']['scene']] == ['나레이션', '카엘'] and third['last_pov'] == 'omniscient'
    assert h.director[3]['state']['required'] == 'closing'


def test_flow_scene_narrates_the_start_every_beat_change_and_the_end(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), speech(LINA), acts=[action(), action(prose='리나가 고개를 숙였다.', observed='리나가 고개를 숙였다.')],
              verdicts=lambda payload: verdict(payload, beat_done=True))
    scene = run_auto(PLAN_FLOW)
    assert [t.characterName for t in scene.result.turns] == ['나레이션', '카엘', '나레이션', '리나', '나레이션']
    assert [c['purpose'] for c in h.calls.narrate] == ['opening', 'transition', 'closing']
    assert [c['allowed'] for c in h.director] == [['narration'], ANY, ['narration'], ANY, ['end']]
    assert [b.status for b in scene.result.beats] == ['done', 'done']
    assert [(e.beat, e.done, e.ended) for e in scene.trail] == [(0, False, False), (0, True, False), (1, False, False), (1, True, True), (None, False, False)]
    assert (scene.result.mode, scene.result.premise, scene.result.status, scene.result.stopReason) == ('flow', None, 'completed', None)
    assert all(payload['checks'] == FLOW_KINDS for payload in h.calls.check)
    # 전환 나레이션은 새 비트가 현재 비트인 상태에서 쓰고, 마무리 때는 모든 비트가 끝나 있다.
    assert 'B1-FUTURE' in text(h.calls.narrate[1]['direction']) and 'B0-NOW' not in text(h.calls.narrate[1]['direction'])
    assert [b['status'] for b in h.calls.narrate[2]['plan']['beats']] == ['done', 'done']


def test_if_mode_checks_the_premise_and_ends_when_the_scene_is_complete(monkeypatch):
    fails = iter([('premise',), (), ()])
    h = setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, fail=next(fails, ()), scene_complete=len(h.calls.act) >= 3))
    scene = run_auto()
    assert all(payload['checks'] == IF_KINDS for payload in h.calls.check)
    assert 'IF-PREMISE' in text(h.calls.act[0]['direction']) and 'currentBeat' not in h.calls.act[0]['direction']
    assert (scene.result.mode, scene.result.premise, scene.result.beats) == ('if', PLAN_IF.premise, [])
    assert (scene.result.status, [t.regenerated for t in characters(scene)]) == ('completed', [1, 0])
    assert [c['purpose'] for c in h.calls.narrate] == ['opening', 'closing']  # IF에는 비트 전환이 없다


def test_result_shape_follows_the_contract_json(monkeypatch):
    setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, beat_done=True))
    result = run_auto(PLAN_FLOW).result.model_dump(mode='json')
    assert set(result) == {'mode', 'premise', 'beats', 'turns', 'notes', 'status', 'stopReason'} and result['notes'] == []
    opening, turn = result['turns'][:2]
    assert (opening['kind'], opening['characterId'], opening['characterName'], opening['checks'], opening['pov']) == (
        'narration', None, '나레이션', [], 'omniscient')
    assert set(turn) == {'index', 'kind', 'characterId', 'characterName', 'prose', 'checks', 'regenerated', 'evidence', 'pov', 'editedByAuthor'}
    assert (turn['kind'], turn['editedByAuthor'], turn['characterId']) == ('character', False, KAEL)
    assert [c['kind'] for c in turn['checks']] == FLOW_KINDS and set(turn['checks'][0]) == {'kind', 'passed', 'detail'}
    assert turn['evidence'] == [{'ref': f'card:{result["turns"][1]["evidence"][0]["ref"].split(":")[1]}', 'source': 'graph'}]


# --- 시점과 독백 ---------------------------------------------------------------------------------------------------------

def test_omniscient_narration_is_checked_only_for_the_future_and_gets_the_world_up_to_the_base_episode(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, scene_complete=True))
    run_auto()
    asked, review = h.calls.narrate[0], h.calls.review[0]
    assert asked['self'] == {'id': None, 'name': '나레이션'} and asked['pov'] == {'kind': 'omniscient', 'character': None}
    assert (review['checks'], review['voices']) == (['knowledge_leak'], [])
    assert all(mark in text(review['forbidden']) for mark in ('KAEL-EP5-FUTURE', 'SHADOW-GUILD'))
    assert [(c['character_id'], c['stage']) for c in h.recall if c['character_id'] is None] == [(None, 2), (None, 2)]  # 시작·마무리
    assert 'KAEL-EP5-FUTURE' not in text(asked)


def test_monologue_is_written_by_the_narrator_from_the_pov_characters_knowledge_and_hidden_from_the_others(monkeypatch):
    h = setup(monkeypatch, monologue(f'limited:{KAEL}'), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 1),
              narrations=[narration(), narration(prose='MONO-TEXT 카엘은 리나를 의심했다.', observed='MONO-OBSERVED 새어 나가면 안 된다'), narration()])
    scene = run_auto()
    mono = scene.result.turns[1]
    assert (mono.kind, mono.characterId, mono.characterName, mono.pov, mono.checks) == ('monologue', KAEL, '카엘', f'limited:{KAEL}', [])
    assert mono.prose == 'MONO-TEXT 카엘은 리나를 의심했다.' and scene.trail[1].observed == ''
    asked = h.calls.narrate[1]  # 독백도 나레이터가 쓰되 시점 인물이 아는 것만 받는다
    assert (asked['self']['id'], asked['purpose'], asked['pov']) == (KAEL, 'monologue', {'kind': 'limited', 'character': '카엘'})
    assert 'KAEL-SOUL' in text(asked['known']) and 'LINA-MEMORY-SECRET' not in text(asked)
    check = h.calls.check[0]
    assert check['checks'] == ['knowledge_leak', 'voice_mix'] and 'LINA-MEMORY-SECRET' in text(check['forbidden'])
    assert h.calls.check[1]['checks'] == IF_KINDS
    assert 'MONO-' not in text(h.calls.act[0])  # 다음 인물은 독백을 보지 못한다
    assert [e['allowed'] for e in h.director][:3] == [['narration'], ANY, ['speech']]  # 서술·독백이 두 번 이어지면 이번엔 대사


@pytest.mark.parametrize('pov, kinds', [(f'limited:{KAEL}', ['knowledge_leak']), (f'first:{KAEL}', ['knowledge_leak', 'voice_mix'])])
def test_narration_from_a_characters_point_of_view_knows_only_what_that_character_knows(monkeypatch, pov, kinds):
    h = setup(monkeypatch, narrating(pov), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 1))
    scene = run_auto()
    opening = scene.result.turns[0]
    assert (opening.kind, opening.characterId, opening.characterName, opening.pov, opening.checks) == ('narration', None, '나레이션', pov, [])
    asked = h.calls.narrate[0]
    assert asked['self']['id'] == KAEL and asked['pov']['kind'] == pov.split(':')[0] and 'LINA-MEMORY-SECRET' not in text(asked)
    assert h.calls.check[0]['checks'] == kinds and 'LINA-MEMORY-SECRET' in text(h.calls.check[0]['forbidden'])
    assert h.calls.review == [h.calls.review[0]] and h.calls.review[0]['self']['id'] is None  # 마무리는 전지적이라 따로 검사한다


@pytest.mark.parametrize('speaker', ['card-that-is-not-in-the-world', LINA])  # 세계관에 없는 인물, 세계관에는 있지만 이 장면의 참여 인물이 아닌 인물
def test_a_speaker_the_director_picked_must_be_a_character_of_this_scene(monkeypatch, speaker):
    h = setup(monkeypatch, speech(speaker))
    scene = run_auto(SimulationPlan(mode='if', premise='만약 북문이 열려 있었다면?', characterIds=[KAEL]))
    assert (scene.result.status, scene.error, [t.kind for t in scene.result.turns]) == ('failed', '시뮬레이션 모델 응답을 확인할 수 없습니다.', ['narration'])
    assert h.calls.act == []


# --- 검사·재생성·중단 ------------------------------------------------------------------------------------------------------

def test_violation_regenerates_only_that_turn_then_stops_after_two_retries(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(
        payload, fail=('knowledge_leak',), refs=[f'card:{LINA}#memory'], detail='LEAK-DETAIL 리나의 정체를 말했다'))
    scene = run_auto()
    assert len(h.calls.act) == len(h.calls.check) == 3  # 처음 + 재생성 2회
    assert (scene.result.status, scene.result.stopReason, [t.kind for t in scene.result.turns]) == ('stopped', 'check_failed', ['narration'])
    # 재생성 안내는 고정 문구뿐이다. 검사 모델의 설명에는 인물이 알면 안 되는 사실이 섞일 수 있다.
    assert 'feedback' not in h.calls.act[0]
    assert h.calls.act[1]['feedback'] == h.calls.act[2]['feedback'] == [FEEDBACK['knowledge_leak']]
    assert all('LEAK-DETAIL' not in text(payload) for payload in h.calls.act)
    assert '알 수 없는 정보 언급' in scene.error and 'LEAK-DETAIL' in scene.error and '카엘' in scene.error
    assert len([c for c in h.recall if c['character_id']]) == 1  # 재생성은 다시 조회하지 않는다
    assert h.order.count('director') == 2  # 재생성은 연출을 다시 정하지 않는다(시작 + 이번 턴)


def test_a_turn_that_passes_after_a_retry_counts_the_regeneration(monkeypatch):
    attempts = iter([('voice_mix',), (), ()])
    h = setup(monkeypatch, speech(KAEL), speech(LINA),
              verdicts=lambda payload: verdict(payload, fail=next(attempts, ()), scene_complete=len(h.calls.act) >= 3))
    scene = run_auto()
    assert [(t.index, t.regenerated) for t in characters(scene)] == [(1, 1), (2, 0)]
    assert all(check.passed for turn in scene.result.turns for check in turn.checks) and len(h.calls.act) == 3


def test_narration_is_regenerated_with_its_own_notice_before_the_scene_stops(monkeypatch):
    h = setup(monkeypatch, reviews=lambda payload: verdict(
        payload, fail=('knowledge_leak',), refs=[f'card:{KAEL}#ep05'], detail='FUTURE-DETAIL 왕의 죽음을 말했다'))
    scene = run_auto()
    assert len(h.calls.narrate) == len(h.calls.review) == 3 and h.calls.act == [] and h.calls.check == []
    assert 'feedback' not in h.calls.narrate[0] and h.calls.narrate[1]['feedback'] == h.calls.narrate[2]['feedback'] == [NARRATION_FEEDBACK['knowledge_leak']]
    assert all('FUTURE-DETAIL' not in text(payload) for payload in h.calls.narrate)
    assert (scene.result.status, scene.result.stopReason, scene.result.turns) == ('stopped', 'check_failed', [])
    assert '나레이션' in scene.error and 'FUTURE-DETAIL' in scene.error and '알 수 없는 정보 언급' in scene.error


def test_a_narration_that_passes_after_a_retry_is_kept_with_its_regeneration_and_no_checks(monkeypatch):
    fails = iter([('knowledge_leak',), ()])
    setup(monkeypatch, speech(KAEL), reviews=lambda payload: verdict(payload, fail=next(fails, ())),
          verdicts=lambda payload: verdict(payload, scene_complete=True))
    turn = run_auto().result.turns[0]
    assert (turn.kind, turn.regenerated, turn.checks) == ('narration', 1, [])


def test_beat_refusal_stops_as_a_planning_problem_without_regenerating(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), acts=action(refuses=True, reason='REASON 자존심 때문에 막아서지 않는다'))
    scene = run_auto(PLAN_FLOW)
    assert (scene.result.status, scene.result.stopReason) == ('stopped', 'beat_rejected')
    assert [b.status for b in scene.result.beats] == ['rejected', 'pending'] and [t.kind for t in scene.result.turns] == ['narration']
    assert len(h.calls.act) == 1 and h.calls.check == []
    assert '카엘' in scene.error and 'REASON' in scene.error and 'B0-NOW' in scene.error


def test_a_refusal_means_nothing_in_if_mode_and_a_long_reason_is_cut(monkeypatch):
    setup(monkeypatch, speech(KAEL), acts=action(refuses=True, reason='이유'), verdicts=lambda payload: verdict(payload, scene_complete=True))
    assert run_auto().result.status == 'completed'  # IF에는 따를 비트가 없다
    setup(monkeypatch, speech(KAEL), acts=action(refuses=True, reason='R' * 300))
    message = run_auto(PLAN_FLOW).error
    assert 'R' * 200 in message and 'R' * 201 not in message


def test_check_detail_from_the_model_is_cut_in_the_turn_and_in_the_stop_message(monkeypatch):
    setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, detail='D' * 300, scene_complete=True))
    assert [len(c.detail) for c in characters(run_auto())[0].checks] == [200] * 4
    setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, fail=('voice_mix',), detail='E' * 300))
    message = run_auto().error
    assert 'E' * 200 in message and 'E' * 201 not in message


def test_unfinished_scene_stops_at_the_turn_limit_and_never_looks_complete(monkeypatch):
    h = setup(monkeypatch, lambda state, allowed, cast, last: speech(KAEL if state['spoken'] % 2 == 0 else LINA))
    scene = run_auto()
    assert len(h.calls.act) == len(characters(scene)) == 12  # 한도는 인물 대사 턴만 센다. 나레이션·독백은 세지 않는다
    assert [t.characterId for t in characters(scene)[:4]] == [KAEL, LINA, KAEL, LINA]
    assert (scene.result.status, scene.result.stopReason) == ('stopped', 'turn_limit') and '12' in scene.error


# --- 실패 -------------------------------------------------------------------------------------------------------------

def test_model_failure_in_the_middle_keeps_the_earlier_turns_in_a_failed_scene(monkeypatch):
    def act(payload):
        if len(h.calls.act) == 2:
            raise SimulationFailure(503, '시뮬레이션 모델 호출에 실패했습니다.')
        return action()

    h = setup(monkeypatch, speech(KAEL), speech(LINA), acts=act)
    scene = run_auto()
    assert (scene.error, scene.result.status, scene.result.stopReason) == ('시뮬레이션 모델 호출에 실패했습니다.', 'failed', None)
    assert [t.characterName for t in scene.result.turns] == ['나레이션', '카엘']


@pytest.mark.parametrize('bad', [
    lambda payload: verdict(payload, fail=('knowledge_leak',), refs=['made-up-ref']),      # 입력에 없는 근거
    lambda payload: verdict({'checks': ['voice_mix']}),                                      # 요청한 검사가 빠짐
    lambda payload: verdict({'checks': IF_KINDS + ['voice_mix']}),                          # 같은 검사가 두 번
])
def test_check_verdict_that_does_not_fit_the_request_is_an_error_not_a_pass(monkeypatch, bad):
    setup(monkeypatch, speech(KAEL), verdicts=bad)
    scene = run_auto()
    assert (scene.error, scene.result.status, [t.kind for t in scene.result.turns]) == (
        '시뮬레이션 검사 모델 응답을 확인할 수 없습니다.', 'failed', ['narration'])


def test_narration_verdict_that_does_not_fit_the_request_is_an_error_not_a_pass(monkeypatch):
    setup(monkeypatch, reviews=lambda payload: verdict(payload, fail=('knowledge_leak',), refs=['made-up-ref']))
    scene = run_auto()
    assert (scene.result.status, scene.error, scene.result.turns) == ('failed', '시뮬레이션 검사 모델 응답을 확인할 수 없습니다.', [])


@pytest.mark.parametrize('empty', [action(prose='  '), action(observed='')])
def test_empty_paragraph_or_action_from_the_model_is_an_error(monkeypatch, empty):
    h = setup(monkeypatch, speech(KAEL), acts=empty)
    scene = run_auto()
    assert scene.error == '시뮬레이션 모델 응답을 확인할 수 없습니다.' and h.calls.check == []


@pytest.mark.parametrize('empty', [narration(prose=' '), narration(observed='')])
def test_empty_narration_from_the_model_is_an_error(monkeypatch, empty):
    h = setup(monkeypatch, narrations=empty)
    scene = run_auto()
    assert scene.error == '시뮬레이션 나레이션 모델 응답을 확인할 수 없습니다.' and h.calls.review == [] and h.calls.act == []


def test_an_empty_monologue_observation_is_fine_but_an_empty_monologue_is_not(monkeypatch):
    setup(monkeypatch, monologue(), speech(LINA), narrations=[narration(), narration(prose='속마음', observed=''), narration()],
          verdicts=lambda payload: verdict(payload, scene_complete=True))
    assert run_auto().result.turns[1].prose == '속마음'
    setup(monkeypatch, monologue(), narrations=[narration(), narration(prose=' ', observed='')])
    assert run_auto().error == '시뮬레이션 나레이션 모델 응답을 확인할 수 없습니다.'


@pytest.mark.parametrize('plan', [
    SimulationPlan(mode='if', premise='전제', characterIds=['not-in-the-world']),
    SimulationPlan(mode='if', characterIds=[KAEL]),  # 전제가 빠진 계획
])
def test_plan_the_world_does_not_support_fails_before_any_model_call(monkeypatch, plan):
    h = setup(monkeypatch)
    scene = run_auto(plan)
    assert (scene.result.status, scene.error) == ('failed', '시뮬레이션 계획이 완성되지 않았거나 세계관에 없는 인물이 있어요.')
    assert h.calls.act == [] and h.calls.narrate == [] and h.director == []


def test_director_failure_is_a_failed_scene_with_the_fixed_message(monkeypatch):
    setup(monkeypatch)

    async def decide(*args, **kwargs):
        raise SimulationFailure(503, '연출 결정 모델 호출에 실패했습니다.')

    monkeypatch.setattr(scene_agent.director, 'decide', decide)
    scene = run_auto()
    assert (scene.result.status, scene.error, scene.result.turns) == ('failed', '연출 결정 모델 호출에 실패했습니다.', [])


def test_the_loop_guards_end_a_scene_that_would_never_end_without_losing_its_turns(monkeypatch):
    setup(monkeypatch, lambda state, allowed, cast, last: speech(KAEL if state['spoken'] % 2 == 0 else LINA))
    monkeypatch.setattr(scene_agent, 'LOOP_LIMIT', 3)
    scene = run_auto()  # 한도에 닿으면 예외 없이 끝난다. 쌓은 턴은 그대로이고 장면은 끝나지 않은 채(paused)라 바깥 그래프가 이유를 남긴다.
    assert [t.kind for t in scene.result.turns] == ['narration', 'character', 'character'] and scene.result.status == 'paused'


def test_the_agents_model_slot_is_never_used_because_the_director_builds_the_calls():
    with pytest.raises(RuntimeError):
        scene_agent.DirectorModel().invoke('안녕')


# --- 대화 안: 턴 사이에서 멈춘다 -------------------------------------------------------------------------------------------

def finished_after_two(h):
    """카엘·리나가 한 번씩 말하면 이야기가 끝나는 검사 대역."""
    return lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2)


def counts(h):
    return {k: len(v) for k, v in vars(h.calls).items()} | {'director': len(h.director)}


def test_each_request_writes_exactly_one_turn_and_waits_for_the_author_until_the_scene_is_completed(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    run = Run().start()
    assert run.waiting['awaitingScene'] == 'character_simulation' and h.order == ['director', 'narrate', 'review']
    assert (run.shown['status'], run.shown['result']['status'], len(run.shown['result']['turns'])) == ('not_started', 'paused', 1)
    assert run.scene.result.turns[0].kind == 'narration' and 'error' not in run.shown
    run.next()
    assert [t['characterName'] for t in run.shown['result']['turns']] == ['나레이션', '카엘'] and h.order[3:] == ['director', 'act', 'check']
    run.next()
    assert [t['characterName'] for t in run.shown['result']['turns']] == ['나레이션', '카엘', '리나']
    run.next()  # 마무리 나레이션까지 쓰면 에이전트가 끝나 바깥 그래프로 돌아간다
    assert run.waiting is None and run.scene.result.status == 'completed' and run.scene.trail[-1].closing
    assert [e.decision.turn for e in run.scene.trail] == ['narration', 'speech', 'speech', 'end']


def test_edit_changes_only_the_text_and_waits_again_and_the_next_character_reads_the_edited_line(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    run = Run().start().next()
    seen = counts(h)
    run.resume(SceneAction(action='edit', turn=1, text='AUTHOR-LINE "비켜."'))
    turn = run.shown['result']['turns'][1]
    assert run.waiting and (turn['prose'], turn['editedByAuthor'], turn['checks']) == ('AUTHOR-LINE "비켜."', True, [])
    assert counts(h) == seen  # 모델도 연출도 부르지 않는다. 고친 글은 멈춘 payload와 재개 응답에 있다
    run.next()  # 재개 때 앞선 edit 응답을 다시 읽어도 같은 결과가 된다
    assert 'AUTHOR-LINE' in text(h.calls.act[-1]['scene']) and run.scene.result.turns[1].editedByAuthor
    assert run.scene.trail[1].observed == 'AUTHOR-LINE "비켜."'
    assert [t.characterName for t in run.scene.result.turns] == ['나레이션', '카엘', '리나']


def test_redo_writes_that_turn_again_for_the_same_character_with_the_recorded_direction_and_the_note(monkeypatch):
    h = setup(monkeypatch, speech(KAEL, f'limited:{KAEL}'), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 3))
    run = Run().start().next().next()
    asked_director = len(h.director)
    run.resume(SceneAction(action='redo', turn=1, note='REDO-NOTE 더 퉁명스럽게'))
    assert [(t['characterName'], t['pov']) for t in run.shown['result']['turns']] == [('나레이션', 'omniscient'), ('카엘', f'limited:{KAEL}')]
    assert h.calls.act[-1]['self']['id'] == KAEL and h.calls.act[-1]['authorNote'] == 'REDO-NOTE 더 퉁명스럽게'
    assert 'authorNote' not in text(h.calls.check[-1]) and len(h.director) == asked_director  # 연출은 기록된 결정을 쓴다
    assert run.waiting and run.scene.result.notes == [Note(afterTurn=0, text='REDO-NOTE 더 퉁명스럽게')] and run.scene.hint is None


def test_a_redo_checks_that_the_whole_cast_still_exists_before_writing_again(monkeypatch):
    setup(monkeypatch, speech(KAEL), speech(LINA))
    run = Run().start().next().next()
    fake_content(monkeypatch, read={**READ, 'cards': [c for c in READ['cards'] if c['id'] != LINA]})  # 그 사이 리나 카드가 지워졌다
    run.resume(SceneAction(action='redo', turn=1))  # 카엘의 줄만 다시 말하게 해도 장면의 참여 인물은 모두 있어야 한다
    assert run.waiting and (run.scene.result.status, run.scene.error) == ('failed', service.INVALID_PLAN)  # 오류로 죽지 않고 멈춰서 작가가 정한다


def test_a_note_makes_the_next_turn_a_narration_and_reaches_the_characters_only_through_it(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), speech(LINA), narrations=[narration(), narration(prose='정전이 되었다.', observed='갑자기 불이 모두 꺼졌다.')],
              verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    run = Run().start().next()
    run.next(note='MEMO-BLACKOUT 갑자기 정전이 된다')
    assert [t['kind'] for t in run.shown['result']['turns']] == ['narration', 'character', 'narration']
    asked = h.calls.narrate[-1]
    assert asked['purpose'] == 'note' and asked['notes'] == [{'afterTurn': 1, 'text': 'MEMO-BLACKOUT 갑자기 정전이 된다'}]
    assert [n['text'] for n in run.shown['result']['notes']] == ['MEMO-BLACKOUT 갑자기 정전이 된다'] and run.scene.memo is None
    run.next()
    assert 'MEMO-BLACKOUT' not in text(h.calls.act[-1]) and '갑자기 불이 모두 꺼졌다.' in text(h.calls.act[-1]['scene'])


def test_the_note_a_narration_was_written_for_is_recorded_so_that_a_redo_brings_it_back(monkeypatch):
    h = setup(monkeypatch, speech(KAEL))
    run = Run().start().next().next(note='MEMO-RAIN 비가 온다')
    assert run.scene.trail[2].note == 'MEMO-RAIN 비가 온다' and run.scene.trail[1].note is None
    run.resume(SceneAction(action='redo', turn=2))
    assert [t.kind for t in run.scene.result.turns] == ['narration', 'character', 'narration'] and len(h.calls.narrate) == 3
    assert h.calls.narrate[-1]['purpose'] == 'note' and h.calls.narrate[-1]['notes'] == [{'afterTurn': 1, 'text': 'MEMO-RAIN 비가 온다'}]
    assert run.scene.trail[2].note == 'MEMO-RAIN 비가 온다'


def test_stop_ends_the_scene_as_it_is_without_a_closing_narration_and_a_refusal_ends_it_declined(monkeypatch):
    h = setup(monkeypatch, speech(KAEL))
    run = Run().start().next()
    seen = counts(h)
    run.resume(SceneAction(action='stop'))
    assert run.waiting is None and (run.scene.result.status, len(run.scene.result.turns)) == ('completed', 2) and counts(h) == seen
    declined = Run().start().next().resume(None, approved=False)
    assert declined.waiting is None and declined.scene.declined and len(declined.scene.result.turns) == 2


def test_a_stopped_scene_waits_for_the_author_and_next_tries_again(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, fail=('voice_mix',) if len(h.calls.check) <= 3 else (), detail='DETAIL'))
    run = Run().start().next()  # 카엘의 대사가 세 번 모두 검사에서 걸린다
    assert run.waiting['awaitingScene'] == 'character_simulation'
    assert (run.shown['status'], run.shown['result']['status'], run.shown['result']['stopReason']) == ('failed', 'stopped', 'check_failed')
    assert '말투 섞임' in run.shown['error'] and [t['kind'] for t in run.shown['result']['turns']] == ['narration']
    run.next()
    assert run.shown['status'] == 'not_started' and 'error' not in run.shown and run.scene.error is None
    assert [t['characterName'] for t in run.shown['result']['turns']] == ['나레이션', '카엘']
    run.next()
    assert run.scene.result.turns[1].regenerated == 0 and len(h.calls.act) == 5


def test_a_scene_that_failed_before_any_turn_cannot_be_continued_so_the_run_ends(monkeypatch):
    setup(monkeypatch, reviews=lambda payload: verdict(payload, fail=('knowledge_leak',), refs=[f'card:{KAEL}#ep05']))
    run = Run().start()
    assert run.waiting is None and run.scene.result.turns == [] and run.scene.result.status == 'stopped'


def test_the_turn_limit_waits_for_the_author_who_can_end_the_scene_there(monkeypatch):
    setup(monkeypatch, lambda state, allowed, cast, last: speech(KAEL if state['spoken'] % 2 == 0 else LINA))
    run = Run().start()
    for _ in range(12):
        run.next()
    assert run.shown['result']['status'] == 'paused' and len(run.shown['result']['turns']) == 13  # 열두 번째 대사까지는 이어진다
    run.next()  # 열세 번째 대사를 쓰려 하면 한도에 닿아 멈춘다
    assert (run.shown['status'], run.shown['result']['stopReason']) == ('failed', 'turn_limit') and '12' in run.shown['error']
    run.resume(SceneAction(action='stop'))
    assert run.waiting is None and run.scene.result.status == 'completed' and len(characters(run.scene)) == 12


def test_the_world_is_read_once_per_request_and_the_retrieval_token_is_the_one_the_resume_brought(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), verdicts=lambda payload: verdict(payload, fail=('voice_mix',) if len(h.calls.check) == 1 else ()))
    tokens = []
    monkeypatch.setattr(service.retrieval, 'retrieve', lambda scope, question: tokens.append(scope.scopeToken) or RetrievalResult(
        status='found', excerpts=[], gaps=[], steps=[], coverage={'expected': [], 'withVerifiedExcerpt': [], 'withoutVerifiedExcerpt': []}))
    run = Run(scope={'scopeToken': 'old.token'}).start()
    assert [tool for tool, _ in h.content] == ['world_studio_list', 'world_studio_read'] and tokens == ['old.token']
    run.resume(SceneAction(action='next'), scope={'scopeToken': 'fresh.token'})  # 한 요청 안의 재생성은 세계관을 다시 읽지 않는다
    assert len(h.content) == 4 and tokens == ['old.token', 'fresh.token'] and h.calls.act[-1]['self']['id'] == KAEL


def test_a_finished_scene_can_be_continued_after_the_approval_question_by_an_action_the_graph_hands_back(monkeypatch):
    h = setup(monkeypatch, speech(KAEL), speech(LINA), verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    finished = run_auto()
    seen = counts(h)
    edited = Run().start(scene=finished, action=SceneAction(action='edit', turn=1, text='AUTHOR-LINE'))
    assert edited.waiting is None and edited.scene.result.status == 'completed' and edited.scene.result.turns[1].prose == 'AUTHOR-LINE'
    assert counts(h) == seen  # 고치기만 했으면 모델을 부르지 않고 바로 승인으로 돌아간다
    more = Run().start(scene=finished, action=SceneAction(action='next', note='MORE 이야기가 이어진다'))
    assert [t['kind'] for t in more.shown['result']['turns']] == ['narration', 'character', 'character', 'narration']  # 마무리가 빠지고 메모 나레이션이 붙었다
    assert more.shown['result']['status'] == 'paused' and h.calls.narrate[-1]['purpose'] == 'note'
    assert [e.closing for e in more.scene.trail] == [False, False, False, False] and not more.scene.trail[2].ended
