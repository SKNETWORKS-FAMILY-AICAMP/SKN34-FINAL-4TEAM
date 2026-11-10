package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldCandidate
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldCandidateRepository : JpaRepository<InitialWorldCandidate, UUID> {
    fun findAllByWorldIdAndAnalysisIdOrderByLocalRef(worldId: UUID, analysisId: UUID): List<InitialWorldCandidate>
}
