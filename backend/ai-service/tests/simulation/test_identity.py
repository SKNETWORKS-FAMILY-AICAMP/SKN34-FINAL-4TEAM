"""「동일 인물」(#485): 다른 이름 카드 → 본체 카드. 고른 카드의 이름으로 연기하고 SOUL·GOAL·회차 기억은 본체의 것이며,
같은 사람의 두 카드는 함께 고를 수 없다. 관계를 기록하지 않은 두 카드는 두 사람이다."""

import pytest

from app.simulation import service
from app.simulation.errors import SimulationFailure
from app.simulation.models import PlanDraft, SimulationPlan

from .stubs import (EPISODE, GATE, KAEL, LINA, READ, TARGET, action, card, fake_content, fake_novelbrain, narration, relation, run_auto,
                    speech, staged, text, verdict)

MASK, BODY, MASK2, I1, I2, REL_KM, REL_BL, VOICE = (f'00000000-0000-0000-0000-{n:012d}' for n in (101, 102, 103, 104, 105, 106, 107, 108))


def identity(id, source, target, polarity='asserted', direction='directed'):
    return {**relation(id, source, target, '동일 인물', '', direction=direction, polarity=polarity), 'category': 'identity'}


PEOPLE = [
    card(MASK, '승상', 'MASK-IDENTITY 왕을 보좌하는 재상'),
    card(BODY, '홍길동', 'BODY-IDENTITY 사실은 도적의 우두머리', docs={
        'soul': 'BODY-SOUL 낮고 느린 하오체', 'goal': 'BODY-GOAL 정체를 숨기고 왕을 감시한다',
        'episodes': {'1': 'BODY-EP1 승상으로 입궐했다', '5': 'BODY-EP5-FUTURE 정체가 드러난다'}}),
]
SOCIAL = [relation(REL_KM, KAEL, MASK, '상관', 'REL-KAEL-MASK 카엘의 상관이다'),
          relation(REL_BL, BODY, LINA, '동료', 'REL-BODY-LINA 길동은 리나와 같은 첩자다')]


def world(*links, people=PEOPLE):
    return {**READ, 'cards': [*READ['cards'], *people], 'relationships': [*READ['relationships'], *SOCIAL, *links]}


DUAL = world(identity(I1, MASK, BODY))
PLAN = SimulationPlan(mode='if', premise='IF-PREMISE 만약 승상이 카엘을 불렀다면?', characterIds=[MASK, KAEL])


def view(monkeypatch, read=DUAL, plan=PLAN, actor=MASK):
    fake_content(monkeypatch, read=read)
    loaded = service.load_world(TARGET, '요청', None)
    return loaded, service.character_view(plan, loaded, service.new_scene(plan), loaded.characters[actor])


# --- 읽기: 「동일 인물」만 최신 시점으로 한 번 더 -----------------------------------------------------------------------

def test_identity_is_read_once_more_at_the_latest_episode_and_kept_apart_from_the_base_episode_relations(monkeypatch):
    base = world(identity('old-identity', MASK, BODY))                       # 기준 회차(3화)까지 이어 둔 것
    latest = world(identity(I2, MASK2, BODY), relation('later', KAEL, LINA, '뒤 회차 관계', ''))   # 최신: 달라진 identity와 뒤 회차에만 있는 관계
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        if tool == 'world_studio_list':
            return [{'worldId': base['worldId'], 'linkedWorkId': 'work'}]
        return base if arguments.get('episode') else latest

    monkeypatch.setattr(service.content_mcp, 'call', call)
    read = service.read_world('work', EPISODE)
    # 스냅샷이 읽는 관계는 기준 회차 시점 그대로다(뒤 회차의 관계도 최신 identity도 섞이지 않는다). 최신 identity는 따로 identity에 담긴다.
    assert read['relationships'] == base['relationships']
    assert [r['id'] for r in read['identity']] == [I2]
    assert [(tool, args.get('episode')) for tool, args in calls] == [('world_studio_list', None), ('world_studio_read', str(EPISODE)), ('world_studio_read', None)]


