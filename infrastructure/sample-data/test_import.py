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

    def test_flyway_migrations_are_exactly_rendered_from_csv(self):
        loader = self.loader()
        self.assertEqual({'core': 'V9__sample_auth_member.sql', 'content': 'V16__sample_content.sql'}, {s: p.name for s, p in loader.MIGRATIONS.items()})
        for service, path in loader.MIGRATIONS.items():
            self.assertEqual(loader.render_sql(service), path.read_text(encoding='utf-8'), f'regenerate {path.name} with load.py')

    def test_rendered_sql_is_additive_and_literal_safe(self):
        loader = self.loader()
        for service in ('core', 'content'):
            sql = loader.render_sql(service)
            filled = [t for t, cols in loader.TABLES[service].items() if loader.read_table(HERE / service / (t + '.csv'), cols)]
            self.assertEqual([f'INSERT INTO {t} (' for t in filled], [line[:len(f'INSERT INTO {t} (')] for t, line in zip(filled, [l for l in sql.splitlines() if l.startswith('INSERT INTO')])])
            for forbidden in ('UPDATE ', 'DELETE ', 'DROP ', 'TRUNCATE', 'DO UPDATE', '${'):
                self.assertNotIn(forbidden, sql)
            self.assertEqual(sql.count('INSERT INTO'), sql.count('DO NOTHING;'))
        self.assertEqual("'it''s'", loader.sql_literal("it's"))
        self.assertEqual("'a\\b\n--; c'", loader.sql_literal('a\\b\n--; c'))
        self.assertEqual(('NULL', 'true', '7'), (loader.sql_literal(None), loader.sql_literal(True), loader.sql_literal(7)))
        with self.assertRaises(ValueError):
            loader.sql_literal('${flyway:user}')
        self.assertIn("ON CONFLICT (work_id, genre_id) DO NOTHING;", loader.render_sql('content'))
        self.assertNotIn('psql', (HERE / 'load.py').read_text())

    def test_invalid_csv_fails_before_rendering(self):
        loader = self.loader()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(HERE / 'core', root / 'core')
            path = root / 'core/auth_member.csv'
            valid = path.read_text(encoding='utf-8')
            cases = [valid.replace('id,email,', 'id,rogue,', 1), valid + valid.splitlines()[1] + '\n', valid + 'too,few\n', valid.replace(',false', ',not-a-bool', 1), valid.replace('!sample-import', '\x00sample-import', 1)]
            for text in cases:
                path.write_text(text, encoding='utf-8')
                with self.assertRaises(ValueError):
                    loader.render_sql('core', root)


if __name__ == "__main__":
    unittest.main()
