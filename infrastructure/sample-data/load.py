"""Render the canonical sample CSVs into each service's Flyway sample migration (stdlib only).

Run `python3 -I infrastructure/sample-data/load.py` after editing a CSV and commit the regenerated SQL.
"""
import csv
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
# Ordinary next-version migrations; once applied they are immutable, so later sample changes need a new version.
MIGRATIONS = {
    'core': ROOT / 'backend/core-api/src/main/resources/db/migration/sample/V9__sample_auth_member.sql',
    'content': ROOT / 'backend/content-service/src/main/resources/db/migration/sample/V16__sample_content.sql',
}
# Fixed schema/column allowlist, in FK insertion order. No CSV value becomes an SQL identifier.
TABLES = {
    'core': {'auth_member': 'id,email,password_hash,nickname,operator'},
    'content': {
        'member': 'id',
        'work': 'id,owner_id,title,description,origin_kind,creation_type,revision,deleted_episode_revision,created_at,slug,author_name,theme,hook,hanja,hero_line1,hero_line2,hero_background',
        'world': 'id,owner_id,name,description,revision,created_at',
        'work_world_history': 'id,work_id,world_id,revision_no,changed_at',
        'work_publication_history': 'id,work_id,revision_no,visibility,changed_at',
        'work_genre': 'work_id,genre_id',
        'work_hashtag': 'id,work_id,tag,position',
        'episode': 'id,work_id,sequence',
        'episode_version': 'id,episode_id,content_version_id,revision_no,title,content,created_at,is_saved,work_world_history_id',
        'publication_event': 'id,episode_version_id,actor_id,action,outcome,occurred_at,trigger_kind',
        'fork_policy_history': 'id,work_id,allow_creation,allow_publication,episode_scope,start_episode_id,changed_at,revision_no',
        'setting_document': 'id,world_id,logical_id,created_at',
        'setting_visibility_history': 'id,setting_document_id,revision_no,default_visibility,changed_at',
        'setting_visibility_range': 'id,visibility_history_id,start_episode_id,end_episode_id,visibility',
        'setting_version': 'id,setting_document_id,content_version_id,revision_no,name,category_id,content,evidence,created_at,lifecycle,visibility_history_id',
        'setting_reading_detail': 'setting_version_id,source_key,wiki_category,color,image,event_episode,event_line,source_basis_episode',
        'setting_reading_property': 'setting_version_id,position,episode,name,value,public_from_episode',
        'setting_reading_alias': 'setting_version_id,position,alias',
        'setting_reading_participant': 'setting_version_id,position,name',
        'setting_reading_link': 'setting_version_id,position,target_logical_id,kind',
        'setting_reading_knowledge': 'setting_version_id,position,content,known_at,public_at',
        'setting_tag': 'id,owner_id,name',
        'setting_version_tag': 'setting_version_id,setting_tag_id,position',
        'setting_document_tag': 'setting_document_id,setting_tag_id',
        'checkpoint': 'id,work_id,episode_id,basis_episode_version_id,status,created_at',
        'checkpoint_episode': 'checkpoint_id,source_work_id,episode_id,episode_version_id',
        'checkpoint_setting': 'checkpoint_id,setting_document_id,setting_version_id',
        'fork': 'work_id,source_work_id,owner_id,source_checkpoint_id,confirmed_policy_history_id,conditions_confirmed_at,source_title,direction,world_revision,created_at',
        'fork_source_setting': 'fork_work_id,setting_document_id,setting_version_id',
        'fork_world_reference': 'fork_work_id,source_world_id,reference_status,last_followed_checkpoint_id,detached_at',
    },
}
TABLES = {service: {table: columns.split(',') for table, columns in tables.items()} for service, tables in TABLES.items()}
KEYS = {'work_genre': ['work_id', 'genre_id'], 'setting_reading_detail': ['setting_version_id'],
    **{t: ['setting_version_id', 'position'] for t in ['setting_reading_property', 'setting_reading_alias', 'setting_reading_participant', 'setting_reading_link', 'setting_reading_knowledge']},
    'setting_version_tag': ['setting_version_id', 'setting_tag_id'], 'setting_document_tag': ['setting_document_id', 'setting_tag_id'],
    'checkpoint_episode': ['checkpoint_id', 'episode_id'], 'checkpoint_setting': ['checkpoint_id', 'setting_document_id'],
    'fork': ['work_id'], 'fork_source_setting': ['fork_work_id', 'setting_document_id'], 'fork_world_reference': ['fork_work_id']}
