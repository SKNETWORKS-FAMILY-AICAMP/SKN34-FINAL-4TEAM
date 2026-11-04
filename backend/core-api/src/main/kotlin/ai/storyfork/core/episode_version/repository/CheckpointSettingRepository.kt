package ai.storyfork.core.episode_version.repository

import ai.storyfork.core.episode_version.entity.CheckpointSettingEntity
import org.springframework.data.jpa.repository.*

interface CheckpointSettingRepository : JpaRepository<CheckpointSettingEntity, CheckpointSettingEntity.Key> {
    fun findAllByCheckpointId(checkpointId: String): List<CheckpointSettingEntity>
}