def test_the_narrator_and_recall_see_only_the_base_episode_relations_while_the_latest_identity_only_groups_the_cards(monkeypatch):
    # 카드가 둘뿐이라 정체 관계가 있으면 나레이터 조회(상위 8개) 안에 반드시 들어온다.
    small = {**READ, 'cards': PEOPLE}
    base, latest = {**small, 'relationships': []}, {**small, 'relationships': [identity(I1, MASK, BODY)]}   # 기준 회차(3화)에는 없고 최신 시점에만 있다
    solo = SimulationPlan(mode='if', premise='IF-PREMISE 승상이 홍길동을 부른다면?', characterIds=[MASK])

    def call(tool, arguments):
        if tool == 'world_studio_list':
            return [{'worldId': base['worldId'], 'linkedWorkId': 'work'}]
        return base if arguments.get('episode') else latest

    monkeypatch.setattr(service.content_mcp, 'call', call)
    loaded = service.load_world(TARGET, '요청', None)
    assert loaded.bodies == {MASK: BODY}                                     # 한 사람으로 묶는 데는 쓴다
    assert not [r for r in loaded.snapshot.relations if r.category == 'identity']   # 조회용 스냅샷에는 기준 회차 시점 관계뿐이다
    asked, extra, _ = service.narrator_view(solo, loaded, service.new_scene(solo))  # 전지적 나레이터도 기준 회차 뒤의 정체를 읽지 못한다
    assert f'relation:{I1}' not in text(asked) + text(extra) and '동일 인물' not in text(asked) + text(extra)


def test_a_fork_groups_the_cards_by_the_identity_of_the_inherited_world_it_reads_only_once(monkeypatch):
    from .stubs import INHERITED
    inherited = {**INHERITED, 'relationships': [*INHERITED['relationships'], identity(I1, KAEL, LINA)]}
    calls = fake_content(monkeypatch, worlds=[], inherited=inherited)
    read = service.read_world('work', EPISODE)
    assert [r['id'] for r in read['identity']] == [I1] and read['relationships'] == inherited['relationships']
    assert service.load_world(TARGET, '요청', None).bodies == {KAEL: LINA}
    assert [tool for tool, _ in calls].count('work_inherited_world') == 2 and 'world_studio_read' not in [tool for tool, _ in calls]


def test_a_fork_reads_the_inherited_world_only_once(monkeypatch):
    from .stubs import INHERITED
    calls = fake_content(monkeypatch, worlds=[], inherited=INHERITED)
    service.read_world('work', EPISODE)
    assert [tool for tool, _ in calls] == ['world_studio_list', 'work_inherited_world']


def test_an_identity_relation_that_touches_a_narrator_style_card_is_ignored_instead_of_failing_the_world(monkeypatch):
    # 제목이 '나레이터'로 시작하는 카드는 유형과 상관없이 문체 지침이라 인물이 아니다: 거기 닿는 identity는 없던 것으로 보고 세계관을 409로 막지 않는다.
    voice = card(VOICE, '나레이터 문체', 'NARRATOR-STYLE 담담한 3인칭')
    fake_content(monkeypatch, read=world(identity(I1, VOICE, BODY), identity(I2, MASK, BODY), people=[*PEOPLE, voice]))
    loaded = service.load_world(TARGET, '요청', None)
    assert loaded.bodies == {MASK: BODY} and VOICE not in loaded.characters   # 나레이터 카드에 닿은 것만 빠지고 나머지 묶음은 그대로다


# --- 고른 카드의 이름으로, 본체의 문서로 ------------------------------------------------------------------------------------

def test_the_other_name_card_acts_under_its_own_name_with_the_bodys_soul_goal_and_memories_up_to_the_base_episode(monkeypatch):
    fake_novelbrain(monkeypatch)
    _, (asked, extra, _) = view(monkeypatch)
    assert asked['self'] == {'id': MASK, 'name': '승상'}
    mine = text(asked['known'])
    assert all(mark in mine for mark in ('BODY-IDENTITY', 'MASK-IDENTITY', 'BODY-SOUL', 'BODY-GOAL', 'BODY-EP1'))
    refs = [d['ref'] for d in asked['known']]
    assert refs.index(f'card:{BODY}#identity') < refs.index(f'card:{MASK}#identity')   # 본체 IDENTITY에 가면 IDENTITY를 더한다
    assert 'BODY-EP5-FUTURE' not in mine                                    # 기준 회차 뒤의 기억은 본체의 것이어도 모른다
    assert 'BODY-EP5-FUTURE' in text(extra['forbidden'])                      # 검사는 그것을 금지 목록으로 본다
    assert asked['present'] == ['승상', '카엘']


