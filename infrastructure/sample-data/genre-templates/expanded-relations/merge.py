#!/usr/bin/env python3
"""검토용 관계 병합. 구조 검사는 출처의 진실성·권리·전수 감수를 보증하지 않는다."""
import argparse
import json
import re
from pathlib import Path
from uuid import UUID, uuid5

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
TEMPLATES = ROOT / 'backend/content-service/src/main/resources/genre-templates.json'
MANIFEST = ROOT / 'backend/content-service/src/main/resources/sample-worlds-expanded/manifest.json'
REVIEW = HERE.parent / 'review'
FIELDS = {'id', 'sourceCardId', 'targetCardId', 'category', 'body', 'label', 'direction', 'polarity'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def read_cards(templates, history, myth, expansion):
    for directory in (history, myth, expansion):
        if not directory.is_dir():
            raise ValueError(f'{directory}: 입력 디렉터리가 없음')
    worlds = {}
    owners = {}

    def add(genre, world_id, cards):
        if genre not in worlds:
            worlds[genre] = {'worldId': world_id, 'cards': set()}
        world = worlds[genre]
        if world_id != world['worldId']:
            raise ValueError(f'{genre}: 세계관 ID 충돌')
        for card in cards:
            card_id = str(UUID(card['id']))
            if card_id in owners:
                raise ValueError(f'{card_id}: 카드 ID 중복 또는 세계관 충돌')
            owners[card_id] = genre
            world['cards'].add(card_id)

    for world in read(templates):
        add(world['genre'], str(UUID(world['worldId'])), world['cards'])
    for path in sorted(history.glob('*/cards-*.json')):
        chunk = read(path)
        index = read(path.parent / 'index.json')
        if isinstance(chunk, dict) and (chunk['genre'], chunk['worldId']) != (index['genre'], index['worldId']):
            raise ValueError(f'{path}: 인덱스와 세계관 불일치')
        add(index['genre'], str(UUID(index['worldId'])), chunk if isinstance(chunk, list) else chunk['cards'])
    for path in sorted(myth.glob('*/cards-*.json')):
        index = read(path.parent / 'index.json')
        genre = index['genre']
        if genre not in worlds:
            raise ValueError(f'{path}: 기존 시드 세계관이 없음')
        world_id = worlds[genre]['worldId']
        for key in ('worldId', 'world_id_reference', 'worldId_reference', 'worldId_reference_only',
                    'world_id_for_uuid_namespace_only', 'existing_world_id_for_uuid_namespace',
                    'existing_world_id_for_uuid_namespace_only'):
            if key in index and str(UUID(index[key])) != world_id:
                raise ValueError(f'{path}: 인덱스와 세계관 불일치')
        chunk = read(path)
        if isinstance(chunk, dict) and chunk['genre'] != genre:
            raise ValueError(f'{path}: 인덱스와 장르 불일치')
        add(genre, world_id, chunk if isinstance(chunk, list) else chunk['cards'])
    checked_expansion = set()
    for path in sorted(expansion.glob('cards-*.json')):
        for card in read(path):
            genre = card['world_id']
            if genre not in worlds:
                namespace = UUID(read(expansion.parent / 'index.json')['project_namespace_for_new_labels'])
                world_id = str(uuid5(namespace, genre))
            else:
                world_id = worlds[genre]['worldId']
            if genre not in checked_expansion:
                index = read(expansion.parent / 'worlds' / genre / 'index.json')
                if index['world_id'] != genre or str(UUID(index['id_namespace'])) != world_id:
                    raise ValueError(f'{genre}: 확장 인덱스와 세계관 ID 불일치')
                checked_expansion.add(genre)
            add(genre, world_id, [card])
    return worlds


def validate_manifest(worlds, path):
    manifest = read(path)['worlds']
    expected = {genre: world['worldId'] for genre, world in worlds.items()}
    actual = {world['genre']: world['worldId'] for world in manifest}
    if len(actual) != len(manifest) or len(set(actual.values())) != len(actual) or actual != expected:
        raise ValueError(f'{path}: 세계관 목록 또는 ID가 원본 입력과 불일치')


def collect(worlds, inputs):
    if not inputs.is_dir():
        raise ValueError(f'{inputs}: 관계 입력 디렉터리가 없음')
    edges = {genre: [] for genre in worlds}
    reviewed = {genre: set() for genre in worlds}
    ambiguous = {genre: set() for genre in worlds}
    ids, seen, possible_duplicates = set(), set(), {}
    reserved_ids = {UUID(card) for world in worlds.values() for card in world['cards']}
    reserved_ids.update(UUID(world['worldId']) for world in worlds.values() if world['worldId'])
    for path in sorted(inputs.glob('*.json')):
        batch = read(path)
        genre = batch['genre']
        if genre not in worlds or not worlds[genre]['worldId'] or batch['worldId'] != worlds[genre]['worldId']:
            raise ValueError(f'{path}: 알 수 없거나 원본 세계관과 ID가 다른 세계관')
        cards = worlds[genre]['cards']
        for key, target in [('reviewedCardIds', reviewed), ('ambiguousCardIds', ambiguous)]:
            values = batch.get(key, [])
            if not isinstance(values, list) or not set(values) <= cards:
                raise ValueError(f'{path}: {key}의 카드가 세계관에 없음')
            target[genre].update(values)
        if not isinstance(batch['relationships'], list):
            raise ValueError(f'{path}: relationships는 배열이어야 함')
        for edge in batch['relationships']:
            if set(edge) != FIELDS or not all(isinstance(edge[k], str) and edge[k].strip() for k in FIELDS):
                raise ValueError(f'{path}: 관계 필드가 잘못됨')
            try:
                edge_id = UUID(edge['id'])
            except (ValueError, AttributeError) as exc:
                raise ValueError(f'{path}: 관계 UUID 오류') from exc
            if str(edge_id) != edge['id'] or edge_id.version != 5 or edge_id in ids or edge_id in reserved_ids:
                raise ValueError(f'{path}: 관계 UUIDv5 오류 또는 충돌')
            ids.add(edge_id)
            source, target = edge['sourceCardId'], edge['targetCardId']
            if source not in cards or target not in cards or source == target:
                raise ValueError(f'{path}: 관계 끝점 오류')
            if edge['category'] not in ('structural', 'emotional') or edge['direction'] not in ('directed', 'symmetric') or edge['polarity'] not in ('asserted', 'denied'):
                raise ValueError(f'{path}: 관계 유형·방향·극성 오류')
            if len(edge['body'].encode('utf-16-le')) // 2 > 3000 or len(edge['label'].encode('utf-16-le')) // 2 > 200:
                raise ValueError(f'{path}: 관계 내용 길이 오류')
            source_card = re.search(r'근거 카드 ID:\s*([0-9a-f-]{36})', edge['body'])
            card_location = source_card and source_card.group(1) in (source, target)
            if not re.search(r'출처|출전|근거', edge['body']) or not (card_location or re.search(r'https?://\S+|(?:[\w.-]+/)+[\w.\-]+', edge['body'])):
                raise ValueError(f'{path}: 출처와 URL 또는 위치 필요')
            endpoints = tuple(sorted((source, target))) if edge['direction'] == 'symmetric' else (source, target)
            semantic_key = (genre, endpoints, edge['category'], edge['label'], edge['direction'], edge['polarity'])
            key = (*semantic_key, edge['body'])
            if key in seen:
                raise ValueError(f'{path}: 중복 관계')
            seen.add(key)
            possible_duplicates.setdefault(semantic_key, []).append(edge['id'])
            edges[genre].append(edge)
    report = {'notice': 'processed·ambiguous는 작성자가 명시한 카드만 집계; remaining은 미감수와 모호 카드의 합집합이다. unlinked는 관계 부재의 증거가 아니다. possibleDuplicateIds는 같은 끝점·분류·라벨·방향·극성의 수동 검토 후보이며 이본일 수 있다. 출처 표기 검사는 관계 내용의 근거를 보증하지 않는다.', 'totals': dict.fromkeys(('input', 'processed', 'unlinked', 'ambiguous', 'relations', 'remaining'), 0), 'worlds': {}}
    for genre, world in sorted(worlds.items()):
        linked = {edge[k] for edge in edges[genre] for k in ('sourceCardId', 'targetCardId')}
        cards = world['cards']
        pending = (cards - reviewed[genre]) | ambiguous[genre]
        counts = {'input': len(cards), 'processed': len(reviewed[genre]), 'unlinked': len(cards - linked),
                  'ambiguous': len(ambiguous[genre]), 'relations': len(edges[genre]), 'remaining': len(pending)}
        for key, count in counts.items():
            report['totals'][key] += count
        report['worlds'][genre] = {'worldId': world['worldId'], **counts,
                                  'pendingCardIds': sorted(pending),
                                  'unreviewedCardIds': sorted(cards - reviewed[genre]),
                                  'possibleDuplicateIds': [values for key, values in possible_duplicates.items() if key[0] == genre and len(values) > 1],
                                  'unlinkedCardIds': sorted(cards - linked),
                                  'ambiguousCardIds': sorted(ambiguous[genre])}
    return edges, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--templates', type=Path, default=TEMPLATES)
    parser.add_argument('--history', type=Path, default=REVIEW / 'full-history')
    parser.add_argument('--myth', type=Path, default=REVIEW / 'full-myth')
    parser.add_argument('--expansion', type=Path, default=REVIEW / 'expansion-20261116/cards')
    parser.add_argument('--manifest', type=Path, default=MANIFEST, help='생성 결과가 이미 있으면 세계관 ID를 교차 검사')
    parser.add_argument('--inputs', type=Path, default=HERE / 'worlds')
    parser.add_argument('--output', type=Path, default=HERE)
    args = parser.parse_args()
    worlds = read_cards(args.templates, args.history, args.myth, args.expansion)
    if args.manifest.exists():
        validate_manifest(worlds, args.manifest)
    edges, report = collect(worlds, args.inputs)
    args.output.mkdir(parents=True, exist_ok=True)
    index = {'notice': '검토용 후보. 구조 검사만 수행했으며 원문·사실·권리·전수 감수를 보증하지 않음.',
             'totals': report['totals'], 'worlds': []}
    for genre, relations in sorted(edges.items()):
        if not relations:
            continue
        filename = genre + '.json'
        data = {'genre': genre, 'worldId': worlds[genre]['worldId'], 'relationships': relations}
        (args.output / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        index['worlds'].append({'genre': genre, 'worldId': worlds[genre]['worldId'], 'file': filename, 'relations': len(relations)})
    (args.output / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'coverage.json').write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(report['totals'], ensure_ascii=False))


if __name__ == '__main__':
    main()
