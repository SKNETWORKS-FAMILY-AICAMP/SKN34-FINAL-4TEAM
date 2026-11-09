import importlib.util
import unittest
from pathlib import Path

import hashlib
import json
import uuid

def package_loader(root):
    spec = importlib.util.spec_from_file_location('package_loader',root/'load.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def content_key(*parts):
    return str(uuid.UUID(bytes=hashlib.md5('\0'.join(parts).encode()).digest(),version=3))

PACKAGE=Path(__file__).resolve().parent
INDEX=json.loads((PACKAGE/'genre-index.json').read_text(encoding='utf-8'))
TEMPLATES=[json.loads((PACKAGE/g['genre_id']/'source/template.json').read_text(encoding='utf-8')) for g in INDEX['genres']]

class SavedFlowTest(unittest.TestCase):
    def test_saved_snapshot_and_editor_state(self):
        root = Path(__file__).resolve().parent
        loader = package_loader(root)
        all_ids = set()
        for genre in TEMPLATES:
            path = root / genre['genre_id']
            rows = {t: loader.read_table(path / 'content' / (t+'.csv'), c) for t,c in loader.TABLES['content'].items()}
            work, world, episode, version = (rows[t][0] for t in ('work','world','episode','episode_version'))
            self.assertEqual(episode['id'], content_key('episode', work['id'], '1'))
            self.assertEqual(version['id'], content_key('episode-version', episode['id'], version['content_version_id']))
            self.assertEqual(1, len(rows['checkpoint']))
            cp = rows['checkpoint'][0]
            self.assertEqual(cp['id'], content_key('writing-checkpoint', version['content_version_id']))
            self.assertEqual('content_only', cp['status'])
            self.assertEqual(version['id'], cp['basis_episode_version_id'])
            self.assertEqual([dict(checkpoint_id=cp['id'],source_work_id=work['id'],episode_id=episode['id'],episode_version_id=version['id'])], rows['checkpoint_episode'])
            docs = {d['id']:d for d in rows['setting_document']}
            self.assertFalse(all_ids & set(docs))
            all_ids.update(docs)
            self.assertEqual({(v['setting_document_id'],v['id']) for v in rows['setting_version']}, {(r['setting_document_id'],r['setting_version_id']) for r in rows['checkpoint_setting']})
            self.assertTrue(all(r['checkpoint_id']==cp['id'] for r in rows['checkpoint_setting']))
            for v in rows['setting_version']:
                d = docs[v['setting_document_id']]
                self.assertEqual(world['id'],d['world_id'])
                self.assertEqual(d['id'],content_key('setting',world['id'],d['logical_id']))
                self.assertEqual(v['id'],content_key('setting-version',d['id'],v['content_version_id']))
            self.assertEqual(len(docs),len(rows['setting_visibility_range']))
            self.assertTrue(all(r['start_episode_id']==episode['id'] and r['end_episode_id'] is None and r['visibility']=='private' for r in rows['setting_visibility_range']))
            draft = rows['episode_draft'][0]
            self.assertEqual(version['content'],draft['content'])
            self.assertEqual(version['revision_no'],draft['edit_revision'])
            self.assertEqual(len(docs),world['revision'])
            self.assertEqual(list(range(len(docs))),[v['revision_no'] for v in rows['setting_version']])
            self.assertEqual(genre['content_markdown'].encode(),(path/'source/original.md').read_bytes())
            for service in ('core','content'):
                self.assertEqual(loader.render_sql(service,path).encode(),(path/'sql'/f'{service}.sql').read_bytes())
            for t in ('fork','publication_event'):
                self.assertFalse(rows[t])
        self.assertEqual(259,len(all_ids))

if __name__ == '__main__':
    unittest.main()
