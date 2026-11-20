"""평가 세계관·표본·장면 입력의 단위 테스트: 합성 TimeChara 행과 저장소의 한국어 시연 세계관(홍길동전)을 쓴다. 호출·내려받기가 없다."""

import json

import pytest

import hp_build as hb
import sim_worlds as w
from app.simulation import service
from app.simulation.errors import SimulationFailure
from timechara import parse_tables

UTILS = """
character_period_harry_potter = {"at the end of the scene": ['1-17', '2-18', '3-22', '4-37', '5-38', '6-30', '7-36']}
character_period_the_lord_of_the_rings = {}
character_period_twilight = {}
character_period_hunger_games = {}
"""
HARRY, HERMIONE, RON = 'Harry Potter', 'Hermione Granger', 'Ronald Weasley'


def row(character=HARRY, period='3rd-year', qp='Book3-chapter19', summary='Harry met Sirius.', participants="['Harry Potter', 'Sirius Black']",
        data_type='past-presence', question='What did you do in the Shack?', gen='fact-structured'):
    return {'series': 'harry_potter', 'character': character, 'character_period': period, 'question_period': qp, 'event_summary': summary,
            'participants': participants, 'question_generation': gen, 'data_type': data_type, 'question': question,
            'temporal_label': 't', 'spatial_label': 's'}


ROWS = [dict(r, idx=i) for i, r in enumerate([
    row(),
    row(qp='Book5-chapter2', summary='Harry fought Umbridge.', participants="['Harry Potter']", data_type='future', question='Who is Umbridge?'),
    row(character=HERMIONE, period='1st-year', qp='Book1-chapter9', summary='Hermione met Ron.', participants="['Hermione Granger', 'Ronald Weasley']"),
    row(character=RON, period='5th-year', qp='Book4-chapter3', summary='Ron went to the match.', participants="['Ronald Weasley', 'Harry Potter']"),
])]


@pytest.fixture
def worlds():
    return w.Worlds(ROWS, parse_tables(UTILS))


def test_a_series_world_is_built_from_every_row_of_that_series_and_numbers_chapters_in_story_order(worlds):
    world, ordinals = worlds.series('harry_potter')
    assert [t for t, _ in sorted(ordinals.items(), key=lambda kv: kv[1])] == sorted(ordinals)  # 장 번호는 이야기 순서
    assert {(3, 22), (1, 17), (3, 19), (5, 2), (5, 38)} <= set(ordinals)  # 질문 시점과 인물 시점(기준 장)이 모두 번호를 받는다
    assert {c.title for c in world['cards'] if c.cardType == 'character'} >= {'Harry', 'Hermione', 'Ron'}  # 카드 제목은 본문이 쓰는 이름


def test_a_time_chara_world_is_a_service_world_with_no_manuscript_and_only_relations_up_to_the_episode(worlds):
    data, ordinals = worlds.series('harry_potter')
    early, late = w.tc_world(data, ordinals[(1, 17)]), w.tc_world(data, ordinals[(5, 38)])
    assert isinstance(early, service.World) and early.manuscript == [] and early.notice is None and early.read == {} and early.bodies == {}
    assert len(early.snapshot.cards) == len(late.snapshot.cards) and len(early.snapshot.relations) < len(late.snapshot.relations)
    assert set(early.characters) == {c.id for c in early.snapshot.cards if c.cardType == 'character'}


def test_an_interview_is_the_question_asked_to_that_character_at_that_point_of_the_story(worlds):
    plan, world, actor, scene = worlds.interview(ROWS[0])
    assert (plan.mode, plan.characterIds, actor.id) == ('if', [actor.id], worlds.series('harry_potter')[0]['character_id'][HARRY])
    assert [(t.characterName, t.prose) for t in scene.result.turns] == [('Interviewer', 'What did you do in the Shack?')]
    asked, extra, _ = service.character_view(plan, world, scene, actor)  # 운영이 인물 턴 입력을 만드는 그 함수
    assert asked['scene'] == [{'ref': 'scene:0', 'by': 'Interviewer', 'text': 'What did you do in the Shack?'}] and asked['self']['id'] == actor.id
    shown, hidden = json.dumps(asked), json.dumps(extra['forbidden'])
    assert 'Harry met Sirius.' in shown and 'Umbridge' not in shown  # 3학년 시점이라 5권의 일은 모른다
    assert 'Umbridge' in hidden  # 검사 모델에는 기준 회차 뒤 기억이 금지 목록으로 간다


