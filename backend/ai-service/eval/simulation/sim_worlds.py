"""평가 세계관: TimeChara(영어)와 한국어 시연 세계관을 시뮬레이션이 읽는 `service.World`로 만들고 표본·장면을 고정한다.

원문·질문은 `eval/simulation/.data`(git 무시)에만 있다. TimeChara는 CC BY-NC 4.0(비상업 연구 한정)이라 저장소에 두지 않는다.
세계관 구성·시점 규칙·표본 추출은 `eval/novelbrain`(`timechara.py`)을 그대로 쓴다. 소설 청크(원고 발췌)는 쓰지 않아 세계관 카드·관계만 입력이 된다.
Content는 부르지 않는다: 세계관은 `SceneContext.loaded`에 넣는다.
"""

import ast
import importlib.util
import json
import re
import sys
import threading
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

import prepare as nb_prepare  # noqa: E402  eval/novelbrain/prepare.py
from timechara import build_world, chapter_tuple, common_names, cutoff, ordinal_map, parse_tables, sample_by_type, snapshot  # noqa: E402

import hp_chapters  # noqa: E402
from app.simulation import service  # noqa: E402
from app.simulation.errors import SimulationFailure  # noqa: E402
from app.simulation.models import Decision, SimulationPlan, Trail, Turn  # noqa: E402

DATA = Path(__file__).resolve().parent / '.data'
TC = DATA / 'timechara'
DEMO = Path(__file__).resolve().parents[4] / 'infrastructure/sample-data/simulation-demo'
HP_WORLD = DATA / 'hp' / 'world.json'   # 번역본 원문에서 만든 세계관(hp_build.py). 저작권 때문에 .data(git 무시)에만 둔다
SEED = 642   # 표본 고정용(이슈 번호). novelbrain의 58과 다른 표본이다
PER_TYPE = 50
PREMISE = 'An interviewer asks the character one question. The character answers it in their own voice, using only what they know at this point in the story.'

# 속도 성적표의 고정 장면 목록(해리 포터 8 + 한국어 2). cast는 TimeChara 데이터의 인물 이름(한국어 장면은 카드 key), book은 그 권 끝을 기준 회차로 한다.
HP = 'harry_potter'
THREE = ['Harry Potter', 'Ronald Weasley', 'Hermione Granger']
SCENES = (
    {'id': 'hp-1-if', 'world': HP, 'book': 1, 'mode': 'if', 'cast': THREE,
     'premise': "What if the three friends had told a teacher about the Philosopher's Stone before going after it themselves?"},
    {'id': 'hp-1-flow', 'world': HP, 'book': 1, 'mode': 'flow', 'cast': ['Harry Potter', 'Ronald Weasley'],
     'beats': ['Harry tells Ron what he saw in the Mirror of Erised and Ron listens uneasily.',
               'Ron admits he would want something for himself too, and they agree to keep it secret.']},
    {'id': 'hp-2-if', 'world': HP, 'book': 2, 'mode': 'if', 'cast': ['Harry Potter', 'Hermione Granger'],
     'premise': 'What if Harry had told Hermione about the voice in the walls as soon as he first heard it?'},
    {'id': 'hp-3-flow', 'world': HP, 'book': 3, 'mode': 'flow', 'cast': THREE,
     'beats': ['Ron and Hermione argue about the cat and the rat while Harry tries to stay out of it.', 'Harry says he is tired of the two of them fighting.',
               "The three agree to put the quarrel aside for Harry's sake."]},
    {'id': 'hp-3-if', 'world': HP, 'book': 3, 'mode': 'if', 'cast': ['Harry Potter', 'Ronald Weasley'],
     'premise': 'What if Harry had told Ron how badly the Dementors affected him on the train?'},
    {'id': 'hp-4-flow', 'world': HP, 'book': 4, 'mode': 'flow', 'cast': ['Harry Potter', 'Hermione Granger'],
     'beats': ["Hermione urges Harry to ask for help with the egg's clue.", 'Harry resists, then admits he is worried.']},
    {'id': 'hp-5-if', 'world': HP, 'book': 5, 'mode': 'if', 'cast': THREE,
     'premise': "What if the three had refused to join a secret defence group at the Hog's Head?"},
    {'id': 'hp-5-flow', 'world': HP, 'book': 5, 'mode': 'flow', 'cast': ['Harry Potter', 'Ronald Weasley'],
     'beats': ['Ron apologizes for staying distant from Harry.', 'Harry asks Ron to stand with him against the teacher who is silencing him.']},
    # 홍길동전 시연 세계관의 5화 장면 계획(honggildong/plans.json) 앞의 둘과, 같은 시점의 IF
    {'id': 'ko-5-flow', 'world': 'ko', 'episode': 5, 'mode': 'flow', 'cast': ['gilhyeon', 'gildong'],
     'beats': ['날이 밝아 오는 들판에서 길현이 홍길동을 따라잡아 불러 세운다. 그는 집으로 돌아가자고 설득한다.',
               '홍길동은 자신이 돌아가면 집안에 화가 미칠 것을 헤아려 정중히 거절한다. 길현은 다시 한번 길동을 붙잡는다.']},
    {'id': 'ko-5-if', 'world': 'ko', 'episode': 5, 'mode': 'if', 'cast': ['gildong', 'gilhyeon', 'chunseom'],
     'premise': '만약 홍길동이 길현의 설득을 받아들여 집으로 돌아갔다면?'},
)


