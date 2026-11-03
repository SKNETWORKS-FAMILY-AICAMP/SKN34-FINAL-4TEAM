package ai.storyfork.core.work.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "work_world_history")
class WorkWorldHistoryEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "world_id")
    var worldId: String = "",
    @field:Column(name = "revision_no")
    var revisionNo: Int = 0,
    @field:Column(name = "changed_at")
    var changedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
