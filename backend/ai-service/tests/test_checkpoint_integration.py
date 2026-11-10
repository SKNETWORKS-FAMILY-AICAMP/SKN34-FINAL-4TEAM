"""CI 전용 격리 PG: 업무 Flyway와 분리된 임시 schema/role만 사용한다."""
import asyncio
from dataclasses import replace
import os
from unittest.mock import AsyncMock
from uuid import uuid4

from psycopg import AsyncConnection, sql
from psycopg.conninfo import make_conninfo
import pytest

from test_mock_retrievers import story, content, wiki, manuscripts
from test_main_graph import graph, request
from app.retrieval.content_client import ContentReadError
from app.runs.checkpoints import CheckpointError, postgres_saver, run_lease, setup_schema
from app.runs.runner import Budget, ModelReply, TaskOutput


pytestmark = pytest.mark.integration


class Crash(BaseException):
    pass


@pytest.fixture
def checkpoint_db():
    admin = os.environ.get("TEST_CHECKPOINT_ADMIN_DATABASE_URL")
    if not admin or os.environ.get("TEST_CHECKPOINT_DISPOSABLE") != "true":
        if os.environ.get("CI") == "true":
            pytest.fail("isolated checkpoint PG fixture is required in CI")
        pytest.skip("isolated checkpoint PG not configured; no real DB connection attempted")
    suffix = uuid4().hex[:12]
    schema, role = f"langgraph_test_{suffix}", f"checkpoint_test_{suffix}"
    runtime = make_conninfo(admin, user=role, password="")
    async def prepare():
        async with await AsyncConnection.connect(admin, autocommit=True) as conn:
            # 이 임시 DB에만 적용한다. 공유 DB의 PUBLIC TEMP 정책을 자동 변경하지 않는다.
            cursor = await conn.execute("SELECT current_database()")
            database = (await cursor.fetchone())[0]
            await conn.execute(sql.SQL("REVOKE TEMP ON DATABASE {} FROM PUBLIC").format(sql.Identifier(database)))
            await conn.execute(sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS").format(sql.Identifier(role)))
            await setup_schema(admin, schema=schema)
            await conn.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
                await conn.execute(sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON {}.{} TO {}").format(
                    sql.Identifier(schema), sql.Identifier(table), sql.Identifier(role)))
            await conn.execute(sql.SQL("GRANT SELECT ON {}.checkpoint_migrations TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
    async def cleanup():
        async with await AsyncConnection.connect(admin, autocommit=True) as conn:
            # fixture가 만든 무작위 이름만 정리한다. 실제 langgraph/content schema는 사용하지 않는다.
            await conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
            await conn.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
    try:
        asyncio.run(prepare())
        yield admin, runtime, schema, role
    finally:
        asyncio.run(cleanup())


async def interrupted_graph(saver, content, wiki, manuscripts, monkeypatch):
    req = request(content)
    calls = AsyncMock(return_value=ModelReply(output_ref="answer", usage=Budget(model_calls=1, input_tokens=7, output_tokens=5)))
    async def agent(s, ctx):
        await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), calls)
        return TaskOutput(output_schema=s.output_schema, output_ref="answer", is_mock=True)
    put = saver.aput
    async def crash_after_dispatch(config, checkpoint, metadata, versions):
        result = await put(config, checkpoint, metadata, versions)
        if config["configurable"].get("checkpoint_ns", "") == "" and checkpoint["channel_values"].get("task_results"):
            raise Crash()
        return result
    with monkeypatch.context() as patch:
        patch.setattr(saver, "aput", crash_after_dispatch)
        with pytest.raises(Crash):
            await graph(content, wiki, manuscripts, checkpointer=saver, handlers={"qa": agent}).run(req)
    assert calls.await_count == 1
    return req


