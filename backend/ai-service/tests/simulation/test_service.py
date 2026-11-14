import pytest

from app.manuscript.models import Excerpt
from app.retrieval.errors import RetrievalFailure, RetrievalUnavailable
from app.retrieval.models import RetrievalResult
from app.simulation import service
from app.simulation.errors import SimulationFailure
from app.simulation.models import Decision, Note, PlanDraft, SceneAction, SimulationPlan, Trail, Turn

from .stubs import (EPISODE, GATE, KAEL, LINA, PLAN_FLOW, PLAN_IF, READ, REL, SHADOW, TARGET, WORLD, card, context, fake_content,
                    fake_novelbrain, recalled, text)

STYLE, PERSONA, REMOVED = (f'00000000-0000-0000-0000-0000000000{n}' for n in ('a1', 'a2', 'ff'))
PERSONA_CARD = card(PERSONA, '나레이터 페르소나', 'PERSONA-ID 오래된 이야기꾼', docs={'soul': 'PERSONA-SOUL 느릿한 말투', 'memory': '', 'episodes': {}})
STYLE_CARD = card(STYLE, '나레이터 문체', 'STYLE-GUIDE 담담한 3인칭 현재형으로 쓴다', cardType='etc')
NARRATOR_WORLD = {**READ, 'cards': [*READ['cards'], STYLE_CARD, PERSONA_CARD]}
COVERAGE = {'expected': [], 'withVerifiedExcerpt': [], 'withoutVerifiedExcerpt': []}


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


def test_load_world_reads_the_linked_world_and_retrieves_excerpts_for_the_request_without_filtering_them(monkeypatch):
    calls = fake_content(monkeypatch)
    excerpts = [Excerpt(id='m', episode=2, quote='원고', kind='manuscript'), Excerpt(id='s', episode=2, quote='설정', kind='setting')]
    asked = []
    monkeypatch.setattr(service.retrieval, 'retrieve', lambda scope, question: asked.append((scope.scopeToken, question)) or
                        RetrievalResult(status='found', excerpts=excerpts, gaps=[], coverage=COVERAGE, steps=[]))
    world = service.load_world(TARGET, '카엘과 리나가 만나면', {'scopeToken': 'signed.token'})
    assert [tool for tool, _ in calls] == ['world_studio_list', 'world_studio_read'] and asked == [('signed.token', '카엘과 리나가 만나면')]
    # 받은 발췌를 그대로 둔다. 원고가 아닌 발췌(설정·현재 관계)는 recall의 인물 필터가 gaps로 돌린다.
    assert [e.id for e in world.manuscript] == ['m', 's'] and set(world.characters) == {KAEL, LINA} and world.episode == EPISODE


def raising(error):
    def retrieve(scope, question):
        raise error
    return retrieve


def test_load_world_goes_on_without_excerpts_when_the_search_is_unavailable_and_carries_the_notice(monkeypatch):
    fake_content(monkeypatch)
    monkeypatch.setattr(service.retrieval, 'retrieve', raising(RetrievalUnavailable(503, '원고 Q&A를 사용할 수 없어요.')))
    world = service.load_world(TARGET, '요청', {'scopeToken': 'signed.token'})
    assert (world.manuscript, world.notice) == ([], '원고 발췌 검색을 쓸 수 없어 세계관 설정만으로 진행했어요.')
    assert world.notice == service.NO_EXCERPTS and set(world.characters) == {KAEL, LINA}  # 세계관 카드·관계는 그대로 읽는다


@pytest.mark.parametrize('error', [RetrievalFailure(403, 'x'), RetrievalFailure(404, 'x'), RetrievalFailure(409, '공개 원고 범위가 변경됐어요.'),
                                   RetrievalFailure(422, 'x'), RetrievalFailure(502, 'Content 검색에 실패했습니다.'),
                                   RetrievalFailure(503, 'Content 검색 설정이 필요합니다.')])  # 우리 쪽 503은 Content가 답한 것이 아니다
def test_every_other_retrieval_error_still_fails_the_world_load(monkeypatch, error):
    fake_content(monkeypatch)
    monkeypatch.setattr(service.retrieval, 'retrieve', raising(error))
    with pytest.raises(RetrievalFailure) as failure:
        service.load_world(TARGET, '요청', {'scopeToken': 'signed.token'})
    assert failure.value is error


