"""Convert the checked-in review candidates to runtime chunks; never modify relationships."""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import uuid


ROOT = Path(__file__).resolve().parents[3]
REVIEW = ROOT / 'infrastructure/sample-data/genre-templates/review'
RESOURCES = ROOT / 'backend/content-service/src/main/resources'
OUTPUT = RESOURCES / 'sample-worlds-expanded'
RELATIONS = ROOT / 'infrastructure/sample-data/genre-templates/expanded-relations'
NAMESPACE = uuid.UUID('c62a8e33-1fb5-5ef4-aea1-a896a1ac84ea')
NAMES = {
    'china_history': '중국 역사', 'england_history': '잉글랜드 역사',
    'france_history': '프랑스 역사', 'italy_history': '이탈리아 역사',
    'japan_history': '일본 역사', 'korea_history': '한국 역사', 'usa_history': '미국 역사',
    'hawaiian_tradition': '하와이 전승', 'inca_tradition': '잉카 전승',
    'persian_tradition': '페르시아 전승',
}
TYPES = {'character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other'}
ATTRIBUTION_FIELDS = {
    'title', 'work', 'edition', 'author', 'authors', 'editors', 'general_editors',
    'volume_editors', 'work_editors', 'editor', 'chapter_editor', 'chapter_editors',
    'contributors', 'chapter_contributors', 'chapter_credit', 'credit_evidence',
    'url', 'chapter_url', 'source_url', 'license', 'license_url', 'changes', 'change',
    'modifications', 'citation', 'recommended_citation', 'verification',
}
ATTRIBUTION_LABELS = {'chapter_editor': '장 편집', 'chapter_editors': '장 편집',
                      'editor': '편집', 'contributors': '기여자', 'chapter_contributors': '장 기여자'}


def atomic_write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def attribution(card):
    data = next(iter(card['provenance']['chapter_attribution'].values()))
    if isinstance(data, str):
        return data.strip()
    parts = []
    for key, value in data.items():
        if key in ATTRIBUTION_FIELDS:
            if isinstance(value, list):
                value = ', '.join(value)
            if isinstance(value, str):
                label = ATTRIBUTION_LABELS.get(key)
                parts.append((label + ': ' if label else '') + value.strip())
        if key in ('source_attribution_url', 'license_evidence') and isinstance(value, str):
            parts.extend(url.rstrip('.,;') for url in re.findall(r'https?://[^\s<>]+', value))
    return '\n\n'.join(parts)


def public_sources(card):
    provenance = card.get('provenance', {})
    parts = []

    def add(value):
        if isinstance(value, str) and value.strip() and not re.search(r'/Users/|/home/|/tmp/|file://|미게시-임시자료:', value):
            value = value.strip()
            if value not in parts and value not in card['body']:
                parts.append(value)

    for key in ('source_url', 'edition', 'edition_and_scope', 'translation_status', 'translation',
                'verification', 'verification_limits', 'evidence_review', 'evidence_verification', 'rights'):
        add(provenance.get(key))
    for key in ('edition_and_scope', 'evidence_editions'):
        for item in provenance.get(key, []) if isinstance(provenance.get(key), list) else []:
            if isinstance(item, dict):
                for field in ('edition', 'url', 'scope'):
                    add(item.get(field))
    for item in provenance.get('verification_limits', []) if isinstance(provenance.get('verification_limits'), list) else []:
        add(item)
    for item in provenance.get('source_units', []):
        add(item)
    for line in provenance.get('lines', []):
        if isinstance(line, dict) and isinstance(line.get('start'), int) and isinstance(line.get('end'), int):
            add(f"{line['start']}–{line['end']}행")
    for item in provenance.get('evidence', []):
        if isinstance(item, dict):
            for key in ('url', 'location', 'unit'):
                add(item.get(key))
    return parts


def convert(card, genre, group):
    result = {key: card[key] for key in ('id', 'title', 'cardType')}
    result['body'] = '## 개요\n\n' + card['body']
    if group == 'expansion':
        result['body'] += '\n\n## 출처\n\n' + '\n\n'.join(
            [card['edition'], card['source_location'], card['source_url'],
             *(value for value in card['uncertainties']
               if value != '공개 전 evidence의 원문 직접 발췌를 모두 제거해야 함'), card['rights_status']])
    elif genre == 'usa_history':
        result['body'] += '\n\n## 출처\n\n' + attribution(card)
        if 'americanyawp.com/textbook/15-capital-and-labor' in card['body']:
            result['body'] += '\n\n장 편집: Joseph L. Locke'
        if 'americanyawp.com/textbook/16-geographies-of-empire' in card['body']:
            result['body'] += '\n\n장 편집자: 미확인'
        result['body'] += '\n\n이 카드는 개작물이며 CC BY-SA 4.0 동일조건으로 제공됩니다.'
    if group in ('full-history', 'full-myth'):
        sources = public_sources(card)
        if sources:
            result['body'] += '\n\n## 출처 정보\n\n' + '\n\n'.join(sources)
    if 'soul' in card:
        result['soul'] = card['soul']
    assert result['cardType'] in TYPES and result['title'].strip() and result['body'].strip()
    assert len(result['title'].encode('utf-16-le')) // 2 <= 200
    assert len(result['body'].encode('utf-16-le')) // 2 <= 3000, (genre, result['id'])
    if 'soul' in result:
        assert result['cardType'] == 'character' and 0 < len(result['soul'].strip().encode('utf-16-le')) // 2 <= 3000
    uuid.UUID(result['id'])
    return result


