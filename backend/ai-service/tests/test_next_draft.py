"""복합 초안 DAG의 합성 수용. 모델·DB·HTTP 호출은 없다."""
import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from test_mock_retrievers import content, story, query, wiki, manuscripts, candidate, graph
from test_retrieval_coordinator import coordinator
from test_task_graph import task
from test_semantic_review import simulation_request
from app.agents.development import Beat, DevelopmentReply, DevelopmentRequest
from app.agents.writing import WritingRequest, CreateTarget
from app.agents.next_draft import NextDraftRequest, NextDraftHandler, next_draft_tasks
from app.agents.simulation import Action, CharacterReply
from app.retrieval.content_client import CanonicalAdapter, SourceVersion
from app.retrieval.mock_content import MockRow
from app.retrieval.relationships import RelationshipGraphRetriever
from app.runs.orchestrator import REGISTRY
from app.runs.runner import TaskRunner


def setup(content, wiki, manuscripts, *, mode="next_draft", draft=True, simulate=False, save=False, **changes):
    q = query(content, operation="full_context", episode_range=(1, content.scope.basis_episode), token_budget=30000, top_k=50)
    development = DevelopmentRequest(query=q, mode="expand_conti" if mode == "expand_conti" else "next_episode_planning",
        count=1, hook_refs=(f"e{content.scope.basis_episode}",), conti_refs=("conti",) if mode == "expand_conti" else (),
        reaction_required=simulate, simulation_input=simulation_request(content).model_copy(update={"query": q}) if simulate else None)
    request = NextDraftRequest(development=development, writing=WritingRequest(query=q, mode="draft", prompt="다음 장면을 써 주세요.",
        save_requested=save, create_target=CreateTarget(work_id="w1", document_id="reserved", episode=content.scope.basis_episode+1,
            title="다음 화", work_revision=7) if save else None), draft_requested=draft, **changes)
    beat = Beat(goal="단서를 찾는다", action="문을 살핀다", dialogue="누가 왔습니까", cause="닫힌 문", refs=(f"e{content.scope.basis_episode}",))
    text = "단서를 찾는다. 문을 살핀다. 누가 왔습니까. 닫힌 문."
    model = AsyncMock(develop=AsyncMock(return_value=DevelopmentReply(beats=(beat,), input_tokens=10, output_tokens=10)),
        write=AsyncMock(return_value=dict(text=text, used_refs=(), input_tokens=10, output_tokens=10)),
        act=AsyncMock(side_effect=[CharacterReply(action=Action(actor_id=actor, turn=n, kind="observe", target_ids=("lina",) if n==3 else (), text="",
            used_fact_ids=(), disclosed_fact_ids=()), input_tokens=2, output_tokens=2) for n, actor in ((1,"kai"),(2,"lina"),(3,"kai"))]))
    port = coordinator(content, wiki, manuscripts)
    async def write(payload):
        return dict(text=text+" "+" ".join(s.text for s in payload.context),
            used_refs=tuple(s.id for s in payload.context),input_tokens=10,output_tokens=10)
    model.write.side_effect=write
    return request, model, port


def execute(content, request, model, port):
    handler = NextDraftHandler(request, content=content, coordinator=port, model=model)
    root = task(content.scope, "context", "context")
    runner = TaskRunner("draft-run", (root, *next_draft_tasks(request, context_task=root)), scope=content.scope,
        manifest=CanonicalAdapter(content).manifest(content.scope), allowed_operations=tuple(REGISTRY),
        handlers={op: handler for op in ("context", "simulation", "development", "writing", "mechanical")}, wants_change=True)
    return asyncio.run(runner.run()), handler, runner


def test_beat_plan_reaches_writing_and_continuity_with_no_saves(content, wiki, manuscripts):
    content.rows=tuple(r for r in content.rows if r.version.document_id!="future")
    before=content.rows
    req, model, port=setup(content,wiki,manuscripts,save=True)
    result, handler, runner=execute(content,req,model,port)
    assert result.status=="succeeded" and handler.result.status=="ok"
    assert handler.result.document_create_proposal.target.episode==4 and content.rows==before
    assert model.write.call_args.args[0].beats[0].action==handler.plan.beats[0].action
    assert "카이는 암호를 물었다." in model.write.call_args.args[0].required_phrases
    assert handler.continuity.complete and result.accounted.model_calls==2
    assert [t.operation for t in runner.tasks]==["context","development","writing","mechanical"]
    assert "단서를 찾는다" not in result.model_dump_json()


