package ai.storyfork.core.work.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "work")
class WorkEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "owner_id")
    var ownerId: String = "",
    @field:Column(name = "title")
    var title: String = "",
    @field:Column(name = "description")
    var description: String = "",
    @field:Column(name = "origin_kind")
    var originKind: String = "",
    @field:Column(name = "revision")
    var revision: Int = 0,
    @field:Column(name = "deleted_episode_revision")
    var deletedEpisodeRevision: Int = 0,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "audience_rating")
    var audienceRating: String? = null,
    @field:Column(name = "creation_type")
    var creationType: String = "original",
)
