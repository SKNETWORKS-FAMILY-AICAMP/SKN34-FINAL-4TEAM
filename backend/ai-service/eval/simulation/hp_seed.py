"""해리 포터 평가 세계관(.data/hp/world.json)을 로컬 스택에 배치로 적재한다(평가용, 표준 라이브러리만, 모델 호출 없음).

시연 세계관 적재(infrastructure/sample-data/simulation-demo/seed.py)의 함수(작품 찾기·카드·관계 변환·값 비교·확정)를 그대로 불러 쓰고(seed.py는 고치지 않는다) 회차 저장 루프만 배치로 바꿨다.
카드가 3천~4천 개라 seed.seed처럼 한 번에 보내면 서버 한도(WorldStudioService.validateEditRequest: 요청당 카드 1000개·직렬화 본문 2,000,000바이트)를 넘는다. 그래서
① 카드를 개수·바이트 한도 안의 배치로 모두 저장한 뒤(서버가 관계 양 끝 카드를 검사한다) ② 관계를 회차 오름차순으로, 그 회차에 시작하는 기록(새로 생기거나 값이 바뀌는 것)만 배치로 보낸다.
저장 key는 보내는 입력에서 정해 같은 입력의 재시도가 같은 요청으로 알아봐진다. 배치 하나가 실패하면 2초·4초… 기다려 서버를 다시 읽고(응답을 못 받은 사이 들어간 것은 빼고) 다시 보낸다.
모든 시도가 실패한 배치는 세고 다음 배치로 계속 가며, 한 번 훑은 뒤 남은 단계만 한 번 더 시도하고 그래도 남으면 SeedError다(카드가 다 들어가지 않으면 관계는 보내지 않는다).
world['work']에는 title·creationType·genres가 있어야 한다(seed._ensure_work가 읽는다). 원고(episodes/*.md)는 발행하지 않는다.
서버가 끝에서 거절할 입력(빈 제목·본문 카드, 마지막 회차 시점 관계 10,000개 초과)은 아무것도 보내기 전에 알린다(check_world).

    cd backend/ai-service
    STORYFORK_SEED_PASSWORD='<개발 작가 비밀번호>' uv run --locked --extra dev python eval/simulation/hp_seed.py [--world 경로] [--base-url http://localhost:5173]

공개 진입점 주소는 이 컴퓨터(localhost·127.0.0.1·[::1])만 허용한다. 비밀번호는 환경변수로만 받고 출력하지 않으며, 로그·예외에는 진행 숫자와 서버가 준 오류 문구만 넣고 카드·관계 본문은 넣지 않는다.
"""

import argparse
import functools
import hashlib
import json
import os
import sys
import time
import urllib.parse
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE / '.data' / 'hp'   # 적재할 세계관 디렉터리. episodes/*.md가 없어 원고는 발행하지 않는다(seed._ensure_work는 이 아래 episodes의 글만 발행한다)
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
MAX_RELATIONS = 10_000   # 서버 한도: 한 회차 시점의 활성 관계 수(RelationshipInputHelper.merge). 마지막 회차 시점이 가장 많다


@functools.cache
def load_seed():
    """시연 세계관 적재 모듈(seed.py). sim_worlds가 app·novelbrain을 불러와 무거우므로 처음 쓸 때 늦게 불러오고, SeedError 클래스가 하나이도록 한 번만 만든다."""
    from sim_worlds import seed_module
    return seed_module()


def check_local(base_url: str) -> str:
    """공개 진입점 주소가 이 컴퓨터(localhost·127.0.0.1·[::1])인지 확인하고 끝의 /를 뗀 주소를 돌려준다. 공유·원격 DB로 가는 주소는 거절한다(메시지에 주소를 넣지 않는다: 비밀번호가 섞일 수 있다)."""
    parts = urllib.parse.urlsplit(base_url)   # 모양이 잘못된 주소는 ValueError로 멈춘다(로그인하기 전)
    if parts.scheme not in ('http', 'https') or '@' in parts.netloc or parts.hostname not in LOCAL_HOSTS:
        raise load_seed().SeedError('로컬 주소(localhost·127.0.0.1·[::1])만 쓸 수 있어요.')
    return base_url.rstrip('/')


def split_batches(items: list, count: int, max_bytes: int) -> list[list]:
    """items를 순서대로 개수 count 이하·직렬화(JSON, UTF-8) max_bytes 이하의 배치로 나눈다. 다음 항목을 더하면 한도를 넘을 때만 끊고, 한 항목이 혼자 max_bytes를 넘으면 그 항목 하나짜리 배치가 된다."""
    out, cur, size = [], [], 2   # 2는 JSON 배열의 대괄호
    for item in items:
        n = len(json.dumps(item, ensure_ascii=False).encode('utf-8'))
        if cur and (len(cur) >= count or size + 2 + n > max_bytes):   # 2는 항목 사이의 ', '
            out.append(cur)
            cur, size = [], 2
        size += n + (2 if cur else 0)
        cur.append(item)
    return out + [cur] if cur else out


