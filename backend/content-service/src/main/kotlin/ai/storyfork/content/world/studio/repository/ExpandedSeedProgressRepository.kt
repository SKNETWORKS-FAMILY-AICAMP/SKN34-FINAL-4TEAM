package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.ExpandedSeedProgress
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface ExpandedSeedProgressRepository:JpaRepository<ExpandedSeedProgress,UUID> {
    fun findAllByCompletedFalse():List<ExpandedSeedProgress>
}
