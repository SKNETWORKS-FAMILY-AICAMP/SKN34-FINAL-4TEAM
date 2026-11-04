package ai.storyfork.core.episode_version.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "episode_version")
@Immutable
class EpisodeVersionEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "episode_id")
    var episodeId: String = "",
    @field:Column(name = "content_version_id")
    var contentVersionId: String = "",
    @field:Column(name = "revision_no")
    var revisionNo: Int = 0,
    @field:Column(name = "title")
    var title: String = "",
    @field:Column(name = "content")
    var content: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "is_saved")
    var isSaved: Boolean = true,
    @field:Column(name = "work_world_history_id")
    var workWorldHistoryId: String? = null,
    @field:Column(name = "restored_from_id")
    var restoredFromId: String? = null,
)
