package ai.storyfork.content.episode_version.repository

import ai.storyfork.content.episode_version.entity.CheckpointSettingEntity
import org.springframework.data.jpa.repository.*

interface CheckpointSettingRepository : JpaRepository<CheckpointSettingEntity, CheckpointSettingEntity.Key> {
    fun findAllByCheckpointId(checkpointId: String): List<CheckpointSettingEntity>
}