def test_load_world_without_scope_does_not_retrieve(monkeypatch):
    fake_content(monkeypatch)
    monkeypatch.setattr(service.retrieval, 'retrieve', lambda *args: pytest.fail('scope가 없으면 검색하지 않는다'))
    assert service.load_world(TARGET, '요청', None).manuscript == []


def test_the_context_reads_the_world_once_for_the_whole_request(monkeypatch):
    calls = fake_content(monkeypatch)
    ctx = context()
    assert ctx.world() is ctx.world()
    assert [tool for tool, _ in calls] == ['world_studio_list', 'world_studio_read']


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


@pytest.mark.parametrize('call', [lambda: service.plan('요청', [], None), lambda: service.plan_from_form(PLAN_IF, None),
                                  lambda: service.load_world(None, '요청', None)])
def test_plan_and_world_need_the_target_work_and_episode(call):
    with pytest.raises(SimulationFailure) as error:
        call()
    assert error.value.status == 422


def test_narrator_cards_are_style_guides_not_characters_the_plan_could_pick(monkeypatch):
    fake_content(monkeypatch, read=NARRATOR_WORLD)
    seen = []
    monkeypatch.setattr(service.agent, 'plan', lambda *args: seen.append(args[2]) or PlanDraft(mode=None, premise=None, beats=[], characterIds=[]))
    service.plan('요청', [], TARGET)
    assert [c['name'] for c in seen[0]] == ['카엘', '리나']


# --- 버튼 진입: 작가가 양식으로 정한 계획 ----------------------------------------------------------------------------------

def test_form_plan_is_used_as_it_is_after_checking_the_linked_world_without_asking_a_model(monkeypatch):
    calls = fake_content(monkeypatch)
    monkeypatch.setattr(service.agent, 'plan', lambda *args: pytest.fail('양식으로 정한 계획은 모델에게 묻지 않는다'))
    form = SimulationPlan(mode='flow', beats=['성문 대면'], characterIds=[KAEL, LINA])
    assert service.plan_from_form(form, TARGET) == form
    assert [tool for tool, _ in calls] == ['world_studio_list', 'world_studio_read']


@pytest.mark.parametrize('form, said', [
    (SimulationPlan(mode='if', characterIds=[KAEL]), 'IF 전제'),
    (SimulationPlan(mode='flow', characterIds=[KAEL]), '장면 비트'),
    (SimulationPlan(mode='if', premise='만약 북문이 열려 있었다면?'), '참여 인물'),
    (SimulationPlan(characterIds=[KAEL]), '모드'),
    (SimulationPlan(mode='if', premise='전제', characterIds=['not-in-the-world']), '세계관에 없는 인물'),
    (SimulationPlan(mode='if', premise='전제', characterIds=[GATE]), '세계관에 없는 인물'),     # 인물 카드가 아니다(장소)
    (SimulationPlan(mode='if', premise='전제', characterIds=[REMOVED]), '세계관에 없는 인물'),  # 삭제된 인물 카드
    (SimulationPlan(mode='if', premise='전제', characterIds=[PERSONA]), '세계관에 없는 인물'),  # 나레이터 카드는 인물이 아니다
])
def test_form_plan_the_world_or_the_mode_does_not_allow_fails_clearly_instead_of_asking(monkeypatch, form, said):
    fake_content(monkeypatch, read=NARRATOR_WORLD)
    with pytest.raises(SimulationFailure) as error:
        service.plan_from_form(form, TARGET)
    assert error.value.status == 422 and said in str(error.value)


# --- 장면 상태(순수 함수) ----------------------------------------------------------------------------------------------

def scene_of(plan=PLAN_IF, *entries):
    """entries는 ('narration'|'monologue'|'character', 트레일 값) 목록. 턴을 차례로 붙인 장면."""
    scene = service.new_scene(plan)
    for kind, flags in entries:
        who = KAEL if kind != 'narration' else None
        turn = Turn(index=len(scene.result.turns), kind=kind, characterId=who, characterName='카엘' if who else '나레이션',
                    prose=f'{kind}-{len(scene.result.turns)}', checks=[], regenerated=0, evidence=[])
        decision = Decision(turn={'narration': 'narration', 'monologue': 'monologue', 'character': 'speech'}[kind],
                            speaker=who if kind == 'character' else None, pov='omniscient' if kind == 'narration' else f'limited:{KAEL}')
        flags = {'observed': '' if kind == 'monologue' else f'{kind}-observed', **flags}
        scene = service.add_turn(scene, turn, Trail(decision=decision, **flags))
    return scene


