package ai.storyfork.core.episode_version.repository

import ai.storyfork.core.episode_version.entity.CheckpointEpisodeEntity
import org.springframework.data.jpa.repository.*

interface CheckpointEpisodeRepository : JpaRepository<CheckpointEpisodeEntity, CheckpointEpisodeEntity.Key> {
    fun findAllByCheckpointId(checkpointId: String): List<CheckpointEpisodeEntity>
}