def test_pool_restart_restores_main_position_results_and_cost_without_duplicate_tasks(checkpoint_db, content, wiki, manuscripts, monkeypatch):
    admin, runtime, schema, _ = checkpoint_db
    async def scenario():
        async with postgres_saver(runtime, schema=schema) as saver:
            req = await interrupted_graph(saver, content, wiki, manuscripts, monkeypatch)
        async with postgres_saver(runtime, schema=schema) as saver:
            spy = AsyncMock()
            resumed = await graph(content, wiki, manuscripts, checkpointer=saver, handlers={"qa": spy}).run(req, resume=True)
            assert resumed.state.execution_status == "succeeded" and len(resumed.state.task_results) == 2
            assert resumed.state.budget_usage == Budget(model_calls=1, input_tokens=7, output_tokens=5)
            citations = resumed.response.citations
            assert {c.episode for c in citations} == {1, 2, 3} and not spy.called
            assert len({(c.source_revision, c.span) for c in citations}) == len(citations)
            replay = await graph(content, wiki, manuscripts, checkpointer=saver, handlers={"qa": spy}).run(req, resume=True)
            assert replay.state == resumed.state and not spy.called
            history = await graph(content, wiki, manuscripts, checkpointer=saver).ahistory(req)
            assert len(history) >= 5 and all(h.run_id == req.run_id for h in history)
        async with await AsyncConnection.connect(admin, autocommit=True) as conn:
            for table, column in (("checkpoints", "checkpoint"), ("checkpoints", "metadata")):
                cursor = await conn.execute(sql.SQL("SELECT {}::text FROM {}.{}").format(sql.Identifier(column), sql.Identifier(schema), sql.Identifier(table)))
                raw = repr(await cursor.fetchall())
                assert content.scope.grant_ref not in raw and "질문" not in raw
                assert all(row.text not in raw for row in content.rows)
            for table in ("checkpoint_blobs", "checkpoint_writes"):
                cursor = await conn.execute(sql.SQL("SELECT type, blob FROM {}.{} WHERE blob IS NOT NULL").format(sql.Identifier(schema), sql.Identifier(table)))
                raw = repr([saver.serde.loads_typed((kind, bytes(blob))) for kind, blob in await cursor.fetchall()])
                assert content.scope.grant_ref not in raw and "질문" not in raw
                assert all(row.text not in raw for row in content.rows)
            cursor = await conn.execute("SELECT to_regclass('public.content_schema_history'), to_regclass('public.checkpoints')")
            assert await cursor.fetchone() == (None, None)
    asyncio.run(scenario())


def test_restart_inside_dispatch_keeps_unknown_reservation_without_recalling_model(checkpoint_db, content, wiki, manuscripts):
    _, runtime, schema, _ = checkpoint_db
    req = request(content)
    async def scenario():
        calls = 0
        async def invoke(res):
            nonlocal calls
            calls += 1
            raise Crash()
        async def agent(s, ctx):
            await ctx.call_model(Budget(model_calls=1, input_tokens=100, output_tokens=100), invoke)
            return TaskOutput(output_schema=s.output_schema, output_ref="unreachable", is_mock=True)
        async with postgres_saver(runtime, schema=schema) as saver:
            with pytest.raises(Crash):
                await graph(content, wiki, manuscripts, checkpointer=saver, handlers={"qa": agent}).run(req)
        async with postgres_saver(runtime, schema=schema) as saver:
            spy = AsyncMock()
            resumed = await graph(content, wiki, manuscripts, checkpointer=saver, handlers={"qa": spy}).run(req, resume=True)
            assert resumed.state.execution_status == "partial" and resumed.state.usage_unknown
            assert resumed.state.budget_usage == Budget(model_calls=1, input_tokens=100, output_tokens=100)
            assert resumed.state.task_results[-1].error_code == "interrupted_outcome_unknown"
            assert calls == 1 and not spy.called
    asyncio.run(scenario())


@pytest.mark.parametrize("change", ["revoked", "request", "revision", "subject", "fork"])
def test_resume_blocks_changed_authority_input_and_manifest(checkpoint_db, content, wiki, manuscripts, monkeypatch, change):
    _, runtime, schema, _ = checkpoint_db
    async def scenario():
        async with postgres_saver(runtime, schema=schema) as saver:
            req = await interrupted_graph(saver, content, wiki, manuscripts, monkeypatch)
        if change == "revoked": content.active = False
        if change == "request": req = req.model_copy(update={"prompt": "different"})
        if change == "revision": content.pinned = frozenset()
        if change in ("subject", "fork"):
            scope = replace(content.scope, **({"subject_ref": "other"} if change == "subject" else {"work_id": "fork2", "fork_id": "fork2"}))
            req = req.model_copy(update={"scope": scope})
        async with postgres_saver(runtime, schema=schema) as saver:
            spy = AsyncMock()
            with pytest.raises(ContentReadError):
                await graph(content, wiki, manuscripts, checkpointer=saver, handlers={"qa": spy}).run(req, resume=True)
            assert not spy.called
    asyncio.run(scenario())