def test_the_person_keeps_the_relations_of_both_cards_but_not_the_identity_relation_itself(monkeypatch):
    fake_novelbrain(monkeypatch)
    _, (asked, _, _) = view(monkeypatch)
    mine = text(asked['known'])
    assert 'REL-KAEL-MASK' in mine and 'REL-BODY-LINA' in mine               # 두 카드에 이어진 관계는 모두 그 사람의 관계다
    assert f'relation:{I1}' not in mine                                      # 두 카드 사이의 identity 관계 자체는 관계 문서로 넣지 않는다


def test_choosing_the_body_card_uses_the_body_documents_only_and_the_relations_of_both_cards(monkeypatch):
    fake_novelbrain(monkeypatch)
    plan = SimulationPlan(mode='if', premise='IF-PREMISE', characterIds=[BODY, KAEL])
    _, (asked, _, _) = view(monkeypatch, plan=plan, actor=BODY)
    mine = text(asked['known'])
    assert asked['self'] == {'id': BODY, 'name': '홍길동'} and asked['present'] == ['홍길동', '카엘']
    assert all(mark in mine for mark in ('BODY-IDENTITY', 'BODY-SOUL', 'BODY-GOAL', 'BODY-EP1', 'REL-KAEL-MASK', 'REL-BODY-LINA'))
    assert 'MASK-IDENTITY' not in mine                                       # 본체 카드를 고르면 본체 문서만 쓴다(가면 카드 IDENTITY를 더하지 않는다)


def test_only_the_chosen_mask_adds_its_identity_never_another_mask_of_the_same_body(monkeypatch):
    fake_novelbrain(monkeypatch)
    read = world(identity(I1, MASK, BODY), identity(I2, MASK2, BODY), people=[*PEOPLE, card(MASK2, '재상', 'MASK2-IDENTITY 다른 가면')])
    _, (asked, _, _) = view(monkeypatch, read=read)
    mine = text(asked['known'])
    assert 'MASK-IDENTITY' in mine and 'BODY-IDENTITY' in mine and 'MASK2-IDENTITY' not in mine


# --- 둘을 함께 고를 수 없다 --------------------------------------------------------------------------------------------------

@pytest.mark.parametrize('ids', [[MASK, BODY], [BODY, KAEL, MASK], [MASK, MASK2]])
def test_two_cards_of_one_person_cannot_be_picked_together(monkeypatch, ids):
    read = world(identity(I1, MASK, BODY), identity(I2, MASK2, BODY), people=[*PEOPLE, card(MASK2, '재상', 'MASK2-IDENTITY')])
    fake_content(monkeypatch, read=read)
    form = SimulationPlan(mode='if', premise='전제', characterIds=ids)
    with pytest.raises(SimulationFailure) as error:
        service.plan_from_form(form, TARGET)
    assert error.value.status == 422 and '같은 인물' in str(error.value)
    with pytest.raises(SimulationFailure) as again:                        # 요청마다 세계관을 다시 읽으니 그 사이 이어졌을 수도 있다
        service.check_plan(form, service.load_world(TARGET, '요청', None))
    assert again.value.status == 422 and '같은 인물' in str(again.value)
    monkeypatch.setattr(service.agent, 'plan', lambda *args: PlanDraft(mode='if', premise='전제', beats=[], characterIds=ids))
    with pytest.raises(SimulationFailure) as planned:                      # 모델이 둘을 함께 골라도 고쳐 쓰지 않고 거절한다
        service.plan('요청', [], TARGET)
    assert planned.value.status == 422 and '같은 인물' in str(planned.value)


def test_one_person_next_to_other_people_and_two_other_names_of_different_people_are_fine(monkeypatch):
    read = world(identity(I1, MASK, BODY), identity(I2, MASK2, KAEL), people=[*PEOPLE, card(MASK2, '재상', 'MASK2-IDENTITY')])
    fake_content(monkeypatch, read=read)
    form = SimulationPlan(mode='if', premise='전제', characterIds=[MASK, MASK2, LINA])
    assert service.plan_from_form(form, TARGET) == form


