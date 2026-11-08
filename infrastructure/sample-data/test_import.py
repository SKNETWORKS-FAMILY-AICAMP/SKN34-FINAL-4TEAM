"""Pure source/CSV/loader contracts; never opens a database or starts an application."""
import csv
import io
import shutil
import tempfile
from unittest.mock import patch
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("sample_generator", HERE / "generate.py")
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class SampleImportTest(unittest.TestCase):
    def setUp(self):
        self.source = json.loads((HERE / "source-inventory.json").read_text())
        self.rows = generator.content_rows(self.source)

    def test_counts_and_exact_episode_bodies_and_parent_versions(self):
        self.assertEqual(11, len(self.rows["work"]))
        self.assertEqual(7, len(self.rows["fork"]))
        self.assertEqual(32, len(self.rows["episode_version"]))
        self.assertEqual(17, len(self.rows["publication_event"]))
        self.assertEqual(15, len(self.rows["checkpoint_episode"]))
        self.assertEqual(120, len(self.rows["setting_reading_detail"]))
        versions = {row["id"]: row for row in self.rows["episode_version"]}
        for work in self.source["canonicalMappings"]:
            for episode in work["episodes"]:
                row = versions[episode["versionRowId"]]
                self.assertEqual(episode["bodySha256"], hashlib.sha256(row["content"].encode()).hexdigest())
                self.assertEqual(episode["contentVersionId"], row["content_version_id"])
        for checkpoint in self.rows["checkpoint_episode"]:
            self.assertIn(checkpoint["episode_version_id"], versions)

    def test_future_source_docs_and_properties_remain_private_in_fork(self):
        mappings = {m["slug"]: m for m in self.source["canonicalMappings"]}
        docs = {r["id"]: r for r in self.rows["setting_document"]}
        visibility = {r["id"]: r for r in self.rows["setting_visibility_history"]}
        for slug in ("reply", "postif"):
            work = mappings[slug]
            haram = next(d for d in work["wikiDocuments"] if d["sourceId"] == "char:하람")
            version = next(v for v in self.rows["setting_version"] if v["setting_document_id"] == haram["documentId"])
            self.assertEqual("private", visibility[version["visibility_history_id"]]["default_visibility"])
            detail = next(d for d in self.rows["setting_reading_detail"] if d["setting_version_id"] == version["id"])
            self.assertEqual(1, detail["source_basis_episode"])
        self.assertEqual(120, len(docs))

    def test_property_disclosure_is_fact_specific_and_unknown_is_private(self):
        maps = {m['slug']: m for m in self.source['canonicalMappings']}
        versions = {r['setting_document_id']: r['id'] for r in self.rows['setting_version']}
        for slug in ('starlight', 'crown', 'seal'):
            doc = next(d for d in maps[slug]['wikiDocuments'] if d['sourceId'] == 'char:카엘')
            prop = next(p for p in self.rows['setting_reading_property'] if p['setting_version_id'] == versions[doc['documentId']] and p['name'] == '관계')
            self.assertEqual(2, prop['public_from_episode'], slug)
            visible = lambda episode: prop['episode'] <= episode and prop['public_from_episode'] is not None and prop['public_from_episode'] <= episode
            self.assertFalse(visible(1))
            self.assertTrue(visible(2))
        for slug, doc_id, name, epoch, public_at in [('postman','char:도윤','관계',0,2),('guunmong','char:팔선녀','관계',0,2),('guunmong','char:성진','상태',2,3),('guunmong','char:성진','상태',3,4)]:
            doc = next(d for d in maps[slug]['wikiDocuments'] if d['sourceId'] == doc_id)
            prop = next(p for p in self.rows['setting_reading_property'] if p['setting_version_id'] == versions[doc['documentId']] and p['name'] == name and p['episode'] == epoch)
            self.assertEqual(public_at, prop['public_from_episode'])
        doc = next(d for d in maps['starlight']['wikiDocuments'] if d['sourceId'] == 'char:세라핀')
        unknown = next(p for p in self.rows['setting_reading_property'] if p['setting_version_id'] == versions[doc['documentId']] and p['name'] == '성격')
        self.assertIsNone(unknown['public_from_episode'])

    def test_every_wiki_body_and_rich_field_survives_normalization(self):
        mappings = {m['slug']: m for m in self.source['canonicalMappings']}
        versions = {r['setting_document_id']: r for r in self.rows['setting_version']}
        details = {r['setting_version_id']: r for r in self.rows['setting_reading_detail']}
        for work in self.source['works']:
            ids = {d['sourceId']: d for d in mappings[work['id']]['wikiDocuments']}
            for doc in work['wiki']['docs']:
                version = versions[ids[doc['id']]['documentId']]
                vid = version['id']
                self.assertEqual(doc['body'], version['content'])
                self.assertEqual(doc['t'], version['name'])
                self.assertEqual(doc['cat'], details[vid]['wiki_category'])
                self.assertEqual(doc.get('img'), details[vid]['image'])
                self.assertEqual(doc.get('ep'), details[vid]['event_episode'])
                self.assertEqual(doc.get('line'), details[vid]['event_line'])
                rows = lambda table: [r for r in self.rows.get(table, []) if r['setting_version_id'] == vid]
                expected = [(0, n, v) for n, v in doc.get('props', {}).items()]
                expected += [(int(epoch), n, v) for epoch, props in doc.get('at', {}).items() for n, v in props.items()]
                self.assertEqual(expected, [(r['episode'], r['name'], r['value']) for r in rows('setting_reading_property')])
                self.assertEqual(doc.get('alias', []), [r['alias'] for r in rows('setting_reading_alias')])
                self.assertEqual(doc.get('who', []), [r['name'] for r in rows('setting_reading_participant')])
                self.assertEqual([(ids[l['to']]['logicalId'], l['k']) for l in doc.get('links', [])], [(r['target_logical_id'], r['kind']) for r in rows('setting_reading_link')])
                self.assertEqual([(k['text'], k['knownAt'], k.get('publicAt')) for k in doc.get('knowledge', [])], [(r['content'], r['known_at'], r['public_at']) for r in rows('setting_reading_knowledge')])
                tags = {r['id']: r['name'] for r in self.rows.get('setting_tag', [])}
                self.assertEqual(doc.get('tags', []), [tags[r['setting_tag_id']] for r in rows('setting_version_tag')])
        self.assertEqual(9, len(self.rows['setting_reading_link']))

    def test_inherited_bodies_and_checkpoint_source_relationships_are_exact(self):
        versions = {r['id']: r for r in self.rows['episode_version']}
        checkpoint_rows = {(r['checkpoint_id'], r['episode_id']): r for r in self.rows['checkpoint_episode']}
        forks = {r['work_id']: r for r in self.rows['fork']}
        for work in self.source['canonicalMappings']:
            for inherited in work['sourceEpisodeVersionIds']:
                source = versions[inherited['sourceVersionRowId']]
                local = versions[inherited['localVersionRowId']]
                self.assertEqual(source['content'], local['content'])
                self.assertEqual(source['title'], local['title'])
                self.assertEqual(source['content_version_id'], local['content_version_id'])
                self.assertFalse(local['is_saved'])
                cp = checkpoint_rows[(forks[work['workId']]['source_checkpoint_id'], inherited['sourceEpisodeId'])]
                self.assertEqual(inherited['sourceVersionRowId'], cp['episode_version_id'])
        self.assertTrue(all(r['public_from_episode'] is None or r['public_from_episode'] >= r['episode'] for r in self.rows['setting_reading_property']))
        self.assertTrue(all(r['reference_status'] == 'independent' for r in self.rows['fork_world_reference']))
        self.assertFalse(any('likes' in r or 'views' in r or 'comments' in r for rows in self.rows.values() for r in rows))

    def test_old_migration_bytes_are_unchanged(self):
        for entry in self.source["preserveMigrationBytes"]:
            self.assertEqual(entry["sha256"], hashlib.sha256((ROOT / entry["file"]).read_bytes()).hexdigest(), entry["file"])

    def loader(self):
        spec = importlib.util.spec_from_file_location('sample_loader', HERE / 'load.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_csv_artifacts_are_normalized_exact_current_and_runtime_inputs(self):
        loader = self.loader()
        for service, rows in (('core', generator.core_rows(self.source)), ('content', self.rows)):
            with tempfile.TemporaryDirectory() as tmp:
                generator.write_csv(service, rows, Path(tmp))
                for table, columns in loader.TABLES[service].items():
                    path = HERE / service / (table + '.csv')
                    self.assertEqual(path.read_bytes(), (Path(tmp) / service / path.name).read_bytes())
                    self.assertEqual(columns, next(csv.reader(io.StringIO(path.read_text(encoding='utf-8')))))
                    self.assertEqual(rows.get(table, []), loader.read_table(path, columns))
            self.assertFalse((HERE / service / 'import.sql').exists())
        self.assertEqual(9, len(loader.read_table(HERE / 'core/auth_member.csv', loader.TABLES['core']['auth_member'])))
        self.assertTrue(all(not r['operator'] for r in generator.core_rows(self.source)['auth_member']))
        # No SQL generators or whole-aggregate JSON fields serve as a second sample source.
        self.assertFalse(hasattr(generator, 'render'))
        self.assertNotIn('source-inventory.json', (HERE / 'load.py').read_text())

    def test_loader_columns_exist_in_owned_migrations(self):
        # A real PostgreSQL apply failed on a CSV-only column; keep loader columns tied to the migration schema.
        import re
        migrations = ROOT / 'backend/core-api/src/main/resources/db/migration', ROOT / 'backend/content-service/src/main/resources/db/migration'
        sql = '\n'.join(p.read_text() for base in migrations for p in sorted(base.rglob('V*.sql')))
        columns = {}
        for table, body in re.findall(r'CREATE TABLE (\w+) \((.*?)\);', sql, re.S):
            parts = re.split(r',(?![^()]*\))', body)
            columns.setdefault(table, set()).update(p.split()[0] for p in parts if p.split() and p.split()[0].upper() not in {'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'CONSTRAINT', 'EXCLUDE'})
        for table, column in re.findall(r'ALTER TABLE (\w+) ADD COLUMN (\w+)', sql):
            columns.setdefault(table, set()).add(column)
        for service, tables in self.loader().TABLES.items():
            for table, names in tables.items():
                self.assertEqual([], [c for c in names if c not in columns.get(table, set())], f'{service}.{table}')

    def test_loader_uses_guarded_copy_staging_without_data_as_sql(self):
        loader = self.loader()
        for service in ('core', 'content'):
            script = loader.build_script(service, HERE, 'approved_db', 'approved_schema', 'approved-development')
            self.assertIn('IS DISTINCT FROM', script)
            self.assertIn("SET LOCAL lock_timeout = '5s'", script)
            self.assertIn('pg_try_advisory_xact_lock', script)
            self.assertIn('FROM STDIN WITH (FORMAT text', script)
            self.assertLess(script.index(' IN SHARE ROW EXCLUSIVE MODE;'), script.index('CREATE TEMP TABLE'))
            if service == 'core':
                self.assertLess(script.index('LOCK TABLE auth_member'), script.index('Existing ordinary development writer identity'))
            self.assertNotIn('DO UPDATE', script)
            self.assertNotIn('DELETE FROM', script)
            self.assertNotIn('VALUES\n', script)
            self.assertIn('COMMIT;', script)
        with self.assertRaises(ValueError):
            loader.build_script('content', HERE, 'approved_db', 'public', 'no')
        for bad in ('bad-schema', 'public; DROP TABLE work;', 'public\n\\!whoami'):
            with self.assertRaises(ValueError):
                loader.build_script('content', HERE, 'approved_db', bad, 'approved-development')
        # Real multiline CSV, quotes and psql metacommands are safely COPY-text encoded.
        columns = loader.TABLES['content']['world']
        row = dict(self.rows['world'][0], description="한글, \"인용\"\n\\.\n\\! touch must-not-run\r\nSELECT 'not SQL';", name='\\N')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'world.csv'
            generator.write_csv('content', {'world': [row]}, Path(tmp))
            path = Path(tmp) / 'content/world.csv'
            decoded = loader.read_table(path, columns)
            self.assertEqual([row], decoded)
            payload = loader.copy_data(columns, decoded)
            self.assertNotIn('\n\\.\n', payload)
            self.assertNotIn('\n\\! touch', payload)
            parsed = payload.rstrip('\n').split('\t')
            self.assertEqual(loader.copy_escape(row['description']), parsed[columns.index('description')])
            self.assertEqual('\\\\N', parsed[columns.index('name')])

    def test_invalid_csv_fails_before_any_psql_process(self):
        loader = self.loader()
        columns = loader.TABLES['core']['auth_member']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(HERE / 'core', root / 'core')
            path = root / 'core/auth_member.csv'
            valid = path.read_text(encoding='utf-8')
            cases = [valid.replace('id,email,', 'id,rogue,', 1), valid + valid.splitlines()[1] + '\n', valid + 'too,few\n', valid.replace(',false', ',not-a-bool', 1), valid.replace('!sample-import', '\x00sample-import', 1)]
            for text in cases:
                path.write_text(text, encoding='utf-8')
                with patch.object(loader.subprocess, 'run') as run:
                    with self.assertRaises(ValueError):
                        loader.load('core', root, 'fixture', 'db', 'public', 'approved-development')
                    run.assert_not_called()
            path.write_text(valid, encoding='utf-8')
            with patch.object(loader.subprocess, 'run') as run:
                run.return_value.returncode = 0
                loader.load('core', root, 'fixture', 'db', 'public', 'approved-development')
                args, kwargs = run.call_args
                self.assertIn('--no-password', args[0])
                self.assertEqual('service=fixture', args[0][-1])
                self.assertNotIn('shell', kwargs)
                self.assertIn('COPY sample_expected_auth_member', kwargs['input'])
                self.assertTrue(kwargs['capture_output'])
                self.assertEqual(120, kwargs['timeout'])
            with patch.object(loader.subprocess, 'run', side_effect=loader.subprocess.TimeoutExpired('psql', 120, stderr='secret-value')):
                with self.assertRaisesRegex(RuntimeError, 'commit outcome is unconfirmed') as error:
                    loader.load('core', root, 'fixture', 'db', 'public', 'approved-development')
                self.assertNotIn('secret-value', str(error.exception))
            with patch.object(loader.subprocess, 'run') as run:
                run.return_value.returncode = 3
                run.return_value.stderr = 'ERROR: Conflicting existing auth_member sample row; no overwrite is permitted\nsecret-value'
                with self.assertRaisesRegex(RuntimeError, 'no overwrite') as error:
                    loader.load('core', root, 'fixture', 'db', 'public', 'approved-development')
                self.assertNotIn('secret-value', str(error.exception))


if __name__ == "__main__":
    unittest.main()
