"""KoTimeChara 서비스 전처리 기준선(C): 지금 서비스의 원고 전처리(app.manuscript_extraction: extract → resolve → organize)를 같은 작품에 그대로 돌리고
결과(LoadPayload)를 세계관 모양(world_svc.json, kt_world.build_world와 같은 모양 + 평가용 덧붙임)으로 바꿔 kt_linkeval이 시제품(world2.json)·기존 세계관(world.json)과 같은 잣대로 재게 한다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_world_svc.py run [--workers=6] [작품 id …]

서비스 코드는 import만 하고 고치지 않는다. 모델 호출은 기존 평가 하네스 eval/simulation/pipe_build(#836)가 하는 방식 그대로다: install('ocx')가 이 프로세스의 agent.ChatOpenAI 자리를 로컬 게이트웨이(구독 경로, gpt-6-luna, 금액 0)로
바꿔 끼우고 추출 응답은 KT/svc에 캐시한다(서비스 프롬프트는 Langfuse 키가 없으면 코드 문자열이라 시작할 때 LANGFUSE_* 환경 변수를 지워 프롬프트 등록·원문 전송 부작용을 막는다). 서비스는 추출에 reasoning 강도를 정하지 않는다.
변환 규칙(서비스가 Content에 적재하는 모양 그대로): 카드 본문·인물 문서(soul·goal·회차별 기억, '00'은 이야기 시작 전 0회)를 그대로 옮기고 공개 회차(revealFromEpisode)는 정하지 않는다(자동 적재는 공개 회차를 정하지 않는다, DEC-53).
사건 카드는 인물과 관계가 없다(서비스는 사건을 인물의 회차 기억 문장 '[사건] 인용'으로만 잇는다): 평가용 덧붙임 world['events']의 '겪음'은 그 문장이 든 회차 기억을 가진 인물로 읽는다.
관계는 시작만 옮기고(끝 표지·같은 관계의 되풀이는 뺀다) 동일 인물 후보(identityCandidates)는 작가가 승인해야 관계가 되므로 관계로 만들지 않는다.
결과는 KT/works/<작품 id>/world_svc.json·world_svc_stats.json과 KT/world_svc_stats.json(git 무시)에 쓴다.
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json
import os
import re
import time
from collections import Counter

from app.manuscript_extraction.models import LoadPayload
from app.novelbrain.models import Card, Relation
from kt_common import KT
from kt_exec import load_works
from kt_world import save_world

EVENT_LINE = '[사건] '   # 서비스가 사건 진술을 카드 본문·인물 기억에 싣는 표지(service.LABELS['event'])
LABEL = re.compile(r'\[(?:사건|묘사|사실|규칙|계획|목표|추측)\] ')   # 서비스가 카드 본문·기억 줄에 붙이는 표지 전부(service.LABELS)
PREFIX = {'character': 'c', 'event': 'e'}


def event_quotes(text: str) -> set[str]:
    """기억 글의 [사건] 항목의 인용 전체. 표지로 시작하는 줄이 한 항목이고 표지 없이 이어지는 줄은 앞 항목의 인용 안 개행이다(부분 문자열로 이으면 긴 문장의 기억이 짧은 사건에 붙는다)."""
    entries: list[str] = []
    for row in text.split('\n'):
        if LABEL.match(row):
            entries.append(row)
        elif entries:
            entries[-1] += '\n' + row
    return {e[len(EVENT_LINE):] for e in entries if e.startswith(EVENT_LINE)}


def svc_world(wid: str, payload: LoadPayload) -> tuple[dict, dict]:
    """LoadPayload → 세계관 모양과 개수 통계. 카드 id는 첫 등장 회차·제목 순으로 종류별(c 인물·e 사건·x 그 밖) 번호를 매긴다. 규칙은 모듈 설명."""
    ids, count = {}, Counter()
    for c in sorted(payload.cards, key=lambda c: (c.firstEpisode, c.title, c.key)):
        prefix = PREFIX.get(c.cardType, 'x')
        count[prefix] += 1
        ids[c.key] = f'{prefix}{count[prefix]:03d}'
    cards = [Card(id=ids[c.key], cardType=c.cardType, title=c.title, text=c.body, soul=c.characterDocs.soul if c.characterDocs else '',
                  goal=c.characterDocs.goal if c.characterDocs else '', episodes={int(k): v for k, v in c.characterDocs.episodes.items()} if c.characterDocs else {})
             for c in sorted(payload.cards, key=lambda c: ids[c.key])]
    relations, when, seen = [], {}, set()
    for r in sorted(payload.relations, key=lambda r: (r.fromEpisode, r.fromKey, r.toKey, r.label)):
        edge = (ids[r.fromKey], ids[r.toKey], r.label)
        if r.ended or edge in seen:
            continue
        seen.add(edge)
        rid = f'r{len(relations) + 1:03d}'
        relations.append(Relation(id=rid, source=edge[0], target=edge[1], label=edge[2], direction='directed'))
        when[rid] = r.fromEpisode
    memory = {p.key: {int(k): event_quotes(text) for k, text in p.characterDocs.episodes.items()} for p in payload.cards if p.characterDocs}
    events = {}
    for c in payload.cards:
        if c.cardType != 'event':
            continue
        rest = c.body.partition('\n')[2]
        quote = rest[len(EVENT_LINE):] if rest.startswith(EVENT_LINE) else rest
        knowers = {}
        for key, by_episode in memory.items():
            if seen_at := [k for k, quotes in by_episode.items() if quote in quotes]:
                knowers[ids[key]] = min(seen_at)
        events[ids[c.key]] = {'episode': c.firstEpisode, 'title': c.title, 'quote': quote, 'experienced': knowers, 'heard': {}, 'mentioned': []}
    character_id: dict[str, str] = {}
    for c in payload.cards:
        if c.cardType == 'character':
            for name in (c.title, *c.aliases):
                character_id.setdefault(name, ids[c.key])
    world = {'series': wid, 'cards': cards, 'relations': relations, 'when': when, 'character_id': character_id, 'title': {c.id: c.title for c in cards}, 'events': events,
             'aliases': {ids[c.key]: list(c.aliases) for c in payload.cards if c.cardType == 'character' and c.aliases}}
    return world, {'cards': dict(Counter(c.cardType for c in cards)), 'relations': len(relations), 'events': len(events), 'identity_candidates': len(payload.identityCandidates)}


def run(ids: list[str], workers: int) -> None:
    """고른 작품(없으면 KT/works 전체)에 서비스 전처리를 돌려(회차는 workers개씩 동시에, 캐시에 있는 호출은 다시 내지 않는다) world_svc.json·통계를 쓴다. 실패한 작품은 건너뛰고 알린다."""
    import pipe_build as pb   # 서비스 전처리를 게이트웨이로 돌리는 기존 평가 하네스(#836): 부를 때만 불러온다
    import pipe_score
    import sim_via

    for key in [k for k in os.environ if k.startswith('LANGFUSE')]:
        del os.environ[key]
    cost = sim_via.OcxCostLog(KT / 'cost-svc.jsonl')
    pb.install('ocx', cost)
    per_work = {}
    for wid, work in load_works(ids or None).items():
        started = time.time()
        for stale in ('world_svc.json', 'world_svc_stats.json'):   # 이 실행이 실패하면 옛 결과를 현재 결과로 읽지 않게 먼저 지운다(내가 만든 산출물이다)
            (KT / 'works' / wid / stale).unlink(missing_ok=True)
        try:
            built = pb.build_world(work, KT / 'svc', sim_via.MODEL, workers=workers)
        except pb.WorldFailed as error:
            print(f'{wid}: 서비스 전처리 실패 {error}', flush=True)
            continue
        world, stats = svc_world(wid, built.payload)
        extraction = pipe_score.extraction_stats(built.extractions.values())
        stats.update(episodes=len(work['episodes']), failures=[list(f) for f in built.failures], calls=built.calls, seconds=round(time.time() - started),
                     extraction={k: extraction[k] for k in ('kept', 'dropped', 'skipped', 'quotePass')})
        save_world(KT / 'works' / wid / 'world_svc.json', world)
        (KT / 'works' / wid / 'world_svc_stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2, sort_keys=True))
        per_work[wid] = stats
        print(f"{wid}: 회차 {stats['episodes']}(실패 {len(built.failures)}) · 모델 호출 {built.calls} · 카드 {stats['cards']} · 관계 {stats['relations']} · 사건 {stats['events']} · "
              f"동일 인물 후보 {stats['identity_candidates']} · 항목 통과 {extraction['kept']}/{extraction['kept'] + extraction['dropped']} · {stats['seconds']}초", flush=True)
    (KT / 'world_svc_stats.json').write_text(json.dumps({'works': per_work}, ensure_ascii=False, indent=2, sort_keys=True))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    sub = parser.add_subparsers(dest='command', required=True)
    run_ = sub.add_parser('run', help='서비스 전처리를 돌려 world_svc.json 만들기(모델 호출, 게이트웨이)', allow_abbrev=False)
    run_.add_argument('works', nargs='*', help='작품 id(없으면 KT/works 전체)')
    run_.add_argument('--workers', type=int, default=6, help='한 작품에서 동시에 뽑는 회차 수')
    args = parser.parse_args(argv)
    run(args.works, args.workers)


if __name__ == '__main__':
    main()