@pytest.mark.parametrize('entries, plan, expected', [
    ([], PLAN_IF, (['narration'], 'opening')),
    ([('narration', {})], PLAN_IF, (['narration', 'monologue', 'speech'], None)),
    ([('narration', {}), ('character', {})], PLAN_IF, (['narration', 'monologue', 'speech'], None)),
    ([('narration', {}), ('character', {'ended': True, 'done': True})], PLAN_IF, (['end'], 'closing')),
    ([('narration', {}), ('character', {'beat': 0, 'done': True})], PLAN_FLOW, (['narration'], 'transition')),
    ([('narration', {}), ('character', {'beat': 0, 'done': True, 'ended': True})], PLAN_FLOW, (['end'], 'closing')),
    ([('narration', {}), ('character', {}), ('monologue', {})], PLAN_IF, (['narration', 'monologue', 'speech'], None)),
    ([('narration', {}), ('monologue', {})], PLAN_IF, (['speech'], None)),                        # 서술·독백이 두 번 이어지면 이번엔 대사
    ([('narration', {}), ('character', {}), ('monologue', {}), ('narration', {})], PLAN_IF, (['speech'], None)),
    ([('narration', {})] + [('character', {})] * 12, PLAN_IF, ([], None)),                      # 인물 대사 한도
])
def test_rules_decide_which_turns_the_director_may_pick_and_why_narration_is_required(entries, plan, expected):
    assert service.rules(plan, scene_of(plan, *entries)) == expected


def test_a_note_comes_before_every_other_rule_and_the_turn_cap_counts_every_kind():
    pending = scene_of(PLAN_IF, ('narration', {}), ('character', {'ended': True})).model_copy(update={'memo': '비가 온다'})
    assert service.rules(PLAN_IF, pending) == (['narration'], 'note')
    assert service.rules(PLAN_IF, scene_of(PLAN_IF, ('narration', {}), *([('character', {}), ('narration', {}), ('monologue', {})] * 13))) == ([], None)
    # 인물 대사는 한도 아래여도 나레이션·독백까지 합친 턴이 상한에 닿으면 멈춘다
    many = scene_of(PLAN_IF, ('narration', {}), *([('character', {}), ('narration', {}), ('monologue', {}), ('narration', {})] * 10))
    assert sum(t.kind == 'character' for t in many.result.turns) == 10 and len(many.result.turns) == 41 and service.rules(PLAN_IF, many) == ([], None)


def test_the_scene_lines_characters_see_leave_out_monologues_and_unspoken_turns():
    scene = scene_of(PLAN_IF, ('narration', {}), ('monologue', {}), ('character', {}))
    assert service.seen_lines(scene) == [{'ref': 'scene:0', 'by': '나레이션', 'text': 'narration-observed'},
                                         {'ref': 'scene:2', 'by': '카엘', 'text': 'character-observed'}]


def test_the_director_sees_a_summary_without_ids_documents_or_monologue_text():
    scene = scene_of(PLAN_FLOW, ('narration', {}), ('monologue', {}), ('character', {'beat': 0})).model_copy(update={'memo': '비가 온다'})
    state = service.director_state(PLAN_FLOW, scene, 'note')
    assert state['mode'] == 'flow' and state['currentBeat'] == {'index': 0, 'text': PLAN_FLOW.beats[0]} and state['required'] == 'note'
    assert (state['spoken'], state['limit'], state['memoPending']) == (1, 12, True)
    assert [line['kind'] for line in state['scene']] == ['narration', 'monologue', 'character']
    assert 'text' not in state['scene'][1] and state['scene'][2]['text'] == 'character-observed'
    assert KAEL not in text(state) and 'KAEL-' not in text(state)
    assert len(service.director_state(PLAN_IF, scene_of(PLAN_IF, *[('narration', {})] * 12), None)['scene']) == 8


