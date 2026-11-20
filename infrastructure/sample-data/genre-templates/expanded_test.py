import collections
import contextlib
import importlib.util
import io
import json
import pathlib
import re
import shutil
import tempfile
import unittest
import uuid


ROOT = pathlib.Path(__file__).resolve().parents[3]
REVIEW = ROOT / 'infrastructure/sample-data/genre-templates/review'
OUTPUT = ROOT / 'backend/content-service/src/main/resources/sample-worlds-expanded'
BASE = ROOT / 'backend/content-service/src/main/resources/genre-templates.json'
RELATIONS = ROOT / 'infrastructure/sample-data/genre-templates/expanded-relations'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def inputs():
    result = []
    for world in read(BASE):
        result.extend(('base', world['genre'], card) for card in world['cards'])
    for group in ('full-history', 'full-myth'):
        for directory in sorted((REVIEW / group).iterdir()):
            if not directory.is_dir():
                continue
            index = read(directory / 'index.json')
            for path in sorted(directory.glob('cards-*.json')):
                data = read(path)
                result.extend((group, index['genre'], card) for card in
                              (data if isinstance(data, list) else data['cards']))
    for path in sorted((REVIEW / 'expansion-20261116/cards').glob('*.json')):
        result.extend(('expansion', card['world_id'], card) for card in read(path))
    return result


def has_excerpt_key(value):
    if isinstance(value, dict):
        return any('excerpt' in key.lower() or has_excerpt_key(item) for key, item in value.items())
    if isinstance(value, list):
        return any(has_excerpt_key(item) for item in value)
    return False


class ExpandedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = pathlib.Path(cls.temporary.name)
        spec = importlib.util.spec_from_file_location('expanded_generate', pathlib.Path(__file__).with_name('expanded_generate.py'))
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        generator.OUTPUT = cls.output
        with contextlib.redirect_stdout(io.StringIO()):
            generator.generate()

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def assert_snapshot_matches(self, generated, snapshot):
        self.assertEqual((generated / 'manifest.json').read_bytes(), (snapshot / 'manifest.json').read_bytes())
        manifest = read(generated / 'manifest.json')
        for world in manifest['worlds']:
            for name in world['chunks']:
                self.assertEqual((generated / name).read_bytes(), (snapshot / name).read_bytes(), name)

    def test_checked_in_manifest_and_chunks_match_generated_output(self):
        self.assert_snapshot_matches(self.output, OUTPUT)

    def test_snapshot_comparison_rejects_tampering_and_missing_chunks(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = pathlib.Path(directory)
            manifest = read(self.output / 'manifest.json')
            chunks = [name for world in manifest['worlds'] for name in world['chunks']]
            for name in ['manifest.json', *chunks]:
                shutil.copyfile(self.output / name, snapshot / name)
            (snapshot / 'unreferenced.json').write_text('ignored')
            self.assert_snapshot_matches(self.output, snapshot)
            chunk = snapshot / chunks[0]
            original = chunk.read_bytes()
            chunk.write_bytes(original + b' ')
            with self.assertRaises(AssertionError):
                self.assert_snapshot_matches(self.output, snapshot)
            chunk.unlink()
            with self.assertRaises((AssertionError, FileNotFoundError)):
                self.assert_snapshot_matches(self.output, snapshot)
            chunk.write_bytes(original)
            with (snapshot / 'manifest.json').open('ab') as manifest_file:
                manifest_file.write(b' ')
            with self.assertRaises(AssertionError):
                self.assert_snapshot_matches(self.output, snapshot)

    def test_source_metadata_keeps_public_details_only(self):
        spec = importlib.util.spec_from_file_location('expanded_generate', pathlib.Path(__file__).with_name('expanded_generate.py'))
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        card = {'id': str(uuid.uuid4()), 'title': '제목', 'body': '요약', 'cardType': 'event',
                'provenance': {'edition': '판본 미확인', 'verification': '독립 대조 미완료',
                               'source_url': 'https://example.org/source', 'source_units': ['제1장'],
                               'lines': [{'start': 10, 'end': 12}],
                               'evidence': [{'url': 'https://example.org/section', 'location': '3절',
                                             'excerpt': '원문 직접 발췌', 'input_path': '/Users/private'}]}}
        body = generator.convert(card, 'sample', 'full-myth')['body']
        for text in ('판본 미확인', '독립 대조 미완료', 'https://example.org/source',
                     '제1장', '10–12', 'https://example.org/section', '3절'):
            self.assertIn(text, body)
        self.assertNotIn('원문 직접 발췌', body)
        self.assertNotIn('/Users/private', body)

    def test_failed_regeneration_preserves_manifest_and_its_chunks(self):
        spec = importlib.util.spec_from_file_location('expanded_generate', pathlib.Path(__file__).with_name('expanded_generate.py'))
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        with tempfile.TemporaryDirectory() as directory:
            generator.OUTPUT = pathlib.Path(directory) / 'out'
            generator.RELATIONS = pathlib.Path(directory) / 'relations'
            generator.RELATIONS.mkdir()
            with contextlib.redirect_stdout(io.StringIO()):
                generator.generate()
            manifest_path = generator.OUTPUT / 'manifest.json'
            manifest = read(manifest_path)
            before = {f: (generator.OUTPUT / f).read_bytes() for w in manifest['worlds'] for f in w['chunks']}
            original_manifest = manifest_path.read_bytes()
            original_convert = generator.convert
            def changed(card, genre, group):
                result = original_convert(card, genre, group)
                if genre == 'wuxia':
                    result['body'] += ' 변경'
                return result
            generator.convert = changed
            world = manifest['worlds'][-1]
            (generator.RELATIONS / (world['genre'] + '.json')).write_text(json.dumps({
                'genre': world['genre'], 'worldId': world['worldId'],
                'relationships': [{'id': 'bad', 'sourceCardId': 'bad', 'targetCardId': 'bad'}]}))
            with self.assertRaises(AssertionError), contextlib.redirect_stdout(io.StringIO()):
                generator.generate()
            self.assertEqual(manifest_path.read_bytes(), original_manifest)
            self.assertEqual(before, {f: (generator.OUTPUT / f).read_bytes() for f in before})

    def test_all_cards_and_worlds(self):
        source = inputs()
        self.assertEqual(collections.Counter(group for group, _, _ in source),
                         {'base': 1254, 'full-history': 12618, 'full-myth': 1243, 'expansion': 1346})
        source_ids = collections.Counter(card['id'] for _, _, card in source)
        self.assertEqual(len(source_ids), 16461)
        self.assertTrue(all(count == 1 for count in source_ids.values()))
        self.assertTrue(all(uuid.UUID(key) for key in source_ids))
        for _, _, card in source:
            self.assertTrue(all(isinstance(card[key], str) and card[key].strip()
                                for key in ('id', 'title', 'body', 'cardType')))
            self.assertIn(card['cardType'], {'character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other'})
        expected = {card['id']: (group, genre, card) for group, genre, card in source}
        original_worlds = {w['genre']: w['worldId'] for w in read(BASE)}
        for directory in (REVIEW / 'full-history').iterdir():
            if directory.is_dir():
                index = read(directory / 'index.json')
                original_worlds[index['genre']] = index['worldId']
                for path in directory.glob('cards-*.json'):
                    data = read(path)
                    if isinstance(data, dict):
                        self.assertEqual((data['genre'], data['worldId']), (index['genre'], index['worldId']))
        for directory in (REVIEW / 'full-myth').iterdir():
            if directory.is_dir():
                index = read(directory / 'index.json')
                world_id = original_worlds[index['genre']]
                for key in ('worldId', 'world_id_reference', 'worldId_reference', 'worldId_reference_only',
                            'world_id_for_uuid_namespace_only', 'existing_world_id_for_uuid_namespace',
                            'existing_world_id_for_uuid_namespace_only'):
                    if key in index:
                        self.assertEqual(index[key], world_id)
                reference = index.get('world_reference', {})
                for key in ('existing_worldId', 'existing_world_id'):
                    if key in reference:
                        self.assertEqual(reference[key], world_id)
        manifest = read(self.output / 'manifest.json')
        self.assertEqual(set(manifest), {'worlds'})
        seen = collections.Counter()
        genres = set()
        world_ids = set()
        for world in manifest['worlds']:
            self.assertEqual(set(world), {'genre', 'worldId', 'name', 'description', 'chunks'})
            genre = world['genre']
            self.assertNotIn(genre, genres)
            genres.add(genre)
            self.assertNotIn(world['worldId'], world_ids)
            world_ids.add(world['worldId'])
            self.assertTrue(world['name'] and world['description'])
            self.assertEqual(world['worldId'], original_worlds.get(genre) or
                             str(uuid.uuid5(uuid.UUID('c62a8e33-1fb5-5ef4-aea1-a896a1ac84ea'), genre)))
            total = 0
            relations = []
            for filename in world['chunks']:
                path = self.output / filename
                self.assertEqual(path.resolve().parent, self.output.resolve())
                self.assertLess(path.stat().st_size, 2_000_000)
                data = read(path)
                self.assertEqual(set(data), {'cards', 'relationships'})
                self.assertLessEqual(len(data['relationships']), 500)
                relations.extend(data['relationships'])
                self.assertLessEqual(len(data['cards']), 500)
                total += len(data['cards'])
                for card in data['cards']:
                    self.assertEqual(set(card), {'id', 'title', 'body', 'cardType'} |
                                     ({'soul'} if 'soul' in card else set()))
                    seen[card['id']] += 1
                    group, source_genre, original = expected[card['id']]
                    self.assertEqual(source_genre, genre)
                    self.assertEqual(card['title'], original['title'])
                    self.assertEqual(card['cardType'], original['cardType'])
                    self.assertEqual(card.get('soul'), original.get('soul'))
                    if 'soul' in card:
                        self.assertEqual(card['cardType'], 'character')
                        self.assertTrue(card['soul'].strip())
                        self.assertLessEqual(len(card['soul'].encode('utf-16-le')) // 2, 3000)
                    self.assertTrue(card['body'].startswith('## 개요\n\n' + original['body']))
                    self.assertLessEqual(len(card['body'].encode('utf-16-le')) // 2, 3000)
                    self.assertNotRegex(card['body'], r'/Users/|/home/|/tmp/|file://|미게시-임시자료:')
                    if group in ('full-history', 'full-myth'):
                        self.assertRegex(card['body'], r'https?://')
                        provenance = original['provenance']
                        for key in ('source_url', 'edition', 'translation_status', 'translation', 'verification'):
                            value = provenance.get(key)
                            if isinstance(value, str) and value.strip():
                                self.assertIn(value.strip(), card['body'])
                        for unit in provenance.get('source_units', []):
                            self.assertIn(unit, card['body'])
                        for line in provenance.get('lines', []):
                            if isinstance(line, dict) and isinstance(line.get('start'), int) and isinstance(line.get('end'), int):
                                self.assertIn(f"{line['start']}–{line['end']}행", card['body'])
                        for reference in provenance.get('evidence', []):
                            for key in ('url', 'location', 'unit'):
                                value = reference.get(key)
                                if isinstance(value, str) and value.strip():
                                    self.assertIn(value.strip(), card['body'])
                    if group == 'expansion':
                        self.assertFalse(has_excerpt_key(original))
                        self.assertIn('## 출처', card['body'])
                        for key in ('source_url', 'source_location', 'edition', 'rights_status'):
                            self.assertIn(original[key], card['body'])
                        for uncertainty in original['uncertainties']:
                            if uncertainty == '공개 전 evidence의 원문 직접 발췌를 모두 제거해야 함':
                                self.assertNotIn(uncertainty, card['body'])
                            else:
                                self.assertIn(uncertainty, card['body'])
                    if genre == 'usa_history':
                        self.assertIn('CC BY-SA 4.0', card['body'])
                        self.assertIn('이 카드는 개작물이며 CC BY-SA 4.0 동일조건으로 제공됩니다.', card['body'])
                        self.assertIn('https://creativecommons.org/licenses/by-sa/4.0/', card['body'])
                        attribution = next(iter(original['provenance']['chapter_attribution'].values()))
                        if isinstance(attribution, dict):
                            for key in ('chapter_editor', 'chapter_editors', 'editor', 'editors',
                                        'general_editors', 'volume_editors', 'work_editors', 'contributors',
                                        'chapter_contributors', 'chapter_credit', 'credit_evidence',
                                        'url', 'chapter_url', 'source_url', 'license', 'license_url',
                                        'changes', 'change', 'modifications'):
                                if key in attribution:
                                    values = attribution[key] if isinstance(attribution[key], list) else [attribution[key]]
                                    for value in values:
                                        self.assertIn(value, card['body'])
                            if 'source_attribution_url' in attribution:
                                self.assertIn(attribution['source_attribution_url'], card['body'])
                            for url in re.findall(r'https?://[^\s<>]+', attribution.get('license_evidence', '')):
                                self.assertIn(url.rstrip('.,;'), card['body'])
                        if isinstance(attribution, dict) and ('contributors' in attribution or 'chapter_contributors' in attribution):
                            contributors = attribution.get('contributors', attribution.get('chapter_contributors'))
                            for contributor in contributors if isinstance(contributors, list) else [contributors]:
                                self.assertIn(contributor, card['body'])
                        self.assertRegex(card['body'], r'https?://')
                        self.assertRegex(card['body'], r'변경|요약|재구성|번역')
                        if 'americanyawp.com/textbook/15-capital-and-labor' in card['body']:
                            self.assertIn('장 편집: Joseph L. Locke', card['body'])
                        if 'americanyawp.com/textbook/16-geographies-of-empire' in card['body']:
                            self.assertIn('장 편집자: 미확인', card['body'])
            self.assertLessEqual(total, 10000)
            sidecar = RELATIONS / (genre + '.json')
            self.assertEqual(relations, read(sidecar)['relationships'] if sidecar.exists() else [])
        self.assertEqual(seen, source_ids)
        self.assertEqual(genres, {genre for _, genre, _ in source})

    def test_generator_reproduces_chunks(self):
        spec = importlib.util.spec_from_file_location('expanded_generate', pathlib.Path(__file__).with_name('expanded_generate.py'))
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        with tempfile.TemporaryDirectory() as directory:
            generator.OUTPUT = pathlib.Path(directory)
            with contextlib.redirect_stdout(io.StringIO()):
                generator.generate()
            manifest = read(self.output / 'manifest.json')
            for filename in ['manifest.json'] + [f for w in manifest['worlds'] for f in w['chunks']]:
                self.assertEqual((self.output / filename).read_bytes(), (generator.OUTPUT / filename).read_bytes())

    def test_relation_sidecar_is_split_after_cards(self):
        spec = importlib.util.spec_from_file_location('expanded_generate', pathlib.Path(__file__).with_name('expanded_generate.py'))
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        world = read(BASE)[0]
        edges = [{'id': str(uuid.uuid5(uuid.UUID(world['worldId']), str(i))),
                  'sourceCardId': world['cards'][0]['id'], 'targetCardId': world['cards'][1]['id'],
                  'category': 'structural', 'body': '근거', 'label': '관계',
                  'direction': 'directed', 'polarity': 'asserted'} for i in range(501)]
        with tempfile.TemporaryDirectory() as directory:
            generator.OUTPUT = pathlib.Path(directory) / 'out'
            generator.RELATIONS = pathlib.Path(directory) / 'relations'
            generator.RELATIONS.mkdir()
            (generator.RELATIONS / (world['genre'] + '.json')).write_text(json.dumps({
                'genre': world['genre'], 'worldId': world['worldId'], 'relationships': edges}), encoding='utf-8')
            with contextlib.redirect_stdout(io.StringIO()):
                generator.generate()
            manifest = read(generator.OUTPUT / 'manifest.json')
            generated = next(w for w in manifest['worlds'] if w['genre'] == world['genre'])
            chunks = [read(generator.OUTPUT / f) for f in generated['chunks']]
            self.assertEqual([e for chunk in chunks for e in chunk['relationships']], edges)
            self.assertTrue(all(len(chunk['relationships']) <= 500 for chunk in chunks))
            self.assertTrue(all(not chunk['cards'] for chunk in chunks if chunk['relationships']))
            self.assertTrue(all((generator.OUTPUT / f).stat().st_size < 2_000_000 for f in generated['chunks']))


if __name__ == '__main__':
    unittest.main()
