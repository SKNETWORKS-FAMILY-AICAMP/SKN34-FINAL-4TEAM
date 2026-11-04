package ai.storyfork.content.episode_version.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "checkpoint")
class CheckpointEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "episode_id")
    var episodeId: String = "",
    @field:Column(name = "basis_episode_version_id")
    var basisEpisodeVersionId: String = "",
    @field:Column(name = "graph_state_ref")
    var graphStateRef: String? = null,
    @field:Column(name = "status")
    var status: String = "content_only",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
