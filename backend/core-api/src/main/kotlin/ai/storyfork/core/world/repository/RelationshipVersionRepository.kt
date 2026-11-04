package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.RelationshipVersion
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RelationshipVersionRepository : JpaRepository<RelationshipVersion, UUID> {
    @Query("select v.relationId, max(v.versionNo) from RelationshipVersion v where v.worldId=:world group by v.relationId")
    fun versionNumbers(@Param("world") world: UUID): List<Array<Any>>
}
