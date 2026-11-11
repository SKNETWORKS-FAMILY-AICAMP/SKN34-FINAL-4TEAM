package ai.storyfork.content.proposal.domain

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.episodeId
import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content.proposal.service.dto.*

/** 모델은 본문만 제안한다. 대상·연산·근거·기준 판은 Content가 복원한다. */
internal fun generatedChange(request: AiRunDispatchRequest,base: Int,title: String,body: String,
                             draftRevision: Int,text: String,citations: List<AiRunCitation>): PrepareChangeSetRequest {
    checkContent(text.isNotBlank() && text.length<=40000,502,"생성된 원고를 확인할 수 없어요.")
    val edit=request.operation=="edit"
    checkContent(edit || request.operation in setOf("next_draft","expand_conti"),422,"원고 제안 작업이 아니에요.")
    val number=request.basisEpisode
    val id=episodeId(request.workId,number)
    val draft=request.targetRefs.singleOrNull {it.kind=="draft" && it.documentId==id && it.workId==request.workId}
    val span=if(edit) request.selection?.let {ChangeSpan(it.start,it.end)} else null
    val evidence=mutableListOf<ChangeEvidence>()
    if(edit || (draft!=null && body.isNotEmpty())) {
        checkContent(draft!=null && draft.revision==draftRevision.toString() && (!edit || request.selection?.revision==draftRevision),
            409,"선택한 원고 판본이 변경됐어요.")
        val area=if(edit) checkNotNull(span) else ChangeSpan(0,body.length)
        val digest=ChangeSetPolicy.hash(ChangeSetPolicy.quote(body,area))
        checkContent(!edit || digest==request.selection?.sourceHash,409,"선택한 원문이 변경됐어요.")
        evidence+=ChangeEvidence("draft",draft!!,area,digest,false)
    }
    citations.forEachIndexed { i,c ->
        checkContent(c.source in request.targetRefs && c.source.kind=="manuscript" && c.span.size==2 &&
            c.episode in 1..number && c.sourceHash==ChangeSetPolicy.hash(c.quote),409,"인용 판본을 확인해 주세요.")
        evidence+=ChangeEvidence("quote-$i",c.source,ChangeSpan(c.span[0],c.span[1]),c.sourceHash,false)
    }
    checkContent(evidence.isNotEmpty(),422,"검증할 원문 근거가 없어 적용할 제안을 만들 수 없어요.")
    val target=if(edit) ChangeTarget("draft",id,number,draftRevision,ChangeSetPolicy.documentHash(title,body))
        else ChangeTarget("draft",episodeId(request.workId,Math.incrementExact(number)),number+1,null,null)
    val operation=ChangeOperation(if(edit) "replace_span" else "create",target,span,text,
        if(edit) emptyList() else listOf(ChangeField("title","${target.episode}화")),evidence.map {it.id})
    return PrepareChangeSetRequest(request.runId,request.forkId,base,listOf(operation),evidence,false)
}
