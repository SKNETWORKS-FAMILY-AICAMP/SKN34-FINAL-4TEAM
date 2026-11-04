package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.RelationshipDraft
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RelationshipDraftRepository : JpaRepository<RelationshipDraft, UUID> {
    fun findAllByWorldId(worldId: UUID): List<RelationshipDraft>
    @Modifying(clearAutomatically=true,flushAutomatically=true)
    @Query("delete from RelationshipDraft d where d.worldId=:world")
    fun deleteWorldDrafts(@Param("world") world: UUID)
}
