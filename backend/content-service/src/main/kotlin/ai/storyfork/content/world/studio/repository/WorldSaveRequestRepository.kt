package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldSaveRequest
import ai.storyfork.content.world.studio.entity.WorldSaveKey
import org.springframework.data.jpa.repository.JpaRepository

interface WorldSaveRequestRepository : JpaRepository<WorldSaveRequest, WorldSaveKey> {
}
