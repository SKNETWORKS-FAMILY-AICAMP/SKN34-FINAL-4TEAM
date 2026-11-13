package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldDecision
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldDecisionRepository : JpaRepository<InitialWorldDecision, UUID> {
    fun findByCandidateIdAndRequestKey(candidateId:UUID,requestKey:String):InitialWorldDecision?
    fun findFirstByCandidateIdOrderBySequenceDesc(candidateId:UUID):InitialWorldDecision?
    fun findAllByWorldIdAndAnalysisIdOrderByCandidateIdAscSequenceAsc(worldId:UUID,analysisId:UUID):List<InitialWorldDecision>
}
