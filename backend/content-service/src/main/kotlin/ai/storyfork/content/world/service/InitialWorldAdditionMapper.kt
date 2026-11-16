package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.helper.RelationshipInputHelper
import java.util.UUID

/** 승인 내용만 새 의미 카드/관계로 매핑한다. 기존 엔터티 카드와 원문은 입력에 넣지 않는다. */
object InitialWorldAdditionMapper {
    fun build(analysisId:UUID,applicationId:UUID,draft:WorldDraftResponse,decisions:List<InitialWorldDecisionRecord>,ids:Map<UUID,UUID>):EditWorldDraftRequest {
        require(ids.values.distinct().size==ids.size)
        require(ids.values.none { id -> draft.cards.any { it.id==id } || draft.relationships.any { it.id==id } })
        val cards=mutableListOf<CardPayload>();val relations=mutableListOf<RelationshipPayload>()
        decisions.forEach { d ->
            require(d.state=="approved")
            val c=d.content;val id=ids.getValue(d.candidateId)
            val metadata=mapOf("preprocessing" to mapOf("semanticType" to c.type,"provenance" to c.provenance,
                "analysisId" to analysisId.toString(),"candidateId" to d.candidateId.toString(),"decisionSequence" to d.sequence,
                "basisDraftRevision" to draft.draftRevision,"evidence" to c.evidence,"condition" to c.condition,
                "timeText" to c.timeText,"polarity" to c.polarity),
                "studio" to mapOf("item" to mapOf("id" to id.toString(),"kind" to "note",
                    "subjectId" to c.subjectId?.toString(),"relatedIds" to c.relatedEntityIds.map { it.toString() })))
            if(c.type=="relation") {
                val r=requireNotNull(c.relation)
                relations+=RelationshipPayload(id,r.sourceCardId,r.targetCardId,r.category,c.text,r.label,r.direction,r.polarity,metadata)
            } else {
                cards+=CardPayload(id,c.title,c.text,when(c.type) { "rule"->"rule";"event"->"event";else->"other" },
                    if(c.type=="event") "history" else "basic",semanticMetadata=metadata)
            }
        }
        require(draft.cards.count { it.lifecycle=="active" }+cards.size<=1000)
        fun signature(r:RelationshipPayload):List<Any?> {
            val ends=listOf(r.sourceCardId.toString(),r.targetCardId.toString())
            return (if(r.direction=="symmetric") ends.sorted() else ends)+listOf(r.category,r.direction,r.label,r.polarity)
        }
        val existing=draft.relationships.map(::signature).toMutableSet()
        relations.forEach { require(existing.add(signature(it))) { "중복 관계입니다." } }
        val known=(draft.cards.filter { it.lifecycle=="active" }.map { it.id }+cards.map { it.id }).toSet()
        // Existing world validation also runs in edit(); this preflight must precede reservation.
        if(relations.isNotEmpty()) RelationshipInputHelper.merge(draft.relationships,relations,false,known)
        return EditWorldDraftRequest(draft.draftRevision,draft.name,draft.description,cards,relations,"initial-application:$applicationId",false)
    }
}
