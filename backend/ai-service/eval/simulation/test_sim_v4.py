"""V4(초안 → 병렬 수정) 시험의 단위 테스트: 초안 검증·장면 상태 조립(순수)과, 모델 대역(초안·대사·나레이션·검사)으로 한 장면을 끝까지 돌리는 흐름."""

import asyncio
import threading
import time
from types import SimpleNamespace

import pytest

import sim_v4 as v
import sim_worlds as w
from app.simulation import agent, service
from app.simulation.errors import SimulationFailure
from app.simulation.models import Action, CheckItem, Narration, Verdict
from app.simulation.prompt import FEEDBACK

FLOW = next(spec for spec in w.SCENES if spec['id'] == 'ko-5-flow')   # 비트 둘
IF = next(spec for spec in w.SCENES if spec['id'] == 'ko-5-if')       # 인물 셋


def cast_of(spec):
    plan, world = w.Worlds([], {}).scene(spec)
    return plan, world, {world.characters[i].title: i for i in plan.characterIds}


def t(kind, speaker=None, pov='omniscient', prose='글', observed='보이는 것', done=False):
    return v.DraftTurn(kind=kind, speaker=speaker, pov=pov, prose=prose, observed=observed, beatDone=done)


def flow_draft(names):
    a, b = list(names)[:2]
    return v.Draft(turns=[t('narration', prose='연다'), t('character', a, prose='첫째'), t('character', b, prose='둘째', done=True), t('narration', prose='넘긴다'),
                          t('character', a, prose='셋째'), t('character', b, prose='넷째', done=True), t('narration', prose='맺는다')])


def test_a_flow_draft_becomes_planned_turns_with_purposes_card_ids_and_omniscient_dialogue():
    plan, world, names = cast_of(FLOW)
    a, b = list(names)[:2]
    planned = v.check_draft(flow_draft(names), plan, names)
    assert [p.purpose for p in planned] == ['opening', '', '', 'transition', '', '', 'closing']
    assert [p.kind for p in planned] == ['narration', 'character', 'character', 'narration', 'character', 'character', 'narration']
    assert planned[1].owner == names[a] and planned[2].owner == names[b] and planned[1].pov == 'omniscient' and planned[1].name == a
    assert planned[0].owner is None and planned[0].name == service.NARRATOR and [p.beat_done for p in planned] == [False, False, True, False, False, True, False]


@pytest.mark.parametrize('broken, reason', [
    (lambda d, a, b: d.turns.__setitem__(0, t('character', a)), '시작'),                                   # 첫 턴이 나레이션이 아니다
    (lambda d, a, b: d.turns.__setitem__(-1, t('character', b)), '맺'),                                    # 끝 턴이 나레이션이 아니다
    (lambda d, a, b: d.turns.__setitem__(1, t('character', '모르는 사람')), '인물'),                        # 장면 인물이 아닌 화자
    (lambda d, a, b: d.turns.__setitem__(5, t('character', b, done=False)), '비트'),                       # 비트 하나를 끝내지 않았다
    (lambda d, a, b: d.turns.__setitem__(1, t('character', a, done=True)), '비트'),                        # 비트를 셋 끝냈다(비트는 둘)
    (lambda d, a, b: d.turns.__setitem__(2, t('character', b, prose='  ', done=True)), '본문'),             # 빈 본문
    (lambda d, a, b: d.turns.__setitem__(2, t('character', b, observed='', done=True)), '보이는'),          # 인물 턴에 observed가 없다
    (lambda d, a, b: d.turns.__setitem__(3, t('monologue', None, pov='omniscient')), '독백'),                # 독백인데 시점 인물이 없다
    (lambda d, a, b: d.turns.__setitem__(3, t('narration', pov='limited:모르는 사람')), '시점'),             # 시점 인물이 장면 인물이 아니다
    (lambda d, a, b: d.turns.__delitem__(slice(1, 6)), '턴'),                                              # 너무 짧다
])
def test_a_draft_that_cannot_become_a_scene_is_rejected_with_a_reason(broken, reason):
    plan, world, names = cast_of(FLOW)
    a, b = list(names)[:2]
    draft = flow_draft(names)
    broken(draft, a, b)
    with pytest.raises(v.DraftError, match=reason):
        v.check_draft(draft, plan, names)