def check_world(seed, world: dict) -> None:
    """서버가 결국 거절할 입력을 적재 전에 알린다(긴 적재의 끝에서야 알면 헛수고다): 제목이나 본문이 빈 카드(확정 버전의 검사가 거절), 마지막 회차 시점의 관계가 서버 한도를 넘는 것. 본문은 메시지에 넣지 않는다."""
    blank = [c['key'] for c in world['cards'] if not c['title'].strip() or not c['body'].strip()]
    if blank:
        raise seed.SeedError(f'제목이나 본문이 빈 카드가 {len(blank)}개 있어요(확정 버전이 거절해요). 처음 key: {", ".join(blank[:3])}')
    last = len(seed.relations_at(world, seed.episodes(world)[-1]))
    if last > MAX_RELATIONS:
        raise seed.SeedError(f'마지막 회차 시점의 관계가 {last}개로 서버 한도 {MAX_RELATIONS}개를 넘어요.')


def _label(field: str, episode: int) -> str:
    return '카드' if field == 'cards' else f'{episode}화 관계'


def _pending(seed, draft: dict, field: str, items: list, fields) -> list:
    """서버 초안(draft[field])에 없거나 값이 다른 항목."""
    have = {x['id']: x for x in draft[field]}
    return [x for x in items if seed._differs(x, have.get(x['id']), fields)]