def generate():
    worlds = {}
    counts = collections.Counter()
    types = collections.defaultdict(collections.Counter)
    seen = set()

    def add_world(genre, world_id, name, description):
        if genre in worlds:
            assert worlds[genre]['worldId'] == world_id, genre
        else:
            worlds[genre] = dict(genre=genre, worldId=world_id, name=name,
                                 description=description, cards=[])

    def add(genre, card, group):
        assert card['id'] not in seen, card['id']
        seen.add(card['id'])
        worlds[genre]['cards'].append(convert(card, genre, group))
        counts[group] += 1
        types[group][card['cardType']] += 1

    for world in read(RESOURCES / 'genre-templates.json'):
        add_world(world['genre'], world['worldId'], world['name'], world['description'])
        for card in world['cards']:
            add(world['genre'], card, 'base')

    for group in ('full-history', 'full-myth'):
        for directory in sorted((REVIEW / group).iterdir()):
            if not directory.is_dir():
                continue
            index = read(directory / 'index.json')
            genre = index['genre']
            if genre not in worlds:
                add_world(genre, index['worldId'], NAMES[genre],
                          '역사 자료에서 추출한 검토 후보. 역사 감수와 원전·요약의 재배포 권리는 미확인.')
            elif 'worldId' in index:
                assert worlds[genre]['worldId'] == index['worldId'], genre
            for path in sorted(directory.glob('cards-*.json')):
                data = read(path)
                for card in data if isinstance(data, list) else data['cards']:
                    add(genre, card, group)

    for path in sorted((REVIEW / 'expansion-20261116/cards').glob('*.json')):
        for card in read(path):
            genre = card['world_id']
            if genre not in worlds:
                add_world(genre, str(uuid.uuid5(NAMESPACE, genre)), NAMES[genre],
                          '전승 자료에서 추출한 검토 후보. 판본·전승의 차이와 재배포 권리는 미확인.')
            add(genre, card, 'expansion')

    assert counts == {'base': 1254, 'full-history': 12618, 'full-myth': 1243, 'expansion': 1346}, counts
    for world in worlds.values():
        assert len(world['cards']) <= 10000, (world['genre'], len(world['cards']))

    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {'worlds': []}
    for world in worlds.values():
        cards = world.pop('cards')
        world['chunks'] = []

        def write_chunk(chunk_cards, chunk_relations):
            data = json.dumps({'cards': chunk_cards, 'relationships': chunk_relations},
                              ensure_ascii=False, separators=(',', ':')) + '\n'
            raw = data.encode('utf-8')
            filename = f"{world['genre']}-{len(world['chunks']) + 1:03}-{hashlib.sha256(raw).hexdigest()}.json"
            assert len(data.encode('utf-8')) < 2_000_000, filename
            path = OUTPUT / filename
            if path.exists():
                assert path.read_bytes() == raw, filename
            else:
                atomic_write(path, raw)
            world['chunks'].append(filename)

        for start in range(0, len(cards), 500):
            write_chunk(cards[start:start + 500], [])

        sidecar = RELATIONS / (world['genre'] + '.json')
        if sidecar.exists():
            relation_data = read(sidecar)
            assert (relation_data['genre'], relation_data['worldId']) == (world['genre'], world['worldId'])
            card_ids = {card['id'] for card in cards}
            relation_ids = set()
            batch = []
            for edge in relation_data['relationships']:
                assert edge['id'] not in relation_ids and edge['sourceCardId'] in card_ids and edge['targetCardId'] in card_ids
                relation_ids.add(edge['id'])
                batch.append(edge)
                size = len(json.dumps({'cards': [], 'relationships': batch}, ensure_ascii=False,
                                      separators=(',', ':')).encode('utf-8')) + 1
                if len(batch) > 500 or size >= 2_000_000:
                    assert len(batch) > 1, edge['id']
                    write_chunk([], batch[:-1])
                    batch = batch[-1:]
            if batch:
                write_chunk([], batch)
        manifest['worlds'].append(world)
    atomic_write(OUTPUT / 'manifest.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print('입력별 카드:', dict(counts))
    print('입력별 유형:', {group: dict(values) for group, values in types.items()})
    print('세계관별 카드:', {world['genre']: sum(len(read(OUTPUT / f)['cards']) for f in world['chunks'])
                          for world in manifest['worlds']})


if __name__ == '__main__':
    generate()
