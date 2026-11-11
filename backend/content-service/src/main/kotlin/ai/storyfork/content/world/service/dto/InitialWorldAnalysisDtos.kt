package ai.storyfork.content.world.service.dto

import ai.storyfork.content.world.service.InitialWorldBasis
import ai.storyfork.content.world.service.InitialWorldEvidence
import java.util.UUID

data class InitialWorldAnalysisRequest(val key:String,val expectedDraftRevision:Long)
data class InitialWorldRelation(val sourceCardId:UUID,val targetCardId:UUID,val category:String,
    val label:String,val direction:String,val polarity:String)
data class InitialWorldCandidateOutput(val localRef:String,val type:String,val title:String,val text:String,
    val subjectId:UUID?,val relatedEntityIds:List<UUID>,val provenance:String,val evidence:List<InitialWorldEvidence>,
    val relation:InitialWorldRelation?,val condition:String,val timeText:String,val polarity:String)
data class InitialWorldOutput(val schemaVersion:String,val candidates:List<InitialWorldCandidateOutput>,val diagnostics:List<String>)
/** #219 AnalysisResponse. 실패 사유는 별도 HTTP 헤더로 제공해 기존 JSON 계약을 유지한다. */
data class InitialWorldAnalysisResponse(val analysisId:UUID,val basis:InitialWorldBasis,val executionStatus:String,
    val freshness:String,val output:InitialWorldOutput?,val candidateIds:Map<String,UUID>,val decisions:List<Any> = emptyList())
data class InitialWorldStoredCandidate(val candidateId:UUID,val content:InitialWorldCandidateOutput)
