"""해리 포터 평가 세계관 배치 적재(hp_seed) 단위 테스트: 서버·DB·네트워크 없이 메모리 모의 스택으로 본다. 세계관은 합성이고 실제 번역본 원문·모델 호출은 없다."""

import copy
import hashlib
import json
import uuid
from collections import Counter

import pytest

import hp_seed
import sim_worlds as w

seed = hp_seed.load_seed()   # 적재 함수 모듈(seed.py). 테스트 전체가 같은 모듈 객체(같은 SeedError 클래스)를 쓴다
SEED_PY = w.DEMO / 'seed.py'
OWNER = '11111111-1111-4111-8111-111111111111'
OTHER_WORLD = '22222222-2222-4222-8222-222222222222'
WORLD_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, 'hp-seed-test'))
TITLE = '해리 포터 시험 작품'
SECRET = 'pw-never-printed-9f3a'   # 환경변수로 넣는 비밀번호 대역: 어떤 출력에도 나오면 안 된다
CARD_TEXT, REL_TEXT = '카드본문에만-있는-문장', '관계본문에만-있는-문장'   # 로그·예외 메시지에 나오면 안 되는 본문 조각
OPTIONS = {'cards_per_batch': 15, 'relations_per_batch': 10, 'max_bytes': 120_000}   # 개수 한도와 바이트 한도가 모두 걸리게


# --- 합성 세계관 --------------------------------------------------------------------------------------------------------------

