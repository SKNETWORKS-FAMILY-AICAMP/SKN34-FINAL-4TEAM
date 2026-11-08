"""Approved, additive CSV import using stdlib + psql; no sample SQL files or runtime seed."""
import argparse
import csv
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
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


def copy_escape(value):
    if value is None:
        return NULL
    text = str(value).lower() if isinstance(value, bool) else str(value)
    return text.replace('\\', '\\\\').replace('\t', r'\t').replace('\n', r'\n').replace('\r', r'\r')


def copy_data(columns, rows):
    # Convert validated CSV to COPY text: one physical line per row, no embedded psql terminator/metacommand.
    return ''.join('\t'.join(copy_escape(row[c]) for c in columns) + '\n' for row in rows)


def build_script(service, root, database, schema, approval):
    if service not in TABLES or approval != 'approved-development':
        raise ValueError('Explicit development approval and known service are required')
    if not all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', value) for value in (database, schema)):
        raise ValueError('Approved database/schema must be simple PostgreSQL identifiers')
    tables = TABLES[service]
    if {p.stem for p in (root / service).glob('*.csv')} != set(tables):
        raise ValueError('CSV table set does not match the fixed service allowlist')
    rows = {t: read_table(root / service / (t + '.csv'), cols) for t, cols in tables.items()}
    output = ['\\encoding UTF8', 'BEGIN;', 'SET LOCAL standard_conforming_strings = on;', "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL statement_timeout = '60s';", "SET LOCAL idle_in_transaction_session_timeout = '60s';",
        f'SET LOCAL search_path TO "{schema}";', 'DO $$ BEGIN',
        f" IF current_database() IS DISTINCT FROM '{database}' OR current_schema() IS DISTINCT FROM '{schema}' THEN",
        "  RAISE EXCEPTION 'Explicit development import approval and exact database/schema are required'; END IF;",
        " IF NOT pg_try_advisory_xact_lock(736521904) THEN RAISE EXCEPTION 'Another sample import holds the lock'; END IF; END $$;"]
    # ponytail: one-off import locks all owned targets; online/live imports require a separate design.
    output += ['LOCK TABLE ' + ','.join(tables) + ' IN SHARE ROW EXCLUSIVE MODE;']
    if service == 'core':
        output += ["DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth_member WHERE id='b832d965-0352-4eb1-b896-7a307ba09a68' AND email='writer@example.test' AND operator=false) THEN",
            " RAISE EXCEPTION 'Existing ordinary development writer identity must be verified first'; END IF; END $$;"]
    else:
        output += ["DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='work' AND column_name='slug') OR to_regclass('setting_reading_detail') IS NULL THEN",
            " RAISE EXCEPTION 'Content V15 reading metadata schema is required; do not reset or repair migration history'; END IF; END $$;"]
    for table, columns in tables.items():
        names = ','.join(columns)
        output += [f'CREATE TEMP TABLE sample_expected_{table} (LIKE {table} INCLUDING DEFAULTS) ON COMMIT DROP;',
            f'COPY sample_expected_{table} ({names}) FROM STDIN WITH (FORMAT text);', copy_data(columns, rows[table]) + '\\.']
        join = ' AND '.join(f'a.{c}=e.{c}' for c in KEYS.get(table, ['id']))
        unequal = ' OR '.join(f'a.{c} IS DISTINCT FROM e.{c}' for c in columns)
        output += [f'DO $$ BEGIN IF EXISTS(SELECT 1 FROM {table} a JOIN sample_expected_{table} e ON {join} WHERE {unequal}) THEN',
            f" RAISE EXCEPTION 'Conflicting existing {table} sample row; no overwrite is permitted'; END IF; END $$;"]
    for table, columns in tables.items():
        names = ','.join(columns)
        keys = ','.join(KEYS.get(table, ['id']))
        output += [f'INSERT INTO {table} ({names}) SELECT {names} FROM sample_expected_{table} ON CONFLICT ({keys}) DO NOTHING;']
    return '\n'.join(output + ['COMMIT;', ''])


def load(service, root, connection_service, database, schema, approval):
    script = build_script(service, root, database, schema, approval)  # Validate all input before opening psql.
    command = ['psql', '--no-psqlrc', '--no-password', '--quiet', '--set=ON_ERROR_STOP=1']
    if connection_service:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', connection_service):
            raise ValueError('Invalid PostgreSQL connection service name')
        command.append('service=' + connection_service)
    try:
        result = subprocess.run(command, input=script, text=True, encoding='utf-8', capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'Sample {service} import timed out; commit outcome is unconfirmed, inspect the approved target before retrying') from None
    if result.returncode:
        # psql errors can echo row values/credentials; expose only a known fixed error, never raw stderr.
        reason = next((f'Conflicting existing {t} sample row; no overwrite is permitted' for t in TABLES[service]
            if f'Conflicting existing {t} sample row; no overwrite is permitted' in result.stderr), 'Approval, target, identity, lock, schema or constraint check failed')
        raise RuntimeError(f'Sample {service} import failed (psql exit {result.returncode}); {reason}; uncommitted work rolls back on disconnect; confirm the target if commit outcome is uncertain')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service', choices=TABLES, required=True)
    parser.add_argument('--connection-service', help='Pre-approved libpq service; otherwise use pre-approved PG connection environment')
    parser.add_argument('--database', required=True)
    parser.add_argument('--schema', required=True)
    parser.add_argument('--approval', required=True)
    args = parser.parse_args()
    try:
        load(args.service, HERE, args.connection_service, args.database, args.schema, args.approval)
    except (ValueError, OSError, RuntimeError) as failure:
        parser.exit(1, str(failure) + '\n')
    print(f'CSV {args.service} import committed; identical replay allowed; no database credentials logged.')