def test_b_ten_revisions_current_relationship_simulation_then_eleven(content,graph):
    content.scope=replace(content.scope,basis_episode=10)
    content.rows=tuple(MockRow(SourceVersion("w1","manuscript",f"m{n}",f"r{n}"),f"허용된 {n}화 사건",n,True,("kai","lina")) for n in range(1,11))
    content.expected_episodes=tuple(range(1,11)); content.pinned=frozenset(r.version for r in content.rows)
    graph.scope=content.scope
    wiki=tuple(candidate(content,f"m{n}","wiki",id=f"e{n}",scene_id=f"scene{n}") for n in range(1,11))
    manuscripts=tuple(candidate(content,f"m{n}") for n in range(1,11))
    req,model,port=setup(content,wiki,manuscripts,simulate=True,current_relationships_required=True,save=True)
    port.ports["relationship"]=RelationshipGraphRetriever(content,graph)
    result,handler,_=execute(content,req,model,port)
    assert result.status=="succeeded" and result.accounted.model_calls==5, [(r.task_id,r.status,r.error_code) for r in result.results]
    assert handler.plan.coverage.expected_count==handler.plan.coverage.verified_count==10
    assert model.act.await_count==3 and model.develop.await_count==model.write.await_count==1
    payload=model.write.call_args.args[0]
    assert payload.simulations and payload.current_relationships[0].source_revision.revision=="7"
    assert {s.exact.version.document_id for s in payload.context}=={"m1","m10"}
    assert handler.result.document_create_proposal.target.episode==11 and handler.result.hypothetical


@pytest.mark.parametrize("draft",[False,True])
def test_conti_only_stops_at_beats_or_expands_to_text(content,wiki,manuscripts,draft):
    version=SourceVersion("w1","conti","c3","c3")
    content.rows+=(MockRow(version,"문 앞에서 단서를 찾는 콘티",3,False,("kai",)),); content.pinned|={version}
    wiki=(*wiki,candidate(content,"c3","wiki",id="conti",scene_id="conti-scene"))
    req,model,port=setup(content,wiki,manuscripts,mode="expand_conti",draft=draft)
    result,handler,runner=execute(content,req,model,port)
    assert result.status=="succeeded" and handler.plan.beats
    assert model.write.await_count==int(draft) and bool(handler.result)==draft
    assert len(runner.tasks)==(4 if draft else 2)


@pytest.mark.parametrize("failure",["coverage","missing_simulation","simulation_failure","zero_budget","relationship","provider","continuity","stale"])
def test_missing_or_failed_requirements_never_complete_or_propose(content,wiki,manuscripts,failure):
    req,model,port=setup(content,wiki if failure!="coverage" else wiki[:1],manuscripts,
        simulate=failure in ("missing_simulation","simulation_failure","zero_budget"),current_relationships_required=failure=="relationship")
    if failure in ("missing_simulation","zero_budget"):
        dev=req.development.model_copy(update={"simulation_input":None if failure=="missing_simulation" else req.development.simulation_input.model_copy(update={"remaining_model_calls":0})})
        req=req.model_copy(update={"development":dev})
    if failure=="simulation_failure": model.act.side_effect=RuntimeError("provider detail")
    if failure=="provider": model.write.side_effect=RuntimeError("provider detail")
    if failure=="continuity":
        model.write.side_effect=None
        model.write.return_value=dict(text="무관한 장면",used_refs=(),input_tokens=1,output_tokens=1)
    if failure=="stale":
        async def write(payload):
            content.rows=tuple(replace(r,text="변경된 원문") if r.version.document_id=="m3" else r for r in content.rows)
            return dict(text="단서를 찾는다. 문을 살핀다. 누가 왔습니까. 닫힌 문.",used_refs=(),input_tokens=1,output_tokens=1)
        model.write.side_effect=write
    result,handler,_=execute(content,req,model,port)
    assert result.status=="partial" and (handler.result is None or handler.result.status!="ok")
    assert handler.result is None or handler.result.document_create_proposal is None
    if failure not in ("provider","continuity","stale"): model.write.assert_not_called()


@pytest.mark.parametrize("intent",["next_draft","expand_conti"])
def test_registered_patterns_include_plan_writing_and_continuity(content,intent):
    from app.runs.routing import RuleBasedRouter, RoutingRequest
    from app.runs.graph import build_plan
    classification=RuleBasedRouter().classify(RoutingRequest(text=intent),(intent,),intent)
    assert [t.operation for t in build_plan(classification,content.scope)]==["context","development","writing","mechanical"]


