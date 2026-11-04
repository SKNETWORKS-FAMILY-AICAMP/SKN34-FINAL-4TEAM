package ai.storyfork.content.work.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "fork_policy_history")
class ForkPolicyHistoryEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "allow_creation")
    var allowCreation: Boolean = false,
    @field:Column(name = "allow_publication")
    var allowPublication: Boolean = false,
    @field:Column(name = "episode_scope")
    var episodeScope: String = "all",
    @field:Column(name = "start_episode_id")
    var startEpisodeId: String? = null,
    @field:Column(name = "changed_at")
    var changedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "revision_no")
    var revisionNo: Int = 0,
)
