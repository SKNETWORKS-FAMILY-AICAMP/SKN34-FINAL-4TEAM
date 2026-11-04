package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.WorldSaveRequest
import ai.storyfork.core.world.entity.WorldSaveKey
import org.springframework.data.jpa.repository.JpaRepository

interface WorldSaveRequestRepository : JpaRepository<WorldSaveRequest, WorldSaveKey> {
}
