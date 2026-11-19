package ai.storyfork.operations.jobs.repository

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import java.util.UUID
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository

interface ScheduledJobRepository : JpaRepository<ScheduledJobEntity, UUID> {
    fun findAllByEnabledTrue(): List<ScheduledJobEntity>

    /** ponytail: a handful of schedules, so the list is unpaged; page it when there are dozens. */
    fun findAllByOrderByCreatedAtDescIdDesc(): List<ScheduledJobEntity>
}

interface JobRunRepository : JpaRepository<JobRunEntity, UUID> {
    fun findAllByStatusOrderByCreatedAtAscIdAsc(status: JobStatus): List<JobRunEntity>
    fun findAllByStatus(status: JobStatus, page: Pageable): Page<JobRunEntity>
    fun findAllByKind(kind: String, page: Pageable): Page<JobRunEntity>
    fun findAllByStatusAndKind(status: JobStatus, kind: String, page: Pageable): Page<JobRunEntity>
    fun existsByScheduleIdAndStatusIn(scheduleId: UUID, statuses: Collection<JobStatus>): Boolean
    fun findFirstByScheduleIdOrderByCreatedAtDescIdDesc(scheduleId: UUID): JobRunEntity?
    fun existsByRetryOf(retryOf: UUID): Boolean
}
