package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldAnalysis
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldAnalysisRepository : JpaRepository<InitialWorldAnalysis, UUID> {
    fun findByWorldIdAndRequestKey(worldId: UUID, requestKey: String): InitialWorldAnalysis?
    fun findAllByWorldIdOrderByCreatedAtDesc(worldId: UUID): List<InitialWorldAnalysis>
}