def text(tag, size):
    """tag로 구별되는 size글자의 합성 본문(문서를 크게 해 바이트 배치가 걸리게)."""
    return (tag + ' ' + '가나다라마바사아자차카타파하' * (size // 14 + 1))[:size]


def card(key, kind, area, label, size, **more):
    return {'key': key, 'cardType': kind, 'areaCode': area, 'title': f'{label} {key}', 'classification': label, 'aliases': [], 'tags': [],
            'visibility': 'private', 'revealFromEpisode': 1, 'body': text(key, size), **more}


def rel(key, at, source, target, label='참석', body='', predicate='custom_relation_directed'):
    return {'key': key, 'from': at, 'source': source, 'target': target, 'predicate': predicate, 'label': label, 'body': body}


def make_world():
    """카드 130개(인물 70·장소 30·조직 10·능력 10·사건 10)와 1·2·4·7화에 시작하는 관계 기록 59개(관계 52개, 그중 7개는 뒤 회차에 값이 바뀐다).
    회차별 관계 수는 1화 24·2화 36·4화 46·7화 52다."""
    docs = {'soul': text('soul', 600), 'goal': text('goal', 200), 'episodes': {'0': text('mem0', 300), '1': text('mem1', 300)}}
    cards = [card(f'ch-{i:02d}', 'character', 'basic', '인물', 2400, characterDocs=docs) for i in range(70)]
    cards += [card(f'loc-{i:02d}', 'location', 'space', '장소', 600) for i in range(30)]
    cards += [card(f'org-{i:02d}', 'organization', 'society', '조직', 600) for i in range(10)]
    cards += [card(f'abl-{i:02d}', 'ability', 'special', '능력', 600) for i in range(10)]
    cards += [card(f'ev-{i:02d}', 'event', 'history', '사건', 600) for i in range(10)]
    cards[0]['body'] = CARD_TEXT + ' ' + cards[0]['body']
    ch, ev = (lambda i: f'ch-{i:02d}'), (lambda i: f'ev-{i:02d}')
    rels = [rel(f'{ch(s)}~{ev(j)}', 1, ch(s), ev(j)) for j in range(10) for s in (2 * j, 2 * j + 1)]   # 1화: 사건 참석 20
    rels += [rel(f'{ch(2 * i)}>{ch(2 * i + 1)}>emotional', 1, ch(2 * i), ch(2 * i + 1), '친구', REL_TEXT if i == 0 else f'친구 사이 {i}', 'custom_emotion') for i in range(4)]   # 감정 4
    rels += [rel(f'{ch(20 + i)}~{ev(i % 10)}', 2, ch(20 + i), ev(i % 10)) for i in range(12)]   # 2화: 새 관계 12
    rels += [rel(f'{ch(2 * i)}>{ch(2 * i + 1)}>emotional', 2, ch(2 * i), ch(2 * i + 1), '다툼', f'다퉜다 {i}', 'custom_emotion') for i in range(4)]   # 2화: 바뀌는 관계 5
    rels.append(rel(f'{ch(0)}~{ev(0)}', 2, ch(0), ev(0), '참석', '다시 참석했다'))
    rels += [rel(f'{ch(30 + i)}~loc-{i:02d}', 4, ch(30 + i), f'loc-{i:02d}', '머문 곳') for i in range(10)]   # 4화: 새 관계 10
    rels += [rel(f'{ch(40 + i)}~org-{i:02d}', 7, ch(40 + i), f'org-{i:02d}', '소속') for i in range(6)]   # 7화: 새 관계 6
    rels += [rel(f'{ch(30 + i)}~loc-{i:02d}', 7, ch(30 + i), f'loc-{i:02d}', '머문 곳', '오래 머물렀다') for i in range(2)]   # 7화: 바뀌는 관계 2
    return {'world': {'id': WORLD_ID, 'name': '해리 포터 시험 세계관', 'description': '합성 시험 데이터', 'genre': 'fantasy'},
            'work': {'title': TITLE, 'summary': '시험용 작품', 'creationType': 'EXTERNAL_DERIVATIVE', 'genres': ['판타지'], 'hashtags': []},
            'chapters': 7, 'english': {}, 'unsplit': [], 'ordinals': {},   # 평가 전용 여분 키: 적재는 무시한다
            'cards': cards, 'relationships': rels, 'secrets': {}}


WORLD = make_world()
CARD_IDS = {seed.card_id(c['key'], seed.scope_of(WORLD)) for c in WORLD['cards']}


def starting(world, episode):
    """그 회차에 시작하는(새로 생기거나 값이 바뀌는) 관계 id."""
    return sorted(seed.relation_id(r['key'], seed.scope_of(world)) for r in world['relationships'] if r['from'] == episode)


def only(world, keys):
    """keys의 카드와, 양 끝이 모두 keys에 있는 관계만 남긴 작은 세계관."""
    small = copy.deepcopy(world)
    small['cards'] = [c for c in world['cards'] if c['key'] in keys]
    small['relationships'] = [r for r in world['relationships'] if r['source'] in keys and r['target'] in keys]
    return small


# --- 메모리 모의 스택 ----------------------------------------------------------------------------------------------------------

class FakeStack:
    """Content 최소 모의: 작품(제목으로 찾고 만든다)·세계관 초안(draftRevision·회차별 관계·서버 한도 일부)·확정 버전·작품 연결만 흉내 낸다.
    실서버의 Neo4j 저장, 저장 도중 멈춰 조회가 503이 되는 incomplete 상태, 관계 한도(요청당 1000개·시점당 10,000개)는 흉내 내지 않는다."""

    def __init__(self):
        self.works, self.worlds, self.counter = {}, {}, 0
        self.calls, self.puts, self.revision_posts = [], [], []
        self.fail = lambda n, body: None     # n번째 PUT draft를 (상태, detail)로 거절시킨다(저장하지 않음)
        self.lose = lambda n, body: False    # True면 저장은 하고 응답은 500으로 돌려준다(응답을 못 받은 경우)

    @property
    def world(self):
        return next(iter(self.worlds.values()), None)

    def new_id(self):
        self.counter += 1
        return f'00000000-0000-4000-8000-{self.counter:012d}'

    def call(self, method, path, body=None):
        self.calls.append((method, path))
        status, data = self.route(method, path, None if body is None else json.loads(json.dumps(body)))
        return status, json.loads(json.dumps(data))

    def route(self, method, path, body):
        route, _, query = path.partition('?')
        parts = route.split('/')   # ['', 'api', 'v1', 'works' | 'world-studios', id, ...]
        if route == '/api/v1/works':
            return (200, [dict(x) for x in self.works.values()]) if method == 'GET' else self.create_work(body)
        if route == '/api/v1/world-studios':
            if body['id'] in self.worlds and (self.worlds[body['id']]['name'], self.worlds[body['id']]['description']) != (body['name'], body['description']):
                return 409, {'detail': '다른 편집본 또는 저장 요청과 충돌했습니다.'}   # 세계관 생성은 같은 이름·설명일 때만 멱등이다
            self.worlds.setdefault(body['id'], {'revision': 0, 'cards': {}, 'edges': {}, 'current': None, 'revisions': {}, 'visibility': 'private', 'genre': None, 'last': None,
                                                'name': body['name'], 'description': body['description']})
            return 200, self.draft(body['id'], None)
        if route.startswith('/api/v1/world-studios/'):
            wid, rest = parts[4], parts[5:]
            if rest == ['publication']:
                self.worlds[wid].update(visibility=body['visibility'], genre=body['genre'])
                return 200, {'worldId': wid, 'visibility': body['visibility'], 'genre': body['genre']}
            if rest[:1] == ['revisions']:
                return self.revisions(wid, method, rest[1:], body)
            if method == 'GET' and wid not in self.worlds:
                return 404, {'detail': '세계관을 찾을 수 없습니다.'}
            return (200, self.draft(wid, int(query.split('=')[1]) if query else None)) if method == 'GET' else self.put(wid, body)
        if route.startswith('/api/v1/works/'):
            work, rest = self.works[parts[4]], '/'.join(parts[5:])
            if (method, rest) == ('GET', ''):
                return 200, dict(work)
            if (method, rest) == ('GET', 'episodes'):   # 새 작품의 빈 1화 초안뿐이다(원고는 발행하지 않는다)
                return 200, [{'number': 1, 'draft': {'title': '새 회차', 'body': '', 'revision': 0}, 'versions': [], 'publishedVersionId': None, 'inherited': False}]
            if (method, rest) == ('PUT', 'world-studio'):
                if work['worldStudioId'] not in (None, body['worldId']):
                    return 409, {'detail': '이미 연결돼 있어요'}
                work['worldStudioId'] = body['worldId']
                return 200, {'workId': work['id'], 'worldId': body['worldId']}
        raise AssertionError(f'모의에 없는 호출: {method} {path}')

    def create_work(self, body):
        if body.get('creationType') not in ('ORIGINAL', 'EXTERNAL_DERIVATIVE') or not body.get('rightsConfirmed') or not 1 <= len(body.get('genres', [])) <= 2:
            return 422, {'detail': '작품 등록 입력을 확인해 주세요.'}
        work = {'id': self.new_id(), 'ownerId': OWNER, 'source': None, 'worldStudioId': None, **{k: body[k] for k in ('title', 'summary', 'creationType', 'genres', 'hashtags')}}
        self.works[work['id']] = work
        return 201, dict(work)

    def draft(self, wid, episode):
        """GET /world-studios/{id}?episode=N: 그 회차 시점의 관계 = 관계마다 N화 이하의 가장 최근 값(DEC-51). 카드는 회차와 무관하다."""
        world, rels = self.worlds[wid], []
        for history in world['edges'].values():
            seen = [e for e in history if episode is None or e <= episode]
            if seen and history[max(seen)] is not None:   # None은 종료 연결(그 회차부터 관계가 없다)
                rels.append(history[max(seen)])
        return {'worldId': wid, 'draftRevision': world['revision'], 'currentRevisionId': world['current'], 'cards': list(world['cards'].values()),
                'relationships': rels, 'visibility': world['visibility'], 'genre': world['genre']}

    def revisions(self, wid, method, rest, body):
        """WorldStudioService.save의 핵심: 낡은 draftRevision은 409, 확정하면 그때의 카드가 남고 draftRevision이 하나 오른다."""
        world = self.worlds[wid]
        if method == 'GET':
            return 200, world['revisions'][rest[0]]
        self.revision_posts.append(body)
        if body['expectedDraftRevision'] != world['revision']:
            return 409, {'detail': 'draftRevision이 달라요'}
        revision_id = self.new_id()
        world['revisions'][revision_id] = {'revisionId': revision_id, 'parentRevisionId': world['current'], 'cards': [{'card': c} for c in world['cards'].values()]}
        world['current'] = revision_id
        world['revision'] += 1
        return 200, world['revisions'][revision_id]

    def put(self, wid, body):
        """PUT /world-studios/{id}/draft: validateEditRequest(카드 1000개·본문 2,000,000바이트)와 관계 끝점 검사, 같은 key·revision 재전송은 멱등, 저장마다 revision+1."""
        world = self.worlds[wid]
        self.puts.append(body)
        n = len(self.puts)
        if (refused := self.fail(n, body)):
            return refused[0], {'detail': refused[1]}
        if len(body['cards']) > 1000 or len({c['id'] for c in body['cards']}) != len(body['cards']) \
                or len(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) > 2_000_000:
            return 422, {'detail': '세계관 입력 크기를 확인하세요.'}
        known = set(world['cards']) | {c['id'] for c in body['cards']}
        if any(r.get('lifecycle') != 'removed' and (r['sourceCardId'] not in known or r['targetCardId'] not in known) for r in body['relationships']):
            return 422, {'detail': '관계의 시작 카드가 이 세계관에 없습니다.'}
        if world['last'] == (body['key'], body['expectedDraftRevision']) and world['revision'] == body['expectedDraftRevision'] + 1:
            return 200, self.draft(wid, body['episode'])   # 같은 요청의 재전송은 다시 적용하지 않는다
        if body['expectedDraftRevision'] != world['revision']:
            return 409, {'detail': 'draftRevision이 달라요'}
        world['name'], world['description'] = body['name'], body['description']   # 초안을 저장하면 이름·설명이 갱신된다
        for card in body['cards']:
            world['cards'][card['id']] = card
        for relation in body['relationships']:
            history = world['edges'].setdefault(relation['id'], {})
            seen = [e for e in history if e <= body['episode']]
            tip = history[max(seen)] if seen else None
            if relation.get('lifecycle') == 'removed':
                if tip is not None:   # 그 시점에 보이는 관계만 종료 연결을 쓴다(같은 회차의 옛 연결은 덮어쓴다)
                    history[body['episode']] = None
            elif tip != relation:
                history[body['episode']] = relation
        world['revision'] += 1
        world['last'] = (body['key'], body['expectedDraftRevision'])
        if self.lose(n, body):
            return 500, {'detail': '모의 서버 오류'}
        return 200, self.draft(wid, body['episode'])


def run(fake, world=None, **options):
    """seed_hp를 모의 스택에 돌리고 (통계, 로그 줄, wait 호출 기록)을 돌려준다. wait는 기록만 하고 자지 않는다."""
    logs, waits = [], []
    stats = hp_seed.seed_hp(seed, world or WORLD, fake.call, log=logs.append, wait=waits.append, **options)
    return stats, logs, waits


@pytest.fixture(scope='module', autouse=True)
def seed_py_is_untouched():
    """적재 함수 모듈(seed.py)은 읽기만 한다: 테스트 시작과 끝의 sha256이 같다."""
    before = hashlib.sha256(SEED_PY.read_bytes()).hexdigest()
    yield
    assert hashlib.sha256(SEED_PY.read_bytes()).hexdigest() == before


@pytest.fixture(scope='module')
def first_run():
    """합성 세계관을 처음 적재한 결과(읽기만 한다): (모의 스택, 통계, 로그 줄, wait 기록)."""
    fake = FakeStack()
    return (fake, *run(fake, **OPTIONS))


# --- 배치 나누기 --------------------------------------------------------------------------------------------------------------

def test_배치_나누기는_순서를_지키고_한도를_넘는_항목은_혼자_보낸다():
    items = [{'n': i, 'pad': '가' * pad} for i, pad in enumerate([100, 100, 100, 5000, 100, 100, 100, 100, 100])]   # 작은 항목은 JSON으로 319바이트
    out = hp_seed.split_batches(items, 3, 700)
    assert [[x['n'] for x in b] for b in out] == [[0, 1], [2], [3], [4, 5], [6, 7], [8]]   # 3의 한도가 아니라 바이트 한도에서 끊고, 혼자 넘는 3번은 따로 간다
    assert [[x['n'] for x in b] for b in hp_seed.split_batches([{'n': i} for i in range(7)], 3, 10_000)] == [[0, 1, 2], [3, 4, 5], [6]]
    assert hp_seed.split_batches([], 3, 700) == []


def test_카드_배치는_개수와_바이트_한도를_지키고_한도에_닿을_때만_끊는다(first_run):
    fake = first_run[0]
    batches = [b['cards'] for b in fake.puts if b['cards']]
    size = lambda items: len(json.dumps(items, ensure_ascii=False).encode('utf-8'))
    assert all(len(b) <= OPTIONS['cards_per_batch'] and size(b) <= OPTIONS['max_bytes'] for b in batches)
    for batch, after in zip(batches, batches[1:]):   # 다음 카드를 더하면 한도를 넘을 때만 끊는다(헐렁한 배치가 없다)
        assert len(batch) == OPTIONS['cards_per_batch'] or size(batch + after[:1]) > OPTIONS['max_bytes']
    assert any(len(b) == OPTIONS['cards_per_batch'] for b in batches) and any(len(b) < OPTIONS['cards_per_batch'] for b in batches[:-1])   # 두 한도가 모두 실제로 걸렸다
    assert sorted(c['id'] for b in batches for c in b) == sorted(CARD_IDS)   # 130장이 한 번씩


def test_카드_130장을_한_번에_보내면_서버_한도를_넘고_바이트_한도가_나눠_보낸다():
    """배치가 필요한 이유: 합성 카드 130장은 직렬화하면 서버 한도(2,000,000바이트)를 넘는다."""
    fake = FakeStack()
    stats, _, _ = run(fake, cards_per_batch=1000, max_bytes=1_500_000)   # 개수는 서버 한도까지 열어도 바이트 한도가 나눈다
    sizes = [len(json.dumps(b['cards'], ensure_ascii=False).encode('utf-8')) for b in fake.puts if b['cards']]
    assert len(sizes) >= 2 and max(sizes) <= 1_500_000 and stats['cards']['sent'] == 130
    everything = {'expectedDraftRevision': 0, 'name': 'n', 'description': 'd', 'cards': [seed.card_payload(c, seed.scope_of(WORLD), {x['key'] for x in WORLD['cards']}) for c in WORLD['cards']],
                  'relationships': [], 'replace': False, 'episode': 1, 'key': 'k'}
    other = FakeStack()
    other.call('POST', '/api/v1/world-studios', {'id': WORLD_ID, 'name': '시험', 'description': '시험'})
    assert other.call('PUT', f'/api/v1/world-studios/{WORLD_ID}/draft', everything)[0] == 422


def test_카드_하나가_max_bytes를_넘으면_그_카드_하나짜리_배치로_보내고_크기만_로그에_남긴다():
    small = only(WORLD, {'ch-00', 'ch-01', 'ch-20', 'loc-00', 'ev-00'})   # 인물 셋은 25KB 안팎, 나머지는 5KB 안팎
    fake = FakeStack()
    _, logs, _ = run(fake, small, cards_per_batch=15, relations_per_batch=10, max_bytes=20_000)
    assert [len(b['cards']) for b in fake.puts if b['cards']] == [1, 1, 1, 2]   # 넘는 인물 카드 셋은 각각 혼자, 나머지 둘은 함께
    big = [line for line in logs if '바이트' in line]
    assert len(big) == 3 and all(any(ch.isdigit() for ch in line) for line in big)
    assert not any(CARD_TEXT in line for line in logs)


# --- 저장 순서·회차별 관계 -----------------------------------------------------------------------------------------------------

def test_모든_카드가_관계보다_먼저_저장된다(first_run):
    fake = first_run[0]
    first = next(i for i, b in enumerate(fake.puts) if b['relationships'])
    assert {c['id'] for b in fake.puts[:first] for c in b['cards']} == CARD_IDS
    assert not any(b['cards'] for b in fake.puts[first:])


def test_관계는_회차별로_그_회차에_새로_생기거나_바뀐_것만_배치로_간다(first_run):
    fake = first_run[0]
    sent = {}
    for b in fake.puts:
        if b['relationships']:
            assert len(b['relationships']) <= OPTIONS['relations_per_batch'] and not b['cards'] and b['replace'] is False
            sent.setdefault(b['episode'], []).extend(r['id'] for r in b['relationships'])
    assert list(sent) == [1, 2, 4, 7]   # 관계가 시작하는 회차를 오름차순으로
    for episode in sent:
        assert sorted(sent[episode]) == starting(WORLD, episode)   # 그 회차에 시작하는 기록만(앞 회차에서 이어지는 관계는 다시 보내지 않는다)
    assert [len(sent[e]) for e in sent] == [24, 17, 10, 8]
    for episode, count in ((1, 24), (2, 36), (4, 46), (7, 52)):   # 서버에는 회차별 이력이 쌓인다(DEC-51)
        assert len(fake.draft(WORLD_ID, episode)['relationships']) == count == len(seed.relations_at(WORLD, episode))
    assert [len(b['relationships']) for b in fake.puts if b['episode'] == 1 and b['relationships']] == [10, 10, 4]   # 24개가 10개씩


def test_처음_실행은_카드와_관계를_모두_보내고_통계를_센다(first_run):
    fake, stats, logs, waits = first_run
    (work,) = fake.works.values()
    assert stats == {'work': work['id'], 'world': WORLD_ID, 'episodes': 7, 'cards': {'sent': 130, 'skipped': 0}, 'relations': {'sent': 59, 'removed': 0, 'skipped': 0},
                     'batches': {'ok': len([b for b in fake.puts if b['cards'] or b['relationships']]), 'retried': 0, 'failed': 0}}
    assert waits == [] and len(fake.world['cards']) == 130


def test_두_번째_실행은_아무것도_보내지_않는다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    before = (len(fake.puts), len(fake.revision_posts), fake.world['revision'], len(fake.calls))
    stats, _, waits = run(fake, **OPTIONS)
    assert (len(fake.puts), len(fake.revision_posts), fake.world['revision']) == before[:3]   # PUT draft 0회, 확정 0회
    assert [c for c in fake.calls[before[3]:] if c[0] != 'GET' and c != ('POST', '/api/v1/world-studios')] == []   # 세계관 생성(POST)은 id로 멱등이라 다시 부른다
    assert stats['cards'] == {'sent': 0, 'skipped': 130} and stats['relations'] == {'sent': 0, 'removed': 0, 'skipped': 59}
    assert stats['batches'] == {'ok': 0, 'retried': 0, 'failed': 0} and waits == []


# --- 실패한 배치만 다시 ---------------------------------------------------------------------------------------------------------

def test_한_배치가_일시_실패하면_그_배치만_다시_보내고_나머지는_한_번씩만_간다(first_run):
    base = first_run[0]
    fake = FakeStack()
    fake.fail = lambda n, body: (500, '모의 서버 오류') if n == 3 else None   # 세 번째 배치가 한 번 실패한다
    stats, _, waits = run(fake, **OPTIONS)
    ids = [tuple(x['id'] for x in b['cards'] + b['relationships']) for b in fake.puts]
    assert len(fake.puts) == len(base.puts) + 1
    assert [i for i, n in Counter(ids).items() if n > 1] == [ids[2]] and ids[3] == ids[2]   # 다시 보낸 것은 그 배치 하나, 바로 다음 시도
    assert fake.puts[3] == fake.puts[2]   # 입력이 같으면 key·expectedDraftRevision도 같다(서버가 같은 요청으로 알아본다)
    assert waits == [2] and stats['batches']['retried'] == 1 and stats['batches']['failed'] == 0
    assert stats['batches']['ok'] == len(base.puts) - 1
    assert len(fake.world['cards']) == 130 and len(fake.draft(WORLD_ID, 7)['relationships']) == 52


def test_응답을_못_받은_저장은_서버를_다시_읽어_이미_들어간_것은_다시_보내지_않는다(first_run):
    base = first_run[0]
    fake = FakeStack()
    fake.lose = lambda n, body: n == 3   # 세 번째 PUT은 저장됐지만 응답이 500으로 돌아온다
    stats, _, waits = run(fake, **OPTIONS)
    assert len(fake.puts) == len(base.puts)   # 같은 배치를 다시 보내지 않는다
    assert waits == [2] and stats['batches']['retried'] == 1 and stats['batches']['failed'] == 0
    assert stats['cards']['sent'] == 130 and len(fake.world['cards']) == 130 and len(fake.draft(WORLD_ID, 7)['relationships']) == 52


def test_시도가_한_번뿐이어도_실패한_배치_다음_배치는_서버를_다시_읽고_한_번_더에서_끝낸다(first_run):
    base = first_run[0]
    fake = FakeStack()
    fake.lose = lambda n, body: n == 3   # 세 번째 PUT은 저장됐지만 응답이 500이고, 시도가 한 번뿐이라 바로 실패로 센다
    stats, _, waits = run(fake, attempts=1, **OPTIONS)
    assert stats['batches'] == {'ok': len(base.puts) - 1, 'retried': 0, 'failed': 1} and waits == []   # 다음 배치는 낡은 revision(409)으로 실패하지 않는다
    assert len(fake.puts) == len(base.puts) and stats['cards'] == {'sent': 130, 'skipped': 0}   # 한 번 더에서 이미 들어간 것을 알아보고 다시 보내지 않는다
    assert len(fake.world['cards']) == 130 and len(fake.draft(WORLD_ID, 7)['relationships']) == 52


def test_끝내지_못한_실행은_다시_실행하면_남은_배치만_보내고_끝낸다():
    fake = FakeStack()
    fake.fail = lambda n, body: (500, '모의 서버 오류') if body['episode'] == 4 and body['relationships'] else None
    with pytest.raises(seed.SeedError):
        run(fake, **OPTIONS)
    fake.fail = lambda n, body: None
    saved = len(fake.puts)
    stats, _, waits = run(fake, **OPTIONS)
    assert len(fake.puts) == saved + 1 and fake.puts[-1]['episode'] == 4 and len(fake.puts[-1]['relationships']) == 10   # 4화 관계 한 배치뿐
    assert stats['cards'] == {'sent': 0, 'skipped': 130} and stats['relations'] == {'sent': 10, 'removed': 0, 'skipped': 49} and waits == []
    assert len(fake.revision_posts) == 1 and next(iter(fake.works.values()))['worldStudioId'] == WORLD_ID   # 이번에야 확정하고 연결한다
    for episode, count in ((1, 24), (2, 36), (4, 46), (7, 52)):
        assert len(fake.draft(WORLD_ID, episode)['relationships']) == count


def test_계속_실패하는_관계_배치는_실패로_세고_나머지는_저장하며_마지막에_SeedError를_던진다():
    fake = FakeStack()
    fake.fail = lambda n, body: (500, '모의 서버 오류') if body['episode'] == 4 and body['relationships'] else None
    logs, waits = [], []
    with pytest.raises(seed.SeedError) as caught:
        hp_seed.seed_hp(seed, WORLD, fake.call, log=logs.append, wait=waits.append, **OPTIONS)
    message = str(caught.value)
    assert '4화 관계' in message and '1개' in message and '카드' not in message   # 실패 배치 수와 종류만
    assert CARD_TEXT not in message and REL_TEXT not in message
    assert waits == [2, 4, 2, 4]   # 처음 훑을 때 세 번 시도(2초·4초 기다림), 한 번 더에서 또 세 번
    assert len([b for b in fake.puts if b['episode'] == 4]) == 6
    assert len(fake.draft(WORLD_ID, 2)['relationships']) == 36   # 앞뒤 회차는 저장됐다
    assert set(starting(WORLD, 7)) <= {r['id'] for r in fake.draft(WORLD_ID, 7)['relationships']}
    assert fake.revision_posts == [] and fake.works and all(x['worldStudioId'] is None for x in fake.works.values())   # 끝내지 못했으니 확정·연결하지 않는다


def test_카드가_끝내_저장되지_않으면_관계는_보내지_않고_멈춘다():
    target = seed.card_id('ch-10', seed.scope_of(WORLD))
    fake = FakeStack()
    fake.fail = lambda n, body: (500, '모의 서버 오류') if any(c['id'] == target for c in body['cards']) else None
    waits = []
    with pytest.raises(seed.SeedError) as caught:
        hp_seed.seed_hp(seed, WORLD, fake.call, log=lambda line: None, wait=waits.append, **OPTIONS)
    assert '카드' in str(caught.value) and '관계' not in str(caught.value)
    assert not any(b['relationships'] for b in fake.puts)   # 서버가 관계 양 끝 카드를 검사하므로 카드가 다 들어가기 전에는 보내지 않는다
    payloads = [seed.card_payload(c, seed.scope_of(WORLD), {x['key'] for x in WORLD['cards']}) for c in WORLD['cards']]
    failing = next(b for b in hp_seed.split_batches(payloads, OPTIONS['cards_per_batch'], OPTIONS['max_bytes']) if any(c['id'] == target for c in b))
    assert target not in fake.world['cards'] and len(fake.world['cards']) == 130 - len(failing)   # 실패한 배치 하나만 빼고 나머지 카드는 저장됐다
    assert fake.revision_posts == [] and waits == [2, 4, 2, 4]


# --- 확정·연결·작품 ------------------------------------------------------------------------------------------------------------

def test_확정_버전은_모든_저장_뒤_한_번만_남기고_작품_연결도_한_번만_한다(first_run):
    fake = first_run[0]
    (work,) = fake.works.values()
    saves = [i for i, (m, p) in enumerate(fake.calls) if m == 'PUT' and p.endswith('/draft')]
    confirm = [i for i, c in enumerate(fake.calls) if c == ('POST', f'/api/v1/world-studios/{WORLD_ID}/revisions')]
    link = [i for i, c in enumerate(fake.calls) if c == ('PUT', f'/api/v1/works/{work["id"]}/world-studio')]
    assert len(confirm) == len(link) == 1 and len(fake.revision_posts) == 1 and saves[-1] < confirm[0] < link[0]
    (revision,) = fake.world['revisions'].values()
    assert {c['card']['id'] for c in revision['cards']} == CARD_IDS and work['worldStudioId'] == WORLD_ID
    assert fake.world['genre'] == 'fantasy' and fake.world['visibility'] == 'private'   # 장르만 설정하고 공개 범위는 그대로


def test_작품은_새_제목으로_한_번만_만들어지고_원고는_발행하지_않는다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    run(fake, **OPTIONS)
    (work,) = [x for x in fake.works.values() if x['title'] == TITLE]
    assert (work['creationType'], work['genres'], work['hashtags']) == ('EXTERNAL_DERIVATIVE', ['판타지'], [])
    assert len([c for c in fake.calls if c == ('POST', '/api/v1/works')]) == 1
    assert not [c for c in fake.calls if '/episodes' in c[1] and c[0] != 'GET']   # 회차 저장·발행 없음
    assert len([c for c in fake.calls if c[0] == 'PUT' and c[1].endswith('/world-studio')]) == 1   # 연결은 한 번


# --- 회차별 관계 수 검증 -------------------------------------------------------------------------------------------------------

def test_회차별_관계_수가_모두_같으면_실패한다():
    keys = {'ch-00', 'ch-01', 'ev-00'}
    same = only(WORLD, keys)   # 2화에는 값이 바뀌는 기록만 있어 1화와 2화의 관계 수가 같다
    same['relationships'] = [r for r in same['relationships'] if r['from'] in (1, 2)]
    assert len(seed.relations_at(same, 1)) == len(seed.relations_at(same, 2))
    with pytest.raises(seed.SeedError) as caught:
        run(FakeStack(), same, **OPTIONS)
    assert '모두 같' in str(caught.value)


def test_회차가_하나뿐이면_관계_수가_같다는_검사에서_제외한다():
    one = only(WORLD, {'ch-00', 'ch-01', 'ev-00'})
    one['relationships'] = [r for r in one['relationships'] if r['from'] == 1]
    assert seed.episodes(one) == [1]
    stats, logs, _ = run(FakeStack(), one, **OPTIONS)
    assert stats['episodes'] == 1 and any('1화 3' in line for line in logs)


def test_관계_수_확인은_마지막_회차의_서버_수가_올린_수와_다르면_실패한다():
    fake = FakeStack()
    fake.put_original = fake.put
    lost = seed.relation_id('ch-40~org-00', seed.scope_of(WORLD))   # 7화에 처음 생기는 관계

    def drop_one(wid, body):   # 마지막 회차의 관계 하나를 서버가 저장하지 않은 것처럼 보이게 한다
        status, data = fake.put_original(wid, body)
        if body['episode'] == 7:
            fake.worlds[wid]['edges'].pop(lost, None)
        return status, data
    fake.put = drop_one
    with pytest.raises(seed.SeedError) as caught:
        run(fake, **OPTIONS)
    assert '7화' in str(caught.value) and '51' in str(caught.value) and '52' in str(caught.value)


# --- 적재 전 점검 ------------------------------------------------------------------------------------------------------------

def test_제목이나_본문이_빈_카드가_있으면_아무것도_보내기_전에_멈춘다():
    blank = copy.deepcopy(WORLD)
    blank['cards'][5]['body'] = '  '   # 확정 버전(WorldStudioService.save)은 활성 카드의 제목·본문이 비어 있으면 거절한다
    fake = FakeStack()
    with pytest.raises(seed.SeedError) as caught:
        run(fake, blank, **OPTIONS)
    assert '1개' in str(caught.value) and 'ch-05' in str(caught.value) and fake.calls == []


def test_마지막_회차_시점의_관계가_서버_한도를_넘으면_아무것도_보내기_전에_멈춘다(monkeypatch):
    small = only(WORLD, {'ch-00', 'ch-01', 'ch-20', 'loc-00', 'ev-00'})
    assert len(seed.relations_at(small, 2)) == 4
    monkeypatch.setattr(hp_seed, 'MAX_RELATIONS', 3)
    fake = FakeStack()
    with pytest.raises(seed.SeedError) as caught:
        run(fake, small, **OPTIONS)
    assert '4개' in str(caught.value) and '3개' in str(caught.value) and fake.calls == []
    monkeypatch.setattr(hp_seed, 'MAX_RELATIONS', 4)   # 한도와 같으면 적재한다
    assert run(FakeStack(), small, **OPTIONS)[0]['relations']['sent'] == 6   # 1화 3개 + 2화 3개(새 관계 1개와 바뀌는 관계 2개)


# --- key·모의 서버 ------------------------------------------------------------------------------------------------------------

def test_저장_key는_입력에서만_정해지고_서버_한도_안이다(first_run):
    fake = first_run[0]
    other = FakeStack()
    run(other, **OPTIONS)
    keys = [b['key'] for b in fake.puts]
    assert keys == [b['key'] for b in other.puts]   # 같은 입력이면 같은 key
    assert len(keys) == len(set(keys)) and all(0 < len(k.encode()) <= 200 for k in keys)
    assert all(k.startswith('hp-seed-cards-' if b['cards'] else f'hp-seed-rel-{b["episode"]}-') for k, b in zip(keys, fake.puts))


def test_모의_서버는_같은_key와_revision의_재전송을_한_번만_적용한다():
    fake = FakeStack()
    fake.call('POST', '/api/v1/world-studios', {'id': WORLD_ID, 'name': '시험', 'description': '시험'})
    body = {'expectedDraftRevision': 0, 'name': 'n', 'description': 'd', 'cards': [], 'relationships': [], 'replace': False, 'episode': 1, 'key': 'same'}
    first, second = (fake.call('PUT', f'/api/v1/world-studios/{WORLD_ID}/draft', body) for _ in range(2))
    assert first[0] == second[0] == 200 and fake.world['revision'] == 1


# --- 로그·예외·비밀 -----------------------------------------------------------------------------------------------------------

def test_로그에_진행_숫자만_있고_카드와_관계_본문이_없다(first_run):
    logs = first_run[2]
    assert logs and any('카드 배치' in line for line in logs) and any('7화' in line for line in logs)
    assert not any(CARD_TEXT in line or REL_TEXT in line or '인물 ch-' in line for line in logs)


def test_check_local은_로컬_주소만_허용하고_정규화한다():
    for url, normalized in (('http://localhost', 'http://localhost'), ('http://localhost:5173/', 'http://localhost:5173'), ('https://127.0.0.1:8443', 'https://127.0.0.1:8443'),
                            ('http://[::1]:5173/', 'http://[::1]:5173'), ('http://LocalHost:5173', 'http://LocalHost:5173')):
        assert hp_seed.check_local(url) == normalized
    for url in ('http://example.com', 'http://192.168.0.10:5173', 'http://10.0.0.5', 'http://172.16.3.4', 'http://localhost.example.com', 'http://127.0.0.1.example.com',
                'http://example.com@localhost:5173', 'http://localhost@example.com', 'ftp://localhost', 'localhost:5173', '', f'http://user:{SECRET}@example.com'):
        with pytest.raises(seed.SeedError) as caught:
            hp_seed.check_local(url)
        assert SECRET not in str(caught.value)   # 거절 메시지에 주소(비밀번호가 섞일 수 있다)를 넣지 않는다


def test_main은_비밀번호_환경변수가_없으면_이유만_출력하고_2를_돌려준다(monkeypatch, capsys):
    monkeypatch.delenv('STORYFORK_SEED_PASSWORD', raising=False)
    monkeypatch.setattr(seed, 'Client', lambda url: pytest.fail('비밀번호가 없는데 로그인을 시도했다'))
    assert hp_seed.main([]) == 2
    out, err = capsys.readouterr()
    assert 'STORYFORK_SEED_PASSWORD 환경변수가 필요합니다' in out + err


def test_main에는_비밀번호_옵션이_없다():
    with pytest.raises(SystemExit) as caught:
        hp_seed.main(['--password', 'x'])   # 비밀번호는 환경변수로만 받는다(명령줄에 남지 않게)
    assert caught.value.code == 2


def test_main은_로컬이_아닌_주소를_로그인_전에_거절한다(monkeypatch, capsys):
    monkeypatch.setenv('STORYFORK_SEED_PASSWORD', SECRET)
    monkeypatch.setattr(seed, 'Client', lambda url: pytest.fail('공유·원격 주소로 로그인을 시도했다'))
    assert hp_seed.main(['--base-url', 'http://example.com']) == 1
    out, err = capsys.readouterr()
    assert '실패' in out + err and SECRET not in out + err


def test_로그인이_거절돼도_main의_출력에_비밀번호가_없다(monkeypatch, capsys):
    class Rejecting(seed.Client):
        def _open(self, request):   # HTTP 대신 모의 응답: CSRF는 200, 로그인은 401
            return (200, {'csrfToken': 't'}) if request.full_url.endswith('/csrf') else (401, {'detail': '이메일 또는 비밀번호가 올바르지 않아요'})

    monkeypatch.setattr(seed, 'Client', Rejecting)
    monkeypatch.setenv('STORYFORK_SEED_PASSWORD', SECRET)
    assert hp_seed.main(['--base-url', 'http://localhost:5173']) == 1
    out, err = capsys.readouterr()
    assert '401' in out + err and SECRET not in out + err


def test_main은_로그인해_적재하고_통계를_숫자만_한_줄_JSON으로_출력한다(monkeypatch, tmp_path, capsys):
    fake, logins = FakeStack(), []

    class Stub:   # 로그인·HTTP는 모의로 바꾸고 main의 인자 처리와 출력만 본다
        def __init__(self, url):
            self.url, self.call = url, fake.call

        def login(self, email, password):
            logins.append((self.url, email, password))
            return OWNER

    monkeypatch.setattr(seed, 'Client', Stub)
    monkeypatch.setenv('STORYFORK_SEED_PASSWORD', SECRET)
    path = tmp_path / 'world.json'
    path.write_text(json.dumps(WORLD, ensure_ascii=False), encoding='utf-8')
    assert hp_seed.main(['--world', str(path), '--base-url', 'http://localhost:5173/']) == 0
    out, err = capsys.readouterr()
    stats = json.loads(out.strip().splitlines()[-1])
    assert stats['cards'] == {'sent': 130, 'skipped': 0} and stats['relations'] == {'sent': 59, 'removed': 0, 'skipped': 0} and stats['batches']['failed'] == 0
    assert max(len(b['cards']) for b in fake.puts) == 50   # 기본 배치 크기(카드 50개)
    assert logins == [('http://localhost:5173', seed.EMAIL, SECRET)]
    assert SECRET not in out + err and CARD_TEXT not in out + err and REL_TEXT not in out + err


# --- world.json이 줄거나 바뀐 뒤 다시 적재: 서버를 world.json과 같게 맞춘다 ---------------------------------------------------------------

def assert_matches(fake, world):
    """서버의 모든 회차 시점 관계가 world.json의 그 시점(관계 id와 비교 필드)과 같다."""
    for episode in range(1, seed.episodes(world)[-1] + 1):
        server = {r['id']: r for r in fake.draft(WORLD_ID, episode)['relationships']}
        wanted = {r['id']: r for r in seed.relations_at(world, episode)}
        assert set(server) == set(wanted), f'{episode}화 관계 id'
        assert not [i for i in wanted if seed._differs(wanted[i], server[i], seed.RELATION_FIELDS)], f'{episode}화 관계 값'


def without(world, *keys):
    """keys의 관계를 (모든 회차 기록째) 뺀 세계관."""
    smaller = copy.deepcopy(world)
    smaller['relationships'] = [r for r in world['relationships'] if r['key'] not in keys]
    return smaller


def test_줄어든_관계는_옛_기록이_있는_모든_회차에서_종료_연결로_끝나고_다시_실행하면_더_보내지_않는다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    gone = ('ch-00>ch-01>emotional', 'ch-00~ev-00', 'ch-30~loc-00')   # 기록이 1·2화, 1·2화, 4·7화에 있다
    smaller = without(WORLD, *gone)
    before = len(fake.puts)
    stats, _, _ = run(fake, smaller, **OPTIONS)
    assert stats['relations'] == {'sent': 0, 'removed': 6, 'skipped': 59 - 6 - 0} or stats['relations']['removed'] == 6   # 옛 기록 6개를 회차마다 끝냈다
    assert stats['cards'] == {'sent': 0, 'skipped': 130}
    ended = [r for body in fake.puts[before:] for r in body['relationships']]
    assert len(ended) == 6 and all(r['lifecycle'] == 'removed' for r in ended) and {r['id'] for r in ended} == {seed.relation_id(k, seed.scope_of(WORLD)) for k in gone}
    assert_matches(fake, smaller)
    assert len(fake.draft(WORLD_ID, 7)['relationships']) == 52 - 3
    mark = len(fake.puts)
    again, _, _ = run(fake, smaller, **OPTIONS)
    assert len(fake.puts) == mark and again['relations'] == {'sent': 0, 'removed': 0, 'skipped': 53} and again['batches'] == {'ok': 0, 'retried': 0, 'failed': 0}


def test_값이_바뀐_관계와_뒤_기록이_사라진_관계도_모든_회차에서_world_json과_같아진다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    changed = copy.deepcopy(WORLD)
    key = 'ch-02>ch-03>emotional'   # 1화 '친구'·2화 '다툼'
    changed['relationships'] = [dict(r, body='바뀐 본문') if (r['key'], r['from']) == (key, 1) else r for r in WORLD['relationships'] if (r['key'], r['from']) != (key, 2)]
    stats, _, _ = run(fake, changed, **OPTIONS)
    assert stats['relations']['removed'] == 0 and stats['relations']['sent'] == 2   # 1화의 값을 고치고, 2화 시점도 그 값으로 맞춘다(옛 2화 연결을 같은 값으로 덮는다)
    assert_matches(fake, changed)


def test_바뀐_카드만_다시_보내고_확정은_한_번_더_남긴다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    changed = copy.deepcopy(WORLD)
    changed['cards'][3]['characterDocs'] = dict(changed['cards'][3]['characterDocs'], soul='새로 쓴 SOUL')
    before, revisions = len(fake.puts), len(fake.revision_posts)
    stats, _, _ = run(fake, changed, **OPTIONS)
    sent = fake.puts[before:]
    assert stats['cards'] == {'sent': 1, 'skipped': 129} and stats['relations']['sent'] == 0 and stats['relations']['removed'] == 0
    assert len(sent) == 1 and [c['id'] for c in sent[0]['cards']] == [seed.card_id('ch-03', seed.scope_of(WORLD))] and sent[0]['relationships'] == []
    assert fake.world['cards'][seed.card_id('ch-03', seed.scope_of(WORLD))]['semanticMetadata']['characterDocs']['soul'] == '새로 쓴 SOUL'
    assert len(fake.revision_posts) == revisions + 1   # 카드가 바뀌었으니 확정 버전을 새로 남긴다


def test_관계를_끝내는_배치가_일시_실패하면_그_배치만_다시_보낸다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    smaller = without(WORLD, 'ch-00>ch-01>emotional', 'ch-00~ev-00')
    failed = []

    def flaky(n, body):
        if not failed and any(r.get('lifecycle') == 'removed' for r in body['relationships']):
            failed.append(n)
            return 500, '모의 서버 오류'
    fake.fail = flaky
    stats, _, waits = run(fake, smaller, **OPTIONS)
    assert failed and waits == [2] and stats['batches']['retried'] == 1 and stats['batches']['failed'] == 0 and stats['relations']['removed'] == 4
    assert_matches(fake, smaller)


def test_세계관_설명을_고친_뒤_다시_적재해도_세계관을_다시_만들지_않고_새_설명으로_갱신한다():
    fake = FakeStack()
    run(fake, **OPTIONS)
    renamed = copy.deepcopy(WORLD)
    renamed['world']['description'] = '고친 설명'
    changed = copy.deepcopy(renamed)
    changed['cards'][5]['body'] = '고친 본문'   # 저장이 한 번은 있어야 설명이 갱신된다
    before = len(fake.calls)
    run(fake, changed, **OPTIONS)
    assert ('POST', '/api/v1/world-studios') not in fake.calls[before:] and fake.world['description'] == '고친 설명'
    mark = len(fake.puts)
    run(fake, changed, **OPTIONS)
    assert len(fake.puts) == mark   # 같으면 다시 보내지 않는다