def test_edit_replaces_the_line_with_the_authors_text_and_clears_its_checks():
    scene = scene_of(PLAN_IF, ('narration', {}), ('character', {}), ('monologue', {}))
    edited = service.apply_action(scene, SceneAction(action='edit', turn=1, text='  AUTHOR-LINE "비켜."  '))
    turn = edited.result.turns[1]
    assert (turn.prose, turn.editedByAuthor, turn.checks, edited.trail[1].observed) == ('AUTHOR-LINE "비켜."', True, [], 'AUTHOR-LINE "비켜."')
    assert edited.result.status == 'paused' and scene.result.turns[1].prose == 'character-1'  # 받은 장면은 바뀌지 않는다
    again = service.apply_action(scene, SceneAction(action='edit', turn=2, text='속마음을 고쳤다'))
    assert again.trail[2].observed == ''  # 독백은 고쳐도 다른 인물에게 보이지 않는다


def test_stop_ends_the_scene_as_it_is_and_next_after_it_takes_the_closing_narration_back():
    scene = scene_of(PLAN_FLOW, ('narration', {}), ('character', {'beat': 0, 'done': True, 'ended': True}),
                     ('narration', {'closing': True}))
    scene.result.status = 'completed'
    scene.result.beats[0].status = 'done'
    stopped = service.apply_action(scene.model_copy(update={'error': '멈췄어요'}), SceneAction(action='stop'))
    assert (stopped.result.status, stopped.result.stopReason, stopped.error, len(stopped.result.turns)) == ('completed', None, None, 3)
    more = service.apply_action(scene, SceneAction(action='next', note='MORE 이어진다'))
    assert [t.kind for t in more.result.turns] == ['narration', 'character'] and more.result.status == 'paused'
    assert (more.trail[1].ended, more.trail[1].done, more.memo) == (False, False, 'MORE 이어진다')
    assert more.result.notes == [Note(afterTurn=1, text='MORE 이어진다')] and more.result.beats[0].status == 'pending'  # 마지막 비트가 다시 열린다
    assert service.rules(PLAN_FLOW, more) == (['narration'], 'note')


def test_next_after_a_stop_or_failure_retries_and_forgets_the_old_reason():
    scene = service.stop_scene(scene_of(PLAN_IF, ('narration', {})), '검사를 통과하지 못했어요', 'stopped', 'check_failed')
    assert (scene.result.status, scene.result.stopReason, scene.error) == ('stopped', 'check_failed', '검사를 통과하지 못했어요')
    retried = service.apply_action(scene, SceneAction(action='next'))
    assert (retried.result.status, retried.result.stopReason, retried.error, retried.memo) == ('paused', None, None, None)


def test_redo_drops_the_turn_and_after_and_keeps_its_recorded_direction_and_the_note_for_it():
    scene = scene_of(PLAN_IF, ('narration', {}), ('character', {}), ('character', {}), ('narration', {}))
    scene.result.notes = [Note(afterTurn=0, text='앞 메모'), Note(afterTurn=2, text='뒤 메모')]
    again = service.apply_action(scene, SceneAction(action='redo', turn=2, note='REDO 더 퉁명스럽게'))
    assert [t.index for t in again.result.turns] == [0, 1] and len(again.trail) == 2
    assert again.redo == scene.trail[2].decision and again.hint == 'REDO 더 퉁명스럽게' and again.memo is None
    assert again.result.notes == [Note(afterTurn=0, text='앞 메모'), Note(afterTurn=1, text='REDO 더 퉁명스럽게')]  # 지운 턴 뒤의 메모는 사라진다
    assert again.result.status == 'paused' and len(scene.result.turns) == 4


def test_redo_of_a_narration_written_for_a_note_brings_that_note_back():
    scene = scene_of(PLAN_IF, ('narration', {}), ('character', {}), ('narration', {'note': 'MEMO-RAIN 비가 온다'}))
    again = service.apply_action(scene, SceneAction(action='redo', turn=2))
    assert (again.memo, again.hint) == ('MEMO-RAIN 비가 온다', None) and service.rules(PLAN_IF, again) == (['narration'], 'note')


def test_redo_gives_back_the_beats_the_dropped_turns_had_finished():
    scene = scene_of(PLAN_FLOW, ('narration', {}), ('character', {'beat': 0, 'done': True}), ('narration', {'beat': 1}))
    assert [b.status for b in scene.result.beats] == ['done', 'pending']
    again = service.apply_action(scene, SceneAction(action='redo', turn=1))
    assert [b.status for b in again.result.beats] == ['pending', 'pending']


