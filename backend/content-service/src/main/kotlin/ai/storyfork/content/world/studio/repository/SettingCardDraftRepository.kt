package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.SettingCardDraft
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface SettingCardDraftRepository : JpaRepository<SettingCardDraft, UUID> {
    fun findAllByWorldId(worldId: UUID): List<SettingCardDraft>
    @Modifying(clearAutomatically=true,flushAutomatically=true)
    @Query("delete from SettingCardDraft d where d.worldId=:world")
    fun deleteWorldDrafts(@Param("world") world: UUID)
}
