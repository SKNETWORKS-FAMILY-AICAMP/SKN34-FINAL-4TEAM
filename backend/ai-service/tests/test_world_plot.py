"""설정 변경의 역참조·다중 문서 후보·적용 차단 단위 계약."""
import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from test_mock_retrievers import content, story, candidate, query, graph
from test_story_context import exact
from test_retrieval_coordinator import coordinator
from app.retrieval.content_client import SourceVersion
from app.retrieval.mock_content import MockRow
from app.retrieval.relationships import RelationshipGraphRetriever
from app.agents.world_plot import WorldPlotRequest, WorldPlotHandler, world_plot, world_plot_tasks


def fixture(content, graph):
    content.scope=replace(content.scope,basis_episode=5)
    content.expected_episodes=tuple(range(1,6))
    content.rows=(MockRow(SourceVersion("w1","setting","magic","s1"),"마법은 하루 3회",1,False,("kai",)),
        *(MockRow(SourceVersion("w1","draft",f"m{n}",f"r{n}"),f"{n}화 마법 사용",n,False,("kai",)) for n in range(1,6)))
    content.pinned=frozenset(r.version for r in content.rows)
    wiki=(candidate(content,"magic","wiki",id="rule",scene_id="rule"),
        *(candidate(content,f"m{n}","wiki",id=f"e{n}",scene_id=f"scene{n}",evidence_refs=("rule",) if n in (3,5) else ()) for n in range(1,6)))
    port=coordinator(content,wiki,tuple(candidate(content,f"m{n}") for n in range(1,6)))
    graph.scope=content.scope
    port.ports["relationship"]=RelationshipGraphRetriever(content,graph)
    req=WorldPlotRequest(query=query(content,operation="full_context",token_budget=30000),rule=exact(content,"magic").exact,
        proposed_rule="마법은 하루 1회",targets=tuple(exact(content,f"m{n}").exact for n in (3,5,2)),current_relationships_required=True)
    reply=dict(impacts=[dict(target_id=f"m{n}",reason="마법 사용 횟수 확인",source_refs=(f"e{n}",),
        proposed_text=f"{n}화 한 번 사용" if n!=2 else None) for n in (3,5,2)],input_tokens=20,output_tokens=10)
    model=AsyncMock(analyze=AsyncMock(return_value=reply))
    return req,port,model


def test_c_rule_and_episode_three_five_have_pinned_proposals_and_two_is_unchanged(content,graph):
    req,port,model=fixture(content,graph); before=content.rows
    result=asyncio.run(world_plot(req,content=content,coordinator=port,model=model))
    assert result.status=="ok" and {i.target.version.document_id for i in result.confirmed}=={"m3","m5"}
    assert result.unchanged[0].target.version.document_id=="m2" and not result.unconfirmed
    assert result.rule_change.after=="마법은 하루 1회" and result.confirmed[0].base_version.revision=="r3"
    assert result.application_blocker=="unsupported_atomic_scope" and result.change_set is None and not result.can_apply
    assert content.rows==before and result.is_mock
    payload=model.analyze.call_args.args[0].model_dump_json()
    assert "synthetic-grant" not in payload and "graph_version" not in payload
    assert model.analyze.call_args.args[0].current_relationships