def test_a_stopped_scene_keeps_its_turns_and_marks_the_beat_that_was_refused():
    scene = scene_of(PLAN_FLOW, ('narration', {}))
    stopped = service.stop_scene(scene, '카엘이 비트를 따르지 않아 멈췄어요.', 'stopped', 'beat_rejected', rejected=0)
    assert [b.status for b in stopped.result.beats] == ['rejected', 'pending'] and len(stopped.result.turns) == 1
    assert [b.status for b in scene.result.beats] == ['pending', 'pending']


# --- 턴 입력의 격리 ----------------------------------------------------------------------------------------------------

def view(monkeypatch, plan=PLAN_IF, actor=KAEL, scene=None, read=READ, manuscript=()):
    fake_content(monkeypatch, read=read)
    world = service.load_world(TARGET, '요청', None)
    world.manuscript = list(manuscript)
    return world, service.character_view(plan, world, scene or service.new_scene(plan), world.characters[actor])


def test_character_input_holds_only_that_characters_documents_up_to_the_base_episode(monkeypatch):
    fake_novelbrain(monkeypatch)
    scene = scene_of(PLAN_IF, ('narration', {'observed': '밤비가 성문 앞에 내리고 있다.'}), ('character', {'observed': '카엘이 북문 앞에서 막아섰다.'}))
    _, (kael, _, _) = view(monkeypatch, scene=service.new_scene(PLAN_IF))
    _, (lina, extra, _) = view(monkeypatch, actor=LINA, scene=scene)
    kael, lina = text(kael), text(lina)
    # 카엘: 자기 문서(기준 회차 이하)와 자기가 끝점인 활성 관계(부정 관계는 '아님'으로)만.
    assert all(mark in kael for mark in ('KAEL-IDENTITY', 'KAEL-SOUL', 'KAEL-MEMORY', 'KAEL-EP2', '경계', '친구 아님', 'REL-KAEL-GATE'))
    assert not any(mark in kael for mark in ('LINA-', 'KAEL-EP5-FUTURE', 'REMOVED', 'REL-LINA-GATE', 'REL-REMOVED'))
    # 기준 회차에 아직 공개되지 않은 카드와의 관계는 아는지 확인할 수 없어 관계 문장에도 상대 제목이 드러나지 않게 뺀다.
    assert not any(mark in kael for mark in ('REL-SHADOW', '그림자 길드', 'SHADOW'))
    # 리나: 카엘의 문서는 없고 장면에는 카엘이 드러낸 행동과 나레이션이 알린 것만 있다.
    assert all(mark in lina for mark in ('LINA-IDENTITY', 'LINA-SOUL', 'LINA-MEMORY-SECRET', 'LINA-EP3', 'REL-LINA-GATE'))
    assert not any(mark in lina for mark in ('KAEL-IDENTITY', 'KAEL-SOUL', 'KAEL-MEMORY', 'KAEL-EP'))
    assert '카엘이 북문 앞에서 막아섰다.' in lina and '밤비가 성문 앞에 내리고 있다.' in lina
    assert set(service.character_view.__annotations__) >= {'plan', 'world', 'scene', 'actor'}  # 이전 인물의 입력·대화 상태를 받는 칸이 없다


def test_real_novelbrain_filter_keeps_other_characters_private_documents_out_of_the_input(monkeypatch):
    _, (kael, _, evidence) = view(monkeypatch)  # 실제 recall(3단계 시점·인물 필터)
    assert not any(mark in text(kael) for mark in ('LINA-SOUL', 'LINA-MEMORY-SECRET', 'LINA-EP3', 'KAEL-EP5-FUTURE'))
    assert evidence and not any(e.ref.split('#')[-1] in ('soul', 'memory', 'ep03') and f'{LINA}' in e.ref for e in evidence)


