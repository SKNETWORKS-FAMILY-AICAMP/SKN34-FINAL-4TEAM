package ai.storyfork.content.episode_version.repository

import ai.storyfork.content.episode_version.entity.CheckpointEpisodeEntity
import org.springframework.data.jpa.repository.*

interface CheckpointEpisodeRepository : JpaRepository<CheckpointEpisodeEntity, CheckpointEpisodeEntity.Key> {
    fun findAllByCheckpointId(checkpointId: String): List<CheckpointEpisodeEntity>
}
