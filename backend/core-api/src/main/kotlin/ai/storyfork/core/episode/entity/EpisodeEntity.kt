package ai.storyfork.core.episode.entity

import jakarta.persistence.*

@Entity
@Table(name = "episode")
class EpisodeEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "sequence")
    var sequence: Int = 0,
)