def load_rows() -> list[dict]:
    """검증 600건. idx는 파일 안의 순서이고 표본·결과가 이 번호로 서로를 가리킨다."""
    return [dict(r, idx=i) for i, r in enumerate(json.loads((TC / 'valid.json').read_text()))]


def prepare(per_type: int = PER_TYPE) -> None:
    """검증 세트(HF gated: 약관 동의·로그인 필요)·공개 채점 프롬프트·성격 설명을 받고(받은 파일은 건너뜀) 표본을 고정한다. 소설 청크(Chroma)는 받지 않는다."""
    nb_prepare.fetch(nb_prepare.TIMECHARA_HF, TC / 'valid.json', token=nb_prepare.hf_token())
    for name in ('utils.py', 'data/spatiotemporal_consistency_evaluation_prompt.txt', 'data/personality_consistency_evaluation_prompt.txt'):
        nb_prepare.fetch(nb_prepare.TIMECHARA_GH + name, TC / name)
    rows = load_rows()
    for slug in sorted({r['character'].lower().replace(' ', '_') for r in rows}):
        nb_prepare.fetch(f'{nb_prepare.TIMECHARA_GH}data/personality/{slug}_personality.txt', TC / f'data/personality/{slug}_personality.txt')
    picked = sample_by_type(rows, per_type, SEED)
    DATA.mkdir(exist_ok=True)
    (DATA / 'sample.json').write_text(json.dumps({'seed': SEED, 'perType': per_type, 'idx': [r['idx'] for r in picked]}))
    print(f'timechara: 검증 {len(rows)}건, 표본 {len(picked)}건(유형마다 {per_type}) 고정', flush=True)


def tc_world(world: dict, episode: int) -> service.World:
    """TimeChara 세계관의 episode화 시점 `service.World`(Content 호출·원고 발췌 없음). 카드는 전부, 관계는 그 회차까지만(`timechara.snapshot`)이고
    인물이 무엇을 아는지는 운영과 같은 NovelBrain 필터가 가린다."""
    snap = snapshot(world, episode)
    return service.World(episode, {}, snap, [], {c.id: c for c in snap.cards if c.cardType == 'character'}, [], None, {})


