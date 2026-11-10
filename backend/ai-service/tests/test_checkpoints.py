"""전용 풀의 runtime DDL 금지·정리·schema/version 검사 단위."""
import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.runs import checkpoints as cp


def connection(*, version=9, safe=True):
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchone = AsyncMock(return_value={"safe": safe, "versions": list(range(version + 1))})
    conn.execute = AsyncMock(return_value=cursor)
    return conn


def test_pool_is_dedicated_and_closed_without_setup(monkeypatch):
    conn = connection()
    pool = MagicMock()
    pool.open, pool.close = AsyncMock(), AsyncMock()
    @asynccontextmanager
    async def checkout():
        yield conn
    pool.connection = checkout
    factory = MagicMock(return_value=pool)
    monkeypatch.setattr(cp, "AsyncConnectionPool", factory)
    setup = AsyncMock()
    monkeypatch.setattr(cp.AsyncPostgresSaver, "setup", setup)
    async def scenario():
        with pytest.raises(RuntimeError, match="application_failure"):
            async with cp.postgres_saver("postgresql://runtime@localhost/test") as saver:
                assert saver.conn is pool
                raise RuntimeError("application_failure")
    asyncio.run(scenario())
    setup.assert_not_called()
    assert pool.close.await_count == 1
    kwargs = factory.call_args.kwargs
    assert kwargs["open"] is False and kwargs["max_size"] == 3
    assert kwargs["kwargs"]["autocommit"] is True
    assert "search_path=langgraph,pg_catalog" in kwargs["kwargs"]["options"]
    assert all(str(c.args[0]).lstrip().startswith("SELECT") for c in conn.execute.call_args_list)


@pytest.mark.parametrize("safe,version", [(False, 9), (True, 8), (True, 10)])
def test_invalid_schema_permissions_or_migration_version_fail_closed(safe, version):
    with pytest.raises(cp.CheckpointError, match="checkpoint_schema_unavailable"):
        asyncio.run(cp.validate_schema(connection(safe=safe, version=version), "langgraph"))


def test_missing_schema_and_driver_error_do_not_expose_dsn():
    conn = connection()
    conn.execute.side_effect = RuntimeError("postgresql://secret:password@host")
    with pytest.raises(cp.CheckpointError) as error:
        asyncio.run(cp.validate_schema(conn, "langgraph"))
    assert "password" not in str(error.value)


@pytest.mark.parametrize("schema", ["public", "content", "langgraph;DROP SCHEMA content", "langgraph,public"])
def test_business_or_injected_search_path_is_rejected(schema):
    with pytest.raises(ValueError, match="invalid_checkpoint_schema"):
        cp.connection_kwargs(schema)


def test_journal_uses_separate_namespace_and_plain_data():
    from langgraph.checkpoint.memory import InMemorySaver
    from app.runs.runner import RunnerState
    async def scenario():
        saver = InMemorySaver(serde=cp.serializer())
        journal = cp.RunnerJournal(saver, {"configurable": {"thread_id": "thread:scope:run", "checkpoint_ns": ""}})
        state = RunnerState(run_id="run", tasks=(), deadline=1)
        await journal.write(state)
        restored = await cp.RunnerJournal(saver, {"configurable": {"thread_id": "thread:scope:run"}}).read()
        assert restored == state
        assert await saver.aget_tuple({"configurable": {"thread_id": "thread:scope:run", "checkpoint_ns": ""}}) is None
    asyncio.run(scenario())


def test_lifespan_exposes_saver_and_closes_runs_before_pool(monkeypatch):
    from app import main
    saver = object()
    service = MagicMock()
    service.close = AsyncMock()
    @asynccontextmanager
    async def configured():
        try:
            yield saver
        finally:
            service.close.assert_awaited_once()
    monkeypatch.setattr(main, "configured_saver", configured)
    application = main.create_app(run_service=service)
    async def scenario():
        async with application.router.lifespan_context(application):
            assert application.state.checkpointer is saver
            assert service.checkpointer is saver
        assert application.state.checkpointer is None
        assert service.checkpointer is None
    asyncio.run(scenario())


def test_package_version_drift_is_rejected(monkeypatch):
    monkeypatch.setattr(cp, "version", lambda name: "future")
    with pytest.raises(cp.CheckpointError, match="checkpoint_package_version_mismatch"):
        cp.check_version()
