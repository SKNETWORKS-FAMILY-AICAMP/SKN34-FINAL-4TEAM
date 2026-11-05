package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkSourceSettingEntity
import org.springframework.data.jpa.repository.*

interface ForkSourceSettingRepository : JpaRepository<ForkSourceSettingEntity, ForkSourceSettingEntity.Key> {
    fun findAllByForkWorkId(forkWorkId: String): List<ForkSourceSettingEntity>
}
