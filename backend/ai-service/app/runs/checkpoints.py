"""고정 Saver 버전의 전용 풀. setup은 명시적인 배포 관리 명령에서만 실행한다."""
import asyncio
from contextlib import asynccontextmanager
from hashlib import sha256
from importlib.metadata import version
import os
import re

from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from psycopg import AsyncConnection, sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .runner import CheckpointError, RunnerState


SAVER_VERSION = "3.2.0"
MIGRATION_VERSION = 9


def serializer():
    return JsonPlusSerializer(pickle_fallback=False, allowed_json_modules=[], allowed_msgpack_modules=[])


def connection_kwargs(schema):
    if not re.fullmatch(r"langgraph(?:_test_[a-f0-9]{12})?", schema):
        raise ValueError("invalid_checkpoint_schema")
    return dict(autocommit=True, row_factory=dict_row, prepare_threshold=0, connect_timeout=5,
                options=f"-csearch_path={schema},pg_catalog -cstatement_timeout=5000 -clock_timeout=1000")


def check_version():
    if version("langgraph-checkpoint-postgres") != SAVER_VERSION or len(AsyncPostgresSaver.MIGRATIONS) != MIGRATION_VERSION + 1:
        raise CheckpointError("checkpoint_package_version_mismatch")


async def validate_schema(conn, schema):
    """조회만 한다. 잘못된 계정·업무 search_path·미적용/미래 migration을 차단한다."""
    try:
        result = await conn.execute("""
            SELECT current_schema() = %s
              AND current_setting('search_path') = %s
              AND NOT (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
                       FROM pg_roles WHERE rolname = current_user)
              AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
              AND NOT has_database_privilege(current_user, current_database(), 'TEMP')
              AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%%'
                  AND (has_schema_privilege(oid, 'CREATE') OR pg_has_role(nspowner, 'USAGE')))
              AND (SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = %s AND c.relname IN
                     ('checkpoints','checkpoint_blobs','checkpoint_writes','checkpoint_migrations')
                     AND c.relkind = 'r' AND NOT pg_has_role(c.relowner, 'USAGE')
                     AND has_table_privilege(c.oid, 'SELECT')
                     AND CASE WHEN c.relname = 'checkpoint_migrations' THEN
                       NOT (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                            OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))
                     ELSE has_table_privilege(c.oid, 'INSERT') AND has_table_privilege(c.oid, 'UPDATE')
                          AND has_table_privilege(c.oid, 'DELETE') END)
              AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname NOT IN (%s, 'pg_catalog', 'information_schema')
                    AND n.nspname NOT LIKE 'pg_%%' AND c.relkind IN ('r','p','v','m','f')
                    AND (has_table_privilege(c.oid, 'SELECT') OR has_table_privilege(c.oid, 'INSERT')
                         OR has_table_privilege(c.oid, 'UPDATE') OR has_table_privilege(c.oid, 'DELETE')))
              AS safe
            """, (schema, f"{schema},pg_catalog", schema, schema))
        if (await result.fetchone())["safe"] is not True:
            raise ValueError()
        result = await conn.execute("SELECT array_agg(v ORDER BY v) AS versions FROM checkpoint_migrations")
        if (await result.fetchone())["versions"] != list(range(MIGRATION_VERSION + 1)):
            raise ValueError()
        # 고정 일반 Saver의 필수 컬럼도 확인한다(Shallow Saver와 혼용 금지).
        await conn.execute("SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata FROM checkpoints LIMIT 0")
        await conn.execute("SELECT thread_id, checkpoint_ns, channel, version, type, blob FROM checkpoint_blobs LIMIT 0")
        await conn.execute("SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob, task_path FROM checkpoint_writes LIMIT 0")
    except Exception:
        raise CheckpointError("checkpoint_schema_unavailable") from None