def seed_hp(seed, world: dict, call, *, log=print, cards_per_batch=50, relations_per_batch=200, max_bytes=1_500_000, attempts=3, wait=time.sleep) -> dict:
    """world를 배치로 적재하고 숫자만 담은 통계를 돌려준다. 흐름은 seed.seed와 같다: 작품 확인 → 세계관 생성·장르 → 카드 → 관계(회차별) → 확정 버전 한 번 → 작품 연결 → 회차별 관계 수 확인.
    call(method, path, body) → (status, json)이고 wait(초)는 재시도 사이에 부른다(시험에서는 기록용 대역). 통계의 batches는 ok(첫 시도에 저장)·retried(재시도 끝에 저장)·failed(모든 시도가 실패한 횟수,
    한 번 더에서 저장돼도 센다)이고, cards·relations의 sent는 보낸 수, skipped는 서버에 이미 같은 값이라 보내지 않은 수다. 끝내 저장하지 못한 배치가 있으면 SeedError(배치 수와 종류만)."""
    check_world(seed, world)
    ok, meta = seed._ok, world['world']
    wid = meta['id']
    path = f'/api/v1/world-studios/{wid}'
    work = seed._ensure_work(call, world['work'], BASE, log, wid)
    row = ok(call('GET', f'/api/v1/works/{work}'), '작품 조회')
    seed._check_link(row, wid)
    ok(call('POST', '/api/v1/world-studios', {'id': wid, 'name': meta['name'], 'description': meta['description']}), '세계관 생성')
    seed._ensure_world_genre(call, wid, meta['genre'], log)
    scope, keys = seed.scope_of(world), {c['key'] for c in world['cards']}
    cards = [seed.card_payload(c, scope, keys) for c in world['cards']]
    starts = defaultdict(set)   # 회차 → 그 회차에 시작하는(새로 생기거나 값이 바뀌는) 관계 id
    for rel in world['relationships']:
        starts[rel['from']].add(seed.relation_id(rel['key'], scope))
    stats = {'cards': {'sent': 0, 'skipped': 0}, 'relations': {'sent': 0, 'skipped': 0}, 'batches': {'ok': 0, 'retried': 0, 'failed': 0}}

    def read(episode):
        return ok(call('GET', f'{path}?episode={episode}'), f'{episode}화 시점 조회')

    def put(field, episode, batch, revision):
        body = {'expectedDraftRevision': revision, 'name': meta['name'], 'description': meta['description'], 'cards': batch if field == 'cards' else [],
                'relationships': batch if field == 'relationships' else [], 'replace': False, 'episode': episode}
        # 결과를 못 받았을 때 같은 입력으로 다시 보내면 서버가 같은 요청으로 알아보도록, key는 입력에서 정한다(seed.seed와 같다).
        digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()[:16]
        key = f'hp-seed-cards-{digest}' if field == 'cards' else f'hp-seed-rel-{episode}-{digest}'
        return ok(call('PUT', f'{path}/draft', {**body, 'key': key}), f'{_label(field, episode)} 저장')

    def run(field, episode, wanted, fields, per_batch, again):
        """한 단계(카드 전부, 또는 한 회차의 관계)를 서버와 비교해 새로 보낼 것만 배치로 보낸다. 모든 시도가 실패한 배치 수를 돌려준다."""
        label, group = _label(field, episode), stats['cards' if field == 'cards' else 'relations']
        draft = read(episode)
        todo = _pending(seed, draft, field, wanted, fields)
        if not again:   # 이 실행이 보낼 것(성공하면 모두 들어간다)과 서버에 이미 같은 값이라 건너뛰는 것
            group['sent'] += len(todo)
            group['skipped'] += len(wanted) - len(todo)
            if not todo:
                log(f'{label}: 이미 적재돼 있어요')
        pieces, lost = split_batches(todo, per_batch, max_bytes), 0
        for i, piece in enumerate(pieces, 1):
            if len(piece) == 1 and (size := len(json.dumps(piece, ensure_ascii=False).encode('utf-8'))) > max_bytes:
                log(f'{label} 배치 {i}/{len(pieces)}: 항목 하나가 {size}바이트로 한도 {max_bytes}바이트를 넘어요(혼자 보냄)')
            batch = piece
            for attempt in range(1, attempts + 1):
                try:
                    if attempt > 1 or draft is None:   # 다시 보내기 전과 실패한 배치 다음에는 서버를 다시 읽어, 응답을 못 받은 사이 들어간 것은 빼고 보낸다
                        draft = read(episode)
                        batch = _pending(seed, draft, field, batch, fields)
                    if batch:
                        draft = put(field, episode, batch, draft['draftRevision'])
                    break
                except seed.SeedError as error:
                    log(f'{label} 배치 {i}/{len(pieces)}: {attempt}번째 시도 실패({error})')
                    if attempt < attempts:
                        wait(2 ** attempt)
            else:
                draft, lost = None, lost + 1
                stats['batches']['failed'] += 1
                continue
            stats['batches']['retried' if attempt > 1 or again else 'ok'] += 1
            log(f'{label} 배치 {i}/{len(pieces)}: {len(piece)}개 저장')
        return lost

    def phase(stages):
        """단계를 차례로 한 번 훑고, 끝내지 못한 단계만 한 번 더(서버를 다시 읽어 비교) 시도한다. 그래도 남으면 SeedError."""
        left = [s for s in stages if run(*s, False)]
        if left:
            log(f'끝내지 못한 {len(left)}개 단계만 한 번 더 시도해요')
            lost = {_label(s[0], s[1]): run(*s, True) for s in left}
            if any(lost.values()):
                raise seed.SeedError(f'배치 {sum(lost.values())}개를 끝내 저장하지 못했어요: ' + ', '.join(name for name, n in lost.items() if n))

    phase([('cards', 1, cards, seed.CARD_FIELDS, cards_per_batch)])
    phase(('relationships', e, [r for r in seed.relations_at(world, e) if r['id'] in starts[e]], seed.RELATION_FIELDS, relations_per_batch)
          for e in seed.episodes(world) if starts[e])
    seed._confirm(call, wid, cards, log)
    if row.get('worldStudioId') != wid:
        ok(call('PUT', f'/api/v1/works/{work}/world-studio', {'worldId': wid}), '작품 연결')
        log('작품에 연결했어요')
    episodes = seed.episodes(world)
    last = episodes[-1]
    # 관계는 지워지지 않아 회차별 관계 수가 늘기만 하므로, 첫·마지막 회차의 수가 같으면 모든 회차가 같다(seed.seed의 검사와 같은 뜻).
    counts = {e: len(read(e)['relationships']) for e in dict.fromkeys((episodes[0], last))}
    log('회차별 관계 수: ' + ' · '.join(f'{e}화 {n}' for e, n in counts.items()))
    expected = len(seed.relations_at(world, last))
    if counts[last] != expected:
        raise seed.SeedError(f'{last}화 시점 관계가 서버에 {counts[last]}개로, 올린 {expected}개와 달라요.')
    if len(counts) > 1 and len(set(counts.values())) == 1:
        raise seed.SeedError('회차별 관계 수가 모두 같아요. 회차별 관계가 저장되지 않은 것 같아요(DEC-51).')
    return {'work': work, 'world': wid, 'episodes': len(episodes), **stats}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='해리 포터 평가 세계관을 로컬 스택에 배치로 적재한다. 비밀번호는 환경변수 STORYFORK_SEED_PASSWORD로만 받는다.')
    parser.add_argument('--world', type=Path, default=BASE / 'world.json', help='적재할 world.json(기본 .data/hp/world.json)')
    parser.add_argument('--base-url', default='http://localhost:5173', help='공개 진입점 주소(기본 http://localhost:5173, localhost·127.0.0.1·[::1]만)')
    parser.add_argument('--cards-per-batch', type=int, default=50, help='카드 배치의 최대 개수(기본 50)')
    parser.add_argument('--relations-per-batch', type=int, default=200, help='관계 배치의 최대 개수(기본 200)')
    args = parser.parse_args(argv)
    password = os.environ.get('STORYFORK_SEED_PASSWORD')
    if not password:
        print('STORYFORK_SEED_PASSWORD 환경변수가 필요합니다', file=sys.stderr)
        return 2
    seed = load_seed()
    try:
        client = seed.Client(check_local(args.base_url))
        client.login(seed.EMAIL, password)
        stats = seed_hp(seed, json.loads(args.world.read_text(encoding='utf-8')), client.call, cards_per_batch=args.cards_per_batch, relations_per_batch=args.relations_per_batch)
    except seed.SeedError as error:
        print(f'실패: {error}', file=sys.stderr)
        return 1
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
