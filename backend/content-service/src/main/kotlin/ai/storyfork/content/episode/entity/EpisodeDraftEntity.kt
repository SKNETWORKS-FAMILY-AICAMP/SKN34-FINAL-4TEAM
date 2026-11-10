package ai.storyfork.content.episode.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "episode_draft")
class EpisodeDraftEntity(
    @field:Id @field:Column(name = "episode_id")
    var episodeId: String = "",
    @field:Column(name = "title")
    var title: String = "",
    @field:Column(name = "content")
    var content: String = "",
    @field:Column(name = "edit_revision")
    var editRevision: Int = 0,
    @field:Column(name = "updated_at")
    var updatedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "author_note", length = 2000)
    var authorNote: String = "",
)
