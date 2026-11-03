package ai.storyfork.core.publication.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "work_publication_history")
class WorkPublicationHistoryEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "revision_no")
    var revisionNo: Int = 0,
    @field:Column(name = "visibility")
    var visibility: String = "",
    @field:Column(name = "changed_at")
    var changedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
