"""Writing/Editing의 선택 범위·화자 지식·무저장 제안 계약."""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import AsyncMock

import pytest
from test_mock_retrievers import content, story, query
from test_story_context import exact
from app.agents.story_context import ExactSource
from app.agents.writing import CreateTarget, WritingReply, WritingRequest, WritingHandler, writing, writing_tasks
from app.retrieval.content_client import SourceVersion, CanonicalAdapter
from app.retrieval.mock_content import MockRow


@pytest.fixture
def selection(content):
    text="보존할 앞 문단.\n\n😀카이는 문을 열라고 말했다.\n\n보존할 뒤 문단."
    content.rows=tuple(replace(r,text=text) if r.version.document_id=="m3" else r for r in content.rows)
    paragraph="😀카이는 문을 열라고 말했다."
    start=len(text[:text.index(paragraph)].encode("utf-16-le"))//2
    row=next(r for r in content.rows if r.version.document_id=="m3")
    return ExactSource(version=row.version,span=(start,start+len(paragraph.encode("utf-16-le"))//2),
        source_hash=sha256(paragraph.encode()).hexdigest())


def request(content, selection=None, **changes):
    values=dict(query=query(content),mode="edit" if selection else "draft",prompt="선택 범위의 문체와 카이 말투만 차분하게 고쳐 주세요.",
        target=selection,edit_types=("style","voice") if selection else (),speaker_id="kai",
        style_examples=(exact(content,"m1").exact,),context_refs=tuple(exact(content,id).exact for id in ("m1","m2","private","future","other")
            if any(r.version.document_id==id for r in content.rows)))
    return WritingRequest(**(values|changes))


def model(text="😀카이는 차분히 문을 열어 달라고 청했다.", **changes):
    reply=dict(text=text,used_refs=(),input_tokens=20,output_tokens=10)|changes
    return AsyncMock(write=AsyncMock(return_value=reply))


def run(content, req, llm=None):
    llm=llm or model()
    return asyncio.run(writing(req,content=content,model=llm)),llm


def test_d_style_and_voice_make_one_utf16_patch_with_no_outside_change_or_writes(content,selection):
    before=content.rows
    result,llm=run(content,request(content,selection))
    assert result.status=="ok" and result.kind=="change_set" and result.is_mock
    patch,=result.change_set.patches
    assert patch.target==selection and patch.before_hash==selection.source_hash
    assert patch.before=="😀카이는 문을 열라고 말했다." and patch.after_hash==sha256(patch.after.encode()).hexdigest()
    original=next(r.text for r in before if r.version==selection.version).encode("utf-16-le")
    start,end=selection.span
    updated=original[:2*start]+patch.after.encode("utf-16-le")+original[2*end:]
    assert updated[:2*start]==original[:2*start] and updated.endswith(original[2*end:])
    assert content.rows==before
    llm.write.assert_awaited_once()
    payload=llm.write.call_args.args[0].model_dump_json()
    assert "style" in payload and "voice" in payload
    assert all(text not in payload for text in ("보존할 앞", "보존할 뒤", "리나만 암호", "비공개 암호", "나중에", "다른 작품", "synthetic-grant"))


@pytest.mark.parametrize("save", [False, True])
def test_new_draft_is_generated_text_or_explicit_create_proposal_without_content_writes(content,save):
    if save:
        content.rows=tuple(r for r in content.rows if r.version.document_id!="future")
    before=content.rows
    target=CreateTarget(work_id="w1",document_id="content-reserved-4",episode=4,title="새 회차",work_revision=7) if save else None
    result,llm=run(content,request(content,save_requested=save,create_target=target))
    assert result.status=="ok" and result.kind==("document_create_proposal" if save else "generated_text")
    assert bool(result.document_create_proposal)==save
    assert result.generated_text.text_hash==sha256(result.generated_text.text.encode()).hexdigest()
    assert content.rows==before and result.hypothetical
    llm.write.assert_awaited_once()


def test_standalone_sentence_generation_needs_no_search_or_source_reads(content,monkeypatch):
    reads=AsyncMock(side_effect=AssertionError("no source retrieval"))
    monkeypatch.setattr(content,"read",reads)
    result,llm=run(content,request(content,speaker_id=None,style_examples=(),context_refs=(),prompt="짧은 풍경 문장을 써 주세요."))
    assert result.status=="ok" and not llm.write.call_args.args[0].context
    reads.assert_not_called()


def test_conti_expansion_uses_only_selected_same_scope_conti(content):
    version=SourceVersion("w1","conti","conti3","c3")
    content.rows+=(MockRow(version,"문 앞에서 카이가 망설인다.",3,False,("kai",)),)
    content.pinned|={version}
    result,llm=run(content,request(content,mode="expand_conti",conti=exact(content,"conti3").exact))
    assert result.status=="ok" and result.kind=="generated_text"
    assert llm.write.call_args.args[0].conti.text=="문 앞에서 카이가 망설인다."


@pytest.mark.parametrize("bad", ["hash","revision","span","other","future","unknown_speaker","missing_speaker","missing_target","paragraphs","blank","sample","source_kind","episode_range"])
def test_invalid_or_ambiguous_edit_stops_before_model(content,selection,bad):
    changes={
        "hash":dict(target=selection.model_copy(update={"source_hash":"0"*64})),
        "revision":dict(target=selection.model_copy(update={"version":replace(selection.version,revision="old")})),
        "span":dict(target=selection.model_copy(update={"span":(selection.span[0]+1,selection.span[1])})),
        "other":dict(target=exact(content,"other").exact),
        "future":dict(target=exact(content,"future").exact),
        "unknown_speaker":dict(speaker_id="unknown"),
        "missing_speaker":dict(speaker_id=None),
        "missing_target":dict(target=None),
        "paragraphs":dict(target=exact(content,"m3").exact),
        "blank":dict(target=selection),
        "sample":dict(style_examples=(exact(content,"other").exact,)),
        "source_kind":dict(query=query(content,source_kinds=("setting",))),
        "episode_range":dict(query=query(content,episode_range=(1,1))),
    }[bad]
    if bad=="blank":
        content.rows=tuple(replace(r,text=" "*len(r.text)) if r.version==selection.version else r for r in content.rows)
        changes={"target":exact(content,"m3").exact}
    result,llm=run(content,request(content,selection,**changes))
    assert result.status in ("denied","blocked") and result.kind is None and not result.change_set
    clarifications={"missing_target":"source_selection","missing_speaker":"speaker","unknown_speaker":"speaker",
        "paragraphs":"source_selection","blank":"source_selection","source_kind":"source_selection","episode_range":"source_selection"}
    if bad in clarifications:
        assert result.clarification==clarifications[bad]
    llm.write.assert_not_called()


@pytest.mark.parametrize("bad", ["missing_conti","missing_reservation","existing_target","other_work"])
def test_unsupported_creation_does_not_invent_target_or_generate(content,bad):
    changes={
        "missing_conti":dict(mode="expand_conti"),
        "missing_reservation":dict(save_requested=True),
        "existing_target":dict(save_requested=True,create_target=CreateTarget(work_id="w1",document_id="m3",episode=4,title="새",work_revision=0)),
        "other_work":dict(save_requested=True,create_target=CreateTarget(work_id="other",document_id="new",episode=4,title="새",work_revision=0)),
    }[bad]
    result,llm=run(content,request(content,**changes))
    assert result.status in ("blocked","denied") and result.kind is None
    llm.write.assert_not_called()


@pytest.mark.parametrize("change", ["revision","scope","revoke","deadline"])
def test_content_is_revalidated_after_model_and_stale_or_revoked_output_is_discarded(content,selection,change):
    llm=model()
    async def invoke(payload):
        if change=="revision": content.rows=tuple(replace(r,version=replace(r.version,revision="new")) if r.version==selection.version else r for r in content.rows)
        elif change=="scope": content.pinned=frozenset()
        elif change=="revoke": content.active=False
        else: content.expires_at=datetime.now(timezone.utc)-timedelta(seconds=1)
        return WritingReply(text="새 문장",input_tokens=20,output_tokens=10)
    llm.write.side_effect=invoke
    result,_=run(content,request(content,selection),llm)
    assert result.status in ("stale","denied") and result.kind is None and not result.generated_text
    llm.write.assert_awaited_once()


@pytest.mark.parametrize("bad", ["empty","unknown_ref","extra_patch","usage","provider","timeout"])
def test_invalid_output_and_provider_failure_are_not_success_or_retried(content,selection,bad):
    llm=model()
    if bad=="empty": llm=model(text="  ")
    elif bad=="unknown_ref": llm=model(used_refs=("foreign-ref",))
    elif bad=="extra_patch": llm=model(patches=[{"span":[0,999],"after":"outside"}])
    elif bad=="usage": llm=model(output_tokens=100000)
    else: llm.write.side_effect=TimeoutError() if bad=="timeout" else RuntimeError("private provider detail")
    result,_=run(content,request(content,selection),llm)
    assert result.status in ("blocked","timeout") and result.kind is None
    assert "private provider" not in result.model_dump_json()
    llm.write.assert_awaited_once()


@pytest.mark.parametrize("edit", [False,True])
def test_run_handler_uses_one_budgeted_call_and_checkpoints_references_only(content,selection,edit):
    from test_task_graph import task
    from app.runs.runner import TaskRunner,TaskOutput
    from app.runs.orchestrator import REGISTRY
    req=request(content,selection if edit else None)
    root=task(content.scope,"context","context")
    async def context_handler(slice,ctx):
        return TaskOutput(output_schema="ContextPacket.v1",output_ref="context:fixture",is_mock=True)
    llm=model();handler=WritingHandler(req,content=content,model=llm)
    op="editing" if edit else "writing"
    runner=TaskRunner("run1",(root,*writing_tasks(req,context_task=root)),scope=content.scope,
        manifest=CanonicalAdapter(content).manifest(content.scope),allowed_operations=("context",op),
        handlers={"context":context_handler,op:handler},wants_change=True,draft_requested=True)
    result=asyncio.run(runner.run())
    assert REGISTRY[op].handler is writing
    assert result.status=="succeeded" and result.accounted.model_calls==1 and handler.result.status=="ok"
    assert "차분히" not in result.model_dump_json() and "synthetic-grant" not in result.model_dump_json()
    assert not any(t.operation in ("world_plot",) for t in runner.tasks)


@pytest.mark.parametrize("edit", [False, True])
def test_content_utf16_document_size_limit_is_checked_before_returning_a_proposal(content,edit):
    if edit:
        version=next(r.version for r in content.rows if r.version.document_id=="m3")
        text="x"*39990+"\n\n말."
        content.rows=tuple(replace(r,text=text) if r.version==version else r for r in content.rows)
        selected=ExactSource(version=version,span=(39992,39994),source_hash=sha256("말.".encode()).hexdigest())
        req=request(content,selected)
        llm=model(text="새"*100)
    else:
        req=request(content)
        llm=model(text="😀"*20001)
    result,_=run(content,req,llm)
    assert result.status=="blocked" and result.kind is None
    llm.write.assert_awaited_once()


@pytest.mark.parametrize("bad", ["existing_episode","long_title","no_voice_example"])
def test_reservation_and_voice_preconditions_are_verified_without_model(content,selection,bad):
    if bad=="long_title":
        content.rows=tuple(r for r in content.rows if r.version.document_id!="future")
    if bad=="no_voice_example":
        req=request(content,selection,style_examples=())
    else:
        title="😀"*61 if bad=="long_title" else "새 회차"
        req=request(content,save_requested=True,create_target=CreateTarget(work_id="w1",document_id="reserved-4",episode=4,title=title,work_revision=0))
    result,llm=run(content,req)
    assert result.status=="blocked" and result.kind is None
    llm.write.assert_not_called()
