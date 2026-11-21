package ai.storyfork.content.world.service.dto

import java.util.UUID

data class ManuscriptCharacterDocs(val soul:String,val goal:String,val episodes:Map<String,String>)
data class ManuscriptCard(val key:String,val cardType:String,val title:String,val aliases:List<String>,val body:String,
    @param:com.fasterxml.jackson.annotation.JsonAlias("firstAppearanceEpisode") val firstEpisode:Int,val characterDocs:ManuscriptCharacterDocs?=null)
data class ManuscriptRelation(val fromKey:String,val toKey:String,val label:String,val fromEpisode:Int,val ended:Boolean=false)
data class ManuscriptIdentityCandidate(val fromKey:String,val toKey:String,val episode:Int,val quote:String)
data class ManuscriptLoadPayload(val cards:List<ManuscriptCard>,val relations:List<ManuscriptRelation>,val identityCandidates:List<ManuscriptIdentityCandidate> = emptyList())
data class ManuscriptBuildRequest(val worldId:UUID,val key:String,val consent:Boolean,val resumeToken:UUID?=null)
data class ManuscriptLoadReceipt(val jobId:UUID,val stepId:UUID,val worldId:UUID,val draftRevision:Long,
    val relationshipVersion:Long,val cardIds:List<UUID>,val relationshipIds:List<UUID>)
data class ManuscriptBuildResponse(val jobId:UUID,val worldId:UUID,val status:String,val completedEpisodes:Int,
    val totalEpisodes:Int,val executionToken:UUID?,val failureCode:String?,val receipts:List<ManuscriptLoadReceipt>,val skippedItems:Int,
    /** 접수 때 쓴 요청 key다(소유자 응답). 화면은 저장한 기록이 없을 때 이 key와 [worldId]로 같은 작업을 재개한다. */
    val requestKey:String)
