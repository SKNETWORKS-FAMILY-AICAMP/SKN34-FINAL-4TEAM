package ai.storyfork.core.world.studio.repository

import ai.storyfork.core.world.studio.entity.WorldSaveRequest
import ai.storyfork.core.world.studio.entity.WorldSaveKey
import org.springframework.data.jpa.repository.JpaRepository

interface WorldSaveRequestRepository : JpaRepository<WorldSaveRequest, WorldSaveKey> {
}
