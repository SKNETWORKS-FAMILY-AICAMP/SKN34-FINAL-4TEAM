package ai.storyfork.content.episode_version.repository

import ai.storyfork.content.episode_version.entity.CheckpointEntity
import org.springframework.data.jpa.repository.*

interface CheckpointRepository : JpaRepository<CheckpointEntity, String> {

}
