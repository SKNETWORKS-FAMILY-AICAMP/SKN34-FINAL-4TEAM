package ai.storyfork.core.work.entity

import jakarta.persistence.*

@Entity
@Table(name = "work_hashtag")
class WorkHashtagEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "tag")
    var tag: String = "",
    @field:Column(name = "position")
    var position: Int = 0,
)