@pytest.mark.parametrize("bad",["unknown_ref","missing_target","duplicate","extra","provider","stale","revoke","relationship","hash","foreign"])
def test_invalid_result_or_authority_never_returns_change_candidates(content,graph,bad):
    req,port,model=fixture(content,graph)
    if bad=="unknown_ref": model.analyze.return_value["impacts"][0]["source_refs"]=("other-fork",)
    if bad=="missing_target": model.analyze.return_value["impacts"]=model.analyze.return_value["impacts"][:1]
    if bad=="duplicate": model.analyze.return_value["impacts"][1]=model.analyze.return_value["impacts"][0]
    if bad=="extra": model.analyze.return_value["execute"]="apply"
    if bad=="provider": model.analyze.side_effect=RuntimeError("private error")
    if bad in ("stale","revoke","relationship"):
        async def analyze(payload):
            if bad=="stale": content.rows=tuple(replace(r,text="동시 수정") if r.version.document_id=="m5" else r for r in content.rows)
            if bad=="revoke": content.active=False
            if bad=="relationship": graph.graph_version="8"
            return model.analyze.return_value
        model.analyze.side_effect=analyze
    if bad=="hash": req=req.model_copy(update={"rule":req.rule.model_copy(update={"source_hash":"0"*64})})
    if bad=="foreign": req=req.model_copy(update={"targets":(req.targets[0].model_copy(update={"version":replace(req.targets[0].version,work_id="other")}),)})
    result=asyncio.run(world_plot(req,content=content,coordinator=port,model=model))
    assert result.status!="ok" and not result.confirmed and result.rule_change is None and not result.can_apply


def test_model_guess_without_reverse_reference_is_unconfirmed(content,graph):
    req,port,model=fixture(content,graph)
    model.analyze.return_value["impacts"][-1]["proposed_text"]="추측으로 바꿀 내용"
    result=asyncio.run(world_plot(req,content=content,coordinator=port,model=model))
    assert len(result.unconfirmed)==1 and result.unconfirmed[0].target.version.document_id=="m2"
    assert result.unconfirmed[0].change is None


def test_conflicting_link_is_reported_without_replacement(content,graph):
    req,port,model=fixture(content,graph)
    model.analyze.return_value["impacts"][1]["conflicts"]=("5화 의도된 예외인지 확인 필요",)
    result=asyncio.run(world_plot(req,content=content,coordinator=port,model=model))
    impact=next(i for i in result.confirmed if i.target.version.document_id=="m5")
    assert impact.conflicts and impact.change is None and result.change_set is None


@pytest.mark.parametrize("bad",["coverage","deadline","graph_target","same_target","budget"])
def test_missing_prerequisites_and_budget_are_not_success(content,graph,bad):
    from datetime import datetime,timedelta,timezone
    req,port,model=fixture(content,graph)
    if bad=="coverage": port.ports["wiki"].candidates=port.ports["wiki"].candidates[:2]
    if bad=="deadline": req=req.model_copy(update={"query":req.query.model_copy(update={"deadline":datetime.now(timezone.utc)-timedelta(seconds=1)})})
    if bad=="graph_target": req=req.model_copy(update={"targets":(req.targets[0].model_copy(update={"version":replace(req.targets[0].version,kind="relationship")}),)})
    if bad=="same_target": req=req.model_copy(update={"targets":(req.rule,)})
    if bad=="budget": model.analyze.return_value["output_tokens"]=req.output_token_cap+1
    result=asyncio.run(world_plot(req,content=content,coordinator=port,model=model))
    assert result.status!="ok" and result.rule_change is None and not result.can_apply
    if bad!="budget": model.analyze.assert_not_called()


def test_registry_and_runner_keep_body_out_of_results(content,graph):
    from test_task_graph import task
    from app.runs.orchestrator import REGISTRY
    from app.runs.runner import TaskRunner, TaskOutput
    from app.retrieval.content_client import CanonicalAdapter
    req,port,model=fixture(content,graph)
    handler=WorldPlotHandler(req,content=content,coordinator=port,model=model)
    root=task(content.scope,"context","context")
    async def context(slice,ctx): return TaskOutput(output_schema="ContextPacket.v1",output_ref="context:fixture",is_mock=True)
    runner=TaskRunner("world-run",(root,*world_plot_tasks(req,context_task=root)),scope=content.scope,
        manifest=CanonicalAdapter(content).manifest(content.scope),allowed_operations=("context","world_plot"),
        handlers={"context":context,"world_plot":handler},wants_change=True)
    result=asyncio.run(runner.run())
    assert REGISTRY["world_plot"].handler is world_plot and result.status=="succeeded"
    assert result.accounted.model_calls==1 and "마법" not in result.model_dump_json()
    assert handler.result.application_blocker=="unsupported_atomic_scope"