def seed_module():
    """시연 세계관 적재 스크립트(seed.py)의 카드·관계 변환 함수들."""
    spec = importlib.util.spec_from_file_location('simulation_demo_seed', DEMO / 'seed.py')
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    # seed.py의 KINDS는 시연 세계관이 쓰는 다섯 유형뿐이다. 서버·화면(studioCards.ts cardTypeOf)은 조직·능력도 entity로 되읽으므로 같은 규칙으로 더한다(seed.py 파일은 그대로).
    seed.KINDS.update({'organization': ('entity', 'organization'), 'ability': ('entity', 'ability')})
    return seed


def _world_at(data: dict, episode: int) -> tuple[service.World, dict[str, str]]:
    """world.json의 episode화 시점 World와 카드 key → 카드 id. Content 읽기 응답과 같은 모양(seed.py가 적재하는 카드·그 회차의 관계)을 만들어 운영과 같은 `service.load_world`가 변환한다."""
    seed = seed_module()
    scope, keys = seed.scope_of(data), {c['key'] for c in data['cards']}
    read = {'worldId': data['world']['id'], 'cards': [seed.card_payload(c, scope, keys) for c in data['cards']],
            'relationships': seed.relations_at(data, episode), 'identity': []}
    real, service.read_world = service.read_world, lambda work_id, base: read
    try:
        world = service.load_world({'workId': 'eval', 'episode': episode}, '', None)
    finally:
        service.read_world = real
    return world, {key: seed.card_id(key, scope) for key in keys}


def korean_world(episode: int) -> tuple[service.World, dict[str, str]]:
    """홍길동전 시연 세계관(`honggildong/world.json`)의 episode화 시점 World와 카드 key → 카드 id."""
    return _world_at(json.loads((DEMO / 'honggildong/world.json').read_text(encoding='utf-8')), episode)


def load_hp() -> dict:
    """`hp_build.py`가 만든 해리 포터 세계관(world.json). 없으면 만들기부터 하라고 알린다."""
    if not HP_WORLD.exists():
        raise SystemExit('해리 포터 원문 세계관(.data/hp/world.json)이 없다: 먼저 sim_cli.py build-hp를 실행한다.')
    return json.loads(HP_WORLD.read_text(encoding='utf-8'))


def hp_episode(data: dict, book: int, chapter: int) -> int:
    """TimeChara의 (권, 장) 기준을 회차(7권의 모든 장을 이어 붙인 번호)로. 장 0(그 권이 시작하기 전)은 앞 권의 끝이고 1권 앞은 0화다."""
    ordinals = {tuple(map(int, key.split('-'))): n for key, n in data['ordinals'].items()}
    if chapter >= 1:
        return ordinals[(book, chapter)]
    return max((n for (b, _), n in ordinals.items() if b < book), default=0)


def hp_world(episode: int, data: dict | None = None) -> tuple[service.World, dict[str, str]]:
    """원문 기반 해리 포터 세계관의 episode화 시점 World와 영어 이름 → 카드 id(`korean_world`와 같은 방식)."""
    data = data or load_hp()
    world, ids = _world_at(data, episode)
    return world, {english: ids[key] for english, key in data['english'].items()}


def end_of_book(ordinals: dict, book: int) -> int:
    """그 권의 끝(그 권까지 나온 가장 뒤의 장)의 회차 번호."""
    return max(o for t, o in ordinals.items() if t[0] <= book)