def test_runtime_cannot_ddl_and_thread_lease_spans_pool_instances(checkpoint_db):
    _, runtime, schema, _ = checkpoint_db
    async def scenario():
        async with postgres_saver(runtime, schema=schema) as first, postgres_saver(runtime, schema=schema) as second:
            async with run_lease(first, "thread"):
                with pytest.raises(CheckpointError, match="thread_busy"):
                    async with run_lease(second, "thread"):
                        pytest.fail("duplicate thread execution")
            async with run_lease(second, "thread"):
                pass
            async with first.conn.connection() as conn:
                from psycopg.errors import InsufficientPrivilege
                with pytest.raises(InsufficientPrivilege):
                    await conn.execute("CREATE TABLE forbidden_runtime_ddl(id int)")
                with pytest.raises(InsufficientPrivilege):
                    await conn.execute("CREATE TEMP TABLE forbidden_temporary_ddl(id int)")
                with pytest.raises(InsufficientPrivilege):
                    await conn.execute("DELETE FROM checkpoint_migrations")
    asyncio.run(scenario())


def test_startup_rejects_admin_and_future_schema_version(checkpoint_db):
    admin, runtime, schema, _ = checkpoint_db
    async def scenario():
        with pytest.raises(CheckpointError, match="checkpoint_schema_unavailable"):
            async with postgres_saver(admin, schema=schema):
                pytest.fail("admin role accepted by runtime")
        async with await AsyncConnection.connect(admin, autocommit=True) as conn:
            await conn.execute(sql.SQL("INSERT INTO {}.checkpoint_migrations(v) VALUES(10)").format(sql.Identifier(schema)))
        with pytest.raises(CheckpointError, match="checkpoint_schema_unavailable"):
            async with postgres_saver(runtime, schema=schema):
                pytest.fail("future migration accepted")
        with pytest.raises(CheckpointError, match="checkpoint_migration_version_mismatch"):
            await setup_schema(admin, schema=schema)
    asyncio.run(scenario())


def test_parallel_thread_leases_leave_capacity_for_checkpoint_sql(checkpoint_db):
    _, runtime, schema, _ = checkpoint_db
    async def scenario():
        async with postgres_saver(runtime, schema=schema) as saver:
            async def work(number):
                async with run_lease(saver, f"thread-{number}"):
                    return await saver.aget_tuple({"configurable": {"thread_id": f"thread-{number}"}})
            assert await asyncio.wait_for(asyncio.gather(*(work(n) for n in range(4))), 3) == [None] * 4
    asyncio.run(scenario())


def test_lifespan_reopened_run_service_reuses_authorized_run_result(checkpoint_db, content, wiki, manuscripts, monkeypatch):
    from app import main
    from app.runs.service import FixtureContent, RunService
    from test_run_service import binding
    _, runtime, schema, _ = checkpoint_db
    monkeypatch.setattr(main, "configured_saver", lambda: postgres_saver(runtime, schema=schema))
    req, grant, _ = binding(content)
    calls = AsyncMock(side_effect=lambda s, c: TaskOutput(output_schema=s.output_schema, output_ref="answer", is_mock=True))
    async def execute():
        g = graph(content, wiki, manuscripts, handlers={"qa": calls})
        service = RunService(FixtureContent((replace(grant, graph=g),)))
        application = main.create_app(run_service=service)
        async with application.router.lifespan_context(application):
            service.start(req)
            await service.records[req.run_id].task
            return service.status(req.run_id, req.grant_ref, req.thread_ref)
    async def scenario():
        first = await execute()
        second = await execute()
        assert first.status == second.status == "succeeded"
        assert first.tasks == second.tasks and calls.await_count == 1
    asyncio.run(scenario())