def test_the_character_is_looked_up_by_the_name_the_question_uses(worlds):
    names = [worlds.interview(r)[2].title for r in ROWS]
    assert names == ['Harry', 'Harry', 'Hermione', 'Ron']


def test_the_sample_is_fixed_by_type_and_seed(monkeypatch, tmp_path):
    rows = [dict(row(data_type=t, question=f'q{i}'), character=HARRY) for t in ('future', 'past-only', 'past-absence', 'past-presence') for i in range(30)]
    fetched = []

    def fetch(url, dest, token=None):
        fetched.append((url.rsplit('/', 1)[-1], bool(token)))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(rows) if dest.name == 'valid.json' else 'x')
        return dest

    monkeypatch.setattr(w, 'DATA', tmp_path)
    monkeypatch.setattr(w, 'TC', tmp_path / 'timechara')
    monkeypatch.setattr(w.nb_prepare, 'fetch', fetch)
    monkeypatch.setattr(w.nb_prepare, 'hf_token', lambda: 'token')
    w.prepare(per_type=5)
    first = json.loads((tmp_path / 'sample.json').read_text())
    w.prepare(per_type=5)
    assert json.loads((tmp_path / 'sample.json').read_text()) == first  # 다시 해도 같은 표본
    kinds = [rows[i]['data_type'] for i in first['idx']]
    assert (first['seed'], first['perType'], len(first['idx'])) == (w.SEED, 5, 20) and all(kinds.count(t) == 5 for t in set(kinds))
    assert ('valid.json', True) in fetched and ('harry_potter_personality.txt', False) in fetched  # 검증 세트만 토큰으로 받는다


def test_the_korean_world_comes_from_the_committed_demo_data_through_the_same_loader_as_production():
    world, ids = w.korean_world(5)
    assert world.episode == 5 and {'홍길동', '길현', '춘섬'} <= {c.title for c in world.characters.values()}
    assert ids['gildong'] in world.characters and ids['gilhyeon'] in world.characters and world.manuscript == []
    assert all(c.revealFromEpisode is None or isinstance(c.revealFromEpisode, int) for c in world.snapshot.cards)


def test_the_fixed_scene_list_is_eight_harry_potter_and_two_korean_scenes_in_both_modes():
    ids = [s['id'] for s in w.SCENES]
    assert len(ids) == len(set(ids)) == 10 and [i[:3] for i in ids].count('hp-') == 8 and [i[:3] for i in ids].count('ko-') == 2
    for world in ('harry_potter', 'ko'):
        mine = [s for s in w.SCENES if s['world'] == world]
        assert {s['mode'] for s in mine} == {'if', 'flow'}
    assert all(2 <= len(s['cast']) <= 3 and (s.get('premise') if s['mode'] == 'if' else s.get('beats')) for s in w.SCENES)
    assert len({tuple(s['cast']) for s in w.SCENES if s['world'] == 'harry_potter'}) >= 3  # 인물 구성이 섞여 있다


def test_the_korean_flow_beats_are_the_demo_scene_plans_of_the_dataset():
    plans = json.loads((w.DEMO / 'honggildong/plans.json').read_text(encoding='utf-8'))['scenes']
    beats = next(s['beats'] for s in w.SCENES if s['id'] == 'ko-5-flow')
    assert beats == [p['content'] for p in plans[:2]]


@pytest.mark.parametrize('spec', [s for s in w.SCENES if s['world'] == 'ko'], ids=lambda s: s['id'])
def test_korean_scenes_become_plans_the_production_check_accepts(spec):
    plan, world = w.Worlds([], {}).scene(spec)
    service.check_plan(plan, world)
    assert (plan.mode, len(plan.characterIds), world.episode) == (spec['mode'], len(spec['cast']), spec['episode'])


def test_harry_potter_scenes_end_at_their_book_and_name_cast_by_the_names_in_the_data(worlds):
    spec = {'id': 'hp-x', 'world': 'harry_potter', 'book': 3, 'mode': 'if', 'cast': [HARRY, RON], 'premise': '만약?'}
    plan, world = worlds.scene(spec)
    assert world.episode == max(o for t, o in worlds.series('harry_potter')[1].items() if t[0] <= 3)
    assert [world.characters[i].title for i in plan.characterIds] == ['Harry', 'Ron']
    with pytest.raises(ValueError, match='Nobody'):
        worlds.scene({**spec, 'cast': [HARRY, 'Nobody']})  # 데이터에 없는 이름은 짐작하지 않고 멈춘다


