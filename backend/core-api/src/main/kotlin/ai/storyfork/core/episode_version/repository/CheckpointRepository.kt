package ai.storyfork.core.episode_version.repository

import ai.storyfork.core.episode_version.entity.CheckpointEntity
import org.springframework.data.jpa.repository.*

interface CheckpointRepository : JpaRepository<CheckpointEntity, String> {

}
