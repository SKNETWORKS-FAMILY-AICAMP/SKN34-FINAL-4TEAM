package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingCardVersion
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface SettingCardVersionRepository : JpaRepository<SettingCardVersion, UUID> {
    @Query("select v.cardId, max(v.versionNo) from SettingCardVersion v where v.worldId=:world group by v.cardId")
    fun versionNumbers(@Param("world") world: UUID): List<Array<Any>>
}