@pytest.mark.parametrize("missing",["goal","action","dialogue","cause","hook","voice","knowledge"])
def test_continuity_checks_actual_text_instead_of_declared_refs(content,wiki,manuscripts,missing):
    req,model,port=setup(content,wiki,manuscripts)
    if missing in ("voice","knowledge"):
        from test_story_context import exact
        if missing=="voice":
            req=req.model_copy(update={"writing":req.writing.model_copy(update={"style_examples":(exact(content,"m1").exact,)})})
        else:
            req=req.model_copy(update={"development":req.development.model_copy(update={"character_refs":("e1",)})})
    async def write(payload):
        beat=payload.beats[0]
        phrases=[beat.goal,beat.action,beat.dialogue,beat.cause,*(s.text for s in (*payload.context,*payload.style_examples))]
        omitted={"goal":beat.goal,"action":beat.action,"dialogue":beat.dialogue,"cause":beat.cause,
            "hook":"카이는 암호를 물었다.","voice":"카이는 문을 닫았다.","knowledge":"카이는 문을 닫았다."}[missing]
        return dict(text=" ".join(p for p in phrases if p!=omitted),used_refs=tuple(s.id for s in payload.context),input_tokens=1,output_tokens=1)
    model.write.side_effect=write
    result,handler,_=execute(content,req,model,port)
    assert result.status=="partial" and not handler.continuity.complete and handler.result.status=="blocked"
    assert handler.result.generated_text is handler.result.document_create_proposal is None


@pytest.mark.parametrize("failure",["manifest_hole","narrow_range","unknown_beat_ref","relation_changed","secret_plan","unused_context"])
def test_scope_coverage_and_handoffs_are_revalidated(content,wiki,manuscripts,graph,failure):
    req,model,port=setup(content,wiki,manuscripts,current_relationships_required=failure=="relation_changed")
    if failure=="manifest_hole": content.expected_episodes=(1,3)
    if failure=="narrow_range":
        q=req.development.query.model_copy(update={"episode_range":(2,3)})
        req=req.model_copy(update={"development":req.development.model_copy(update={"query":q}),"writing":req.writing.model_copy(update={"query":q})})
    if failure=="unknown_beat_ref":
        reply=model.develop.return_value
        model.develop.return_value=reply.model_copy(update={"beats":(reply.beats[0].model_copy(update={"refs":("other-fork",)}),)})
    if failure=="relation_changed":
        port.ports["relationship"]=RelationshipGraphRetriever(content,graph)
        async def develop(payload):
            graph.graph_version="8"
            return model.develop.return_value
        model.develop.side_effect=develop
    if failure=="secret_plan":
        req=req.model_copy(update={"writing":req.writing.model_copy(update={"speaker_id":"kai"})})
    if failure=="unused_context":
        from test_story_context import exact
        req=req.model_copy(update={"writing":req.writing.model_copy(update={"context_refs":(exact(content,"other").exact,)})})
    result,handler,_=execute(content,req,model,port)
    assert result.status=="partial" and handler.result is None
    model.write.assert_not_called()


def test_unknown_speaker_beat_does_not_leak_to_writing(content,wiki,manuscripts):
    req,model,port=setup(content,wiki,manuscripts)
    reply=model.develop.return_value
    model.develop.return_value=reply.model_copy(update={"beats":(reply.beats[0].model_copy(update={"dialogue":"비공개 암호는 달빛이다."}),)})
    req=req.model_copy(update={"writing":req.writing.model_copy(update={"speaker_id":"kai"})})
    result,handler,_=execute(content,req,model,port)
    assert result.status=="partial" and handler.result is None
    model.write.assert_not_called()


def test_external_main_context_can_inject_same_run_handler(content,wiki,manuscripts):
    from app.runs.runner import TaskOutput
    req,model,port=setup(content,wiki,manuscripts)
    handler=NextDraftHandler(req,content=content,coordinator=port,model=model)
    root=task(content.scope,"context","context")
    async def context_handler(slice,ctx):
        return TaskOutput(output_schema="ContextPacket.v1",output_ref="context:external",is_mock=True)
    runner=TaskRunner("external-run",(root,*next_draft_tasks(req,context_task=root)),scope=content.scope,
        manifest=CanonicalAdapter(content).manifest(content.scope),allowed_operations=tuple(REGISTRY),
        handlers={"context":context_handler,**{op:handler for op in ("simulation","development","writing","mechanical")}},wants_change=True)
    assert asyncio.run(runner.run()).status=="succeeded"
    assert handler.continuity.complete and handler.result.status=="ok"