INTEGERS = set('revision deleted_episode_revision revision_no position sequence episode event_episode source_basis_episode public_from_episode known_at public_at world_revision'.split())
BOOLEANS = {'operator', 'is_saved', 'allow_creation', 'allow_publication'}
NULLABLE = set('hanja hero_line1 hero_line2 hero_background start_episode_id end_episode_id image event_episode event_line source_basis_episode public_from_episode public_at confirmed_policy_history_id conditions_confirmed_at last_followed_checkpoint_id detached_at'.split())
NULL = r'\N'  # Reserved CSV null marker; empty string remains an empty string.


def read_table(path, columns):
    rows = []
    keys = KEYS.get(path.stem, ['id'])
    seen = set()
    try:
        with path.open(encoding='utf-8', newline='') as stream:
            reader = csv.reader(stream, strict=True)
            if next(reader, None) != columns:
                raise ValueError(f'Unexpected CSV header: {path.name}')
            for fields in reader:
                if len(fields) != len(columns):
                    raise ValueError(f'Unexpected CSV field count: {path.name}')
                row = {}
                for column, field in zip(columns, fields):
                    if '\x00' in field:
                        raise ValueError(f'NUL in CSV: {path.name}/{column}')
                    value = None if field == NULL else field[1:] if field.startswith('\\\\') else field
                    if value is None and column not in NULLABLE:
                        raise ValueError(f'NULL in required column: {path.name}/{column}')
                    if value is not None and column in INTEGERS:
                        if not re.fullmatch(r'0|[1-9][0-9]*', value):
                            raise ValueError(f'Invalid integer: {path.name}/{column}')
                        value = int(value)
                    if value is not None and column in BOOLEANS:
                        if value not in ('true', 'false'):
                            raise ValueError(f'Invalid boolean: {path.name}/{column}')
                        value = value == 'true'
                    row[column] = value
                identity = tuple(row[k] for k in keys)
                if identity in seen:
                    raise ValueError(f'Duplicate CSV primary key: {path.name}')
                seen.add(identity)
                if path.stem == 'auth_member' and (row['operator'] or row['password_hash'] != '!sample-import-login-disabled'):
                    raise ValueError('Sample accounts must remain ordinary and login-disabled')
                rows.append(row)
    except (csv.Error, UnicodeError) as failure:
        raise ValueError(f'Invalid UTF-8 CSV: {path.name}') from failure
    return rows


def sql_literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    if '${' in value:
        raise ValueError('Flyway placeholder syntax is not allowed in sample values')
    # PostgreSQL standard_conforming_strings: only the quote needs escaping; backslashes/newlines stay literal.
    return "'" + value.replace("'", "''") + "'"


def render_sql(service, root=HERE):
    tables = TABLES[service]
    if {p.stem for p in (root / service).glob('*.csv')} != set(tables):
        raise ValueError('CSV table set does not match the fixed service allowlist')
    rows = {t: read_table(root / service / (t + '.csv'), cols) for t, cols in tables.items()}  # Validate everything first.
    output = [f'-- Generated from infrastructure/sample-data/{service}/*.csv by load.py. Do not edit by hand.\n'
              '-- Additive development samples: rows whose key already exists are kept as-is (ON CONFLICT DO NOTHING).']
    for table, columns in tables.items():
        if not rows[table]:
            continue
        values = ',\n'.join('(' + ', '.join(sql_literal(row[c]) for c in columns) + ')' for row in rows[table])
        keys = ', '.join(KEYS.get(table, ['id']))
        output.append(f'INSERT INTO {table} ({", ".join(columns)}) VALUES\n{values}\nON CONFLICT ({keys}) DO NOTHING;')
    return '\n\n'.join(output) + '\n'


if __name__ == '__main__':
    for service, path in MIGRATIONS.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_sql(service), encoding='utf-8')
        print(f'wrote {path.relative_to(ROOT)}')