def test_too_many_dialogue_turns_are_rejected_like_the_service_turn_limit():
    plan, world, names = cast_of(FLOW)
    a, b = list(names)[:2]
    turns = [t('narration')] + [t('character', a if i % 2 else b) for i in range(service.TURN_LIMIT + 1)] + [t('narration')]
    turns[-2] = t('character', b, done=True)
    turns[len(turns) // 2] = t('character', a, done=True)
    with pytest.raises(v.DraftError, match='대사'):
        v.check_draft(v.Draft(turns=turns), plan, names)


def test_a_monologue_takes_its_point_of_view_from_the_speaker_and_marks_on_narration_are_ignored():
    plan, world, names = cast_of(FLOW)
    a, b = list(names)[:2]
    draft = flow_draft(names)
    draft.turns[3] = t('monologue', a, pov='omniscient', done=True)       # 독백: 화자가 시점 인물, 비트 표시는 대사 턴에서만 의미가 있다
    draft.turns[0] = t('narration', pov=f'limited:{b}', done=True)
    planned = v.check_draft(draft, plan, names)
    assert (planned[3].kind, planned[3].pov, planned[3].owner, planned[3].purpose) == ('monologue', f'limited:{names[a]}', names[a], 'monologue')
    assert planned[0].pov == f'limited:{names[b]}' and planned[0].owner == names[b] and planned[0].beat_done is False and planned[3].beat_done is False
    assert planned[3].name == a and planned[0].name == service.NARRATOR       # 나레이션은 시점 인물이 있어도 이름이 나레이션이다
    draft.turns[3] = t('monologue', None, pov=f'limited:{b}')               # 화자가 없으면 시점의 인물이 속마음의 주인이다
    again = v.check_draft(draft, plan, names)
    assert (again[3].owner, again[3].name, again[3].pov) == (names[b], b, f'limited:{names[b]}')


def test_an_if_draft_has_no_beats_so_the_marks_are_ignored():
    plan, world, names = cast_of(IF)
    a, b = list(names)[:2]
    draft = v.Draft(turns=[t('narration'), t('character', a, done=True), t('character', b), t('narration')])
    planned = v.check_draft(draft, plan, names)
    assert [p.beat_done for p in planned] == [False] * 4 and [p.purpose for p in planned] == ['opening', '', '', 'closing']


def test_each_turn_sees_only_the_earlier_draft_lines_and_the_beat_moves_after_a_beat_ending_turn():
    plan, world, names = cast_of(FLOW)
    a, b = list(names)[:2]
    draft = flow_draft(names)
    draft.turns[1] = t('monologue', a, observed='')                        # 독백은 다른 인물에게 보이지 않는다
    draft.turns[2] = t('character', b, observed='둘째가 한 말', done=True)
    planned = v.check_draft(draft, plan, names)
    scenes = v.scenes_before(plan, planned)
    assert len(scenes) == len(planned) + 1 and scenes[0].result.turns == []
    assert [line['text'] for line in service.seen_lines(scenes[3])] == ['보이는 것', '둘째가 한 말']
    assert [line['text'] for line in service.seen_lines(scenes[2])] == ['보이는 것']                 # 독백(턴 1)은 빠진다
    assert service.current_beat(scenes[2].result).index == 0 and service.current_beat(scenes[3].result).index == 1   # 턴 2가 첫 비트를 끝냈다
    assert [tr.prose for tr in scenes[3].result.turns] == ['연다', '글', '글'] and scenes[3].result.turns[1].kind == 'monologue'



# ---- 병렬 흐름(모델 대역) ----

@pytest.fixture
def models(monkeypatch):
    """초안(agent._parse)·대사·나레이션·검사 대역. 호출마다 공통 usage 이벤트를 알리고(기록의 calls), 호출 이름·입력을 모은다. 검사는 기본으로 모두 통과시키고 비트·장면 완결을 확인해 준다."""
    log = SimpleNamespace(calls=[], inputs=[], acts=[], narrates=[], checked=[], lock=threading.Lock(), draft=None, verdict=None, barrier=None, act_delay=0.0,
                          fail_acts=(), refuse=(), seen={})

    def report(name, tin, tout):
        agent._report(name, time.monotonic() - 0.02, {'input_tokens': tin, 'output_tokens': tout}, failed=False)

    def note(name):
        with log.lock:
            log.calls.append(name)

    def parse(name, instructions, data, text_format, max_tokens, timeout):
        note('draft')
        with log.lock:
            log.inputs.append(data)
            value = log.draft(len(log.inputs)) if callable(log.draft) else log.draft
        report('draft', 800, 600)
        if isinstance(value, Exception):
            raise value
        return value

    def meet():
        if log.barrier is not None:
            log.barrier.wait(timeout=3)   # 병렬이 아니면 짝이 오지 않아 BrokenBarrierError

    def act(data):
        note('act')
        meet()
        time.sleep(log.act_delay)
        if any(text in data['draft'] for text in log.fail_acts):
            raise SimulationFailure(503, '대역 호출 실패')
        with log.lock:
            log.acts.append(data)
        report('act', 1000, 100)
        return Action(prose=f'"{data["draft"]}" 고침', observed=f'{data["draft"]}이(가) 보임', refusesBeat=any(text in data['draft'] for text in log.refuse),
                      refusalReason='성격상 따를 수 없다')

    def narrate(data):
        note('narrate')
        meet()
        with log.lock:
            log.narrates.append(data)
        report('narrate', 900, 80)
        return Narration(prose=f'{data["draft"]} 고침', observed=f'{data["draft"]}이(가) 알려짐')

    def check(payload):
        note('check')
        report('check', 3000, 100)
        with log.lock:
            log.checked.append(payload)
            n = log.seen[payload['paragraph']] = log.seen.get(payload['paragraph'], 0) + 1
        verdict = log.verdict(payload, n) if log.verdict else {}
        failed = verdict.get('failed', ())
        return Verdict(checks=[CheckItem(kind=k, passed=k not in failed, detail='어긋남' if k in failed else '', refs=[]) for k in payload['checks']],
                       beatDone=verdict.get('beatDone', True), sceneComplete=verdict.get('sceneComplete', True))

    monkeypatch.setattr(agent, '_parse', parse)
    monkeypatch.setattr(agent, 'act', act)
    monkeypatch.setattr(agent, 'narrate', narrate)
    monkeypatch.setattr(agent, 'check', check)
    monkeypatch.delenv('SIMULATION_SKIP_NARRATION_CHECK', raising=False)
    return log


def play(spec, **options):
    plan, world = w.Worlds([], {}).scene(spec)
    return asyncio.run(v.run_v4_scene(spec, plan, world, **options))


def count(models, name):
    return models.calls.count(name)


def test_a_scene_takes_one_draft_then_one_revision_and_one_check_per_turn(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    record = play(FLOW)
    assert (record['id'], record['engine'], record['mode'], record['status'], record['stopReason']) == ('ko-5-flow', 'v4', 'flow', 'completed', None)
    assert (count(models, 'draft'), count(models, 'act'), count(models, 'narrate'), count(models, 'check')) == (1, 4, 3, 7)
    assert record['serialSteps'] == 3 and record['v4']['draftAttempts'] == 1 and record['v4']['failedTurns'] == [] and record['v4']['firstCheckFailed'] == 0
    assert sorted(c['name'] for c in record['calls']) == sorted(models.calls) and all(c['inputTokens'] for c in record['calls'])
    assert [t['kind'] for t in record['turns']] == ['narration', 'character', 'character', 'narration', 'character', 'character', 'narration'] and all(t['regenerated'] == 0 for t in record['turns'])
    texts = [t['text'] for t in record['transcript']['turns']]
    assert texts[1] == '"첫째" 고침' and record['transcript']['turns'][1]['draft'] == '첫째' and record['v4']['beatsConfirmed'] == [0, 1]
    assert record['elapsedMs'] >= record['firstTurnMs'] >= 0 and record['draftMs'] <= record['elapsedMs']


def test_the_revision_input_is_the_characters_own_view_plus_the_draft_line(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    play(FLOW)
    one = next(d for d in models.acts if d['draft'] == '둘째')
    assert one['self']['name'] == list(names)[1] and one['actionStyle']['person'] == 'third' and 'known' in one and 'feedback' not in one
    assert [line['text'] for line in one['scene']] == ['보이는 것', '보이는 것']                 # 앞선 초안 줄만 보인다(둘째 자신의 줄은 아직)
    second = next(d for d in models.narrates if d['draft'] == '넘긴다')
    assert second['purpose'] == 'transition' and second['pov']['kind'] == 'omniscient' and second['direction']['currentBeat']['ref'] == 'beat:1'
    assert models.draft.turns[0].prose == '연다' and models.inputs[0]['mode'] == 'flow' and models.inputs[0]['beats'] == plan.beats
    assert set(models.inputs[0]['characters']) == set(names) and 'known' not in models.inputs[0]    # 초안 입력은 계획 입력뿐이다


def test_the_revisions_start_together_instead_of_one_after_another(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.barrier = threading.Barrier(7)    # 일곱 턴의 첫 수정 호출이 모두 동시에 와야 지나간다
    assert play(FLOW)['status'] == 'completed'


def test_a_turn_that_fails_its_check_is_revised_once_more_with_the_feedback_and_only_that_turn(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.verdict = lambda payload, n: {'failed': ('knowledge_leak',)} if '셋째' in payload['paragraph'] and n == 1 else {}
    record = play(FLOW)
    assert record['status'] == 'completed' and [t['regenerated'] for t in record['turns']] == [0, 0, 0, 0, 1, 0, 0] and record['v4']['firstCheckFailed'] == 1
    assert (count(models, 'act'), count(models, 'check')) == (5, 8) and record['serialSteps'] == 5
    again = [d for d in models.acts if d['draft'] == '셋째']
    assert 'feedback' not in again[0] and again[1]['feedback'] == [FEEDBACK['knowledge_leak']]


def test_a_turn_that_fails_twice_is_counted_failed_and_the_scene_stops_with_check_failed(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.verdict = lambda payload, n: {'failed': ('voice_mix',)} if '셋째' in payload['paragraph'] else {}
    record = play(FLOW)
    assert (record['status'], record['stopReason']) == ('stopped', 'check_failed') and record['v4']['failedTurns'] == [4] and '말투 섞임' in record['error']
    assert len(record['transcript']['turns']) == 7 and record['transcript']['turns'][4]['failed'] and not record['transcript']['turns'][1].get('failed')


def test_an_invalid_draft_is_redrafted_once_with_the_reason_and_two_bad_drafts_fail_the_scene(models):
    plan, world, names = cast_of(FLOW)
    bad = flow_draft(names)
    bad.turns[-1] = t('character', list(names)[0])
    models.draft = lambda n: bad if n == 1 else flow_draft(names)
    record = play(FLOW)
    assert record['status'] == 'completed' and record['v4']['draftAttempts'] == 2 and record['serialSteps'] == 4
    assert 'feedback' not in models.inputs[0] and '맺' in models.inputs[1]['feedback'][0]
    models.draft, models.calls, models.inputs = bad, [], []
    failed = play(FLOW)
    assert failed['status'] == 'failed' and failed['error'].startswith('초안') and models.calls == ['draft', 'draft'] and failed['turns'] == []


def test_a_model_failure_in_a_revision_fails_the_scene_and_says_why(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.fail_acts = ('둘째',)
    record = play(FLOW)
    assert record['status'] == 'failed' and '대역 호출 실패' in record['error']


def test_the_omniscient_narration_check_can_be_skipped_like_the_service_switch(models, monkeypatch):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    monkeypatch.setenv('SIMULATION_SKIP_NARRATION_CHECK', '1')
    record = play(FLOW)
    assert count(models, 'check') == 4 and record['status'] == 'completed' and record['serialSteps'] == 3


def test_the_scene_is_complete_only_when_the_checks_confirm_the_beats_or_the_if_premise(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.verdict = lambda payload, n: {'beatDone': False}
    record = play(FLOW)
    assert (record['status'], record['stopReason']) == ('stopped', 'goal_unconfirmed') and record['v4']['beatsConfirmed'] == []
    plan, world, names = cast_of(IF)
    a, b = list(names)[:2]
    models.draft = v.Draft(turns=[t('narration'), t('character', a), t('character', b), t('narration')])
    models.verdict = lambda payload, n: {'sceneComplete': False}
    assert play(IF)['stopReason'] == 'goal_unconfirmed'
    models.verdict = None
    assert play(IF)['status'] == 'completed'


def test_a_beat_refusal_stops_the_scene_without_another_try(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.refuse = ('둘째',)
    record = play(FLOW)
    assert (record['status'], record['stopReason']) == ('stopped', 'beat_rejected') and count(models, 'act') == 4 and record['v4']['refusals'] == [2]


def test_the_first_turn_is_ready_long_before_the_whole_scene_when_later_turns_are_slow(models):
    plan, world, names = cast_of(FLOW)
    models.draft = flow_draft(names)
    models.act_delay = 0.4
    record = play(FLOW)
    assert record['firstTurnMs'] + 250 < record['elapsedMs']
