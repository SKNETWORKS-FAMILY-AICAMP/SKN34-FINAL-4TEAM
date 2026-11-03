package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingDocumentEntity
import org.springframework.data.jpa.repository.*

interface SettingDocumentRepository : JpaRepository<SettingDocumentEntity, String> {
    fun findAllByWorldId(worldId: String): List<SettingDocumentEntity>
}