@asynccontextmanager
async def postgres_saver(dsn, *, schema="langgraph"):
    check_version()
    pool = AsyncConnectionPool(dsn, open=False, min_size=1, max_size=3, timeout=5,
                               kwargs=connection_kwargs(schema))
    try:
        try:
            await pool.open(wait=True, timeout=5)
            async with pool.connection() as conn:
                await validate_schema(conn, schema)
        except Exception:
            raise CheckpointError("checkpoint_schema_unavailable") from None
        saver = AsyncPostgresSaver(pool, serde=serializer())
        # lease가 풀을 점유해도 Saver SQL용 연결 하나는 남긴다.
        saver.run_slots = asyncio.Semaphore(2)
        yield saver
    finally:
        await pool.close()


@asynccontextmanager
async def configured_saver():
    dsn = os.environ.get("AI_CHECKPOINT_DATABASE_URL", "")
    if not dsn:
        yield None
        return
    async with postgres_saver(dsn) as saver:
        yield saver


@asynccontextmanager
async def run_lease(saver, thread_id):
    """DB session 잠금으로 thread의 동시 run/recovery를 막고 연결 종료 시 해제한다."""
    if not isinstance(saver, AsyncPostgresSaver):
        yield
        return
    key = int.from_bytes(sha256(thread_id.encode()).digest()[:8], "big", signed=True)
    async with saver.run_slots, saver.conn.connection() as conn:
        cursor = await conn.execute("SELECT pg_try_advisory_lock(%s) AS acquired", (key,))
        if not (await cursor.fetchone())["acquired"]:
            raise CheckpointError("thread_busy")
        try:
            yield
        finally:
            try:
                await conn.execute("SELECT pg_advisory_unlock(%s)", (key,))
            except BaseException:
                await conn.close()
                raise


class RunnerJournal:
    """같은 Saver의 별도 namespace에 참조·예약만 저장한다. 업무 테이블은 없다."""
    def __init__(self, saver, config):
        self.saver = saver
        self.config = {"configurable": {"thread_id": config["configurable"]["thread_id"], "checkpoint_ns": "task_runner"}}

    async def read(self):
        saved = await self.saver.aget_tuple(self.config)
        if saved is None:
            return None
        self.config = saved.config
        return RunnerState.model_validate(saved.checkpoint["channel_values"]["runner"])

    async def write(self, state):
        checkpoint = empty_checkpoint()
        checkpoint["channel_values"] = {"runner": state.model_dump(mode="json")}
        checkpoint["channel_versions"] = {"runner": checkpoint["id"]}
        self.config = await self.saver.aput(self.config, checkpoint,
            {"source": "update", "step": sum(state.attempts.values())}, checkpoint["channel_versions"])


async def setup_schema(dsn, *, schema="langgraph"):
    """관리 계정 전용. 운영 적용은 별도 승인 후 배포자가 명시 실행한다."""
    check_version()
    async with await AsyncConnection.connect(dsn, **connection_kwargs(schema)) as conn:
        # setup의 concurrent index 때문에 트랜잭션 밖 session lock을 사용한다.
        await conn.execute("SELECT pg_advisory_lock(74621021)")
        try:
            await conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
            cursor = await conn.execute("SELECT to_regclass(%s) AS migrations", (f"{schema}.checkpoint_migrations",))
            if (await cursor.fetchone())["migrations"] is not None:
                cursor = await conn.execute("SELECT v FROM checkpoint_migrations ORDER BY v")
                versions = [row["v"] for row in await cursor.fetchall()]
                if versions != list(range(len(versions))) or len(versions) > MIGRATION_VERSION + 1:
                    raise CheckpointError("checkpoint_migration_version_mismatch")
            await AsyncPostgresSaver(conn, serde=serializer()).setup()
        finally:
            await conn.execute("SELECT pg_advisory_unlock(74621021)")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="고정 Saver setup: 명시적인 관리 계정 전용")
    parser.add_argument("action", choices=("setup",))
    parser.parse_args()
    if not os.environ.get("AI_CHECKPOINT_ADMIN_DATABASE_URL"):
        parser.error("AI_CHECKPOINT_ADMIN_DATABASE_URL is required")
    asyncio.run(setup_schema(os.environ["AI_CHECKPOINT_ADMIN_DATABASE_URL"]))
