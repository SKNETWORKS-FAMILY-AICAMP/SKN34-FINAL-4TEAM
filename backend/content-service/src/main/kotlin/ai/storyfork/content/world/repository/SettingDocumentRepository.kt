package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingDocumentEntity
import org.springframework.data.jpa.repository.*

interface SettingDocumentRepository : JpaRepository<SettingDocumentEntity, String> {
    fun findAllByWorldId(worldId: String): List<SettingDocumentEntity>
}