def hp_data():
    """합성 원문 세계관: 1화 해리, 2화(1권 17장)에 헤르미온느·론, 3화 = 3권 22장, 4화 = 5권 38장."""
    def who(name, **fields):
        return hb.Person(**{'name': name, 'aliases': [], 'looks': '', 'personality': '', 'speech': '', 'situation': '', 'wants': '', 'memory': '', **fields})

    def unit(book, chapter, ordinal, *people):
        return hb.Info(book, (chapter,), ordinal, hb.Extraction(events=[], people=list(people), things=[], relations=[]))

    infos = [unit(1, 1, 1, who('해리', situation='소년')), unit(1, 17, 2, who('해리'), who('헤르미온느', situation='똑똑한 아이'), who('론')), unit(3, 22, 3, who('해리')), unit(5, 38, 4, who('해리'))]
    english = {'해리': 'Harry Potter', '헤르미온느': 'Hermione Granger', '론': 'Ronald Weasley'}
    return hb.build_world(infos, hb.resolve_persons(infos, english.get), hb.resolve_settings(infos), {}, {(1, 1): 1, (1, 17): 2, (3, 22): 3, (5, 38): 4}, [])


def test_hp_episodes_number_the_chapters_across_books_and_chapter_zero_is_the_end_of_the_previous_book():
    data = hp_data()
    assert [w.hp_episode(data, 1, 17), w.hp_episode(data, 3, 22), w.hp_episode(data, 5, 38)] == [2, 3, 4]
    assert w.hp_episode(data, 3, 0) == 2 and w.hp_episode(data, 1, 0) == 0   # 3권이 시작하기 전 = 앞 권(이 데이터에는 1권)의 끝, 1권 앞은 0화


def test_the_original_text_world_carries_the_reveal_episodes_and_finds_people_by_english_name():
    data = hp_data()
    early, ids = w.hp_world(1, data)
    later, _ = w.hp_world(2, data)
    assert (early.episode, later.episode) == (1, 2) and early.manuscript == [] and set(ids) == {HARRY, HERMIONE, RON} and ids[HARRY] in early.characters
    reveal = {c.title: c.revealFromEpisode for c in early.snapshot.cards if c.cardType == 'character'}   # 누가 무엇을 아는지는 이 값을 읽는 운영의 NovelBrain 필터가 가린다
    assert reveal == {'해리': 1, '헤르미온느': 2, '론': 2}


def test_hp_interviews_ask_the_character_in_the_original_text_world_at_the_questions_cutoff():
    hp = w.Worlds(ROWS, parse_tables(UTILS), hp=hp_data())
    plan, world, actor, scene = hp.interview(ROWS[0])   # 해리 3학년 → 3권 22장 = 3화
    assert (actor.title, world.episode, plan.characterIds, [t.prose for t in scene.result.turns]) == ('해리', 3, [actor.id], ['What did you do in the Shack?'])
    assert [hp.interview(r)[2].title for r in (ROWS[2], ROWS[3])] == ['헤르미온느', '론']
    assert hp.hp_at(3) is hp.hp_at(3)   # 회차마다 한 번만 만든다


def test_an_interview_whose_character_has_no_card_at_that_point_is_a_404_failure_not_a_guess():
    data = hp_data()
    gone = dict(data, english={k: v for k, v in data['english'].items() if k != HERMIONE})
    with pytest.raises(SimulationFailure) as failure:
        w.Worlds(ROWS, parse_tables(UTILS), hp=gone).interview(ROWS[2])
    assert failure.value.status == 404


def test_hp_scenes_end_at_their_book_in_the_original_text_world_and_cast_by_english_name():
    hp = w.Worlds([], parse_tables(UTILS), hp=hp_data())
    spec = {'id': 'hp-x', 'world': 'harry_potter', 'book': 3, 'mode': 'if', 'cast': [HARRY, RON], 'premise': '만약?'}
    plan, world = hp.scene(spec)
    assert world.episode == 3 and [world.characters[i].title for i in plan.characterIds] == ['해리', '론']
    with pytest.raises(ValueError, match='Nobody'):
        hp.scene({**spec, 'cast': [HARRY, 'Nobody']})
    thin_plan, thin_world = w.Worlds(ROWS, parse_tables(UTILS)).scene(spec)   # hp가 없으면 얇은 세계관 그대로
    assert [thin_world.characters[i].title for i in thin_plan.characterIds] == ['Harry', 'Ron']