# --- 다른 인물에게 고르지 않은 쪽 이름이 새지 않는다 ---------------------------------------------------------------------------

def test_other_characters_never_get_the_unchosen_cards_name_or_documents(monkeypatch):
    _, (asked, extra, _) = view(monkeypatch, actor=KAEL)                      # 실제 recall(인물 시점 필터)
    for payload in (asked, extra):
        assert '홍길동' not in text(payload) and 'BODY-' not in text(payload.get('known', payload.get('others', [])))
    assert asked['present'] == ['승상', '카엘'] and [o['name'] for o in extra['others']] == ['승상']
    assert 'MASK-IDENTITY' in text(extra['others']) and 'BODY-IDENTITY' not in text(extra['others'])


def test_a_whole_scene_names_only_the_chosen_card_and_the_other_character_hears_nothing_of_the_body(monkeypatch):
    h = staged(monkeypatch, speech(MASK, f'limited:{MASK}'), speech(KAEL, f'limited:{KAEL}'),
               verdicts=lambda payload: verdict(payload, scene_complete=len(h.calls.act) == 2))
    fake_content(monkeypatch, read=DUAL)
    scene = run_auto(PLAN)
    assert [(t.characterName, t.characterId) for t in scene.result.turns if t.kind == 'character'] == [('승상', MASK), ('카엘', KAEL)]
    mask_turn, kael_turn = h.calls.act
    assert all(mark in text(mask_turn['known']) for mark in ('BODY-SOUL', 'BODY-GOAL'))
    assert '홍길동' not in text(kael_turn) and 'BODY-' not in text(kael_turn)
    assert '승상' in text(kael_turn['scene'])                                  # 카엘이 보는 장면 줄의 화자는 승상이다
    kael_check = [c for c in h.calls.check if c['self']['id'] == KAEL]
    assert kael_check and all('홍길동' not in text(c) for c in kael_check)


# --- 기록하지 않은 두 카드는 두 사람 -------------------------------------------------------------------------------------------

def test_two_cards_without_an_identity_relation_are_two_people(monkeypatch):
    fake_novelbrain(monkeypatch)
    plan = SimulationPlan(mode='if', premise='IF-PREMISE', characterIds=[MASK, BODY])
    loaded, (asked, _, _) = view(monkeypatch, read=world(), plan=plan)
    assert service.plan_from_form(plan, TARGET) == plan
    assert asked['present'] == ['승상', '홍길동'] and 'BODY-SOUL' not in text(asked['known']) and 'BODY-IDENTITY' not in text(asked['known'])
    assert loaded.characters[MASK].soul == '' and loaded.characters[BODY].soul.startswith('BODY-SOUL')


def test_a_denied_identity_relation_is_not_a_link(monkeypatch):
    plan = SimulationPlan(mode='if', premise='전제', characterIds=[MASK, BODY])
    fake_content(monkeypatch, read=world(identity(I1, MASK, BODY, polarity='denied')))
    assert service.plan_from_form(plan, TARGET) == plan


# --- 어긋난 응답은 숨기지 않고 멈춘다 ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize('links', [
    [identity(I1, MASK, BODY), identity(I2, BODY, KAEL)],                  # 본체가 다시 다른 이름이다(사슬)
    [identity(I1, MASK, BODY), identity(I2, BODY, MASK)],                  # 순환
    [identity(I1, MASK, BODY), identity(I2, MASK, KAEL)],                  # 다른 이름 카드에 본체가 둘
    [identity(I1, MASK, GATE)],                                            # 인물이 아닌 카드
    [identity(I1, MASK, BODY, direction='symmetric')],                     # 어느 쪽이 본체인지 알 수 없다
], ids=['chain', 'cycle', 'two-bodies', 'not-a-character', 'undirected'])
def test_identity_data_the_server_would_not_have_saved_stops_the_run_with_a_clear_error(monkeypatch, links):
    fake_content(monkeypatch, read=world(*links))
    with pytest.raises(SimulationFailure) as error:
        service.load_world(TARGET, '요청', None)
    assert error.value.status == 409 and '동일 인물' in str(error.value)
