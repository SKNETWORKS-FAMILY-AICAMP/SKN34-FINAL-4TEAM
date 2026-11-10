"""재개 binding의 순수 단위. 실제 graph/Saver 조립은 integration에서 검증한다."""
from dataclasses import replace

from pydantic import ValidationError
import pytest

from test_mock_retrievers import story, content, query, wiki, manuscripts
from app.runs.graph import checkpoint_binding, manifest_digest
from app.runs.runner import ExecutionLimits
from app.runs.state import MainRequest


def test_request_binding_changes_with_input_scope_and_limits(content):
    req = MainRequest(thread_id="t", run_id="r", request_ref="q", scope=content.scope,
                      query=query(content), prompt="private-input")
    limits = ExecutionLimits()
    original = checkpoint_binding(req, limits)
    assert len(original) == 64 and "private" not in original
    assert checkpoint_binding(req.model_copy(update={"prompt": "changed"}), limits) != original
    assert checkpoint_binding(req, limits.model_copy(update={"concurrency": 1})) != original
    assert checkpoint_binding(req.model_copy(update={"scope": replace(req.scope, subject_ref="other")}), limits) != original
    before = content.manifest(content.scope)
    after = replace(before, source_versions=before.source_versions[:-1])
    assert manifest_digest(before) != manifest_digest(after)


def test_checkpoint_recent_message_refs_are_bounded(content):
    with pytest.raises(ValidationError):
        MainRequest(thread_id="t", run_id="r", request_ref="q", scope=content.scope,
                    query=query(content), messages=tuple(f"m{i}" for i in range(21)))


@pytest.mark.integration
def test_node_exception_details_never_enter_checkpoint(content, wiki, manuscripts, monkeypatch):
    import asyncio
    from test_main_graph import graph, request
    g = graph(content, wiki, manuscripts)
    req = request(content)
    def fail(scope):
        raise RuntimeError("private-backend-exception-body")
    monkeypatch.setattr(content, "manifest", fail)
    result = asyncio.run(g.run(req))
    assert result.state.execution_status == "failed"
    raw = repr(g.checkpointer.storage) + repr(g.checkpointer.writes)
    assert "private-backend-exception-body" not in raw