class Worlds:
    """평가에 쓰는 세계관 묶음. 시리즈 세계관은 처음 쓸 때 검증 행 전체로 만들고 한국어 세계관은 장면마다 읽는다."""

    def __init__(self, rows: list[dict], tables: dict, hp: dict | None = None):
        """hp가 있으면 해리 포터 질문·장면은 TimeChara 행으로 만든 얇은 세계관 대신 그 원문 기반 세계관(hp_world)을 쓴다."""
        self.rows, self.tables, self.hp, self._series = rows, tables, hp, {}
        self._hp_worlds, self._hp_lock = {}, threading.Lock()

    @classmethod
    def load(cls, hp: bool = False) -> 'Worlds':
        return cls(load_rows(), parse_tables((TC / 'utils.py').read_text()), load_hp() if hp else None)

    def hp_at(self, episode: int) -> tuple[service.World, dict[str, str]]:
        """회차별로 한 번만 만든다(질문이 스레드로 돌아도 같은 세계관을 동시에 만들지 않는다)."""
        with self._hp_lock:
            if episode not in self._hp_worlds:
                self._hp_worlds[episode] = hp_world(episode, self.hp)
            return self._hp_worlds[episode]

    def series(self, name: str) -> tuple[dict, dict]:
        """시리즈의 평가용 세계관(사건은 시리즈의 지식 기반이라 표본이 아니라 그 시리즈의 모든 행으로 만든다)과 장 → 회차 번호표.
        카드 제목은 소설 청크 대신 질문·사건 요약에서 가장 자주 나오는 이름 낱말로 정한다."""
        if name not in self._series:
            mine = [r for r in self.rows if r['series'] == name]
            ordinals = ordinal_map({chapter_tuple(r['question_period']) for r in mine}
                                   | {cutoff(name, r['character'], r['character_period'], self.tables) for r in mine})
            words = Counter(word for r in mine for word in re.findall(r'[A-Z][A-Za-z]+', f"{r['question']} {r['event_summary']}"))
            names = sorted({r['character'] for r in mine} | {n for r in mine for n in ast.literal_eval(r['participants'])})
            self._series[name] = (build_world(mine, ordinals, common_names(names, words)), ordinals)
        return self._series[name]

    def interview(self, row: dict):
        """질문 하나를 '그 시점의 인물에게 인터뷰어가 묻는 장면'으로: 시뮬레이션이 인물 턴을 쓰는 입력 (계획, World, 인물 카드, 장면)."""
        if self.hp is not None and row['series'] == HP:
            world, ids = self.hp_at(hp_episode(self.hp, *cutoff(HP, row['character'], row['character_period'], self.tables)))
            actor = world.characters.get(ids.get(row['character']))
            if actor is None:
                raise SimulationFailure(404, '원문 기반 세계관에 이 시점의 인물 카드가 없습니다.')
        else:
            data, ordinals = self.series(row['series'])
            world = tc_world(data, ordinals[cutoff(row['series'], row['character'], row['character_period'], self.tables)])
            actor = world.characters[data['character_id'][row['character']]]
        plan = SimulationPlan(mode='if', premise=PREMISE, characterIds=[actor.id])
        question = Turn(index=0, kind='narration', characterId=None, characterName='Interviewer', prose=row['question'], checks=[], regenerated=0, evidence=[])
        scene = service.add_turn(service.new_scene(plan), question, Trail(decision=Decision(turn='narration', pov='omniscient'), observed=row['question']))
        return plan, world, actor, scene

    def scene(self, spec: dict) -> tuple[SimulationPlan, service.World]:
        """고정 장면 하나의 (계획, World). 인물이 데이터에 없으면 짐작하지 않고 멈춘다."""
        if spec['world'] == 'ko':
            world, ids = korean_world(spec['episode'])
        elif self.hp is not None and spec['world'] == HP:
            world, ids = self.hp_at(hp_episode(self.hp, spec['book'], hp_chapters.BOOKS[spec['book']][1]))
        else:
            data, ordinals = self.series(spec['world'])
            world, ids = tc_world(data, end_of_book(ordinals, spec['book'])), data['character_id']
        missing = [name for name in spec['cast'] if name not in ids]
        if missing:
            raise ValueError(f"{spec['id']}: 세계관에 없는 인물 {', '.join(missing)}")
        plan = SimulationPlan(mode=spec['mode'], premise=spec.get('premise'), beats=spec.get('beats', []), characterIds=[ids[name] for name in spec['cast']])
        service.check_plan(plan, world)
        return plan, world
