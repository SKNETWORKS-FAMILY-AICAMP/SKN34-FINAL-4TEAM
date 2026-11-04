package ai.storyfork.core.fork.repository

import ai.storyfork.core.fork.entity.ForkSourceSettingEntity
import org.springframework.data.jpa.repository.*

interface ForkSourceSettingRepository : JpaRepository<ForkSourceSettingEntity, ForkSourceSettingEntity.Key> {
    fun findAllByForkWorkId(forkWorkId: String): List<ForkSourceSettingEntity>
}
