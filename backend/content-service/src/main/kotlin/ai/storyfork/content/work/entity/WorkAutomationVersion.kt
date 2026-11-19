package ai.storyfork.content.work.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "work_automation_version")
class WorkAutomationVersion(
    @field:Id
    val id: String = "",
    @field:Column(name = "work_id")
    val workId: String = "",
    @field:Column(name = "revision_no")
    val revisionNo: Int = 0,
    @field:Column(name = "writing_mode")
    val writingMode: String = "",
    @field:Column(name = "changed_at")
    val changedAt: Instant = Instant.now(),
)