def test_input_uses_novelbrain_refs_and_lists_each_ref_once(monkeypatch):
    fake_novelbrain(monkeypatch, items=[recalled(ref=f'card:{KAEL}#soul', source='bm25', text='KAEL-SOUL 말이 짧고 퉁명스러운 반말')])
    _, (asked, _, evidence) = view(monkeypatch)
    refs = [d['ref'] for d in asked['known']]
    assert {f'card:{KAEL}#identity', f'card:{KAEL}#soul', f'card:{KAEL}#memory', f'card:{KAEL}#ep02', f'relation:{REL}'} <= set(refs)
    assert len(refs) == len(set(refs))  # 조회 결과가 이미 입력에 든 문서면 겹쳐 넣지 않는다
    assert [e.ref for e in evidence] == [f'card:{KAEL}#soul']  # 근거 기록에는 조회한 그대로 남는다


def test_character_sees_only_the_current_beat_never_the_later_ones(monkeypatch):
    fake_novelbrain(monkeypatch)
    _, (asked, _, _) = view(monkeypatch, plan=PLAN_FLOW)
    assert 'B0-NOW' in text(asked['direction']) and 'B1-FUTURE' not in text(asked)


def test_each_view_recalls_for_its_own_viewpoint_for_the_base_episode(monkeypatch):
    recall = fake_novelbrain(monkeypatch)
    excerpt = Excerpt(id='m1', episode=2, quote='원고 발췌')
    world, (asked, _, _) = view(monkeypatch, manuscript=[excerpt])
    service.narrator_view(PLAN_IF, world, service.new_scene(PLAN_IF))
    mine, narrator = recall
    assert (mine['character_id'], mine['stage'], mine['episode']) == (KAEL, 3, EPISODE) and mine['manuscript'] == [excerpt]
    assert (mine['world'].worldId, mine['world'].episode) == (WORLD, EPISODE) and 'IF-PREMISE' in mine['query']
    assert 'GATE-LORE 북문은 밤에 닫힌다' in text(asked['known'])  # 조회 결과가 그 인물의 입력에 들어간다
    assert (narrator['character_id'], narrator['stage'], narrator['episode']) == (None, 2, EPISODE)  # 전지적: 인물 시점 필터 없이 2단계


def test_the_checker_gets_other_characters_secrets_and_the_characters_future_as_forbidden(monkeypatch):
    fake_novelbrain(monkeypatch)
    _, (kael, kael_extra, _) = view(monkeypatch)
    _, (lina, lina_extra, _) = view(monkeypatch, actor=LINA)
    assert all(mark in text(kael_extra['forbidden']) for mark in ('LINA-MEMORY-SECRET', 'LINA-EP3', 'KAEL-EP5-FUTURE'))
    assert 'KAEL-SOUL' not in text(kael_extra['forbidden'])  # SOUL은 말투 자료라 금지 목록이 아니다
    assert 'LINA-SOUL' in text(kael_extra['voices']) and 'KAEL-SOUL' in text(lina_extra['voices'])
    assert all(mark in text(lina_extra['forbidden']) for mark in ('KAEL-MEMORY', 'KAEL-EP2', 'KAEL-EP5-FUTURE'))
    assert 'forbidden' not in kael and 'voices' not in kael  # 인물에게는 금지 목록이 가지 않는다


def test_the_narrator_gets_the_world_up_to_the_base_episode_with_style_cards_and_future_as_forbidden(monkeypatch):
    recall = fake_novelbrain(monkeypatch)
    fake_content(monkeypatch, read=NARRATOR_WORLD)
    world = service.load_world(TARGET, '요청', None)
    asked, extra, _ = service.narrator_view(PLAN_IF, world, service.new_scene(PLAN_IF))
    ids = {c.id for c in recall[0]['world'].cards}
    assert {KAEL, LINA, GATE} <= ids and not ({STYLE, PERSONA, SHADOW} & ids)  # 문체 카드·미공개 카드는 스냅샷에 없다
    assert all(5 not in c.episodes for c in recall[0]['world'].cards) and 3 in next(c for c in recall[0]['world'].cards if c.id == LINA).episodes
    assert all(mark in text(extra['forbidden']) for mark in ('KAEL-EP5-FUTURE', 'SHADOW-GUILD'))
    assert not any(mark in text(extra['forbidden']) for mark in ('LINA-MEMORY-SECRET', 'KAEL-MEMORY')) and extra['voices'] == []
    assert asked['self'] == {'id': None, 'name': '나레이션'} and asked['present'] == ['카엘', '리나']
    # 문체 지침: 제목이 '나레이터'로 시작하는 카드는 유형과 상관없이 쓰고 인물 카드면 IDENTITY와 SOUL을 함께 쓴다.
    given = service.narration_input(PLAN_IF, world, service.new_scene(PLAN_IF), 'opening', 'omniscient')
    assert all(mark in text(given['style']) for mark in ('STYLE-GUIDE', 'PERSONA-ID', 'PERSONA-SOUL'))
    assert given['pov'] == {'kind': 'omniscient', 'character': None} and given['plan']['premise'] == PLAN_IF.premise and given['notes'] == []


