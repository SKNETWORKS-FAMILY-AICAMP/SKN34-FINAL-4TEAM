package ai.storyfork.operations.jobs.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

enum class JobStatus { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED }
enum class JobTrigger { SCHEDULE, MANUAL }

const val OPERATIONS_SCHEDULER = "operations-scheduler"

/** A schedule with a queued or running run does not start another. */
val ACTIVE_JOB_STATUSES = listOf(JobStatus.QUEUED, JobStatus.RUNNING)

/**
 * One execution of a schedule. The scheduler thread is its only writer (a retry only inserts a queued row),
 * so it carries no version column, and the row is saved again after each state change.
 */
@Entity
@Table(name = "job_run", schema = "operations")
class JobRunEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(name = "schedule_id", nullable = false, updatable = false)
    val scheduleId: UUID,
    @field:Column(nullable = false, updatable = false, length = 40)
    val kind: String,
    @field:Column(nullable = false, updatable = false, length = 40)
    val source: String = OPERATIONS_SCHEDULER,
    @field:Enumerated(EnumType.STRING)
    @field:Column(nullable = false, updatable = false, length = 20)
    val trigger: JobTrigger,
    @field:Enumerated(EnumType.STRING)
    @field:Column(nullable = false, length = 20)
    var status: JobStatus = JobStatus.QUEUED,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "started_at")
    var startedAt: Instant? = null,
    @field:Column(name = "finished_at")
    var finishedAt: Instant? = null,
    var done: Int? = null,
    var total: Int? = null,
    @field:Column(length = 500)
    var error: String? = null,
    @field:Column(name = "target_id", length = 100)
    var targetId: String? = null,
)
