import importlib.util
import contextlib
import io
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from uuid import uuid5, UUID, NAMESPACE_URL

spec = importlib.util.spec_from_file_location('merge', Path(__file__).with_name('merge.py'))
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)

W = str(uuid5(NAMESPACE_URL, 'world'))
A = str(uuid5(NAMESPACE_URL, 'a'))
B = str(uuid5(NAMESPACE_URL, 'b'))
C = str(uuid5(NAMESPACE_URL, 'c'))
R = str(uuid5(NAMESPACE_URL, 'relation'))


def relation(**changes):
    return dict({'id': R, 'sourceCardId': A, 'targetCardId': B, 'category': 'structural',
                 'body': '가와 나는 형제이다. 출처: 번역본 제1장 https://example.com/1',
                 'label': '형제', 'direction': 'symmetric', 'polarity': 'asserted'}, **changes)


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'worlds').mkdir()
        self.worlds = {'test': {'worldId': W, 'cards': {A, B, C}}}
        self.addCleanup(self.temp.cleanup)

    def write(self, name, **data):
        (self.root / 'worlds' / name).write_text(json.dumps({'genre': 'test', 'worldId': W, **data}), encoding='utf-8')

    def test_coverage_output_is_compact_and_reproducible(self):
        self.write('test--a.json', relationships=[relation()], reviewedCardIds=[A, B], ambiguousCardIds=[C])
        _, expected = merge.collect(self.worlds, self.root / 'worlds')
        args = ['merge.py', '--inputs', str(self.root / 'worlds'), '--output', str(self.root / 'output'),
                '--manifest', str(self.root / 'missing-manifest.json')]
        with patch.object(merge, 'read_cards', return_value=self.worlds), patch('sys.argv', args), contextlib.redirect_stdout(io.StringIO()):
            merge.main()
            coverage = self.root / 'output' / 'coverage.json'
            first = coverage.read_bytes()
            self.assertEqual(json.loads(first), expected)
            self.assertEqual(first, (json.dumps(expected, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8'))
            merge.main()
            self.assertEqual(coverage.read_bytes(), first)

    def test_merge_keeps_meaning_and_only_explicit_review(self):
        self.write('test--a.json', relationships=[relation()], reviewedCardIds=[A, B], ambiguousCardIds=[C])
        worlds, report = merge.collect(self.worlds, self.root / 'worlds')
        self.assertEqual(worlds['test'], [relation()])
        self.assertEqual(report['totals'], {'input': 3, 'processed': 2, 'unlinked': 1, 'ambiguous': 1, 'relations': 1, 'remaining': 1})
        self.assertEqual(report['worlds']['test']['pendingCardIds'], [C])

    def test_batches_union_coverage_and_flag_possible_semantic_duplicates(self):
        other = relation(id=str(uuid5(NAMESPACE_URL, 'second')), body='가와 나는 형제다. 출처: 다른 번역본 제2장 https://example.com/2')
        self.write('test--a.json', relationships=[relation()], reviewedCardIds=[A, B], ambiguousCardIds=[B])
        self.write('test--b.json', relationships=[other], reviewedCardIds=[B, C])
        worlds, report = merge.collect(self.worlds, self.root / 'worlds')
        self.assertEqual(worlds['test'], [relation(), other])
        self.assertEqual(report['totals']['processed'], 3)
        self.assertEqual(report['totals']['remaining'], 1)
        self.assertEqual(report['worlds']['test']['pendingCardIds'], [B])
        self.assertEqual(report['worlds']['test']['possibleDuplicateIds'], [[R, other['id']]])

    def test_batches_reject_world_and_cross_batch_collisions(self):
        self.write('test--a.json', relationships=[relation()])
        self.write('test--b.json', relationships=[relation(id=str(uuid5(NAMESPACE_URL, 'second')))])
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')
        self.write('test--b.json', relationships=[], worldId=str(uuid5(NAMESPACE_URL, 'other-world')))
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')

    def test_creative_source_card_is_a_checked_location(self):
        self.write('creative-test.json', relationships=[relation(body=f'가와 나는 형제이다. 근거 카드 ID: {A}')])
        worlds, _ = merge.collect(self.worlds, self.root / 'worlds')
        self.assertEqual(len(worlds['test']), 1)
        self.write('creative-test.json', relationships=[relation(body=f'가와 나는 형제이다. 근거 카드 ID: {uuid5(NAMESPACE_URL, "foreign")}')])
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')

    def test_rejects_invalid_edges_and_duplicate_reversed_symmetric(self):
        for invalid in [relation(targetCardId=C, category='other'), relation(targetCardId=A),
                        relation(targetCardId=str(uuid5(NAMESPACE_URL, 'foreign'))),
                        relation(body='근거 없음'), relation(id='not-uuid')]:
            with self.subTest(invalid=invalid):
                self.write('test--a.json', relationships=[invalid])
                with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')
        self.write('test--a.json', relationships=[relation(), relation(id=str(uuid5(NAMESPACE_URL, 'other')), sourceCardId=B, targetCardId=A)])
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')

    def test_rejects_colliding_ids_and_missing_reviewed_cards(self):
        self.write('test--a.json', relationships=[relation(id=A)])
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')
        self.write('test--a.json', relationships=[relation()])
        self.write('test--b.json', relationships=[relation(targetCardId=C)])
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')
        self.write('test--b.json', relationships=[], reviewedCardIds=['missing'])
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'worlds')

    def test_missing_directories_and_repeated_card_ids_are_errors(self):
        with self.assertRaises(ValueError): merge.collect(self.worlds, self.root / 'missing')
        templates = [{'genre': 'test', 'worldId': W, 'cards': [{'id': A}, {'id': A}]}]
        (self.root / 'templates.json').write_text(json.dumps(templates))
        for directory in ('history', 'myth', 'expansion'):
            (self.root / directory).mkdir()
        with self.assertRaises(ValueError):
            merge.read_cards(self.root / 'templates.json', self.root / 'history', self.root / 'myth', self.root / 'expansion')

    def test_read_input_retains_distinct_candidates_and_separates_temporary_worlds(self):
        templates = [{'genre': 'test', 'worldId': W, 'cards': [{'id': A}]}]
        (self.root / 'templates.json').write_text(json.dumps(templates))
        history = self.root / 'history' / 'test'
        history.mkdir(parents=True)
        (history / 'index.json').write_text(json.dumps({'genre': 'test', 'worldId': W}))
        (history / 'cards-001.json').write_text(json.dumps([{'id': B}]))
        myth = self.root / 'myth' / 'test'
        myth.mkdir(parents=True)
        (myth / 'index.json').write_text(json.dumps({'genre': 'test', 'world_id_reference': W}))
        (myth / 'cards-001.json').write_text(json.dumps({'genre': 'test', 'cards': [{'id': C}]}))
        expansion = self.root / 'expansion'
        expansion.mkdir()
        (self.root / 'index.json').write_text(json.dumps({'project_namespace_for_new_labels': 'c62a8e33-1fb5-5ef4-aea1-a896a1ac84ea'}))
        (expansion / 'cards-001.json').write_text(json.dumps([{'id': str(uuid5(NAMESPACE_URL, name)), 'world_id': 'new_tradition'} for name in ('d', 'e')]))
        (self.root / 'manifest.json').write_text(json.dumps({'worlds': [{'genre': 'test', 'worldId': W}, {'genre': 'new_tradition', 'worldId': str(uuid5(UUID('c62a8e33-1fb5-5ef4-aea1-a896a1ac84ea'), 'new_tradition'))}]}))
        index_dir = self.root / 'worlds' / 'new_tradition'
        index_dir.mkdir()
        (index_dir / 'index.json').write_text(json.dumps({'world_id': 'new_tradition', 'id_namespace': str(uuid5(UUID('c62a8e33-1fb5-5ef4-aea1-a896a1ac84ea'), 'new_tradition'))}))
        worlds = merge.read_cards(self.root / 'templates.json', self.root / 'history', self.root / 'myth', expansion)
        self.assertEqual(worlds['test']['cards'], {A, B, C})
        self.assertEqual(worlds['new_tradition']['worldId'], str(uuid5(UUID('c62a8e33-1fb5-5ef4-aea1-a896a1ac84ea'), 'new_tradition')))
        merge.validate_manifest(worlds, self.root / 'manifest.json')
        self.write('new--batch.json', genre='new_tradition', worldId=worlds['new_tradition']['worldId'],
                   relationships=[relation(sourceCardId=str(uuid5(NAMESPACE_URL, 'd')), targetCardId=str(uuid5(NAMESPACE_URL, 'e')))])
        edges, _ = merge.collect(worlds, self.root / 'worlds')
        self.assertEqual(len(edges['new_tradition']), 1)
        (index_dir / 'index.json').write_text(json.dumps({'world_id': 'new_tradition', 'id_namespace': W}))
        with self.assertRaises(ValueError):
            merge.read_cards(self.root / 'templates.json', self.root / 'history', self.root / 'myth', expansion)
        manifest = json.loads((self.root / 'manifest.json').read_text())
        manifest['worlds'][1]['worldId'] = W
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError): merge.validate_manifest(worlds, self.root / 'manifest.json')


if __name__ == '__main__':
    unittest.main()