def test_the_narrator_reads_only_manuscript_excerpts_up_to_the_base_episode(monkeypatch):
    recall = fake_novelbrain(monkeypatch)
    excerpts = [Excerpt(id='m', episode=2, quote='원고', kind='manuscript'), Excerpt(id='late', episode=4, quote='뒤 회차', kind='manuscript'),
                Excerpt(id='s', episode=2, quote='설정', kind='setting')]
    fake_content(monkeypatch)
    world = service.load_world(TARGET, '요청', None)
    world.manuscript = excerpts
    service.narrator_view(PLAN_IF, world, service.new_scene(PLAN_IF))
    assert [e.id for e in recall[0]['manuscript']] == ['m']


def test_only_an_omniscient_narration_gets_the_beats_after_the_current_one():
    """독백·3인칭 제한·1인칭 서술은 아직 오지 않은 비트를 모른다(인물의 입력이 지금 비트만 받는 것과 같다). 전지적 서술만 계획 전체를 본다."""
    fake = type('World', (), {'characters': {KAEL: type('C', (), {'title': '카엘'})()}, 'style': []})()
    plan = SimulationPlan(mode='flow', characterIds=[KAEL, LINA], beats=['B0-PAST', 'B1-NOW', 'B2-FUTURE'])
    scene = scene_of(plan, ('narration', {}), ('character', {'beat': 0, 'done': True}))  # 첫 비트가 끝나 지금은 B1

    def beats(pov, purpose='scene', scene=scene):
        return [b['text'] for b in service.narration_input(plan, fake, scene, purpose, pov)['plan']['beats']]

    assert beats('omniscient') == ['B0-PAST', 'B1-NOW', 'B2-FUTURE']
    assert beats(f'limited:{KAEL}') == beats(f'first:{KAEL}') == beats(f'limited:{KAEL}', 'monologue') == ['B0-PAST', 'B1-NOW']
    assert 'B2-FUTURE' not in text(service.narration_input(plan, fake, scene, 'monologue', f'first:{KAEL}'))
    finished = scene_of(plan, ('narration', {}), *[('character', {'beat': n, 'done': True}) for n in range(3)])  # 모든 비트가 끝나면 미래가 없다
    assert beats(f'limited:{KAEL}', scene=finished) == ['B0-PAST', 'B1-NOW', 'B2-FUTURE']
    assert service.narration_input(PLAN_IF, fake, service.new_scene(PLAN_IF), 'scene', f'limited:{KAEL}')['plan']['beats'] == []  # IF 모드엔 비트가 없다


def test_narration_input_names_the_point_of_view_character_and_the_checks_follow_the_view():
    fake = type('World', (), {'characters': {KAEL: type('C', (), {'title': '카엘'})()}, 'style': []})()
    given = service.narration_input(PLAN_FLOW, fake, scene_of(PLAN_FLOW, ('narration', {})), 'monologue', f'first:{KAEL}')
    assert given['pov'] == {'kind': 'first', 'character': '카엘'} and [b['text'] for b in given['plan']['beats']] == PLAN_FLOW.beats[:1]  # 지금 비트까지만
    assert service.check_kinds(PLAN_IF, 'character', 'omniscient') == ['knowledge_leak', 'voice_mix', 'relation', 'premise']
    assert service.check_kinds(PLAN_FLOW, 'character', 'omniscient')[-1] == 'beat'
    assert service.check_kinds(PLAN_IF, 'narration', 'omniscient') == service.check_kinds(PLAN_IF, 'narration', f'limited:{KAEL}') == ['knowledge_leak']
    assert service.check_kinds(PLAN_IF, 'narration', f'first:{KAEL}') == service.check_kinds(PLAN_IF, 'monologue', f'limited:{KAEL}') == ['knowledge_leak', 'voice_mix']
