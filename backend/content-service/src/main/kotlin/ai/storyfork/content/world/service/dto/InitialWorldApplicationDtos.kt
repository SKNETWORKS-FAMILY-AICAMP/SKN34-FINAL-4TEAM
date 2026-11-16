package ai.storyfork.content.world.service.dto

import java.util.UUID

data class InitialWorldSelection(val candidateId:UUID,val decisionSequence:Long)
data class InitialWorldApplicationRequest(val key:String,val expectedDraftRevision:Long,val candidates:List<InitialWorldSelection>)
data class InitialWorldApplicationResponse(val applicationId:UUID,val status:String,val baseDraftRevision:Long,
    val resultDraftRevision:Long?,val createdCardIds:List<UUID>,val createdRelationshipIds:List<UUID>)
